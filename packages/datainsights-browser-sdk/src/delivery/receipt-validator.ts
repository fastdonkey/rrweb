import type { RecordingBatchV1 } from '../pipeline/batcher';
import type { TransportResult } from '../transport/types';

export type ReceiptValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'RECEIPT_INVALID' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validatePersistedReceipt(
  batch: Readonly<RecordingBatchV1>,
  result: unknown,
): ReceiptValidationResult {
  if (!isRecord(result) || result.status !== 'accepted') {
    return { ok: false, error: 'RECEIPT_INVALID' };
  }
  const receipt = result.receipt;
  if (
    !isRecord(receipt) ||
    receipt.persisted !== true ||
    receipt.batchId !== batch.batchId ||
    receipt.recordingId !== batch.recordingId ||
    receipt.sequenceStart !== batch.sequenceStart ||
    receipt.sequenceEnd !== batch.sequenceEnd ||
    receipt.contentHash !== batch.contentHash
  ) {
    return { ok: false, error: 'RECEIPT_INVALID' };
  }
  return { ok: true };
}

export interface ReceiptAcknowledgingOutbox {
  remove(batchId: string): Promise<void>;
}

export async function acknowledgePersistedReceipt(
  outbox: ReceiptAcknowledgingOutbox,
  batch: Readonly<RecordingBatchV1>,
  result: TransportResult | unknown,
): Promise<ReceiptValidationResult> {
  const validation = validatePersistedReceipt(batch, result);
  if (!validation.ok) return validation;
  await outbox.remove(batch.batchId);
  return validation;
}
