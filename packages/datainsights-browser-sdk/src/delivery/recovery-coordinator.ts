import type { RecordingBatchV1 } from '../pipeline/batcher';
import type { DispatchOutbox } from '../pipeline/outbox-dispatcher';
import type { Transport } from '../transport/types';
import { validatePersistedReceipt } from './receipt-validator';
export class RecoveryCoordinator {
  readonly held = new Set<string>();
  readonly blocked = new Set<string>();
  private flight?: Promise<void>;
  private triggerAfter = 0;
  private requestAfter = 0;
  constructor(
    private readonly transport: Transport,
    private readonly now = Date.now,
    private readonly random = Math.random,
  ) {}
  recover(
    candidates: readonly Readonly<RecordingBatchV1>[],
    outbox: DispatchOutbox,
    signal: AbortSignal,
    wait: (ms: number, signal: AbortSignal) => Promise<boolean>,
    onBlocked?: (batch: Readonly<RecordingBatchV1>) => void,
  ): Promise<void> | undefined {
    if (
      this.flight ||
      signal.aborted ||
      candidates.length < 2 ||
      !this.transport.reconcileBatches ||
      this.now() < Math.max(this.triggerAfter, this.requestAfter)
    )
      return undefined;
    this.triggerAfter = this.now() + 30000;
    const frozen = candidates.slice(0, 300).map((b) => ({ ...b }));
    for (const b of frozen) this.held.add(b.batchId);
    this.flight = this.run(frozen, outbox, signal, wait, onBlocked)
      .catch(() => undefined)
      .finally(() => {
        this.held.clear();
        this.flight = undefined;
      });
    return this.flight;
  }
  private async run(
    frozen: readonly Readonly<RecordingBatchV1>[],
    outbox: DispatchOutbox,
    signal: AbortSignal,
    wait: (ms: number, signal: AbortSignal) => Promise<boolean>,
    onBlocked?: (batch: Readonly<RecordingBatchV1>) => void,
  ): Promise<void> {
    if (!(await this.transport.capabilities?.())?.reconcileV2 || signal.aborted)
      return;
    const groups = new Map<string, Readonly<RecordingBatchV1>[]>();
    for (const b of frozen) {
      const key = JSON.stringify([b.traceId, b.recordingId]);
      const group = groups.get(key) ?? [];
      group.push(b);
      groups.set(key, group);
    }
    let requests = 0;
    for (const group of groups.values())
      for (let offset = 0; offset < group.length; offset += 100) {
        const pending = group.slice(offset, offset + 100);
        let attempt = 0;
        while (requests < 3 && !signal.aborted) {
          const delay = Math.max(0, this.requestAfter - this.now());
          if (delay > 30000) return;
          if (delay > 0 && !(await wait(delay, signal))) return;
          if (signal.aborted) return;
          requests++;
          this.requestAfter = this.now() + 1000;
          const result = await this.transport.reconcileBatches!(
            pending[0].recordingId,
            pending[0].traceId,
            pending.map(
              ({ batchId, sequenceStart, sequenceEnd, contentHash }) => ({
                batchId,
                sequenceStart,
                sequenceEnd,
                contentHash,
              }),
            ),
            { signal },
          );
          this.requestAfter = Math.max(this.requestAfter, this.now() + 1000);
          if (result.status === 'unsupported' || result.status === 'rejected')
            return;
          if (result.status === 'retryable') {
            const backoff =
              (attempt++ === 0 ? 1000 : 2000) *
              (1 + Math.max(0, Math.min(1, this.random())) * 0.2);
            this.requestAfter =
              this.now() + Math.max(backoff, result.retryAfterMs ?? 0);
            continue;
          }
          if (result.status !== 'ok') return;
          const value = result.value;
          if (
            value.recordingId !== pending[0].recordingId ||
            value.traceId !== pending[0].traceId ||
            !Number.isFinite(Date.parse(value.checkedAt)) ||
            !Array.isArray(value.results) ||
            value.results.length !== pending.length
          )
            return;
          const ids = new Set(value.results.map((r) => r.batchId));
          if (
            ids.size !== pending.length ||
            pending.some((b) => !ids.has(b.batchId))
          )
            return;
          for (const row of value.results) {
            const batch = pending.find((b) => b.batchId === row.batchId)!;
            if (
              row.status === 'STORED' &&
              validatePersistedReceipt(batch, {
                status: 'accepted',
                receipt: row.receipt,
              }).ok
            )
              await outbox.remove(batch.batchId);
            else if (row.status === 'CONFLICT' || row.status === 'DELETED') {
              this.blocked.add(batch.batchId);
              await outbox.block?.(batch.batchId, row.status);
              try {
                onBlocked?.(batch);
              } catch {
                /* Host diagnostics must not break recovery. */
              }
            }
          }
          break; // UNKNOWN returns to original retries; never poll it.
        }
        if (requests >= 3 || signal.aborted) return;
      }
  }
}
const coordinators = new WeakMap<Transport, RecoveryCoordinator>();
export function recoveryFor(
  transport: Transport,
  now?: () => number,
  random?: () => number,
): RecoveryCoordinator {
  let coordinator = coordinators.get(transport);
  if (!coordinator) {
    coordinator = new RecoveryCoordinator(transport, now, random);
    coordinators.set(transport, coordinator);
  }
  return coordinator;
}
