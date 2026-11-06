import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openRecorderDatabase,
  type RecorderDatabase,
} from '../src/persistence/database';
import { IndexedDbJournal } from '../src/persistence/indexeddb-journal';
import { IndexedDbOutbox } from '../src/persistence/indexeddb-outbox';
import { CloseStore, type CloseIntent } from '../src/delivery/close-store';
import { CloseDispatcher } from '../src/delivery/close-dispatcher';
import { createHttpTransport as createBaseHttpTransport } from '../src/transport/http';
const createHttpTransport = (
  ...args: Parameters<typeof createBaseHttpTransport>
) =>
  createBaseHttpTransport(args[0], args[1], {
    ...args[2],
    capabilityDiscovery: false,
  });
const app = 'di_t_cn1_' + 'a'.repeat(32),
  trace = '11111111-1111-4111-8111-111111111111',
  recording = '22222222-2222-4222-8222-222222222222';
const intent = (endTrace = false): CloseIntent => ({
  recordingId: recording,
  reason: endTrace ? 'completed' : 'manual',
  endTrace,
  endedAt: new Date().toISOString(),
});
let databases: RecorderDatabase[] = [];
afterEach(() => {
  for (const db of databases) db.close();
  databases = [];
  vi.restoreAllMocks();
});
async function fixture(newTrace = true) {
  const factory = new IDBFactory();
  const db = await openRecorderDatabase(factory);
  databases.push(db);
  const closes = new CloseStore(db, app);
  await closes.register(trace, recording, newTrace);
  return {
    db,
    factory,
    closes,
    outbox: new IndexedDbOutbox(db, app),
    journal: new IndexedDbJournal({
      database: db,
      appKey: app,
      recordingId: recording,
    }),
  };
}
const batch = {
  batchId: '33333333-3333-4333-8333-333333333333',
  recordingId: recording,
  sequenceStart: 1,
  sequenceEnd: 1,
  contentHash: 'a'.repeat(64),
  events: [{ type: 4 }],
  bytes: 100,
  createdAt: Date.now(),
};
describe('durable close', () => {
  it('commits tail, boundary and close together and reopens with the same closeId', async () => {
    const f = await fixture();
    await f.journal.append({ type: 4 });
    await f.journal.flush();
    const chunks = await f.journal.recover();
    expect(
      await f.outbox.enqueueManyFromJournal(
        [batch],
        chunks.map((c) => c.key),
        intent(),
      ),
    ).toBe(true);
    const first = await f.closes.list();
    expect(first).toHaveLength(1);
    expect(first[0].payload).toMatchObject({
      finalSequence: 1,
      finalBatchHash: batch.contentHash,
    });
    expect(await f.journal.recover()).toHaveLength(0);
    f.db.close();
    const reopened = await openRecorderDatabase(f.factory);
    databases.push(reopened);
    const store = new CloseStore(reopened, app);
    expect(await store.list()).toEqual(first);
    expect(await new IndexedDbOutbox(reopened, app).list()).toHaveLength(1);
    await store.finish(intent());
    expect(await store.list()).toEqual(first);
  });
  it('rolls back tail and close on transaction failure then retries without losing journal', async () => {
    const f = await fixture();
    await f.journal.append({ type: 4 });
    await f.journal.flush();
    const keys = (await f.journal.recover()).map((c) => c.key);
    const seal = vi
      .spyOn(CloseStore, 'seal')
      .mockRejectedValueOnce(new Error('transaction fault'));
    expect(
      await f.outbox.enqueueManyFromJournal([batch], keys, intent(true)),
    ).toBe(false);
    expect(await f.outbox.list()).toHaveLength(0);
    expect(await f.closes.list()).toHaveLength(0);
    expect(await f.journal.recover()).toHaveLength(1);
    seal.mockRestore();
    expect(
      await f.outbox.enqueueManyFromJournal([batch], keys, intent(true)),
    ).toBe(true);
    expect(await f.closes.list()).toHaveLength(2);
  });
  it('retains the final boundary after acknowledged batches have left Outbox', async () => {
    const f = await fixture();
    expect(await f.outbox.enqueueManyFromJournal([batch], [])).toBe(true);
    await f.outbox.remove(batch.batchId);
    expect(await new CloseStore(f.db, app).boundary(recording)).toMatchObject({
      end: 1,
      hash: batch.contentHash,
    });
    expect(await f.closes.finish(intent())).toBe(true);
    expect((await f.closes.list())[0].payload.finalSequence).toBe(1);
    expect((await f.closes.list())[0].payload.finalBatchHash).toBe(
      batch.contentHash,
    );
  });
  it('records empty close without hash and keeps Trace open across page recordings', async () => {
    const f = await fixture();
    await f.closes.finish(intent());
    const second = '44444444-4444-4444-8444-444444444444';
    await f.closes.register(trace, second, false);
    await f.closes.finish({ ...intent(true), recordingId: second });
    const rows = await f.closes.list();
    expect(rows).toHaveLength(3);
    expect(rows[0].payload.finalSequence).toBe(0);
    expect(rows[0].payload.finalBatchHash).toBeUndefined();
    expect(rows.find((r) => r.kind === 'trace')?.payload.recordingIds).toEqual([
      recording,
      second,
    ]);
    await expect(f.closes.register(trace, 'new', false)).rejects.toThrow();
  });
  it('does not fabricate Trace closure for legacy membership or Recording closure after a crash', async () => {
    const f = await fixture(false);
    expect(await f.closes.list()).toHaveLength(0);
    await f.closes.finish(intent(true));
    expect((await f.closes.list()).map((c) => c.kind)).toEqual(['recording']);
    expect(await new CloseStore(f.db, 'another-app').list()).toHaveLength(0);
  });
  it('refuses closing while durable journal contains unsealed events', async () => {
    const f = await fixture();
    await f.journal.append({ type: 4 });
    await f.journal.flush();
    expect(await f.closes.finish(intent())).toBe(false);
    expect(await f.closes.list()).toHaveLength(0);
  });
  it('retains close on lost or mismatched receipt; exact ACK alone removes it', async () => {
    const f = await fixture();
    await f.closes.finish(intent());
    const original = (await f.closes.list())[0];
    const sendClose = vi
      .fn()
      .mockResolvedValueOnce({ status: 'retryable' })
      .mockResolvedValueOnce({ status: 'accepted', closeId: 'wrong' })
      .mockResolvedValueOnce({
        status: 'accepted',
        closeId: original.payload.closeId,
      });
    const dispatcher = new CloseDispatcher(f.closes, {
      name: 'test',
      capability: 'test-only',
      send: vi.fn(),
      sendClose,
    });
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await dispatcher.dispatch();
    now += 1001;
    await dispatcher.dispatch();
    now += 1001;
    expect(await f.closes.list()).toEqual([original]);
    await dispatcher.dispatch();
    expect(await f.closes.list()).toHaveLength(0);
    await f.closes.finish(intent());
    expect(await f.closes.list()).toHaveLength(0);
    dispatcher.destroy();
  });
  it('HTTP close reuses token refresh once and preserves its body and closeId', async () => {
    const f = await fixture();
    await f.closes.finish(intent());
    const declaration = (await f.closes.list())[0];
    const config = {
      appKey: app,
      enabled: true as const,
      configVersion: '1',
      collectorUrls: ['https://collector.example'] as const,
      uploadToken: 'old',
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accepted: true,
            closeId: declaration.payload.closeId,
          }),
        ),
      );
    const refresh = vi.fn(async () => ({
      ok: true as const,
      value: { ...config, uploadToken: 'new' },
    }));
    const transport = createHttpTransport(config, fetch, {
      resolveConfig: refresh,
    });
    try {
      expect(
        await transport.sendClose!(declaration, {
          signal: new AbortController().signal,
        }),
      ).toEqual({ status: 'accepted', closeId: declaration.payload.closeId });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    } finally {
      await transport.destroy?.();
    }
  });
});
