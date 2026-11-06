import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync, strFromU8 } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { RecoveryCoordinator } from '../src/delivery/recovery-coordinator';
import { OutboxDispatcher } from '../src/pipeline/outbox-dispatcher';
import { createHttpTransport } from '../src/transport/http';
import { retryAfter } from '../src/transport/recovery-protocol';
import { openRecorderDatabase } from '../src/persistence/database';
import { IndexedDbOutbox } from '../src/persistence/indexeddb-outbox';
import type { RecordingBatchV1 } from '../src/pipeline/batcher';
const key = 'di_t_cn1_' + 'a'.repeat(32),
  recording = '11111111-1111-4111-8111-111111111111',
  trace = '22222222-2222-4222-8222-222222222222';
const capabilities = {
  tokenRefresh: true,
  reconcileV2: true,
  closeV2: true,
  gzipHttp: true,
};
const config = () => ({
  appKey: key,
  enabled: true as const,
  configVersion: '1',
  collectorUrls: ['https://collector.example'] as const,
  uploadToken: 'old',
  expiresAt: new Date(Date.now() + 1800000).toISOString(),
});
const batch = (i: number, recordingId = recording) =>
  ({
    appKey: key,
    traceId: trace,
    recordingId,
    batchId: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`,
    sequenceStart: i,
    sequenceEnd: i,
    contentHash: 'a'.repeat(64),
    events: [{ text: 'x'.repeat(2048) }],
  } as unknown as RecordingBatchV1);
const receipt = (b: RecordingBatchV1) => ({
  persisted: true as const,
  batchId: b.batchId,
  recordingId: b.recordingId,
  sequenceStart: b.sequenceStart,
  sequenceEnd: b.sequenceEnd,
  contentHash: b.contentHash,
});
const response = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(value), { status, headers });
const context = () => ({
  signal: new AbortController().signal,
  attempt: 1,
  trigger: 'manual' as const,
});
function outbox(initial: RecordingBatchV1[]) {
  let items = [...initial];
  return {
    list: async () => items,
    remove: vi.fn(async (id: string) => {
      items = items.filter((b) => b.batchId !== id);
    }),
    block: vi.fn(async () => {}),
    add: (b: RecordingBatchV1) => items.push(b),
  };
}
const transports: ReturnType<typeof createHttpTransport>[] = [];
afterEach(async () => {
  for (const t of transports.splice(0)) await t.destroy?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function http(fetchImpl: typeof fetch, options = {}) {
  const t = createHttpTransport(config(), fetchImpl, options);
  transports.push(t);
  return t;
}
describe('bounded recovery and HTTP gzip', () => {
  it('retries transient capability throttling without caching an unsupported protocol', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const t = http(vi.fn(async () => ++calls < 3
        ? response({}, 429, { 'Retry-After': '1' })
        : response(capabilities)) as typeof fetch);
      const result = t.capabilities!();
      await vi.advanceTimersByTimeAsync(2100);
      expect(await result).toEqual(capabilities);
      expect(await t.capabilities!()).toEqual(capabilities);
      expect(calls).toBe(3);
    } finally { vi.useRealTimers(); }
  });
  it('normal 100 uploads have zero delivery queries and one capability discovery; gzip preserves exact bytes', async () => {
    let configs = 0,
      queries = 0,
      uploads = 0;
    const originals = new Map(
      Array.from({ length: 100 }, (_, i) => {
        const b = batch(i + 1);
        return [b.batchId, JSON.stringify(b)];
      }),
    );
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith('/capabilities')) {
        configs++;
        return response(capabilities);
      }
      if (
        String(url).includes('/reconcile') ||
        String(url).includes('/delivery-state')
      )
        queries++;
      uploads++;
      expect(init.headers['Content-Encoding']).toBe('gzip');
      const raw = strFromU8(gunzipSync(new Uint8Array(init.body)));
      const b = JSON.parse(raw);
      expect(raw).toBe(originals.get(b.batchId));
      return response({ status: 'accepted', receipt: receipt(b) });
    });
    const t = http(fetchImpl);
    await Promise.all([t.capabilities!(), t.capabilities!()]);
    const box = outbox(Array.from({ length: 100 }, (_, i) => batch(i + 1)));
    const d = new OutboxDispatcher({ outbox: box, transport: t });
    expect((await d.dispatch('manual')).sent).toBe(100);
    expect(await box.list()).toHaveLength(0);
    expect({ configs, queries, uploads }).toEqual({
      configs: 1,
      queries: 0,
      uploads: 100,
    });
    d.destroy();
  });
  it('empty and single pending recovery issue no status queries', async () => {
    const reconcileBatches = vi.fn();
    const transport: any = {
      name: 'test',
      capability: 'persisted-receipt-v1',
      reconcileBatches,
      capabilities: async () => capabilities,
      send: async (b: RecordingBatchV1) => ({
        status: 'accepted',
        receipt: receipt(b),
      }),
    };
    const box = outbox([]);
    const d = new OutboxDispatcher({ outbox: box, transport });
    await d.dispatch('startup');
    box.add(batch(1));
    await d.dispatch('online');
    expect(reconcileBatches).not.toHaveBeenCalled();
    d.destroy();
  });
  it('freezes candidates, chunks by Recording and caps each recovery cycle at 3 requests with 1s gaps', async () => {
    let time = 100000;
    const seen: { at: number; ids: string[] }[] = [];
    const transport: any = {
      capabilities: async () => capabilities,
      reconcileBatches: async (
        recordingId: string,
        traceId: string,
        items: any[],
      ) => {
        seen.push({ at: time, ids: items.map((b) => b.batchId) });
        expect(items.length).toBeLessThanOrEqual(100);
        expect(items.every((b) => !('events' in b))).toBe(true);
        return {
          status: 'ok',
          value: {
            recordingId,
            traceId,
            checkedAt: new Date(time).toISOString(),
            results: items.map((b) => ({
              batchId: b.batchId,
              status: 'UNKNOWN',
            })),
          },
        };
      },
    };
    const box = outbox(Array.from({ length: 350 }, (_, i) => batch(i + 1)));
    const c = new RecoveryCoordinator(
      transport,
      () => time,
      () => 0,
    );
    const wait = async (ms: number) => {
      time += ms;
      return true;
    };
    const pending = await box.list();
    await c.recover(pending, box, new AbortController().signal, wait);
    expect(seen).toHaveLength(3);
    expect(seen[1].at - seen[0].at).toBeGreaterThanOrEqual(1000);
    expect(seen[2].at - seen[1].at).toBeGreaterThanOrEqual(1000);
    expect(box.remove).not.toHaveBeenCalled();
    expect(c.held.size).toBe(0);
    expect(
      c.recover(pending, box, new AbortController().signal, wait),
    ).toBeUndefined();
    expect(seen).toHaveLength(3);
  });
  it('bounds retries, applies positive jitter and honors long Retry-After across triggers', async () => {
    let time = 100000;
    const waits: number[] = [];
    const call = vi
      .fn()
      .mockResolvedValueOnce({ status: 'retryable', retryAfterMs: 5000 })
      .mockResolvedValueOnce({ status: 'retryable' })
      .mockResolvedValueOnce({ status: 'retryable', retryAfterMs: 120000 });
    const box = outbox([batch(1), batch(2)]);
    const c = new RecoveryCoordinator(
      { capabilities: async () => capabilities, reconcileBatches: call } as any,
      () => time,
      () => 1,
    );
    await c.recover(
      await box.list(),
      box,
      new AbortController().signal,
      async (ms) => {
        waits.push(ms);
        time += ms;
        return true;
      },
    );
    expect(call).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([5000, 2400]);
    time += 31000;
    expect(
      c.recover(
        await box.list(),
        box,
        new AbortController().signal,
        async () => true,
      ),
    ).toBeUndefined();
  });
  it('accepts exact STORED only and retains/confines CONFLICT and DELETED', async () => {
    const items = [batch(1), batch(2), batch(3), batch(4)];
    const box = outbox(items);
    const c = new RecoveryCoordinator({
      capabilities: async () => capabilities,
      reconcileBatches: async () => ({
        status: 'ok',
        value: {
          recordingId: recording,
          traceId: trace,
          checkedAt: new Date().toISOString(),
          results: [
            {
              batchId: items[0].batchId,
              status: 'STORED',
              receipt: receipt(items[0]),
            },
            {
              batchId: items[1].batchId,
              status: 'STORED',
              receipt: { ...receipt(items[1]), contentHash: 'wrong' },
            },
            { batchId: items[2].batchId, status: 'CONFLICT' },
            { batchId: items[3].batchId, status: 'DELETED' },
          ],
        },
      }),
    } as any);
    await c.recover(items, box, new AbortController().signal, async () => true);
    expect(box.remove).toHaveBeenCalledTimes(1);
    expect(box.remove).toHaveBeenCalledWith(items[0].batchId);
    expect(box.block.mock.calls).toEqual([
      [items[2].batchId, 'CONFLICT'],
      [items[3].batchId, 'DELETED'],
    ]);
    expect(await box.list()).toHaveLength(3);
  });
  it('does not hold new uploads behind a slow recovery and UNKNOWN returns originals to retry', async () => {
    let release!: (result: any) => void;
    const query = vi.fn(() => new Promise<any>((r) => (release = r)));
    const sent: string[] = [];
    const old = [batch(1), batch(2)];
    const box = outbox(old);
    const t: any = {
      capabilities: async () => capabilities,
      reconcileBatches: query,
      capability: 'persisted-receipt-v1',
      name: 'test',
      send: async (b: RecordingBatchV1) => {
        sent.push(b.batchId);
        return { status: 'accepted', receipt: receipt(b) };
      },
    };
    const d = new OutboxDispatcher({ outbox: box, transport: t });
    await d.dispatch('startup');
    await d.dispatch('online');
    await d.dispatch('online');
    expect(query).toHaveBeenCalledTimes(1);
    box.add(batch(3));
    await d.dispatch('immediate');
    expect(sent).toEqual([batch(3).batchId]);
    release({
      status: 'ok',
      value: {
        recordingId: recording,
        traceId: trace,
        checkedAt: new Date().toISOString(),
        results: old.map((b) => ({ batchId: b.batchId, status: 'UNKNOWN' })),
      },
    });
    await vi.waitFor(async () => expect(await box.list()).toHaveLength(0));
    expect(query).toHaveBeenCalledTimes(1);
    await d.dispatch('scheduled');
    expect(query).toHaveBeenCalledTimes(1);
    d.destroy();
  });
  it('capability 404 caches fallback, does not block JSON uploads or introduce recovery polling', async () => {
    let probes = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith('/capabilities')) {
        probes++;
        return response({}, 404);
      }
      expect(init.headers['Content-Encoding']).toBeUndefined();
      return response({
        status: 'accepted',
        receipt: receipt(JSON.parse(init.body)),
      });
    });
    const t = http(fetchImpl);
    await t.capabilities!();
    for (let i = 1; i <= 3; i++)
      expect((await t.send(batch(i), context())).status).toBe('accepted');
    expect(probes).toBe(1);
  });
  it('415 falls back once to identical JSON and disables gzip for that config version', async () => {
    const bodies: string[] = [];
    let zipped = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith('/capabilities')) return response(capabilities);
      if (init.headers['Content-Encoding']) {
        zipped++;
        bodies.push(strFromU8(gunzipSync(new Uint8Array(init.body))));
        return response({}, 415);
      }
      bodies.push(init.body);
      return response({
        status: 'accepted',
        receipt: receipt(JSON.parse(init.body)),
      });
    });
    const t = http(fetchImpl);
    await t.capabilities!();
    await t.send(batch(1), context());
    await t.send(batch(1), context());
    expect(zipped).toBe(1);
    expect(new Set(bodies).size).toBe(1);
  });
  it('429 respects Retry-After without failover and parses HTTP dates', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchImpl = vi.fn(async () =>
      response({}, 429, { 'Retry-After': '60' }),
    );
    const t = http(fetchImpl, { capabilityDiscovery: false });
    const result = await t.send(batch(1), context());
    expect(result).toMatchObject({ status: 'retryable', retryAfterMs: 60000 });
    await t.send(batch(1), context());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      retryAfter(
        response({}, 429, {
          'Retry-After': new Date(now + 120000).toUTCString(),
        }),
        now,
      ),
    ).toBeGreaterThan(119000);
  });
  it('persists blocked metadata without deleting original bytes', async () => {
    const db = await openRecorderDatabase(new IDBFactory());
    try {
      const box = new IndexedDbOutbox(db, key);
      const b = { ...batch(1), events: [], bytes: 12, createdAt: Date.now() };
      expect(await box.enqueueManyFromJournal([b], [])).toBe(true);
      await box.block(b.batchId, 'DELETED');
      const rows = await new IndexedDbOutbox(db, key).list();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        deliveryBlocked: 'DELETED',
        batchId: b.batchId,
        contentHash: b.contentHash,
      });
    } finally {
      db.close();
    }
  });
  it('reuses discovery through same-version refresh and probes once on config version change', async () => {
    let generation = 1,
      version = '1',
      required = 'new';
    const probes: string[] = [];
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith('/capabilities')) {
        probes.push(init.headers['X-Config-Version']);
        return response(capabilities);
      }
      return init.headers.Authorization === `Bearer ${required}`
        ? response({ status: 'accepted', receipt: receipt(batch(1)) })
        : response({}, 401);
    });
    const t = http(fetchImpl, {
      resolveConfig: async () => ({
        ok: true,
        value: {
          ...config(),
          configVersion: version,
          uploadToken: required + '',
        },
      }),
    });
    await t.capabilities!();
    await t.send(batch(1), context());
    await t.capabilities!();
    expect(probes).toEqual(['1']);
    version = '2';
    required = 'newer';
    await t.send(batch(1), context());
    await Promise.all([t.capabilities!(), t.capabilities!()]);
    expect(probes).toEqual(['1', '2']);
  });
  it('query 401 refresh never adds a hidden second status request', async () => {
    let requests = 0;
    const t = http(
      vi.fn(async () => {
        requests++;
        return response({}, 401);
      }),
      {
        capabilityDiscovery: false,
        resolveConfig: async () => ({
          ok: true,
          value: { ...config(), uploadToken: 'new' },
        }),
      },
    );
    const b = batch(1);
    expect(
      (
        await t.reconcileBatches!(
          b.recordingId,
          b.traceId,
          [
            {
              batchId: b.batchId,
              sequenceStart: 1,
              sequenceEnd: 1,
              contentHash: b.contentHash,
            },
          ],
          context(),
        )
      ).status,
    ).toBe('retryable');
    expect(requests).toBe(1);
  });
  it('capability timeout is cached and cannot hold a normal upload', async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).endsWith('/capabilities')
        ? new Promise<Response>(() => {})
        : response({ status: 'accepted', receipt: receipt(batch(1)) }),
    );
    const t = http(fetchImpl);
    expect((await t.send(batch(1), context())).status).toBe('accepted');
    await t.destroy?.();
    expect((await t.capabilities!()).gzipHttp).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('retains permanent old-batch rejection while allowing later batches to upload', async () => {
    const first = batch(1),
      second = batch(2);
    const box = outbox([first, second]);
    const t: any = {
      name: 'test',
      capability: 'test-only',
      send: async (b: RecordingBatchV1) =>
        b.batchId === first.batchId
          ? { status: 'rejected', reason: 'http-422' }
          : { status: 'accepted', receipt: receipt(b) },
    };
    const blocked = vi.fn();
    const d = new OutboxDispatcher({
      transport: t,
      outbox: box,
      onBlocked: blocked,
    });
    expect((await d.dispatch('manual')).sent).toBe(1);
    expect(await box.list()).toEqual([first]);
    expect(box.block).toHaveBeenCalledWith(first.batchId, 'http-422');
    expect(blocked).toHaveBeenCalledWith(first);
    d.destroy();
  });
  it('never mixes Recording identities within a query', async () => {
    let now = 100000;
    const items = [
      batch(1),
      batch(2, '44444444-4444-4444-8444-444444444444'),
      batch(3),
    ];
    const calls: any[] = [];
    const c = new RecoveryCoordinator(
      {
        capabilities: async () => capabilities,
        reconcileBatches: async (
          recordingId: string,
          traceId: string,
          pending: any[],
        ) => {
          calls.push({ recordingId, pending });
          expect(
            pending.every(
              (p) =>
                items.find((b) => b.batchId === p.batchId)?.recordingId ===
                recordingId,
            ),
          ).toBe(true);
          return {
            status: 'ok',
            value: {
              recordingId,
              traceId,
              checkedAt: new Date(now).toISOString(),
              results: pending.map((b) => ({
                batchId: b.batchId,
                status: 'UNKNOWN',
              })),
            },
          };
        },
      } as any,
      () => now,
    );
    await c.recover(
      items,
      outbox(items),
      new AbortController().signal,
      async (ms) => {
        now += ms;
        return true;
      },
    );
    expect(calls).toHaveLength(2);
  });
  it('compresses with the bundled fallback when CompressionStream is unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    let compressed = false;
    const t = http(
      vi.fn(async (url, init) => {
        if (String(url).endsWith('/capabilities'))
          return response(capabilities);
        compressed = init.headers['Content-Encoding'] === 'gzip';
        expect(strFromU8(gunzipSync(new Uint8Array(init.body)))).toBe(
          JSON.stringify(batch(1)),
        );
        return response({ status: 'accepted', receipt: receipt(batch(1)) });
      }),
    );
    await t.capabilities!();
    expect((await t.send(batch(1), context())).status).toBe('accepted');
    expect(compressed).toBe(true);
  });

  it('does not post closes repeatedly to a legacy server without closeV2', async () => {
    const fetchImpl = vi.fn(async () => response({}, 404));
    const t = http(fetchImpl);
    const declaration: any = {
      appKey: key,
      kind: 'recording',
      targetId: recording,
      payload: { closeId: trace },
    };
    await t.sendClose!(declaration, context());
    await t.sendClose!(declaration, context());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/capabilities');
  });
  it('optional endpoint denial never disables otherwise-authorized uploads', async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('/api/events')
        ? response({ status: 'accepted', receipt: receipt(batch(1)) })
        : response({}, 403),
    );
    const t = http(fetchImpl);
    expect((await t.capabilities!()).reconcileV2).toBe(false);
    const b = batch(1);
    expect(
      (
        await t.reconcileBatches!(
          b.recordingId,
          b.traceId,
          [
            {
              batchId: b.batchId,
              sequenceStart: 1,
              sequenceEnd: 1,
              contentHash: b.contentHash,
            },
          ],
          context(),
        )
      ).status,
    ).toBe('rejected');
    expect((await t.send(b, context())).status).toBe('accepted');
  });
});
