export interface SerializedValue {
  readonly json: string;
  readonly bytes: Uint8Array;
}

function canonicalize(
  value: unknown,
  ancestors: Set<object>,
  inArray: boolean,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return inArray ? null : undefined;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('BigInt values cannot be serialized.');
  }
  if (typeof value !== 'object') return value;
  if (ancestors.has(value)) {
    throw new TypeError('Cyclic values cannot be serialized.');
  }

  const serializable = value as { toJSON?: () => unknown };
  if (typeof serializable.toJSON === 'function') {
    return canonicalize(serializable.toJSON(), ancestors, inArray);
  }

  ancestors.add(value);
  let normalized: unknown;
  if (Array.isArray(value)) {
    normalized = value.map((item) => canonicalize(item, ancestors, true));
  } else {
    const record: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = canonicalize(
        (value as Record<string, unknown>)[key],
        ancestors,
        false,
      );
      if (item !== undefined) record[key] = item;
    }
    normalized = record;
  }
  ancestors.delete(value);
  return normalized;
}

export function canonicalSerialize(value: unknown): string {
  const json = JSON.stringify(canonicalize(value, new Set(), false));
  if (json === undefined) {
    throw new TypeError('The root value cannot be serialized.');
  }
  return json;
}

export function serializeBatchSync(value: unknown): SerializedValue {
  const json = canonicalSerialize(value);
  return Object.freeze({ json, bytes: new TextEncoder().encode(json) });
}

export async function serializeBatch(value: unknown): Promise<SerializedValue> {
  return serializeBatchSync(value);
}
