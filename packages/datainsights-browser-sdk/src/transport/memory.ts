import type { RecordingBatchV1 } from '../pipeline/batcher';
import type { TestTransport, TransportContext, TransportResult } from './types';

export class MemoryTransport implements TestTransport {
  readonly name = 'memory';
  readonly capability = 'test-only';
  readonly batches: Readonly<RecordingBatchV1>[] = [];

  async send(
    batch: Readonly<RecordingBatchV1>,
    _context: Readonly<TransportContext>,
  ): Promise<TransportResult> {
    this.batches.push(batch);
    return {
      status: 'accepted',
      receipt: {
        persisted: true,
        batchId: batch.batchId,
        recordingId: batch.recordingId,
        sequenceStart: batch.sequenceStart,
        sequenceEnd: batch.sequenceEnd,
        contentHash: batch.contentHash,
      },
    };
  }
}
