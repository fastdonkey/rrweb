import {
  acknowledgePersistedReceipt,
  validatePersistedReceipt,
} from '../delivery/receipt-validator';
import { planReconciliation } from '../delivery/reconciliation';
import type { RecordingBatchV1 } from './batcher';
import type {
  Transport,
  TransportContext,
  TransportResult,
} from '../transport/types';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_SCHEDULE_INTERVAL_MS = 30_000;

type DispatchTrigger = TransportContext['trigger'];

export interface DispatchOutbox {
  list(): Promise<readonly Readonly<RecordingBatchV1>[]>;
  remove(batchId: string): Promise<void>;
}

export interface DispatchResult {
  readonly state: 'idle' | 'backoff' | 'blocked';
  readonly sent: number;
  readonly cancelled?: true;
}

export interface OutboxDispatcherOptions {
  readonly outbox: DispatchOutbox;
  readonly transport: Transport;
  readonly signal?: AbortSignal;
  readonly random?: () => number;
  readonly eventTarget?: EventTarget;
  readonly scheduleIntervalMs?: number;
  readonly onBlocked?: (batch: Readonly<RecordingBatchV1>) => void;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>;
}

export type ReconciliationDispatchResult =
  | { readonly ok: true; readonly resent: number }
  | { readonly ok: false; readonly error: 'RECONCILIATION_FAILED' };

function retryDelay(
  retryIndex: number,
  random: () => number,
  result?: TransportResult,
): number {
  const base = RETRY_DELAYS_MS[retryIndex];
  const jittered = Math.round(base * (0.8 + random() * 0.4));
  if (result?.status !== 'retryable' || result.retryAfterMs === undefined) {
    return jittered;
  }
  const requested = Math.max(
    0,
    Math.min(result.retryAfterMs, MAX_RETRY_AFTER_MS),
  );
  return Math.max(jittered, requested);
}

export class OutboxDispatcher {
  private readonly controller = new AbortController();
  private readonly random: () => number;
  private readonly scheduleIntervalMs: number;
  private inFlight?: Promise<DispatchResult>;
  private interval?: ReturnType<typeof setInterval>;
  private started = false;
  private disposers: Array<() => void> = [];

  constructor(private readonly options: OutboxDispatcherOptions) {
    this.random = options.random ?? Math.random;
    this.scheduleIntervalMs =
      options.scheduleIntervalMs ?? DEFAULT_SCHEDULE_INTERVAL_MS;
    if (options.signal) {
      const abort = () => this.controller.abort(options.signal?.reason);
      if (options.signal.aborted) abort();
      else {
        options.signal.addEventListener('abort', abort, { once: true });
        this.disposers.push(() =>
          options.signal?.removeEventListener('abort', abort),
        );
      }
    }
  }

  start(): void {
    if (this.started || this.controller.signal.aborted) return;
    this.started = true;
    const target = this.options.eventTarget;
    if (target) {
      const online = () => void this.dispatch('online');
      const pagehide = () => void this.dispatch('pagehide');
      target.addEventListener('online', online);
      target.addEventListener('pagehide', pagehide);
      this.disposers.push(() => target.removeEventListener('online', online));
      this.disposers.push(() =>
        target.removeEventListener('pagehide', pagehide),
      );
    }
    this.interval = setInterval(() => {
      void this.dispatch('scheduled');
    }, this.scheduleIntervalMs);
    void this.dispatch('startup');
  }

  dispatch(trigger: DispatchTrigger): Promise<DispatchResult> {
    if (this.inFlight) return this.inFlight;
    if (this.controller.signal.aborted) {
      return Promise.resolve({ state: 'idle', sent: 0, cancelled: true });
    }
    this.inFlight = this.run(trigger).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  async reconcile(
    recordingId: string,
    localSequenceEnd: number,
    trigger: Extract<DispatchTrigger, 'startup' | 'online' | 'manual'>,
  ): Promise<ReconciliationDispatchResult> {
    if (
      this.controller.signal.aborted ||
      this.options.transport.capability !== 'persisted-receipt-v1'
    ) {
      return { ok: false, error: 'RECONCILIATION_FAILED' };
    }
    let result;
    try {
      result = await this.options.transport.reconcile(recordingId, {
        signal: this.controller.signal,
      });
    } catch (_error) {
      return { ok: false, error: 'RECONCILIATION_FAILED' };
    }
    const local = await this.options.outbox.list();
    const plan = planReconciliation(
      recordingId,
      localSequenceEnd,
      result,
      local,
    );
    if (!plan.ok) return plan;
    let resent = 0;
    for (const selected of plan.batches) {
      const matching = local.find(
        (candidate) => candidate.batchId === selected.batchId,
      );
      if (!matching) {
        return { ok: false, error: 'RECONCILIATION_FAILED' };
      }
      const outcome = await this.sendWithRetries(matching, trigger);
      if (outcome !== 'accepted') {
        return { ok: false, error: 'RECONCILIATION_FAILED' };
      }
      resent += 1;
    }
    return { ok: true, resent };
  }

  destroy(): void {
    this.controller.abort();
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.started = false;
  }

  private async run(trigger: DispatchTrigger): Promise<DispatchResult> {
    let sent = 0;
    let batches = await this.options.outbox.list();
    if (
      (trigger === 'startup' || trigger === 'online') &&
      this.options.transport.capability === 'persisted-receipt-v1'
    ) {
      const recordings = new Map<string, number>();
      for (const batch of batches) {
        recordings.set(
          batch.recordingId,
          Math.max(recordings.get(batch.recordingId) ?? 0, batch.sequenceEnd),
        );
      }
      for (const [recordingId, localSequenceEnd] of recordings) {
        await this.reconcile(recordingId, localSequenceEnd, trigger);
      }
      batches = await this.options.outbox.list();
    }
    for (const batch of batches) {
      if (this.controller.signal.aborted) {
        return { state: 'idle', sent, cancelled: true };
      }
      const outcome = await this.sendWithRetries(batch, trigger);
      if (outcome === 'cancelled') {
        return { state: 'idle', sent, cancelled: true };
      }
      if (outcome === 'blocked') {
        this.notifyBlocked(batch);
        return { state: 'blocked', sent };
      }
      if (outcome === 'exhausted') return { state: 'backoff', sent };
      sent += 1;
    }
    return { state: 'idle', sent };
  }

  private async sendWithRetries(
    batch: Readonly<RecordingBatchV1>,
    trigger: DispatchTrigger,
  ): Promise<'accepted' | 'exhausted' | 'blocked' | 'cancelled'> {
    for (
      let attemptIndex = 0;
      attemptIndex <= RETRY_DELAYS_MS.length;
      attemptIndex += 1
    ) {
      if (this.controller.signal.aborted) return 'cancelled';
      let result: TransportResult | undefined;
      try {
        result = await this.options.transport.send(batch, {
          signal: this.controller.signal,
          attempt: attemptIndex + 1,
          trigger: attemptIndex === 0 ? trigger : 'retry',
        });
      } catch (_error) {
        result = { status: 'retryable', reason: 'transport-error' };
      }

      if (result.status === 'rejected') return 'blocked';
      if (validatePersistedReceipt(batch, result).ok) {
        await acknowledgePersistedReceipt(this.options.outbox, batch, result);
        return 'accepted';
      }
      if (attemptIndex === RETRY_DELAYS_MS.length) return 'exhausted';
      const delay = retryDelay(attemptIndex, this.random, result);
      const continued = this.options.wait
        ? await this.options.wait(delay, this.controller.signal)
        : await this.wait(delay);
      if (!continued) return 'cancelled';
    }
    return 'exhausted';
  }

  private wait(delayMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (this.controller.signal.aborted) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        resolve(true);
      }, delayMs);
      const abort = () => {
        clearTimeout(timer);
        cleanup();
        resolve(false);
      };
      const cleanup = () =>
        this.controller.signal.removeEventListener('abort', abort);
      this.controller.signal.addEventListener('abort', abort, { once: true });
    });
  }

  private notifyBlocked(batch: Readonly<RecordingBatchV1>): void {
    try {
      this.options.onBlocked?.(batch);
    } catch (_error) {
      return;
    }
  }
}
