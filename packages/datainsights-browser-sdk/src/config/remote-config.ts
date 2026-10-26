import type {
  RemoteConfigResolverOptions,
  ResolvedApplicationConfig,
  SDKResult,
} from '../public/types';
import { resolveConfigOrigin } from './app-key';

const CONFIG_KEYS = new Set([
  'appKey',
  'enabled',
  'configVersion',
  'collectorUrls',
  'uploadToken',
  'expiresAt',
]);

function invalidConfig<T>(): SDKResult<T> {
  return {
    ok: false,
    error: {
      code: 'REMOTE_CONFIG_INVALID',
      message: 'The application configuration is invalid.',
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrustedCollectorUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.search === '' &&
      url.hash === ''
    );
  } catch (_error) {
    return false;
  }
}

function validateRemoteConfig(
  appKey: string,
  value: unknown,
  now: number,
): SDKResult<Readonly<ResolvedApplicationConfig>> {
  if (!isRecord(value) || !Object.keys(value).every((key) => CONFIG_KEYS.has(key))) {
    return invalidConfig();
  }
  if (value.enabled === false) {
    return {
      ok: false,
      error: {
        code: 'APPLICATION_DISABLED',
        message: 'The application is disabled.',
      },
    };
  }

  const collectors = value.collectorUrls;
  const expiresAt =
    typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (
    value.appKey !== appKey ||
    value.enabled !== true ||
    typeof value.configVersion !== 'string' ||
    value.configVersion.length === 0 ||
    value.configVersion.length > 128 ||
    !Array.isArray(collectors) ||
    collectors.length === 0 ||
    collectors.length > 3 ||
    !collectors.every(isTrustedCollectorUrl) ||
    new Set(collectors).size !== collectors.length ||
    typeof value.uploadToken !== 'string' ||
    value.uploadToken.length === 0 ||
    value.uploadToken.length > 4096 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  ) {
    return invalidConfig();
  }

  return {
    ok: true,
    value: Object.freeze({
      appKey,
      enabled: true,
      configVersion: value.configVersion,
      collectorUrls: Object.freeze([...collectors]) as readonly [
        string,
        ...string[],
      ],
      uploadToken: value.uploadToken,
      expiresAt: value.expiresAt as string,
    }),
  };
}

export async function resolveRemoteConfig(
  appKey: string,
  options: RemoteConfigResolverOptions = {},
): Promise<SDKResult<Readonly<ResolvedApplicationConfig>>> {
  const origin = resolveConfigOrigin(appKey);
  if (!origin.ok) return origin;

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      error: {
        code: 'REMOTE_CONFIG_FAILED',
        message: 'The application configuration could not be loaded.',
      },
    };
  }

  try {
    const response = await fetchImpl(
      `${origin.value}/sdk/config?appKey=${encodeURIComponent(appKey)}`,
      {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: options.signal,
        headers: { Accept: 'application/json' },
      },
    );
    if (!response.ok) throw new Error('remote-config-http-failure');
    return validateRemoteConfig(
      appKey,
      await response.json(),
      options.now?.() ?? Date.now(),
    );
  } catch (_error) {
    return {
      ok: false,
      error: {
        code: 'REMOTE_CONFIG_FAILED',
        message: 'The application configuration could not be loaded.',
      },
    };
  }
}
