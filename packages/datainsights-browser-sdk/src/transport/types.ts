import type {
  Capabilities,
  PendingBatch,
  RecoveryResult,
} from './recovery-protocol';
import type { CloseDeclaration } from '../delivery/close-store';
import type { RecordingBatchV1 } from '../pipeline/batcher';

export interface PersistedReceipt {
  readonly persisted: true;
  readonly batchId: string;
  readonly recordingId: string;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly contentHash: string;
}

export interface SequenceRange {
  readonly start: number;
  readonly end: number;
}

export interface ReconciliationResult {
  readonly recordingId: string;
  readonly contiguousSequenceEnd: number;
  readonly missingRanges: readonly SequenceRange[];
  readonly checkedAt: string;
}

export type TransportResult =
  | { readonly status: 'accepted'; readonly receipt: PersistedReceipt }
  | {
      readonly status: 'retryable';
      readonly retryAfterMs?: number;
      readonly reason?: string;
    }
  | { readonly status: 'rejected'; readonly reason: string };

export interface TransportContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly trigger:
    | 'immediate'
    | 'retry'
    | 'online'
    | 'scheduled'
    | 'pagehide'
    | 'startup'
    | 'manual';
}

export type CloseResult =
  | { status: 'accepted'; closeId: string }
  | { status: 'retryable' | 'rejected'; retryAfterMs?: number };
interface BaseTransport {
  capabilities?(): Promise<Readonly<Capabilities>>;
  reconcileBatches?(
    recordingId: string,
    traceId: string,
    pending: readonly PendingBatch[],
    context: { readonly signal: AbortSignal },
  ): Promise<RecoveryResult>;
  sendClose?(
    declaration: CloseDeclaration,
    context: { readonly signal: AbortSignal },
  ): Promise<CloseResult>;
  readonly name: string;
  flush?(context: { readonly signal: AbortSignal }): Promise<void>;
  destroy?(): Promise<void>;
}

export interface TestTransport extends BaseTransport {
  readonly capability: 'test-only';
  send(
    batch: Readonly<RecordingBatchV1>,
    context: Readonly<TransportContext>,
  ): Promise<TransportResult>;
  reconcile?(
    recordingId: string,
    context: { readonly signal: AbortSignal },
  ): Promise<ReconciliationResult>;
}

export interface PersistedReceiptTransport extends BaseTransport {
  readonly capability: 'persisted-receipt-v1';
  send(
    batch: Readonly<RecordingBatchV1>,
    context: Readonly<TransportContext>,
  ): Promise<TransportResult>;
  reconcile(
    recordingId: string,
    context: { readonly signal: AbortSignal },
  ): Promise<ReconciliationResult>;
}

export type Transport = TestTransport | PersistedReceiptTransport;
