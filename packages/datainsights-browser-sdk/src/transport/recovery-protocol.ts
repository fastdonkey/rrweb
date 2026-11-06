import { gzipSync, strToU8 } from 'fflate';
import type { PersistedReceipt } from './types';
export interface Capabilities {
  tokenRefresh: boolean;
  reconcileV2: boolean;
  closeV2: boolean;
  gzipHttp: boolean;
}
export const LEGACY: Readonly<Capabilities> = Object.freeze({
  tokenRefresh: false,
  reconcileV2: false,
  closeV2: false,
  gzipHttp: false,
});
export interface PendingBatch {
  batchId: string;
  sequenceStart: number;
  sequenceEnd: number;
  contentHash: string;
}
export interface RecoveryResponse {
  recordingId: string;
  traceId: string;
  checkedAt: string;
  results: {
    batchId: string;
    status: 'STORED' | 'UNKNOWN' | 'CONFLICT' | 'DELETED';
    receipt?: PersistedReceipt;
  }[];
}
export type RecoveryResult =
  | { status: 'ok'; value: RecoveryResponse }
  | { status: 'retryable'; retryAfterMs?: number }
  | { status: 'unsupported' | 'rejected' };
export function retryAfter(
  response: Response,
  now = Date.now(),
): number | undefined {
  const raw = response.headers.get('Retry-After');
  if (!raw) return undefined;
  const value = /^\d+(\.\d+)?$/.test(raw.trim())
    ? Number(raw) * 1000
    : Date.parse(raw) - now;
  return Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value))
    : undefined;
}
export async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort: (reason: Error) => void = () => {};
  const cancel = () => {
    controller.abort();
    rejectAbort(new Error('request-cancelled'));
  };
  const timer = setTimeout(cancel, milliseconds);
  parent?.addEventListener('abort', cancel, { once: true });
  try {
    return await Promise.race([
      new Promise<T>((_, reject) => {
        rejectAbort = reject;
        if (parent?.aborted) cancel();
      }),
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('request-cancelled');
        return work(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
export async function gzipJson(json: string): Promise<ArrayBuffer | undefined> {
  const bytes = strToU8(json);
  if (bytes.length < 1024) return undefined;
  try {
    let zipped: Uint8Array;
    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new CompressionStream('gzip'));
      zipped = new Uint8Array(await new Response(stream).arrayBuffer());
    } else zipped = gzipSync(bytes, { level: 6 });
    return zipped.length < bytes.length
      ? (zipped.slice().buffer as ArrayBuffer)
      : undefined;
  } catch {
    return undefined;
  }
}
export function parseCapabilities(value: unknown): Capabilities | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const names = ['tokenRefresh', 'reconcileV2', 'closeV2', 'gzipHttp'] as const;
  if (names.some((name) => typeof data[name] !== 'boolean')) return undefined;
  return Object.fromEntries(
    names.map((name) => [name, data[name]]),
  ) as unknown as Capabilities;
}
