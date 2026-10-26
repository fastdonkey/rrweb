import { describe, expect, it } from 'vitest';

import {
  planReconciliation,
  type ReconciliationBatch,
} from '../src/delivery/reconciliation';
import { OutboxDispatcher } from '../src/pipeline/outbox-dispatcher';
import { MockPersistedHttpTransport } from '../src/transport/mock-http';
import type {
  PersistedReceiptTransport,
  ReconciliationResult,
} from '../src/transport/types';

function batch(
  batchId: string,
  start: number,
  end: number,
  recordingId = 'recording-1',
): ReconciliationBatch {
  return {
    batchId,
    recordingId,
    sequenceStart: start,
    sequenceEnd: end,
    contentHash: `hash-${batchId}`,
  };
}

function result(
  contiguousSequenceEnd: number,
  missingRanges: ReconciliationResult['missingRanges'],
): ReconciliationResult {
  return {
    recordingId: 'recording-1',
    contiguousSequenceEnd,
    missingRanges,
    checkedAt: '2026-10-26T00:00:00.000Z',
  };
}

const local = [
  batch('batch-1', 1, 100),
  batch('batch-2', 101, 200),
  batch('batch-3', 201, 300),
  batch('other', 1, 300, 'recording-2'),
];

describe('sequence reconciliation', () => {
  it('accepts a continuous result without selecting retransmissions', () => {
    expect(
      planReconciliation('recording-1', 300, result(300, []), local),
    ).toEqual({ ok: true, batches: [] });
  });

  it('selects the original batches intersecting one or multiple missing ranges', () => {
    expect(
      planReconciliation(
        'recording-1',
        300,
        result(50, [
          { start: 80, end: 120 },
          { start: 250, end: 260 },
        ]),
        local,
      ),
    ).toEqual({ ok: true, batches: [local[0], local[1], local[2]] });
  });

  it.each([
    result(-1, []),
    result(301, []),
    result(50, [{ start: 0, end: 2 }]),
    result(50, [{ start: 80, end: 79 }]),
    result(50, [{ start: 40, end: 60 }]),
    result(50, [
      { start: 80, end: 120 },
      { start: 100, end: 130 },
    ]),
    { ...result(50, []), recordingId: 'recording-2' },
    { ...result(50, []), checkedAt: 'not-a-date' },
  ])('rejects malformed or conflicting reconciliation: %j', (candidate) => {
    expect(planReconciliation('recording-1', 300, candidate, local)).toEqual({
      ok: false,
      error: 'RECONCILIATION_FAILED',
    });
  });

  it('reports a local gap when a requested range cannot be fully recovered', () => {
    expect(
      planReconciliation(
        'recording-1',
        300,
        result(100, [{ start: 150, end: 250 }]),
        [local[1]],
      ),
    ).toEqual({ ok: false, error: 'RECONCILIATION_FAILED' });
  });

  it('reuses batch IDs and hashes and never deletes on reconciliation alone', async () => {
    const pending = [local[0], local[1]];
    const sent: Array<{ batchId: string; contentHash: string }> = [];
    const removed: string[] = [];
    const transport: PersistedReceiptTransport = {
      name: 'reconcile-fixture',
      capability: 'persisted-receipt-v1',
      send: async (candidate) => {
        sent.push({
          batchId: candidate.batchId,
          contentHash: candidate.contentHash,
        });
        return { status: 'retryable' };
      },
      reconcile: async () => result(100, [{ start: 101, end: 200 }]),
    };
    const dispatcher = new OutboxDispatcher({
      outbox: {
        list: async () => pending as never,
        remove: async (batchId) => void removed.push(batchId),
      },
      transport,
      wait: async () => true,
    });

    expect(await dispatcher.reconcile('recording-1', 200, 'online')).toEqual({
      ok: false,
      error: 'RECONCILIATION_FAILED',
    });
    expect(sent).toEqual([
      { batchId: 'batch-2', contentHash: 'hash-batch-2' },
      { batchId: 'batch-2', contentHash: 'hash-batch-2' },
      { batchId: 'batch-2', contentHash: 'hash-batch-2' },
      { batchId: 'batch-2', contentHash: 'hash-batch-2' },
    ]);
    expect(removed).toEqual([]);
  });

  it('provides a persisted Mock HTTP capability with reconciliation', async () => {
    const transport = new MockPersistedHttpTransport(
      async () => ({ status: 204 }),
      async (recordingId) =>
        result(recordingId === 'recording-1' ? 300 : 0, []),
    );

    expect(transport.capability).toBe('persisted-receipt-v1');
    expect(
      await transport.reconcile('recording-1', {
        signal: new AbortController().signal,
      }),
    ).toEqual(result(300, []));
  });
});
