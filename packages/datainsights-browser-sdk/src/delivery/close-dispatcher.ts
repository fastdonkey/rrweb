import type { Transport } from '../transport/types';
import { CloseStore } from './close-store';
export class CloseDispatcher {
  private flight?: Promise<void>;
  private stopped = false;
  private blocked = false;
  private retryAt = 0;
  private active?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private readonly online = () => {
    void this.dispatch();
  };
  constructor(
    private readonly store: CloseStore,
    private readonly transport: Transport,
    private readonly target?: EventTarget,
  ) {}
  start(): void {
    if (this.timer !== undefined) return;
    this.target?.addEventListener('online', this.online);
    this.timer = setInterval(this.online, 30000);
    void this.dispatch();
  }
  dispatch(): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.run()
      .catch(() => undefined)
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }
  private async run(): Promise<void> {
    if (
      this.stopped ||
      this.blocked ||
      Date.now() < this.retryAt ||
      !this.transport.sendClose
    )
      return;
    for (const declaration of (await this.store.list()).slice(0, 100)) {
      if (this.stopped || this.blocked) return;
      const controller = new AbortController();
      this.active = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const result = await this.transport.sendClose(declaration, {
          signal: controller.signal,
        });
        if (
          result.status === 'accepted' &&
          result.closeId === declaration.payload.closeId
        )
          await this.store.acknowledge(declaration);
        else {
          this.blocked = result.status === 'rejected';
          if (result.status !== 'accepted')
            this.retryAt = Date.now() + (result.retryAfterMs ?? 1000);
          return;
        }
      } finally {
        clearTimeout(timeout);
        this.active = undefined;
      }
    }
  }
  destroy(): void {
    this.stopped = true;
    this.active?.abort();
    if (this.timer !== undefined) clearInterval(this.timer);
    this.target?.removeEventListener('online', this.online);
  }
}
