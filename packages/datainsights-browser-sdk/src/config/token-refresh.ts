import { resolveRemoteConfig } from './remote-config';
import type { ResolvedApplicationConfig, SDKResult } from '../public/types';

type Config = Readonly<ResolvedApplicationConfig>;
export interface TokenRefreshOptions {
  readonly resolveConfig?: (
    appKey: string,
    signal: AbortSignal,
  ) => Promise<SDKResult<Config>>;
  readonly now?: () => number;
}

/** One owner per transport; refresh never changes the AppKey or Outbox namespace. */
export class TokenRefresh {
  current: Config;
  blocked = false;
  private destroyed = false;
  private flight?: Promise<boolean>;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private retryAt = 0;
  private failures = 0;
  private readonly now: () => number;
  constructor(
    config: Config,
    private readonly fetchImpl: typeof fetch,
    private readonly options: TokenRefreshOptions = {},
  ) {
    this.current = config;
    this.now = options.now ?? Date.now;
    this.schedule();
  }
  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.destroyed || this.blocked) return;
    const delay = Math.max(
      1000,
      this.retryAt > this.now()
        ? this.retryAt - this.now()
        : Date.parse(this.current.expiresAt) - this.now() - 300000,
    );
    this.timer = setTimeout(() => {
      void this.refresh();
    }, Math.min(delay, 2147483647));
  }
  pause(): void {
    this.blocked = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.controller?.abort();
  }
  defer(): void {
    this.retryAt =
      this.now() + Math.min(60000, 1000 * 2 ** Math.min(this.failures++, 6));
    this.schedule();
  }
  async ready(): Promise<boolean> {
    if (this.destroyed || this.blocked) return false;
    if (this.now() < this.retryAt) return false;
    return Date.parse(this.current.expiresAt) - this.now() <= 300000
      ? this.refresh()
      : true;
  }
  refresh(rejected?: Config): Promise<boolean> {
    if (this.destroyed || this.blocked) return Promise.resolve(false);
    // A late 401 for an older generation reuses the already-refreshed token.
    if (rejected && rejected !== this.current) return Promise.resolve(true);
    if (this.flight) return this.flight;
    if (this.now() < this.retryAt) return Promise.resolve(false);
    const controller = new AbortController();
    this.controller = controller;
    this.flight = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      try {
        const resolver =
          this.options.resolveConfig ??
          ((appKey: string, signal: AbortSignal) =>
            resolveRemoteConfig(appKey, {
              fetchImpl: this.fetchImpl,
              signal,
              now: this.now,
            }));
        const result = await Promise.race([
          new Promise<never>((_, reject) => {
            abort = () => reject(new Error('refresh-cancelled'));
            controller.signal.addEventListener('abort', abort, { once: true });
          }),
          Promise.resolve().then(() =>
            resolver(this.current.appKey, controller.signal),
          ),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error('refresh-timeout'));
            }, 10000);
          }),
        ]);
        if (this.destroyed || this.blocked || controller.signal.aborted)
          return false;
        if (!result.ok) {
          if (result.error.code === 'APPLICATION_DISABLED') this.pause();
          else this.defer();
          return false;
        }
        if (
          result.value.appKey !== this.current.appKey ||
          !result.value.enabled ||
          Date.parse(result.value.expiresAt) <= this.now() + 300000 ||
          !Number.isFinite(Date.parse(result.value.expiresAt))
        ) {
          this.defer();
          return false;
        }
        this.current = result.value;
        this.failures = 0;
        this.retryAt = 0;
        return true;
      } catch (_error) {
        if (!this.destroyed && !this.blocked) this.defer();
        return false;
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        if (abort) controller.signal.removeEventListener('abort', abort);
        this.controller = undefined;
        this.flight = undefined;
        this.schedule();
      }
    })();
    return this.flight;
  }
  destroy(): void {
    this.destroyed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.controller?.abort();
  }
}
