import type { ReconciliationResult, SequenceRange } from '../transport/types';

export interface ReconciliationBatch {
  readonly batchId: string;
  readonly recordingId: string;
  readonly sequenceStart: number;
  readonly sequenceEnd: number;
  readonly contentHash: string;
}

export type ReconciliationPlan =
  | { readonly ok: true; readonly batches: readonly ReconciliationBatch[] }
  | { readonly ok: false; readonly error: 'RECONCILIATION_FAILED' };

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isValidRange(value: SequenceRange): boolean {
  return (
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    value.start >= 1 &&
    value.end >= value.start
  );
}

function overlaps(batch: ReconciliationBatch, range: SequenceRange): boolean {
  return batch.sequenceStart <= range.end && batch.sequenceEnd >= range.start;
}

function fullyCovered(
  range: SequenceRange,
  batches: readonly ReconciliationBatch[],
): boolean {
  let cursor = range.start;
  for (const batch of batches) {
    if (batch.sequenceEnd < cursor) continue;
    if (batch.sequenceStart > cursor) return false;
    cursor = Math.max(cursor, batch.sequenceEnd + 1);
    if (cursor > range.end) return true;
  }
  return cursor > range.end;
}

export function planReconciliation(
  recordingId: string,
  localSequenceEnd: number,
  result: ReconciliationResult,
  localBatches: readonly ReconciliationBatch[],
): ReconciliationPlan {
  if (
    result.recordingId !== recordingId ||
    !isNonNegativeInteger(localSequenceEnd) ||
    !isNonNegativeInteger(result.contiguousSequenceEnd) ||
    result.contiguousSequenceEnd > localSequenceEnd ||
    typeof result.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(result.checkedAt))
  ) {
    return { ok: false, error: 'RECONCILIATION_FAILED' };
  }

  let previousEnd = result.contiguousSequenceEnd;
  for (const range of result.missingRanges) {
    if (
      !isValidRange(range) ||
      range.start <= previousEnd ||
      range.end > localSequenceEnd
    ) {
      return { ok: false, error: 'RECONCILIATION_FAILED' };
    }
    previousEnd = range.end;
  }

  const candidates = localBatches
    .filter(
      (batch) =>
        batch.recordingId === recordingId &&
        Number.isInteger(batch.sequenceStart) &&
        Number.isInteger(batch.sequenceEnd) &&
        batch.sequenceStart >= 1 &&
        batch.sequenceEnd >= batch.sequenceStart,
    )
    .sort(
      (left, right) =>
        left.sequenceStart - right.sequenceStart ||
        left.sequenceEnd - right.sequenceEnd,
    );
  const selected = candidates.filter((candidate) =>
    result.missingRanges.some((range) => overlaps(candidate, range)),
  );
  if (result.missingRanges.some((range) => !fullyCovered(range, selected))) {
    return { ok: false, error: 'RECONCILIATION_FAILED' };
  }
  return { ok: true, batches: selected };
}
