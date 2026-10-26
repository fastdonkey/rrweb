import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

interface IdentityClient {
  init(options: Record<string, unknown>): Result;
  consent: { grant(evidence: Record<string, unknown>): Result };
  identify(userId: string): Result;
  clearIdentity(): Result;
  start(
    context?: Record<string, unknown>,
  ): Promise<Result<{ identityType: string }>>;
  stop(): Promise<Result>;
  getDebugInfo(): Readonly<Record<string, unknown>>;
}

const transport = {
  name: 'identity-test',
  capability: 'test-only',
  async send() {
    return { status: 'accepted' };
  },
};

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    values,
  };
}

async function freshClient(): Promise<IdentityClient> {
  vi.resetModules();
  const { DataInsights } = await import('../src/index');
  return DataInsights as unknown as IdentityClient;
}

function grant(client: IdentityClient): void {
  client.consent.grant({
    noticeVersion: 'insurance-notice-v1',
    action: 'start-insurance',
  });
}

describe('identity lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not read or generate identity before consent', async () => {
    const client = await freshClient();
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);

    client.init({ appKey: 'insurance-h5', transport });

    expect(typeof client.identify).toBe('function');
    expect(client.identify('host-user')).toEqual({
      ok: false,
      error: { code: 'CONSENT_REQUIRED', message: expect.any(String) },
    });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('uses a host identity without touching anonymous storage', async () => {
    const client = await freshClient();
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', new IDBFactory());
    client.init({ appKey: 'insurance-h5', transport });
    grant(client);

    expect(client.identify('host-user-a').ok).toBe(true);
    expect(client.identify('host-user-b').ok).toBe(true);
    const result = await client.start();

    expect(result).toMatchObject({
      ok: true,
      value: { identityType: 'host' },
    });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(JSON.stringify(client.getDebugInfo())).not.toContain('host-user-b');
  });

  it('creates a durable anonymous UUID only after consent', async () => {
    const client = await freshClient();
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', new IDBFactory());
    client.init({ appKey: 'insurance-h5', transport });
    grant(client);

    const result = await client.start();
    const storedId = storage.values.get('di:v1:insurance-h5:anonymous-id');

    expect(result).toMatchObject({
      ok: true,
      value: { identityType: 'anonymous' },
    });
    expect(storedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('clears host and anonymous identities deterministically', async () => {
    const client = await freshClient();
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', new IDBFactory());
    client.init({ appKey: 'insurance-h5', transport });
    grant(client);
    await client.start();
    await client.stop();

    expect(client.clearIdentity().ok).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith(
      'di:v1:insurance-h5:anonymous-id',
    );
    expect(client.identify('replacement-user').ok).toBe(true);
    expect(await client.start()).toMatchObject({
      ok: true,
      value: { identityType: 'host' },
    });
  });
});
