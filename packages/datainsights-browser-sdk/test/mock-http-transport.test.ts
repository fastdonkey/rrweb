import { describe, expect, it } from 'vitest';

import type { RecordingBatchV1 } from '../src/pipeline/batcher';
import { MockHttpTransport } from '../src/transport/mock-http';

const batch = {
  batchId: 'batch-1',
  recordingId: 'recording-1',
  sequenceStart: 1,
  sequenceEnd: 1,
  contentHash: 'hash-1',
} as RecordingBatchV1;

const context = {
  signal: new AbortController().signal,
  attempt: 1,
  trigger: 'manual' as const,
};

describe('MockHttpTransport', () => {
  it('does not treat HTTP 2xx without a persisted receipt as accepted', async () => {
    const transport = new MockHttpTransport(async () => ({ status: 204 }));
    expect(await transport.send(batch, context)).toEqual({
      status: 'retryable',
      reason: 'missing-persisted-receipt',
    });
  });

  it('passes an explicit response body to strict receipt validation', async () => {
    const receipt = {
      status: 'accepted' as const,
      receipt: {
        persisted: true as const,
        batchId: batch.batchId,
        recordingId: batch.recordingId,
        sequenceStart: batch.sequenceStart,
        sequenceEnd: batch.sequenceEnd,
        contentHash: batch.contentHash,
      },
    };
    const transport = new MockHttpTransport(async () => ({
      status: 200,
      body: receipt,
    }));
    expect(await transport.send(batch, context)).toEqual(receipt);
  });

  it('maps temporary and permanent HTTP failures without throwing', async () => {
    const temporary = new MockHttpTransport(async () => ({ status: 503 }));
    const permanent = new MockHttpTransport(async () => ({ status: 422 }));
    expect(await temporary.send(batch, context)).toMatchObject({
      status: 'retryable',
    });
    expect(await permanent.send(batch, context)).toMatchObject({
      status: 'rejected',
    });
  });
});
