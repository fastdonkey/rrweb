import type { SDKResult } from '../public/types';

export interface AppKeyRoute {
  readonly environment: 'production' | 'test';
  readonly region: 'cn1';
}

const ROUTES = Object.freeze({
  p: Object.freeze({
    environment: 'production' as const,
    origins: Object.freeze({
      cn1: 'https://config-cn1.datainsights.io',
    }),
  }),
  t: Object.freeze({
    environment: 'test' as const,
    origins: Object.freeze({
      cn1: 'https://config-test-cn1.datainsights.io',
    }),
  }),
});

const APP_KEY_PATTERN = /^di_(p|t)_([a-z][a-z0-9]{1,7})_([A-Za-z0-9]{8,64})$/;

function unsupported<T>(): SDKResult<T> {
  return {
    ok: false,
    error: {
      code: 'APP_KEY_ROUTE_UNSUPPORTED',
      message: 'The application key route is not supported.',
    },
  };
}

export function parseAppKeyRoute(appKey: string): SDKResult<AppKeyRoute> {
  const match = APP_KEY_PATTERN.exec(appKey);
  if (!match) return unsupported();

  const environmentKey = match[1] as keyof typeof ROUTES;
  const environment = ROUTES[environmentKey];
  const region = match[2];
  if (!(region in environment.origins) || region !== 'cn1') {
    return unsupported();
  }

  return {
    ok: true,
    value: Object.freeze({
      environment: environment.environment,
      region,
    }),
  };
}

export function resolveConfigOrigin(appKey: string): SDKResult<string> {
  const parsed = parseAppKeyRoute(appKey);
  if (!parsed.ok) return parsed;

  const environmentKey = parsed.value.environment === 'production' ? 'p' : 't';
  return {
    ok: true,
    value: ROUTES[environmentKey].origins[parsed.value.region],
  };
}
