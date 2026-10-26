import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  deleteRecorderDatabase,
  openRecorderDatabase,
  type RecorderDatabase,
} from '../src/persistence/database';
import { IndexedDbJournal } from '../src/persistence/indexeddb-journal';

interface BatchDraft {
  batchId: string;
  recordingId: string;
  sequenceStart: number;
  sequenceEnd: number;
  events: unknown[];
  bytes: number;
  createdAt: number;
}

interface OutboxRecord extends BatchDraft {
  key: string;
  appKey: string;
}

interface Outbox {
  enqueueFromJournal(
    batch: BatchDraft,
    journalKeys: readonly string[],
  ): Promise<boolean>;
  list(): Promise<readonly OutboxRecord[]>;
  totalBytes(): Promise<number>;
}

interface OutboxModule {
  IndexedDbOutbox: new (
    database: RecorderDatabase,
    appKey: string,
    capacityBytes?: number,
  ) => Outbox;
}

async function loadOutbox(): Promise<OutboxModule> {
  return import(
    '../src/persistence/indexeddb-outbox'
  ) as unknown as Promise<OutboxModule>;
}

describe('IndexedDB outbox', () => {
  beforeEach(async () => {
    await deleteRecorderDatabase();
  });

  it('provides an atomic Journal to Outbox mover', async () => {
    const module = await loadOutbox();
    expect(typeof module.IndexedDbOutbox).toBe('function');
  });

  it('atomically moves Journal data into immutable FIFO Outbox records', async () => {
    const { IndexedDbOutbox } = await loadOutbox();
    const database = await openRecorderDatabase();
    const journal = new IndexedDbJournal({
      database,
      appKey: 'app',
      recordingId: 'recording-1',
    });
    await journal.append({ event: 1 });
    await journal.flush();
    const [chunk] = await journal.recover();
    const outbox = new IndexedDbOutbox(database, 'app');

    expect(
      await outbox.enqueueFromJournal(
        {
          batchId: 'batch-1',
          recordingId: 'recording-1',
          sequenceStart: 1,
          sequenceEnd: 1,
          events: chunk.events,
          bytes: chunk.bytes,
          createdAt: 1,
        },
        [chunk.key],
      ),
    ).toBe(true);
    expect(await journal.recover()).toHaveLength(0);
    expect(await outbox.list()).toEqual([
      expect.objectContaining({ batchId: 'batch-1', events: [{ event: 1 }] }),
    ]);
    database.close();
  });

  it('keeps Journal data when the atomic transaction cannot commit', async () => {
    const { IndexedDbOutbox } = await loadOutbox();
    const database = await openRecorderDatabase();
    const journal = new IndexedDbJournal({
      database,
      appKey: 'app',
      recordingId: 'recording-failure',
    });
    await journal.append({ event: 'safe' });
    await journal.flush();
    const [chunk] = await journal.recover();
    const outbox = new IndexedDbOutbox(database, 'app');
    database.close();

    expect(
      await outbox.enqueueFromJournal(
        {
          batchId: 'batch-failure',
          recordingId: 'recording-failure',
          sequenceStart: 1,
          sequenceEnd: 1,
          events: chunk.events,
          bytes: chunk.bytes,
          createdAt: 1,
        },
        [chunk.key],
      ),
    ).toBe(false);

    const reopened = await openRecorderDatabase();
    const recovered = new IndexedDbJournal({
      database: reopened,
      appKey: 'app',
      recordingId: 'recording-failure',
    });
    expect(await recovered.recover()).toHaveLength(1);
    reopened.close();
  });

  it('preserves FIFO data and refuses writes beyond capacity', async () => {
    const { IndexedDbOutbox } = await loadOutbox();
    const database = await openRecorderDatabase();
    const outbox = new IndexedDbOutbox(database, 'app', 100);
    const first: BatchDraft = {
      batchId: 'batch-first',
      recordingId: 'recording',
      sequenceStart: 1,
      sequenceEnd: 1,
      events: [{}],
      bytes: 80,
      createdAt: 1,
    };
    const second = {
      ...first,
      batchId: 'batch-second',
      sequenceStart: 2,
      sequenceEnd: 2,
      bytes: 30,
      createdAt: 2,
    };

    expect(await outbox.enqueueFromJournal(first, [])).toBe(true);
    expect(await outbox.enqueueFromJournal(second, [])).toBe(false);
    expect((await outbox.list()).map(({ batchId }) => batchId)).toEqual([
      'batch-first',
    ]);
    expect(await outbox.totalBytes()).toBe(80);
    database.close();
  });
});
