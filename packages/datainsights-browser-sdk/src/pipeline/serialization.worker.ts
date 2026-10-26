import { serializeBatchSync, type SerializedValue } from './serializer';

export interface SerializationWorkerRequest {
  readonly id: string;
  readonly value: unknown;
}

export interface SerializationWorkerResponse {
  readonly id: string;
  readonly result: SerializedValue;
}

export function serializeInWorker(
  request: SerializationWorkerRequest,
): SerializationWorkerResponse {
  return { id: request.id, result: serializeBatchSync(request.value) };
}

interface WorkerScope {
  document?: unknown;
  addEventListener?: (
    type: 'message',
    listener: (event: MessageEvent<SerializationWorkerRequest>) => void,
  ) => void;
  postMessage?: (response: SerializationWorkerResponse) => void;
}

const workerScope = globalThis as unknown as WorkerScope;
if (
  typeof workerScope.document === 'undefined' &&
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function'
) {
  workerScope.addEventListener('message', (event) => {
    workerScope.postMessage?.(serializeInWorker(event.data));
  });
}
