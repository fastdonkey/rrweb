import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpTransport as createBaseHttpTransport } from '../src/transport/http';
const createHttpTransport = (
  ...args: Parameters<typeof createBaseHttpTransport>
) =>
  createBaseHttpTransport(args[0], args[1], {
    ...args[2],
    capabilityDiscovery: false,
  });
import { resolveRemoteConfig } from '../src/config/remote-config';
import { createClient } from '../src/runtime/client';
import { OutboxDispatcher } from '../src/pipeline/outbox-dispatcher';
import type { ResolvedApplicationConfig } from '../src/public/types';
import type { RecordingBatchV1 } from '../src/pipeline/batcher';
const key = 'di_t_cn1_' + 'a'.repeat(32);
const initialTime = Date.parse('2026-10-29T00:00:00Z');
const config = (token = 'old'): ResolvedApplicationConfig => ({
  appKey: key,
  enabled: true,
  configVersion: '1',
  collectorUrls: ['https://collector.example'],
  uploadToken: token,
  expiresAt: new Date(Date.now() + 1800000).toISOString(),
});
const batch = {
  appKey: key,
  batchId: 'b1',
  recordingId: 'r1',
  sequenceStart: 1,
  sequenceEnd: 2,
  contentHash: 'hash',
  events: [],
} as unknown as RecordingBatchV1;
const context = () => ({
  signal: new AbortController().signal,
  attempt: 1,
  trigger: 'manual' as const,
});
const accepted = () =>
  new Response(
    JSON.stringify({
      status: 'accepted',
      receipt: {
        persisted: true,
        batchId: batch.batchId,
        recordingId: batch.recordingId,
        sequenceStart: 1,
        sequenceEnd: 2,
        contentHash: batch.contentHash,
      },
    }),
  );
const failure = () => ({
  ok: false as const,
  error: { code: 'REMOTE_CONFIG_FAILED' as const, message: 'Unavailable' },
});
let transports: ReturnType<typeof createHttpTransport>[] = [];
function transport(
  fetchImpl: typeof fetch,
  resolver?: (key: string, signal: AbortSignal) => Promise<any>,
) {
  const t = createHttpTransport(
    config(),
    fetchImpl,
    resolver ? { resolveConfig: resolver } : {},
  );
  transports.push(t);
  return t;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
});
afterEach(async () => {
  for (const t of transports) await t.destroy?.();
  transports = [];
  vi.useRealTimers();
});
describe('upload token refresh', () => {
  it('refreshes at 25 minutes and sends after 30 minutes without changing payload', async () => {
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: config('new'),
    }));
    const fetchImpl = vi.fn(async () => accepted());
    const t = transport(fetchImpl, resolve);
    await vi.advanceTimersByTimeAsync(1499999);
    expect(resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300001);
    expect((await t.send(batch, context())).status).toBe('accepted');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer new');
    expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify(batch));
  });
  it('coalesces concurrent and late 401 responses into one refresh', async () => {
    let late!: () => void;
    const release = new Promise<void>((r) => (late = r));
    let oldRequests = 0;
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: config('new'),
    }));
    const fetchImpl = vi.fn(async (_url, init) => {
      if (init.headers.Authorization === 'Bearer old') {
        if (++oldRequests === 2) await release;
        return new Response('', { status: 401 });
      }
      return accepted();
    });
    const t = transport(fetchImpl, resolve);
    const first = t.send(batch, context());
    const second = t.send(batch, context());
    expect((await first).status).toBe('accepted');
    late();
    expect((await second).status).toBe('accepted');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(new Set(fetchImpl.mock.calls.map((c) => c[1].body)).size).toBe(1);
  });
  it('does not loop when refreshed token is also rejected', async () => {
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: config('new'),
    }));
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const t = transport(fetchImpl, resolve);
    expect((await t.send(batch, context())).status).toBe('retryable');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await t.send(batch, context());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('pauses on 403 and preserves the actual dispatcher Outbox', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    const resolve = vi.fn();
    const t = transport(fetchImpl, resolve);
    const outbox = { list: async () => [batch], remove: vi.fn() };
    const dispatcher = new OutboxDispatcher({ outbox, transport: t });
    expect((await dispatcher.dispatch('manual')).state).toBe('blocked');
    expect(outbox.remove).not.toHaveBeenCalled();
    await dispatcher.dispatch('manual');
    await vi.advanceTimersByTimeAsync(3600000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
    dispatcher.destroy();
  });
  it('backs off offline refresh and recovers with original identity', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(failure())
      .mockImplementation(async () => ({ ok: true, value: config('new') }));
    const fetchImpl = vi.fn(async () => accepted());
    const t = transport(fetchImpl, resolve);
    await vi.advanceTimersByTimeAsync(1500000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect((await t.send(batch, context())).status).toBe('retryable');
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolve).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect((await t.send(batch, context())).status).toBe('accepted');
    expect(fetchImpl.mock.calls[0][1].headers['X-App-Key']).toBe(key);
  });
  it('refuses a different key returned by a resolver or queued on another transport', async () => {
    const resolve = vi.fn(async () => ({
      ok: true as const,
      value: { ...config('new'), appKey: key + 'x' },
    }));
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const t = transport(fetchImpl, resolve);
    expect((await t.send(batch, context())).status).toBe('retryable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      (await t.send({ ...batch, appKey: key + 'x' }, context())).status,
    ).toBe('rejected');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('stops refresh and does not publish after destroy during in-flight refresh', async () => {
    let release!: (value: any) => void;
    const resolve = vi.fn(() => new Promise<any>((r) => (release = r)));
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const t = transport(fetchImpl, resolve);
    const sending = t.send(batch, context());
    await vi.advanceTimersByTimeAsync(0);
    await t.destroy?.();
    release({ ok: true, value: config('new') });
    await sending;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3600000);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('times out a hung resolver and destroy cancels all refresh work', async () => {
    const resolver = vi.fn(() => new Promise<any>(() => {}));
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const t = transport(fetchImpl, resolver);
    const first = t.send(batch, context());
    await vi.advanceTimersByTimeAsync(10000);
    expect((await first).status).toBe('retryable');
    expect(resolver).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolver).toHaveBeenCalledTimes(2);
    await t.destroy?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('client destroy releases an advanced transport timer', async () => {
    const resolver = vi.fn(async () => ({
      ok: true as const,
      value: config('new'),
    }));
    const t = transport(
      vi.fn(async () => accepted()),
      resolver,
    );
    const client = createClient();
    expect(client.init({ appKey: key, transport: t }).ok).toBe(true);
    await client.destroy();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(resolver).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('maps config 403 into a disabled state without exposing credentials', async () => {
    const result = await resolveRemoteConfig(key, {
      fetchImpl: vi.fn(async () => new Response('', { status: 403 })),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'APPLICATION_DISABLED' },
    });
  });
  it('default resolver reloads the same AppKey through the existing config endpoint', async () => {
    const fetchImpl = vi.fn(async (url, init) =>
      String(url).includes('/sdk/config?')
        ? new Response(JSON.stringify(config('new')))
        : init.headers.Authorization === 'Bearer old'
        ? new Response('', { status: 401 })
        : accepted(),
    );
    const t = transport(fetchImpl);
    expect((await t.send(batch, context())).status).toBe('accepted');
    expect(fetchImpl.mock.calls[1][0]).toContain('/sdk/config?appKey=' + key);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
