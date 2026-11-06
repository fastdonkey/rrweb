import { CloseStore, type CloseIntent } from '../delivery/close-store';
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
  createdAt: number | string;
  [key: string]: unknown;
}

export interface OutboxRecord extends OutboxBatchDraft {
  key: string;
  appKey: string;
  deliveryBlocked?: string;
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
    return this.enqueueManyFromJournal([batch], journalKeys);
  }

  async enqueueManyFromJournal(
    batches: readonly OutboxBatchDraft[],
    journalKeys: readonly string[],
    close?: CloseIntent,
  ): Promise<boolean> {
    try {
      const transaction = this.database.raw.transaction(
        [STORES.journal, STORES.outbox, STORES.metadata],
        'readwrite',
      );
      const completed = transactionDone(transaction);
      void completed.catch(() => undefined);
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
      const newBytes = batches.reduce((total, batch) => total + batch.bytes, 0);
      if (
        batches.length === 0 ||
        batches.some(
          (batch) => !Number.isFinite(batch.bytes) || batch.bytes < 0,
        ) ||
        retainedJournalBytes + outboxBytes + newBytes > this.capacityBytes
      ) {
        transaction.abort();
        await completed.catch(() => undefined);
        return false;
      }

      for (const batch of batches) {
        const record: OutboxRecord = {
          ...batch,
          key: `${this.appKey}:${batch.batchId}`,
          appKey: this.appKey,
        };
        outboxStore.put(record);
      }
      for (const key of journalKeys) journalStore.delete(key);
      try {
        await CloseStore.advance(transaction, this.appKey, batches);
        if (close) await CloseStore.seal(transaction, this.appKey, close);
      } catch {
        transaction.abort();
        await completed.catch(() => undefined);
        return false;
      }
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
        new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime() ||
        left.sequenceStart - right.sequenceStart,
    );
    return records.map((record) => Object.freeze(record));
  }

  async block(batchId: string, reason: string): Promise<void> {
    const tx = this.database.raw.transaction(STORES.outbox, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORES.outbox);
    const record = await requestResult(store.get(`${this.appKey}:${batchId}`));
    if (record) {
      record.deliveryBlocked = reason;
      store.put(record);
    }
    await done;
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
