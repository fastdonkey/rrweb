import { sha256Hex } from '../delivery/integrity';
import { generateUuid } from '../shared/uuid';
import {
  serializeBatch,
  serializeBatchSync,
  type SerializedValue,
} from './serializer';

const DEFAULT_MAX_EVENTS = 100;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_SINGLE_EVENT_BYTES = 2 * 1024 * 1024;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

export type BatchReason =
  | 'count'
  | 'bytes'
  | 'interval'
  | 'segment'
  | 'stop'
  | 'manual';

export interface RecordingBatchContext {
  readonly sdkVersion: string;
  readonly rrwebVersion: string;
  readonly rrwebCommit: string;
  readonly appKey: string;
  readonly identity: {
    readonly type: 'host' | 'anonymous';
    readonly id: string;
  };
  readonly consent: {
    readonly noticeVersion: string;
    readonly action: 'start-insurance';
    readonly grantedAt: string;
  };
  readonly journeyId?: string;
  readonly sessionId: string;
  readonly recordingId: string;
  readonly segmentId: string;
}

export interface RecordingBatchV1 extends RecordingBatchContext {
  readonly schemaVersion: '1.0';
  readonly batchId: string;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly contentHash: string;
  readonly previousBatchHash?: string;
  readonly createdAt: string;
  readonly reason: BatchReason;
  readonly events: readonly unknown[];
}

export interface SealedRecordingBatch {
  readonly batch: Readonly<RecordingBatchV1>;
  readonly hashInput: SerializedValue;
  readonly serialized: SerializedValue;
}

export interface RecordingBatcherOptions {
  readonly maxEvents?: number;
  readonly maxBytes?: number;
  readonly maxSingleEventBytes?: number;
  readonly flushIntervalMs?: number;
  readonly createBatchId?: () => string;
  readonly now?: () => number;
  readonly onBatch?: (
    batch: Readonly<SealedRecordingBatch>,
  ) => void | Promise<void>;
}

export class BatchEventTooLargeError extends Error {
  readonly code = 'QUEUE_CAPACITY_EXCEEDED';

  constructor(readonly bytes: number, readonly maximumBytes: number) {
    super('Recording event exceeds the maximum supported batch event size.');
    this.name = 'BatchEventTooLargeError';
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : fallback;
}

export class RecordingBatcher {
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly maxSingleEventBytes: number;
  private readonly flushIntervalMs: number;
  private readonly createBatchId: () => string;
  private readonly now: () => number;
  private readonly onBatch?: RecordingBatcherOptions['onBatch'];
  private pending: unknown[] = [];
  private pendingBytes = 0;
  private nextSequence = 1;
  private previousBatchHash?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private operation: Promise<unknown> = Promise.resolve();
  private destroyed = false;

  constructor(
    private readonly context: Readonly<RecordingBatchContext>,
    options: RecordingBatcherOptions = {},
  ) {
    this.maxEvents = positiveInteger(options.maxEvents, DEFAULT_MAX_EVENTS);
    this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
    this.maxSingleEventBytes = positiveInteger(
      options.maxSingleEventBytes,
      DEFAULT_MAX_SINGLE_EVENT_BYTES,
    );
    this.flushIntervalMs = positiveInteger(
      options.flushIntervalMs,
      DEFAULT_FLUSH_INTERVAL_MS,
    );
    this.createBatchId =
      options.createBatchId ?? (() => generateUuid(globalThis.crypto));
    this.now = options.now ?? Date.now;
    this.onBatch = options.onBatch;
  }

  add(event: unknown): Promise<readonly Readonly<SealedRecordingBatch>[]> {
    return this.enqueue(async () => {
      this.assertActive();
      const eventBytes = serializeBatchSync(event).bytes.byteLength;
      if (eventBytes > this.maxSingleEventBytes) {
        throw new BatchEventTooLargeError(eventBytes, this.maxSingleEventBytes);
      }

      const sealed: SealedRecordingBatch[] = [];
      if (
        this.pending.length > 0 &&
        this.pendingBytes + eventBytes >= this.maxBytes
      ) {
        const boundaryBatch = await this.seal('bytes');
        if (boundaryBatch) sealed.push(boundaryBatch);
      }

      this.pending.push(event);
      this.pendingBytes += eventBytes;
      this.ensureTimer();

      if (eventBytes >= this.maxBytes) {
        const oversizedBatch = await this.seal('bytes');
        if (oversizedBatch) sealed.push(oversizedBatch);
      } else if (this.pending.length >= this.maxEvents) {
        const countBatch = await this.seal('count');
        if (countBatch) sealed.push(countBatch);
      }
      return sealed;
    });
  }

  flush(
    reason: Extract<BatchReason, 'interval' | 'segment' | 'stop' | 'manual'>,
  ): Promise<Readonly<SealedRecordingBatch> | null> {
    return this.enqueue(async () => {
      this.assertActive();
      return this.seal(reason);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimer();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async seal(
    reason: BatchReason,
  ): Promise<SealedRecordingBatch | null> {
    if (this.pending.length === 0) return null;

    const events = Object.freeze([...this.pending]);
    const sequenceStart = this.nextSequence;
    const sequenceEnd = sequenceStart + events.length - 1;
    const withoutHash = {
      schemaVersion: '1.0' as const,
      ...this.context,
      batchId: this.createBatchId(),
      sequenceStart,
      sequenceEnd,
      ...(this.previousBatchHash === undefined
        ? {}
        : { previousBatchHash: this.previousBatchHash }),
      createdAt: new Date(this.now()).toISOString(),
      reason,
      events,
    };
    const hashInput = await serializeBatch(withoutHash);
    const contentHash = await sha256Hex(hashInput.bytes);
    const batch = Object.freeze({ ...withoutHash, contentHash });
    const sealed = Object.freeze({
      batch,
      hashInput,
      serialized: await serializeBatch(batch),
    });

    this.pending = [];
    this.pendingBytes = 0;
    this.nextSequence = sequenceEnd + 1;
    this.previousBatchHash = contentHash;
    this.clearTimer();
    await this.onBatch?.(sealed);
    return sealed;
  }

  private ensureTimer(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      try {
        await this.flush('interval');
      } catch (_error) {
        return;
      }
    }, this.flushIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('Recording batcher is destroyed.');
  }
}
