import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

interface CustomEventClient {
  init(options: Record<string, unknown>): Result;
  consent: { grant(evidence: Record<string, unknown>): Result };
  start(): Promise<Result>;
  addCustomEvent(name: string, data: unknown): Result;
}

interface SanitizerModule {
  sanitizeCustomEvent(
    name: string,
    data: unknown,
  ): Result<{ data: unknown; redactedKeys: number }>;
}

const transport = {
  name: 'custom-event-test',
  capability: 'test-only',
  async send() {
    return { status: 'accepted' };
  },
};

async function freshClient(): Promise<CustomEventClient> {
  vi.resetModules();
  const { DataInsights } = await import('../src/index');
  return DataInsights as unknown as CustomEventClient;
}

async function loadSanitizer(): Promise<SanitizerModule> {
  return import(
    '../src/events/safe-clone'
  ) as unknown as Promise<SanitizerModule>;
}

describe('custom events', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects custom events outside recording state', async () => {
    const client = await freshClient();
    client.init({ appKey: 'insurance-h5', transport });

    expect(typeof client.addCustomEvent).toBe('function');
    expect(client.addCustomEvent('quote.submit', {})).toEqual({
      ok: false,
      error: { code: 'CUSTOM_EVENT_INVALID', message: expect.any(String) },
    });
  });

  it('removes sensitive keys before accepting a payload', async () => {
    const sanitizer = await loadSanitizer();
    const result = sanitizer.sanitizeCustomEvent('quote.submit', {
      amount: 1288.5,
      password: 'never-record',
      nested: { authorization: 'Bearer secret', policyType: 'life' },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        data: {
          amount: 1288.5,
          nested: { policyType: 'life' },
        },
        redactedKeys: 2,
      },
    });
  });

  it.each([
    ['invalid name', '1invalid', {}],
    ['function', 'quote.submit', { value: () => undefined }],
    ['symbol', 'quote.submit', { value: Symbol('unsafe') }],
    ['bigint', 'quote.submit', { value: 1n }],
    ['oversized array', 'quote.submit', { value: Array(1001).fill(1) }],
    ['prototype key', 'quote.submit', JSON.parse('{"__proto__":{"x":1}}')],
  ])('rejects %s payloads', async (_case, name, data) => {
    const sanitizer = await loadSanitizer();
    expect(sanitizer.sanitizeCustomEvent(name, data)).toMatchObject({
      ok: false,
      error: { code: 'CUSTOM_EVENT_INVALID' },
    });
  });

  it('rejects cycles, excessive depth and oversized serialized data', async () => {
    const sanitizer = await loadSanitizer();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 9; index += 1) {
      deep.child = {};
      deep = deep.child as Record<string, unknown>;
    }

    for (const data of [cyclic, root, { text: 'x'.repeat(33 * 1024) }]) {
      expect(sanitizer.sanitizeCustomEvent('quote.submit', data)).toMatchObject(
        {
          ok: false,
          error: { code: 'CUSTOM_EVENT_INVALID' },
        },
      );
    }
  });

  it('accepts a safe event while recording', async () => {
    const client = await freshClient();
    client.init({ appKey: 'insurance-h5', transport });
    client.consent.grant({
      noticeVersion: 'insurance-notice-v1',
      action: 'start-insurance',
    });
    await client.start();

    expect(client.addCustomEvent('quote.submit', { amount: 1288.5 })).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
