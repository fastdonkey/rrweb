import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface JournalChunk {
  sequenceStart: number;
  sequenceEnd: number;
  events: unknown[];
  previousBatchHash?: string;
}

interface RecorderDatabase {
  close(): void;
}

interface Journal {
  readonly pendingCount: number;
  append(event: unknown): Promise<boolean>;
  flush(): Promise<boolean>;
  waitForIdle(): Promise<void>;
  recover(): Promise<JournalChunk[]>;
  bindLifecycle(target: EventTarget): () => void;
}

interface PersistenceModule {
  openRecorderDatabase(): Promise<RecorderDatabase>;
  deleteRecorderDatabase(): Promise<void>;
  IndexedDbJournal: new (options: {
    database: RecorderDatabase;
    appKey: string;
    recordingId: string;
    previousBatchHash?: () => string | undefined;
  }) => Journal;
}

const transport = {
  name: 'journal-test',
  capability: 'test-only',
  async send() {
    return { status: 'accepted' };
  },
};

async function loadPersistence(): Promise<PersistenceModule> {
  const databasePath = '../src/persistence/database';
  const journalPath = '../src/persistence/indexeddb-journal';
  const [database, journal] = await Promise.all([
    import(/* @vite-ignore */ databasePath),
    import(/* @vite-ignore */ journalPath),
  ]);
  return { ...database, ...journal } as unknown as PersistenceModule;
}

async function freshClient() {
  vi.resetModules();
  return (await import('../src/index')).DataInsights;
}

describe('IndexedDB journal', () => {
  const connections: RecorderDatabase[] = [];

  beforeEach(async () => {
    try {
      const persistence = await loadPersistence();
      await persistence.deleteRecorderDatabase();
    } catch {
      // RED phase: persistence modules do not exist yet.
    }
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
  });

  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens IndexedDB only after consent when start prepares persistence', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const client = await freshClient();
    client.init({ appKey: 'insurance-h5', transport });
    expect(open).not.toHaveBeenCalled();

    client.consent.grant({
      noticeVersion: 'insurance-notice-v1',
      action: 'start-insurance',
    });
    await client.start();

    expect(open).toHaveBeenCalledTimes(1);
    await client.destroy();
  });

  it('commits a tail after one second and recovers it in sequence order', async () => {
    const persistence = await loadPersistence();
    const database = await persistence.openRecorderDatabase();
    connections.push(database);
    const journal = new persistence.IndexedDbJournal({
      database,
      appKey: 'insurance-h5',
      recordingId: 'recording-1',
    });
    await journal.append({ type: 'first' });
    expect(await journal.recover()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    await journal.waitForIdle();

    expect(await journal.recover()).toEqual([
      expect.objectContaining({
        sequenceStart: 1,
        sequenceEnd: 1,
        events: [{ type: 'first' }],
      }),
    ]);
  });

  it('commits immediately on the twentieth event', async () => {
    const persistence = await loadPersistence();
    const database = await persistence.openRecorderDatabase();
    connections.push(database);
    const journal = new persistence.IndexedDbJournal({
      database,
      appKey: 'insurance-h5',
      recordingId: 'recording-20',
    });

    for (let index = 0; index < 20; index += 1) {
      await journal.append({ index });
    }

    const chunks = await journal.recover();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ sequenceStart: 1, sequenceEnd: 20 });
  });

  it('persists the last durable batch hash for crash-safe chain recovery', async () => {
    const persistence = await loadPersistence();
    const database = await persistence.openRecorderDatabase();
    connections.push(database);
    const journal = new persistence.IndexedDbJournal({
      database,
      appKey: 'insurance-h5',
      recordingId: 'recording-hash-chain',
      previousBatchHash: () => 'persisted-batch-hash',
    });

    await journal.append({ type: 'after-ack' });
    await journal.flush();

    expect(await journal.recover()).toEqual([
      expect.objectContaining({ previousBatchHash: 'persisted-batch-hash' }),
    ]);
  });

  it('flushes on pagehide and keeps memory data when a transaction fails', async () => {
    const persistence = await loadPersistence();
    const database = await persistence.openRecorderDatabase();
    connections.push(database);
    const journal = new persistence.IndexedDbJournal({
      database,
      appKey: 'insurance-h5',
      recordingId: 'recording-pagehide',
    });
    const page = new EventTarget();
    const dispose = journal.bindLifecycle(page);
    await journal.append({ type: 'tail' });
    page.dispatchEvent(new Event('pagehide'));
    await journal.waitForIdle();
    expect(await journal.recover()).toHaveLength(1);
    dispose();

    database.close();
    await journal.append({ type: 'must-survive' });
    expect(await journal.flush()).toBe(false);
    expect(journal.pendingCount).toBe(1);
  });
});
