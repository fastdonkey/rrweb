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

function headers(config: Readonly<ResolvedApplicationConfig>): Record<string, string> {
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

  constructor(
    private readonly config: Readonly<ResolvedApplicationConfig>,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(
    batch: Readonly<RecordingBatchV1>,
    context: Readonly<TransportContext>,
  ): Promise<TransportResult> {
    if (this.destroyed) {
      return { status: 'rejected', reason: 'transport-destroyed' };
    }
    for (const collector of this.config.collectorUrls) {
      try {
        const response = await this.fetchImpl(`${collector}/api/events`, {
          method: 'POST',
          headers: headers(this.config),
          body: JSON.stringify(batch),
          signal: context.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
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
    return { status: 'retryable', reason: 'network-error' };
  }

  async reconcile(
    recordingId: string,
    context: { readonly signal: AbortSignal },
  ): Promise<ReconciliationResult> {
    if (this.destroyed) throw new Error('RECONCILIATION_FAILED');
    for (const collector of this.config.collectorUrls) {
      try {
        const response = await this.fetchImpl(
          `${collector}/api/recordings/${encodeURIComponent(recordingId)}/delivery-state`,
          {
            method: 'GET',
            headers: headers(this.config),
            signal: context.signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          },
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

  async destroy(): Promise<void> {
    this.destroyed = true;
  }
}

export function createHttpTransport(
  config: Readonly<ResolvedApplicationConfig>,
  fetchImpl: typeof fetch = globalThis.fetch,
): PersistedReceiptTransport {
  return new ResolvedHttpTransport(config, fetchImpl);
}
