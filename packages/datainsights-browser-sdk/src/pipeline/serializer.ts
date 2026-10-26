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

interface PendingSerialization {
  readonly value: unknown;
  readonly resolve: (result: SerializedValue) => void;
}

export interface WorkerFirstSerializerOptions {
  readonly createWorker?: (url: string) => Worker;
}

export class WorkerFirstSerializer {
  private worker?: Worker;
  private requestId = 0;
  private readonly pending = new Map<string, PendingSerialization>();
  usingFallback: boolean;

  constructor(
    workerUrl: string | undefined,
    options: WorkerFirstSerializerOptions = {},
  ) {
    const createWorker =
      options.createWorker ??
      ((url: string) => new globalThis.Worker(url, { type: 'classic' }));
    try {
      this.worker = workerUrl ? createWorker(workerUrl) : undefined;
    } catch (_error) {
      this.worker = undefined;
    }
    this.usingFallback = this.worker === undefined;
    this.worker?.addEventListener('message', this.handleMessage);
    this.worker?.addEventListener('error', this.handleFailure);
    this.worker?.addEventListener('messageerror', this.handleFailure);
  }

  serialize(value: unknown): Promise<SerializedValue> {
    if (!this.worker) return Promise.resolve(serializeBatchSync(value));
    const id = `serialization-${++this.requestId}`;
    return new Promise<SerializedValue>((resolve) => {
      this.pending.set(id, { value, resolve });
      try {
        this.worker?.postMessage({ id, value });
      } catch (_error) {
        this.fallback();
      }
    });
  }

  destroy(): void {
    this.fallback();
  }

  private readonly handleMessage = (
    event: MessageEvent<{ id?: unknown; result?: SerializedValue }>,
  ): void => {
    if (typeof event.data?.id !== 'string' || !event.data.result) return;
    const pending = this.pending.get(event.data.id);
    if (!pending) return;
    this.pending.delete(event.data.id);
    pending.resolve(event.data.result);
  };

  private readonly handleFailure = (): void => {
    this.fallback();
  };

  private fallback(): void {
    this.worker?.removeEventListener('message', this.handleMessage);
    this.worker?.removeEventListener('error', this.handleFailure);
    this.worker?.removeEventListener('messageerror', this.handleFailure);
    this.worker?.terminate();
    this.worker = undefined;
    this.usingFallback = true;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.resolve(serializeBatchSync(pending.value));
    }
  }
}

export function createWorkerFirstSerializer(
  workerUrl?: string,
  options?: WorkerFirstSerializerOptions,
): WorkerFirstSerializer {
  return new WorkerFirstSerializer(workerUrl, options);
}
