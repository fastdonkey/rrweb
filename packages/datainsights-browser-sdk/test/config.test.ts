import { beforeEach, describe, expect, it, vi } from 'vitest';

type InitResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

type Init = (options: Record<string, unknown>) => InitResult;

const transport = {
  name: 'config-test',
  capability: 'test-only',
  async send() {
    return { status: 'accepted' };
  },
};

async function loadInit(): Promise<Init | undefined> {
  const { DataInsights } = await import('../src/index');
  return Reflect.get(DataInsights, 'init') as Init | undefined;
}

describe('SDK configuration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('accepts an appKey and transport without browser side effects', async () => {
    const init = await loadInit();

    expect(typeof init).toBe('function');
    const result = init?.({ appKey: 'insurance-h5-prod', transport });
    expect(result?.ok).toBe(true);
  });

  it.each([
    ['missing appKey', { transport }],
    ['sampleRate', { appKey: 'app', transport, sampleRate: 1 }],
    ['platform', { appKey: 'app', transport, platform: 'h5' }],
    ['tenantId', { appKey: 'app', transport, tenantId: 'tenant' }],
    ['securityKey', { appKey: 'app', transport, securityKey: 'secret' }],
    ['appSecret', { appKey: 'app', transport, appSecret: 'secret' }],
    ['unknown field', { appKey: 'app', transport, unexpected: true }],
  ])('rejects %s with a stable error', async (_name, options) => {
    const init = await loadInit();
    const result = init?.(options);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_CONFIG',
        message: expect.any(String),
      },
    });
  });

  it('rejects malformed privacy selectors', async () => {
    const init = await loadInit();
    const result = init?.({
      appKey: 'app',
      transport,
      privacy: { blockSelector: '[' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_CONFIG',
        message: expect.any(String),
      },
    });
  });

  it('does not touch runtime APIs when validation fails', async () => {
    const addEventListener = vi.fn();
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      'window',
    );
    const originalIndexedDB = Object.getOwnPropertyDescriptor(
      globalThis,
      'indexedDB',
    );
    const originalWorker = Object.getOwnPropertyDescriptor(
      globalThis,
      'Worker',
    );

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { addEventListener },
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('IndexedDB must not be read during config validation');
      },
    });
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      get() {
        throw new Error('Worker must not be read during config validation');
      },
    });

    try {
      const init = await loadInit();
      const result = init?.({ transport });

      expect(result?.ok).toBe(false);
      expect(addEventListener).not.toHaveBeenCalled();
    } finally {
      for (const [name, descriptor] of [
        ['window', originalWindow],
        ['indexedDB', originalIndexedDB],
        ['Worker', originalWorker],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    }
  });
});
