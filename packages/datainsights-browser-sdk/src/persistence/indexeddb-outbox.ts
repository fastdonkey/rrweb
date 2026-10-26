import {
  RecorderDatabase,
  requestResult,
  STORES,
  transactionDone,
} from './database';
import type { JournalChunk } from './indexeddb-journal';

const DEFAULT_CAPACITY_BYTES = 100 * 1024 * 1024;

export interface OutboxBatchDraft {
  batchId: string;
  recordingId: string;
  sequenceStart: number;
  sequenceEnd: number;
  events: unknown[];
  bytes: number;
  createdAt: number;
  [key: string]: unknown;
}

export interface OutboxRecord extends OutboxBatchDraft {
  key: string;
  appKey: string;
}

export class IndexedDbOutbox {
  constructor(
    private readonly database: RecorderDatabase,
    private readonly appKey: string,
    private readonly capacityBytes = DEFAULT_CAPACITY_BYTES,
  ) {}

  async enqueueFromJournal(
    batch: OutboxBatchDraft,
    journalKeys: readonly string[],
  ): Promise<boolean> {
    try {
      const transaction = this.database.raw.transaction(
        [STORES.journal, STORES.outbox],
        'readwrite',
      );
      const completed = transactionDone(transaction);
      const journalStore = transaction.objectStore(STORES.journal);
      const outboxStore = transaction.objectStore(STORES.outbox);
      const [allJournal, allOutbox] = await Promise.all([
        requestResult(
          journalStore.index('byAppKey').getAll(this.appKey),
        ) as Promise<JournalChunk[]>,
        requestResult(
          outboxStore.index('byAppKey').getAll(this.appKey),
        ) as Promise<OutboxRecord[]>,
      ]);
      const movingKeys = new Set(journalKeys);
      const retainedJournalBytes = allJournal
        .filter(({ key }) => !movingKeys.has(key))
        .reduce((total, { bytes }) => total + bytes, 0);
      const outboxBytes = allOutbox.reduce(
        (total, { bytes }) => total + bytes,
        0,
      );
      if (
        !Number.isFinite(batch.bytes) ||
        batch.bytes < 0 ||
        retainedJournalBytes + outboxBytes + batch.bytes > this.capacityBytes
      ) {
        transaction.abort();
        await completed.catch(() => undefined);
        return false;
      }

      const record: OutboxRecord = {
        ...batch,
        key: `${this.appKey}:${batch.batchId}`,
        appKey: this.appKey,
      };
      outboxStore.put(record);
      for (const key of journalKeys) journalStore.delete(key);
      await completed;
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<readonly Readonly<OutboxRecord>[]> {
    const transaction = this.database.raw.transaction(
      STORES.outbox,
      'readonly',
    );
    const completed = transactionDone(transaction);
    const records = (await requestResult(
      transaction
        .objectStore(STORES.outbox)
        .index('byAppKey')
        .getAll(this.appKey),
    )) as OutboxRecord[];
    await completed;
    records.sort(
      (left, right) =>
        left.createdAt - right.createdAt ||
        left.sequenceStart - right.sequenceStart,
    );
    return records.map((record) => Object.freeze(record));
  }

  async totalBytes(): Promise<number> {
    return (await this.list()).reduce((total, { bytes }) => total + bytes, 0);
  }

  async remove(batchId: string): Promise<void> {
    const transaction = this.database.raw.transaction(
      STORES.outbox,
      'readwrite',
    );
    const completed = transactionDone(transaction);
    transaction.objectStore(STORES.outbox).delete(`${this.appKey}:${batchId}`);
    await completed;
  }
}
