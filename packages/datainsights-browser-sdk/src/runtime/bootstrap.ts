import { isValidSelector } from '../config/config';
import { resolveRemoteConfig } from '../config/remote-config';
import type {
  DataInsightsBootstrapOptions,
  DataInsightsClient,
  ResolvedApplicationConfig,
  SDKErrorCode,
  SDKResult,
} from '../public/types';
import { createHttpTransport } from '../transport/http';
import type { Transport } from '../transport/types';

interface BootstrapEventTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface BootstrapDependencies {
  readonly document?: BootstrapEventTarget;
  readonly resolveConfig?: (
    appKey: string,
  ) => Promise<SDKResult<Readonly<ResolvedApplicationConfig>>>;
  readonly createTransport?: (
    config: Readonly<ResolvedApplicationConfig>,
  ) => Transport;
  readonly workerUrl?: string;
  readonly recordError?: (code: SDKErrorCode) => void;
}

export interface InstalledBootstrap {
  readonly client: DataInsightsClient;
  dispose(): void;
}

let defaultWorkerUrl: string | undefined;
let defaultConfigOrigin: string | undefined;

export function setBootstrapWorkerUrl(workerUrl: string | undefined): void {
  defaultWorkerUrl = workerUrl;
}

export function setBootstrapConfigOrigin(origin: string | undefined): void {
  defaultConfigOrigin = origin;
}

function invalidBootstrap(): SDKResult<never> {
  return {
    ok: false,
    error: {
      code: 'INVALID_CONFIG',
      message: 'Bootstrap configuration is invalid.',
    },
  };
}

function validateBootstrapOptions(
  value: unknown,
): value is DataInsightsBootstrapOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const options = value as Record<string, unknown>;
  const allowed = new Set([
    'appKey',
    'consent',
    'resolveUserId',
    'onDeliveryStateChange',
    'privacy',
    'debug',
  ]);
  if (!Object.keys(options).every((key) => allowed.has(key))) return false;
  if (
    typeof options.appKey !== 'string' ||
    typeof options.consent !== 'object' ||
    options.consent === null ||
    Array.isArray(options.consent)
  ) {
    return false;
  }
  const consent = options.consent as Record<string, unknown>;
  if (
    !Object.keys(consent).every((key) =>
      ['startSelector', 'noticeVersion'].includes(key),
    ) ||
    !isValidSelector(consent.startSelector) ||
    typeof consent.noticeVersion !== 'string' ||
    consent.noticeVersion.trim().length === 0 ||
    consent.noticeVersion.length > 128
  ) {
    return false;
  }
  return (
    (options.resolveUserId === undefined ||
      typeof options.resolveUserId === 'function') &&
    (options.onDeliveryStateChange === undefined ||
      typeof options.onDeliveryStateChange === 'function') &&
    (options.debug === undefined || typeof options.debug === 'boolean')
  );
}

function matchesSelector(event: Event, selector: string): boolean {
  const target = event.target as {
    closest?: (value: string) => unknown;
  } | null;
  return (
    typeof target?.closest === 'function' && Boolean(target.closest(selector))
  );
}

export async function installBootstrap(
  client: DataInsightsClient,
  candidate: unknown,
  dependencies: BootstrapDependencies = {},
): Promise<SDKResult<InstalledBootstrap>> {
  if (!validateBootstrapOptions(candidate)) return invalidBootstrap();

  const eventTarget = dependencies.document ?? globalThis.document;
  if (!eventTarget) return invalidBootstrap();
  const trustedConfigOrigin = defaultConfigOrigin;
  const resolveConfig =
    dependencies.resolveConfig ??
    ((appKey: string, signal?: AbortSignal) =>
      resolveRemoteConfig(appKey, {
        trustedConfigOrigin,
        signal,
      }));
  const resolved = await resolveConfig(candidate.appKey);
  if (!resolved.ok) return resolved;

  const transport = dependencies.createTransport
    ? dependencies.createTransport(resolved.value)
    : createHttpTransport(resolved.value, undefined, { resolveConfig });
  const initialized = client.init({
    appKey: candidate.appKey,
    transport,
    ...(dependencies.workerUrl ?? defaultWorkerUrl
      ? { workerUrl: dependencies.workerUrl ?? defaultWorkerUrl }
      : {}),
    ...(candidate.onDeliveryStateChange
      ? { onDeliveryStateChange: candidate.onDeliveryStateChange }
      : {}),
    ...(candidate.privacy ? { privacy: candidate.privacy } : {}),
    ...(candidate.debug === undefined ? {} : { debug: candidate.debug }),
  });
  if (!initialized.ok) {
    await transport.destroy?.();
    return initialized;
  }

  let disposed = false;
  let starting = false;
  let started = false;
  const listener: EventListener = (event) => {
    if (
      disposed ||
      starting ||
      started ||
      !matchesSelector(event, candidate.consent.startSelector)
    ) {
      return;
    }
    starting = true;
    void (async () => {
      const granted = client.consent.grant({
        noticeVersion: candidate.consent.noticeVersion,
        action: 'start-insurance',
      });
      if (!granted.ok) {
        dependencies.recordError?.(granted.error.code);
        return;
      }
      let userId: string | undefined;
      try {
        userId = await candidate.resolveUserId?.();
      } catch (_error) {
        dependencies.recordError?.('IDENTITY_INVALID');
      }
      const result = await client.start(userId ? { userId } : {});
      if (result.ok) started = true;
      else dependencies.recordError?.(result.error.code);
    })()
      .catch(() => dependencies.recordError?.('INVALID_STATE'))
      .finally(() => {
        starting = false;
      });
  };
  eventTarget.addEventListener('click', listener, true);

  return {
    ok: true,
    value: Object.freeze({
      client,
      dispose() {
        if (disposed) return;
        disposed = true;
        eventTarget.removeEventListener('click', listener, true);
        void transport.destroy?.();
      },
    }),
  };
}
