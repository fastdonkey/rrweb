import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

interface TestClient {
  init(options: Record<string, unknown>): Result<TestClient>;
  consent: {
    grant(evidence: Record<string, unknown>): Result;
    revoke(): Promise<Result>;
  };
  start(
    context?: Record<string, unknown>,
  ): Promise<Result<Record<string, unknown>>>;
  stop(): Promise<Result>;
  destroy(): Promise<Result>;
  getDebugInfo(): { state: string };
}

const transport = {
  name: 'lifecycle-test',
  capability: 'test-only',
  async send() {
    return { status: 'accepted' };
  },
};

async function freshClient(): Promise<TestClient> {
  vi.resetModules();
  const { DataInsights } = await import('../src/index');
  return DataInsights as unknown as TestClient;
}

function grant(client: TestClient): Result {
  return client.consent.grant({
    noticeVersion: 'insurance-notice-v1',
    action: 'start-insurance',
  });
}

describe('SDK lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('collects nothing and rejects start before consent', async () => {
    const client = await freshClient();
    const indexedDBAccess = vi.fn(() => {
      throw new Error('IndexedDB must not be read before consent');
    });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get: indexedDBAccess,
    });

    try {
      expect(client.init({ appKey: 'insurance-h5', transport }).ok).toBe(true);
      expect(typeof client.start).toBe('function');
      expect(await client.start()).toEqual({
        ok: false,
        error: { code: 'CONSENT_REQUIRED', message: expect.any(String) },
      });
      expect(indexedDBAccess).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });

  it('deduplicates concurrent starts and enters recording when ready', async () => {
    const client = await freshClient();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const indexedDBAccess = vi.fn(() => new IDBFactory());
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get: indexedDBAccess,
    });

    try {
      client.init({ appKey: 'insurance-h5', transport });
      expect(grant(client).ok).toBe(true);

      const first = client.start({ userId: 'host-user' });
      const second = client.start({ userId: 'host-user' });
      expect(first).toBe(second);

      const result = await first;
      expect(result.ok).toBe(true);
      expect(client.getDebugInfo().state).toBe('recording');
      expect(indexedDBAccess).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });

  it('returns to authorized when persistence is unavailable', async () => {
    const client = await freshClient();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Reflect.deleteProperty(globalThis, 'indexedDB');

    try {
      client.init({ appKey: 'insurance-h5', transport });
      grant(client);

      expect(await client.start()).toEqual({
        ok: false,
        error: {
          code: 'PERSISTENCE_UNAVAILABLE',
          message: expect.any(String),
        },
      });
      expect(client.getDebugInfo().state).toBe('authorized');
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    }
  });

  it('keeps stop and revoke idempotent', async () => {
    const client = await freshClient();
    client.init({ appKey: 'insurance-h5', transport });

    expect((await client.stop()).ok).toBe(true);
    expect((await client.consent.revoke()).ok).toBe(true);
    expect((await client.consent.revoke()).ok).toBe(true);
    expect(client.getDebugInfo().state).toBe('initialized');
  });

  it('makes destroy idempotent and rejects later recording calls', async () => {
    const client = await freshClient();
    client.init({ appKey: 'insurance-h5', transport });

    expect((await client.destroy()).ok).toBe(true);
    expect((await client.destroy()).ok).toBe(true);
    expect(await client.start()).toEqual({
      ok: false,
      error: { code: 'DESTROYED', message: expect.any(String) },
    });
  });
});
