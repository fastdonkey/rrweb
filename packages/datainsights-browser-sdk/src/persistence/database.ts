export const DATABASE_NAME = 'datainsights-recorder-v1';
const DATABASE_VERSION = 1;

export const STORES = Object.freeze({
  journal: 'journal',
  outbox: 'outbox',
  leases: 'leases',
  metadata: 'metadata',
});

export class RecorderDatabase {
  constructor(readonly raw: IDBDatabase) {}

  close(): void {
    this.raw.close();
  }
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

export function openRecorderDatabase(
  factory: IDBFactory = globalThis.indexedDB,
): Promise<RecorderDatabase> {
  return new Promise<RecorderDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORES.journal)) {
        const journal = database.createObjectStore(STORES.journal, {
          keyPath: 'key',
        });
        journal.createIndex(
          'byAppRecordingSequence',
          ['appKey', 'recordingId', 'sequenceStart'],
          { unique: true },
        );
        journal.createIndex('byAppKey', 'appKey');
      }
      if (!database.objectStoreNames.contains(STORES.outbox)) {
        const outbox = database.createObjectStore(STORES.outbox, {
          keyPath: 'key',
        });
        outbox.createIndex('byAppCreated', ['appKey', 'createdAt']);
        outbox.createIndex('byAppKey', 'appKey');
      }
      if (!database.objectStoreNames.contains(STORES.leases)) {
        database.createObjectStore(STORES.leases, { keyPath: 'appKey' });
      }
      if (!database.objectStoreNames.contains(STORES.metadata)) {
        database.createObjectStore(STORES.metadata, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(new RecorderDatabase(request.result));
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB could not be opened.'));
    request.onblocked = () =>
      reject(new Error('IndexedDB upgrade was blocked.'));
  });
}

export function deleteRecorderDatabase(
  factory: IDBFactory = globalThis.indexedDB,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB could not be deleted.'));
    request.onblocked = () =>
      reject(new Error('IndexedDB deletion was blocked.'));
  });
}
