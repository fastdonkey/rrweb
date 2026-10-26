import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  deleteRecorderDatabase,
  openRecorderDatabase,
  type RecorderDatabase,
} from '../src/persistence/database';
import { IndexedDbOutbox } from '../src/persistence/indexeddb-outbox';
import type { RecordingBatchV1 } from '../src/pipeline/batcher';
import { validateConfig } from '../src/config/config';
import {
  acknowledgePersistedReceipt,
  validatePersistedReceipt,
} from '../src/delivery/receipt-validator';
import { MemoryTransport } from '../src/transport/memory';
import type {
  PersistedReceiptTransport,
  TestTransport,
  TransportResult,
} from '../src/transport/types';

const batch: RecordingBatchV1 = {
  schemaVersion: '1.0',
  sdkVersion: '0.1.0',
  rrwebVersion: '2.2.0',
  rrwebCommit: 'commit',
  appKey: 'app-web',
  identity: { type: 'host', id: 'user-1' },
  consent: {
    noticeVersion: 'v1',
    action: 'start-insurance',
    grantedAt: '2026-10-26T00:00:00.000Z',
  },
  sessionId: 'session-1',
  recordingId: 'recording-1',
  segmentId: 'segment-1',
  batchId: 'batch-1',
  sequenceStart: 1,
  sequenceEnd: 2,
  contentHash: 'abc123',
  createdAt: '2026-10-26T00:00:01.000Z',
  reason: 'manual',
  events: [{ event: 1 }, { event: 2 }],
};

const accepted: TransportResult = {
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

async function createPendingOutbox(): Promise<{
  outbox: IndexedDbOutbox;
  database: RecorderDatabase;
}> {
  const database = await openRecorderDatabase();
  const outbox = new IndexedDbOutbox(database, batch.appKey);
  await outbox.enqueueFromJournal(
    {
      ...batch,
      events: [...batch.events],
      bytes: 100,
      createdAt: Date.parse(batch.createdAt),
    },
    [],
  );
  return { outbox, database };
}

describe('persisted Transport receipts', () => {
  beforeEach(async () => {
    await deleteRecorderDatabase();
  });

  it('deletes Outbox data only after an exact persisted receipt', async () => {
    const { outbox, database } = await createPendingOutbox();

    expect(validatePersistedReceipt(batch, accepted)).toEqual({ ok: true });
    expect(await acknowledgePersistedReceipt(outbox, batch, accepted)).toEqual({
      ok: true,
    });
    expect(await outbox.list()).toHaveLength(0);
    database.close();
  });

  it.each([
    ['batchId', 'other-batch'],
    ['recordingId', 'other-recording'],
    ['sequenceStart', 2],
    ['sequenceEnd', 3],
    ['contentHash', 'different-hash'],
    ['persisted', false],
  ] as const)(
    'keeps Outbox data when receipt %s conflicts',
    async (key, value) => {
      const { outbox, database } = await createPendingOutbox();
      const result = {
        ...accepted,
        receipt: { ...accepted.receipt, [key]: value },
      } as unknown as TransportResult;

      expect(validatePersistedReceipt(batch, result)).toEqual({
        ok: false,
        error: 'RECEIPT_INVALID',
      });
      expect(await acknowledgePersistedReceipt(outbox, batch, result)).toEqual({
        ok: false,
        error: 'RECEIPT_INVALID',
      });
      expect(await outbox.list()).toHaveLength(1);
      database.close();
    },
  );

  it.each([
    { status: 200 },
    { ok: true },
    true,
    { status: 'accepted' },
    { status: 'retryable' },
  ])('keeps Outbox data for a non-receipt result: %j', async (result) => {
    const { outbox, database } = await createPendingOutbox();

    expect(await acknowledgePersistedReceipt(outbox, batch, result)).toEqual({
      ok: false,
      error: 'RECEIPT_INVALID',
    });
    expect(await outbox.list()).toHaveLength(1);
    database.close();
  });

  it('defines test-only and persisted-receipt capabilities without ambiguity', async () => {
    const memory = new MemoryTransport();
    expectTypeOf(memory).toMatchTypeOf<TestTransport>();
    expect(memory.capability).toBe('test-only');
    expect((await memory.send(batch, { attempt: 1 })).status).toBe('accepted');
    expect(memory.batches).toEqual([batch]);

    const production: PersistedReceiptTransport = {
      name: 'production-fixture',
      capability: 'persisted-receipt-v1',
      send: async () => accepted,
      reconcile: async (recordingId) => ({
        recordingId,
        contiguousSequenceEnd: 2,
        missingRanges: [],
        checkedAt: '2026-10-26T00:00:02.000Z',
      }),
    };
    expectTypeOf(production.reconcile).toBeFunction();
  });

  it('rejects a persisted-receipt transport without reconciliation', () => {
    expect(
      validateConfig({
        appKey: 'app-web',
        transport: {
          name: 'unsafe-production-transport',
          capability: 'persisted-receipt-v1',
          send: async () => accepted,
        },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'INVALID_CONFIG',
        message: 'A persisted transport must support reconciliation.',
      },
    });
  });
});
