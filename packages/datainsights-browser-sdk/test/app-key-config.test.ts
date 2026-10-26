import { describe, expect, it, vi } from 'vitest';

import { parseAppKeyRoute, resolveConfigOrigin } from '../src/config/app-key';
import { resolveRemoteConfig } from '../src/config/remote-config';

const APP_KEY = 'di_t_cn1_K7J9M2X4';

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    appKey: APP_KEY,
    enabled: true,
    configVersion: '42',
    collectorUrls: ['https://collector-test-cn1.datainsights.io'],
    uploadToken: 'short-lived-upload-token',
    expiresAt: '2026-10-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('AppKey routing', () => {
  it('parses a known environment and region without deriving a URL from random input', () => {
    expect(parseAppKeyRoute('di_p_cn1_K7J9M2X4')).toEqual({
      ok: true,
      value: { environment: 'production', region: 'cn1' },
    });
    expect(resolveConfigOrigin('di_p_cn1_K7J9M2X4')).toEqual({
      ok: true,
      value: 'https://config-cn1.datainsights.io',
    });
  });

  it.each([
    'di_p_evil.example_K7J9M2X4',
    'di_x_cn1_K7J9M2X4',
    'di_p_cn1_short',
    'https://collector.example/app',
    'di_p_cn1_key/../../admin',
  ])('rejects unsupported or unsafe key %s', (appKey) => {
    expect(parseAppKeyRoute(appKey)).toMatchObject({
      ok: false,
      error: { code: 'APP_KEY_ROUTE_UNSUPPORTED' },
    });
  });
});

describe('remote application configuration', () => {
  it('loads a valid application config from the trusted route', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(validConfig()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const result = await resolveRemoteConfig(APP_KEY, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date('2026-10-26T11:00:00.000Z').getTime(),
    });

    expect(result).toEqual({ ok: true, value: validConfig() });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://config-test-cn1.datainsights.io/sdk/config?appKey=${APP_KEY}`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }),
    );
  });

  it('uses an SDK-derived localhost config origin for the local demo only', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            validConfig({ collectorUrls: ['http://127.0.0.1:4173'] }),
          ),
          { status: 200 },
        ),
    );

    const result = await resolveRemoteConfig(APP_KEY, {
      fetchImpl: fetchImpl as typeof fetch,
      trustedConfigOrigin: 'http://127.0.0.1:4173',
      now: () => new Date('2026-10-26T11:00:00.000Z').getTime(),
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://127.0.0.1:4173/sdk/config?appKey=${APP_KEY}`,
      expect.any(Object),
    );
  });

  it('fails closed when the application is disabled', async () => {
    const result = await resolveRemoteConfig(APP_KEY, {
      fetchImpl: vi.fn(
        async () =>
          new Response(JSON.stringify(validConfig({ enabled: false })), {
            status: 200,
          }),
      ) as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'APPLICATION_DISABLED' },
    });
  });

  it.each([
    ['mismatched appKey', { appKey: 'di_t_cn1_OTHERKEY9' }],
    ['expired token', { expiresAt: '2026-10-26T10:00:00.000Z' }],
    ['http collector', { collectorUrls: ['http://collector.example.com'] }],
    ['empty collectors', { collectorUrls: [] }],
    ['unknown field', { endpoint: 'https://evil.example' }],
  ])(
    'rejects %s without returning a usable transport config',
    async (_name, override) => {
      const result = await resolveRemoteConfig(APP_KEY, {
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify(validConfig(override)), {
              status: 200,
            }),
        ) as typeof fetch,
        now: () => new Date('2026-10-26T11:00:00.000Z').getTime(),
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'REMOTE_CONFIG_INVALID' },
      });
    },
  );

  it('maps network and HTTP failures to a stable error', async () => {
    const networkFailure = await resolveRemoteConfig(APP_KEY, {
      fetchImpl: vi.fn(async () => {
        throw new Error('private network detail');
      }) as typeof fetch,
    });
    const httpFailure = await resolveRemoteConfig(APP_KEY, {
      fetchImpl: vi.fn(
        async () => new Response('', { status: 503 }),
      ) as typeof fetch,
    });

    expect(networkFailure).toMatchObject({
      ok: false,
      error: { code: 'REMOTE_CONFIG_FAILED' },
    });
    expect(httpFailure).toMatchObject({
      ok: false,
      error: { code: 'REMOTE_CONFIG_FAILED' },
    });
    expect(JSON.stringify(networkFailure)).not.toContain(
      'private network detail',
    );
  });
});
