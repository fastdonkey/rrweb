import type { SDKResult } from '../public/types';

const EVENT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/;
const SENSITIVE_KEY_PATTERN =
  /password|passwd|token|authorization|cookie|secret/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 1000;
const MAX_SERIALIZED_BYTES = 32 * 1024;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface CloneState {
  readonly seen: WeakSet<object>;
  redactedKeys: number;
}

function invalid(): SDKResult<never> {
  return {
    ok: false,
    error: {
      code: 'CUSTOM_EVENT_INVALID',
      message: 'Custom event name or payload is invalid.',
    },
  };
}

function cloneValue(
  value: unknown,
  depth: number,
  state: CloneState,
): JsonValue {
  if (depth > MAX_DEPTH) throw new Error('depth');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('number');
    return value;
  }
  if (typeof value !== 'object') throw new Error('type');
  if (
    typeof globalThis.Node === 'function' &&
    value instanceof globalThis.Node
  ) {
    throw new Error('dom');
  }
  if (state.seen.has(value)) throw new Error('cycle');
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error('array');
    return value.map((item) => cloneValue(item, depth + 1, state));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('prototype');
  }

  const output: Record<string, JsonValue> = Object.create(null);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('key');
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      state.redactedKeys += 1;
      continue;
    }
    output[key] = cloneValue(item, depth + 1, state);
  }
  return output;
}

export function sanitizeCustomEvent(
  name: string,
  data: unknown,
): SDKResult<{ data: JsonValue; redactedKeys: number }> {
  if (!EVENT_NAME_PATTERN.test(name)) return invalid();
  try {
    const state: CloneState = { seen: new WeakSet(), redactedKeys: 0 };
    const cloned = cloneValue(data, 0, state);
    const serialized = JSON.stringify(cloned);
    if (
      new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES
    ) {
      return invalid();
    }
    return {
      ok: true,
      value: { data: cloned, redactedKeys: state.redactedKeys },
    };
  } catch {
    return invalid();
  }
}
