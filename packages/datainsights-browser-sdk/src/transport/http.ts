import {
  bounded,
  gzipJson,
  LEGACY,
  parseCapabilities,
  retryAfter,
  type Capabilities,
  type PendingBatch,
  type RecoveryResult,
  type RecoveryResponse,
} from './recovery-protocol';
export interface HttpTransportOptions extends TokenRefreshOptions {
  readonly capabilityDiscovery?: boolean;
  readonly gzip?: boolean;
}
import type { CloseDeclaration } from '../delivery/close-store';
import type { CloseResult } from './types';
import {
  TokenRefresh,
  type TokenRefreshOptions,
} from '../config/token-refresh';
import { validatePersistedReceipt } from '../delivery/receipt-validator';
import type { RecordingBatchV1 } from '../pipeline/batcher';
import type { ResolvedApplicationConfig } from '../public/types';
import type {
  PersistedReceiptTransport,
  ReconciliationResult,
  SequenceRange,
  TransportContext,
  TransportResult,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTransportResult(value: unknown): value is TransportResult {
  if (!isRecord(value)) return false;
  if (value.status === 'accepted') return isRecord(value.receipt);
  if (value.status === 'retryable') {
    return (
      (value.retryAfterMs === undefined ||
        (typeof value.retryAfterMs === 'number' &&
          Number.isInteger(value.retryAfterMs) &&
          value.retryAfterMs >= 0)) &&
      (value.reason === undefined || typeof value.reason === 'string')
    );
  }
  return value.status === 'rejected' && typeof value.reason === 'string';
}

function isRange(value: unknown): value is SequenceRange {
  return (
    isRecord(value) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    (value.start as number) >= 1 &&
    (value.end as number) >= (value.start as number)
  );
}

function parseReconciliation(
  recordingId: string,
  value: unknown,
): ReconciliationResult {
  if (
    !isRecord(value) ||
    value.recordingId !== recordingId ||
    !Number.isInteger(value.contiguousSequenceEnd) ||
    (value.contiguousSequenceEnd as number) < 0 ||
    !Array.isArray(value.missingRanges) ||
    !value.missingRanges.every(isRange) ||
    typeof value.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.checkedAt))
  ) {
    throw new Error('RECONCILIATION_FAILED');
  }
  return {
    recordingId,
    contiguousSequenceEnd: value.contiguousSequenceEnd as number,
    missingRanges: value.missingRanges,
    checkedAt: value.checkedAt,
  };
}

function headers(
  config: Readonly<ResolvedApplicationConfig>,
): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${config.uploadToken}`,
    'Content-Type': 'application/json',
    'X-App-Key': config.appKey,
    'X-Config-Version': config.configVersion,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

class ResolvedHttpTransport implements PersistedReceiptTransport {
  readonly name = 'resolved-http';
  readonly capability = 'persisted-receipt-v1';
  private destroyed = false;
  private readonly lifetime = new AbortController();
  private discoveries = new Map<string, Promise<Readonly<Capabilities>>>();
  private features?: { key: string; value: Readonly<Capabilities> };
  private gzipDisabled = new Set<string>();
  private uploadAfter = 0;
  private closeAfter = 0;
  private configKey(): string {
    return JSON.stringify([this.config.appKey, this.config.configVersion]);
  }
  capabilities(): Promise<Readonly<Capabilities>> {
    const key = this.configKey();
    const cached = this.discoveries.get(key);
    if (cached) return cached;
    const work = (async () => {
      if (this.options.capabilityDiscovery === false) return LEGACY;
      try {
        const result = await bounded(
          async (signal) => {
            for (let attempt = 0; ; attempt++) {
            const response = await this.request(
              '/sdk/v2/capabilities',
              {
                method: 'GET',
                signal,
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
              },
              0,
              true,
              false,
            );
            if ([429, 503].includes(response.status) && attempt < 2) {
              const delay = retryAfter(response) ?? 1000;
              await response.body?.cancel();
              await new Promise<void>((resolve, reject) => {
                const cancel = () => { clearTimeout(timer); reject(new Error('request-cancelled')); };
                const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
                signal.addEventListener('abort', cancel, { once: true });
                if (signal.aborted) cancel();
              });
              continue;
            }
            if (!response.ok && response.status !== 404) throw new Error('capability-unavailable');
            return response.ok
              ? parseCapabilities(await response.json()) ?? LEGACY
              : LEGACY;
            }
          },
          5000,
          this.lifetime.signal,
        );
        this.features = { key, value: result };
        return result;
      } catch {
        this.discoveries.delete(key);
        this.features = { key, value: LEGACY };
        return LEGACY;
      }
    })();
    this.discoveries.set(key, work);
    return work;
  }
  async reconcileBatches(
    recordingId: string,
    traceId: string,
    pending: readonly PendingBatch[],
    context: { readonly signal: AbortSignal },
  ): Promise<RecoveryResult> {
    if (this.destroyed || this.tokens.blocked) return { status: 'rejected' };
    if (pending.length < 1 || pending.length > 100)
      return { status: 'rejected' };
    try {
      return await bounded(
        async (signal) => {
          const response = await this.request(
            `/sdk/v2/recordings/${encodeURIComponent(recordingId)}/reconcile`,
            {
              method: 'POST',
              signal,
              body: JSON.stringify({ traceId, pendingBatches: pending }),
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
            },
            0,
            false,
            false,
          );
          if (response.status === 404) return { status: 'unsupported' };
          if (!response.ok)
            return isRetryableStatus(response.status) || response.status === 401
              ? { status: 'retryable', retryAfterMs: retryAfter(response) }
              : { status: 'rejected' };
          return {
            status: 'ok',
            value: (await response.json()) as RecoveryResponse,
          };
        },
        5000,
        context.signal,
      );
    } catch {
      return { status: 'retryable' };
    }
  }

  private readonly tokens: TokenRefresh;
  constructor(
    config: Readonly<ResolvedApplicationConfig>,
    private readonly fetchImpl: typeof fetch,
    private readonly options: HttpTransportOptions = {},
  ) {
    this.tokens = new TokenRefresh(config, fetchImpl, options);
  }
  private get config(): Readonly<ResolvedApplicationConfig> {
    return this.tokens.current;
  }
  private async request(
    path: string,
    init: RequestInit,
    index: number,
    retryAuthentication = true,
    pauseOnForbidden = true,
  ): Promise<Response> {
    if (!(await this.tokens.ready()) || this.destroyed || init.signal?.aborted)
      throw new Error('authorization-unavailable');
    const previous = this.config;
    const send = (config: Readonly<ResolvedApplicationConfig>) =>
      this.fetchImpl(
        `${config.collectorUrls[index] ?? config.collectorUrls[0]}${path}`,
        { ...init, headers: { ...headers(config), ...init.headers } },
      );
    const response = await send(previous);
    if (response.status === 403 && pauseOnForbidden) this.tokens.pause();
    if (response.status !== 401) return response;
    if (
      !(await this.tokens.refresh(previous)) ||
      this.destroyed ||
      init.signal?.aborted
    )
      throw new Error('authorization-unavailable');
    if (!retryAuthentication) return response;
    const retried = await send(this.config);
    if (retried.status === 403 && pauseOnForbidden) this.tokens.pause();
    if (retried.status === 401) this.tokens.defer();
    return retried;
  }

  async send(
    batch: Readonly<RecordingBatchV1>,
    context: Readonly<TransportContext>,
  ): Promise<TransportResult> {
    if (this.destroyed) {
      return { status: 'rejected', reason: 'transport-destroyed' };
    }
    if (this.tokens.blocked)
      return { status: 'rejected', reason: 'application-disabled' };
    if (batch.appKey !== this.config.appKey)
      return { status: 'rejected', reason: 'app-key-mismatch' };
    if (Date.now() < this.uploadAfter)
      return {
        status: 'retryable',
        reason: 'rate-limited',
        retryAfterMs: this.uploadAfter - Date.now(),
      };
    void this.capabilities();
    const raw = JSON.stringify(batch),
      key = this.configKey();
    let compressed =
      this.options.gzip !== false &&
      this.features?.key === key &&
      this.features.value.gzipHttp &&
      !this.gzipDisabled.has(key)
        ? await gzipJson(raw)
        : undefined;
    for (let index = 0; index < this.config.collectorUrls.length; index += 1) {
      try {
        let response = await this.request(
          `/api/events`,
          {
            method: 'POST',
            body: compressed ?? raw,
            headers: compressed ? { 'Content-Encoding': 'gzip' } : undefined,
            signal: context.signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          },
          index,
        );
        if (response.status === 415 && compressed) {
          this.gzipDisabled.add(key);
          compressed = undefined;
          response = await this.request(
            '/api/events',
            {
              method: 'POST',
              body: raw,
              signal: context.signal,
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
            },
            index,
          );
        }
        const advised = retryAfter(response);
        if (
          response.status === 429 ||
          (response.status >= 500 && advised !== undefined)
        ) {
          const delay = advised ?? 1000;
          this.uploadAfter = Date.now() + delay;
          return {
            status: 'retryable',
            reason: `http-${response.status}`,
            retryAfterMs: delay,
          };
        }
        if (!response.ok) {
          if (response.status === 401)
            return {
              status: 'retryable',
              reason: 'authorization-refresh-failed',
              retryAfterMs: 1000,
            };
          if (isRetryableStatus(response.status)) continue;
          return { status: 'rejected', reason: `http-${response.status}` };
        }
        const result: unknown = await response.json();
        if (!isTransportResult(result)) {
          return { status: 'retryable', reason: 'invalid-transport-result' };
        }
        if (
          result.status === 'accepted' &&
          !validatePersistedReceipt(batch, result).ok
        ) {
          return {
            status: 'retryable',
            reason: 'invalid-persisted-receipt',
          };
        }
        return result;
      } catch (_error) {
        if (context.signal.aborted) {
          return { status: 'retryable', reason: 'request-aborted' };
        }
      }
    }
    if (this.tokens.blocked)
      return { status: 'rejected', reason: 'application-disabled' };
    return { status: 'retryable', reason: 'network-error' };
  }

  async reconcile(
    recordingId: string,
    context: { readonly signal: AbortSignal },
  ): Promise<ReconciliationResult> {
    if (this.destroyed) throw new Error('RECONCILIATION_FAILED');
    for (let index = 0; index < this.config.collectorUrls.length; index += 1) {
      try {
        const response = await this.request(
          `/api/recordings/${encodeURIComponent(recordingId)}/delivery-state`,
          {
            method: 'GET',
            signal: context.signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          },
          index,
        );
        if (!response.ok) {
          if (isRetryableStatus(response.status)) continue;
          throw new Error('RECONCILIATION_FAILED');
        }
        return parseReconciliation(recordingId, await response.json());
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'RECONCILIATION_FAILED'
        ) {
          throw error;
        }
        if (context.signal.aborted) throw new Error('RECONCILIATION_FAILED');
      }
    }
    throw new Error('RECONCILIATION_FAILED');
  }

  async sendClose(
    declaration: CloseDeclaration,
    context: { readonly signal: AbortSignal },
  ): Promise<CloseResult> {
    if (
      this.destroyed ||
      this.tokens.blocked ||
      declaration.appKey !== this.config.appKey
    )
      return { status: 'rejected' };
    if (Date.now() < this.closeAfter)
      return {
        status: 'retryable',
        retryAfterMs: this.closeAfter - Date.now(),
      };
    if (
      this.options.capabilityDiscovery !== false &&
      !(await this.capabilities()).closeV2
    )
      return { status: 'retryable', retryAfterMs: 30000 };
    try {
      const response = await this.request(
        `/sdk/v2/${
          declaration.kind === 'recording' ? 'recordings' : 'traces'
        }/${encodeURIComponent(declaration.targetId)}/close`,
        {
          method: 'POST',
          body: JSON.stringify(declaration.payload),
          signal: context.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
        0,
      );
      if (!response.ok) {
        const delay = retryAfter(response);
        if (delay !== undefined) this.closeAfter = Date.now() + delay;
        return {
          status: [400, 403, 413, 422].includes(response.status)
            ? 'rejected'
            : 'retryable',
          retryAfterMs: delay,
        };
      }
      const body: unknown = await response.json();
      return isRecord(body) &&
        body.accepted === true &&
        body.closeId === declaration.payload.closeId
        ? { status: 'accepted', closeId: body.closeId }
        : { status: 'retryable' };
    } catch {
      return { status: this.tokens.blocked ? 'rejected' : 'retryable' };
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.lifetime.abort();
    this.tokens.destroy();
  }
}

export function createHttpTransport(
  config: Readonly<ResolvedApplicationConfig>,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  options?: HttpTransportOptions,
): PersistedReceiptTransport {
  return new ResolvedHttpTransport(config, fetchImpl, options);
}
