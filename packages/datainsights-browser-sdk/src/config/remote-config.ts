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
    const localHttp =
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    return (
      (url.protocol === 'https:' || localHttp) &&
      !url.username &&
      !url.password &&
      url.search === '' &&
      url.hash === ''
    );
  } catch (_error) {
    return false;
  }
}

function normalizeTrustedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch (_error) {
    return undefined;
  }
}

function validateRemoteConfig(
  appKey: string,
  value: unknown,
  now: number,
): SDKResult<Readonly<ResolvedApplicationConfig>> {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) => CONFIG_KEYS.has(key))
  ) {
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
  const routeOrigin = resolveConfigOrigin(appKey);
  if (!routeOrigin.ok) return routeOrigin;
  const configuredOrigin = options.trustedConfigOrigin
    ? normalizeTrustedOrigin(options.trustedConfigOrigin)
    : routeOrigin.value;
  if (!configuredOrigin) {
    return {
      ok: false,
      error: {
        code: 'APP_KEY_ROUTE_UNSUPPORTED',
        message: 'The application key route is not supported.',
      },
    };
  }

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
      `${configuredOrigin}/sdk/config?appKey=${encodeURIComponent(appKey)}`,
      {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: options.signal,
        headers: { Accept: 'application/json' },
      },
    );
    if (response.status === 403)
      return {
        ok: false,
        error: {
          code: 'APPLICATION_DISABLED',
          message: 'The application is not authorized.',
        },
      };
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
