import {
  RecorderDatabase,
  requestResult,
  STORES,
  transactionDone,
} from '../persistence/database';
import { generateUuid } from '../shared/uuid';
export interface CloseIntent {
  recordingId: string;
  reason: string;
  endTrace: boolean;
  endedAt: string;
}
export interface CloseDeclaration {
  key: string;
  appKey: string;
  kind: 'recording' | 'trace';
  targetId: string;
  payload: {
    closeId: string;
    endedAt: string;
    reason: string;
    recordingId?: string;
    traceId?: string;
    finalSequence?: number;
    finalBatchHash?: string;
    recordingIds?: string[];
  };
}
interface Head {
  key: string;
  appKey: string;
  recordingId: string;
  traceId: string;
  end: number;
  hash?: string;
  closed?: boolean;
}
interface Trace {
  key: string;
  appKey: string;
  recordingIds: string[];
  known: boolean;
  closed?: boolean;
}
const key = (app: string, kind: string, id: string) =>
  JSON.stringify(['close-v1', app, kind, id]);
export class CloseStore {
  constructor(
    private readonly database: RecorderDatabase,
    readonly appKey: string,
  ) {}
  async register(
    traceId: string,
    recordingId: string,
    newTrace: boolean,
  ): Promise<void> {
    const tx = this.database.raw.transaction(STORES.metadata, 'readwrite');
    const done = transactionDone(tx);
    void done.catch(() => undefined);
    try {
      const store = tx.objectStore(STORES.metadata);
      const traceKey = key(this.appKey, 'trace', traceId);
      const trace: Trace = (await requestResult(store.get(traceKey))) ?? {
        key: traceKey,
        appKey: this.appKey,
        recordingIds: [],
        known: newTrace,
      };
      if (trace.closed || trace.recordingIds.length >= 10000)
        throw new Error('Trace membership unavailable');
      const headKey = key(this.appKey, 'head', recordingId);
      if (!(await requestResult(store.get(headKey))))
        store.put({
          key: headKey,
          appKey: this.appKey,
          traceId,
          recordingId,
          end: 0,
        } satisfies Head);
      if (!trace.recordingIds.includes(recordingId))
        trace.recordingIds.push(recordingId);
      store.put(trace);
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => undefined);
      throw error;
    }
  }
  /** Runs in the SAME transaction as journal deletion and Outbox insertion. */
  static async advance(
    tx: IDBTransaction,
    appKey: string,
    batches: readonly {
      recordingId: string;
      sequenceStart: number;
      sequenceEnd: number;
      contentHash?: unknown;
    }[],
  ): Promise<void> {
    const store = tx.objectStore(STORES.metadata);
    for (const batch of batches) {
      const head: Head | undefined = await requestResult(
        store.get(key(appKey, 'head', batch.recordingId)),
      );
      if (!head) continue; // Legacy journal: recover data, never fabricate a final boundary.
      if (
        head.closed ||
        batch.sequenceStart !== head.end + 1 ||
        typeof batch.contentHash !== 'string'
      )
        throw new Error('Invalid durable recording boundary');
      head.end = batch.sequenceEnd;
      head.hash = batch.contentHash;
      store.put(head);
    }
  }
  static async seal(
    tx: IDBTransaction,
    appKey: string,
    intent: CloseIntent,
  ): Promise<void> {
    const store = tx.objectStore(STORES.metadata);
    const head: Head | undefined = await requestResult(
      store.get(key(appKey, 'head', intent.recordingId)),
    );
    if (!head) throw new Error('Unknown recording boundary');
    const chunks = await requestResult(
      tx.objectStore(STORES.journal).index('byAppKey').getAll(appKey),
    );
    if (chunks.some((c) => c.recordingId === intent.recordingId))
      throw new Error('Unsealed recording journal');
    if (!head.closed) {
      const declaration: CloseDeclaration = {
        key: key(appKey, 'pending-recording', intent.recordingId),
        appKey,
        kind: 'recording',
        targetId: intent.recordingId,
        payload: {
          closeId: generateUuid(),
          recordingId: intent.recordingId,
          traceId: head.traceId,
          finalSequence: head.end,
          ...(head.hash ? { finalBatchHash: head.hash } : {}),
          endedAt: intent.endedAt,
          reason: intent.reason,
        },
      };
      store.put(declaration);
      head.closed = true;
      store.put(head);
    }
    if (intent.endTrace) {
      const trace: Trace | undefined = await requestResult(
        store.get(key(appKey, 'trace', head.traceId)),
      );
      if (trace?.known && !trace.closed) {
        store.put({
          key: key(appKey, 'pending-trace', head.traceId),
          appKey,
          kind: 'trace',
          targetId: head.traceId,
          payload: {
            closeId: generateUuid(),
            recordingIds: [...trace.recordingIds],
            endedAt: intent.endedAt,
            reason: intent.reason,
          },
        } satisfies CloseDeclaration);
        trace.closed = true;
        store.put(trace);
      }
    }
  }
  async boundary(recordingId: string): Promise<Readonly<Head> | undefined> {
    const tx = this.database.raw.transaction(STORES.metadata, 'readonly');
    const done = transactionDone(tx);
    const head = await requestResult(
      tx
        .objectStore(STORES.metadata)
        .get(key(this.appKey, 'head', recordingId)),
    );
    await done;
    return head;
  }
  async finish(intent: CloseIntent): Promise<boolean> {
    const tx = this.database.raw.transaction(
      [STORES.metadata, STORES.journal],
      'readwrite',
    );
    const done = transactionDone(tx);
    void done.catch(() => undefined);
    try {
      await CloseStore.seal(tx, this.appKey, intent);
      await done;
      return true;
    } catch {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => undefined);
      return false;
    }
  }
  async list(): Promise<CloseDeclaration[]> {
    const tx = this.database.raw.transaction(STORES.metadata, 'readonly');
    const done = transactionDone(tx);
    const all = await requestResult(tx.objectStore(STORES.metadata).getAll());
    await done;
    return all
      .filter(
        (row): row is CloseDeclaration =>
          row.appKey === this.appKey &&
          (row.kind === 'recording' || row.kind === 'trace'),
      )
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }
  async acknowledge(declaration: CloseDeclaration): Promise<void> {
    const tx = this.database.raw.transaction(STORES.metadata, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORES.metadata);
    const current = await requestResult(store.get(declaration.key));
    if (
      current?.appKey === this.appKey &&
      current.payload?.closeId === declaration.payload.closeId
    )
      store.delete(declaration.key);
    await done;
  }
}
