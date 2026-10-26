import type { DataInsightsOptions, SDKResult } from '../public/types';

const ROOT_KEYS = new Set([
  'appKey',
  'transport',
  'workerUrl',
  'onDeliveryStateChange',
  'privacy',
  'batching',
  'debug',
]);
const PRIVACY_KEYS = new Set([
  'blockSelector',
  'maskTextSelector',
  'ignoreSelector',
]);
const BATCHING_KEYS = new Set(['maxEvents', 'maxBytes', 'flushIntervalMs']);
const APP_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

type ValidationResult = SDKResult<Readonly<DataInsightsOptions>>;

function invalidConfig(message: string): ValidationResult {
  return { ok: false, error: { code: 'INVALID_CONFIG', message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isValidSelector(selector: unknown): selector is string {
  if (
    typeof selector !== 'string' ||
    selector.length === 0 ||
    selector.length > 1024 ||
    /[\0{};]/.test(selector)
  ) {
    return false;
  }

  const closingFor: Record<string, string> = { '[': ']', '(': ')' };
  const stack: string[] = [];
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const character of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character in closingFor) {
      stack.push(closingFor[character]);
      continue;
    }
    if ((character === ']' || character === ')') && stack.pop() !== character) {
      return false;
    }
  }

  return !escaped && !quote && stack.length === 0;
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value === undefined ||
    (Number.isInteger(value) &&
      (value as number) >= minimum &&
      (value as number) <= maximum)
  );
}

export function validateConfig(options: unknown): ValidationResult {
  if (!isRecord(options) || !hasOnlyKeys(options, ROOT_KEYS)) {
    return invalidConfig('Configuration contains unsupported fields.');
  }

  const { appKey, transport, workerUrl, privacy, batching } = options;
  if (
    typeof appKey !== 'string' ||
    appKey.length === 0 ||
    appKey.length > 128 ||
    !APP_KEY_PATTERN.test(appKey)
  ) {
    return invalidConfig('A valid public appKey is required.');
  }
  if (
    !isRecord(transport) ||
    typeof transport.name !== 'string' ||
    typeof transport.send !== 'function' ||
    (transport.capability !== 'test-only' &&
      transport.capability !== 'persisted-receipt-v1')
  ) {
    return invalidConfig('A valid transport is required.');
  }
  if (
    transport.capability === 'persisted-receipt-v1' &&
    typeof transport.reconcile !== 'function'
  ) {
    return invalidConfig('A persisted transport must support reconciliation.');
  }
  if (
    workerUrl !== undefined &&
    (typeof workerUrl !== 'string' ||
      workerUrl.length === 0 ||
      workerUrl.length > 2048 ||
      /^(?:blob|data|javascript):/i.test(workerUrl))
  ) {
    return invalidConfig('Worker URL is invalid.');
  }
  if (
    options.onDeliveryStateChange !== undefined &&
    typeof options.onDeliveryStateChange !== 'function'
  ) {
    return invalidConfig('Delivery state callback must be a function.');
  }
  if (options.debug !== undefined && typeof options.debug !== 'boolean') {
    return invalidConfig('Debug must be a boolean.');
  }

  if (privacy !== undefined) {
    if (!isRecord(privacy) || !hasOnlyKeys(privacy, PRIVACY_KEYS)) {
      return invalidConfig('Privacy configuration is invalid.');
    }
    if (
      !Object.values(privacy).every(
        (selector) => selector === undefined || isValidSelector(selector),
      )
    ) {
      return invalidConfig('Privacy selector is invalid.');
    }
  }

  if (batching !== undefined) {
    if (!isRecord(batching) || !hasOnlyKeys(batching, BATCHING_KEYS)) {
      return invalidConfig('Batching configuration is invalid.');
    }
    if (
      !isIntegerInRange(batching.maxEvents, 1, 500) ||
      !isIntegerInRange(batching.maxBytes, 64 * 1024, 2 * 1024 * 1024) ||
      !isIntegerInRange(batching.flushIntervalMs, 1000, 30000)
    ) {
      return invalidConfig('Batching limits are outside supported ranges.');
    }
  }

  return {
    ok: true,
    value: Object.freeze(options as unknown as DataInsightsOptions),
  };
}
