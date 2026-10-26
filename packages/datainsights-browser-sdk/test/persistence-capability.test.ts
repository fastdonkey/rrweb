import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteRecorderDatabase,
  openRecorderDatabase,
  requestResult,
  STORES,
  transactionDone,
} from '../src/persistence/database';
import {
  probePersistenceCapability,
  probeRecorderDatabase,
} from '../src/persistence/capability';

describe('IndexedDB runtime capability', () => {
  beforeEach(async () => {
    await deleteRecorderDatabase();
  });

  it('proves write/read/delete and reports storage persistence details', async () => {
    const storage = {
      estimate: vi.fn(async () => ({ quota: 1024, usage: 128 })),
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => true),
    };

    const result = await probePersistenceCapability(new IDBFactory(), storage);

    expect(result).toEqual({
      ok: true,
      value: {
        available: true,
        persisted: true,
        quota: 1024,
        usage: 128,
      },
    });
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('removes the capability record after a successful round trip', async () => {
    const result = await probePersistenceCapability(indexedDB);
    expect(result.ok).toBe(true);

    const database = await openRecorderDatabase();
    const transaction = database.raw.transaction(STORES.metadata, 'readonly');
    const completed = transactionDone(transaction);
    const records = await requestResult(
      transaction.objectStore(STORES.metadata).getAll(),
    );
    await completed;
    expect(records).toEqual([]);
    database.close();
  });

  it('keeps IndexedDB available when persistent storage is unsupported or denied', async () => {
    const unsupported = await probePersistenceCapability(new IDBFactory());
    const denied = await probePersistenceCapability(new IDBFactory(), {
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({ quota: 2048, usage: 256 }),
    });

    expect(unsupported).toMatchObject({
      ok: true,
      value: { available: true, persisted: 'unsupported' },
    });
    expect(denied).toEqual({
      ok: true,
      value: {
        available: true,
        persisted: false,
        quota: 2048,
        usage: 256,
      },
    });
  });

  it('fails closed when IndexedDB is absent or cannot be opened', async () => {
    const missing = await probePersistenceCapability(undefined);
    const brokenFactory = {
      open() {
        throw new Error('private browser detail');
      },
    } as unknown as IDBFactory;
    const broken = await probePersistenceCapability(brokenFactory);

    for (const result of [missing, broken]) {
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'PERSISTENCE_UNAVAILABLE',
          message: expect.any(String),
        },
      });
      expect(JSON.stringify(result)).not.toContain('private browser detail');
    }
  });

  it('fails closed when the metadata transaction cannot be completed', async () => {
    const database = await openRecorderDatabase(new IDBFactory());
    const transaction = database.raw.transaction.bind(database.raw);
    database.raw.transaction = vi.fn(() => {
      throw new Error('transaction denied');
    }) as typeof database.raw.transaction;

    const result = await probeRecorderDatabase(database);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_UNAVAILABLE' },
    });
    database.raw.transaction = transaction;
    database.close();
  });

  it('fails closed when the capability record does not read back exactly', async () => {
    const request = <T>(result: T): IDBRequest<T> => {
      const candidate = { result } as IDBRequest<T>;
      queueMicrotask(() => candidate.onsuccess?.({} as Event));
      return candidate;
    };
    let transaction: IDBTransaction;
    transaction = {
      objectStore: () =>
        ({
          put: () => request('probe-key'),
          get: () => request({ key: 'probe-key', nonce: 'wrong-nonce' }),
          delete: () => request(undefined),
        } as unknown as IDBObjectStore),
      abort: () => queueMicrotask(() => transaction.onabort?.({} as Event)),
      error: null,
    } as unknown as IDBTransaction;
    const database = {
      raw: { transaction: () => transaction } as unknown as IDBDatabase,
      close: vi.fn(),
    };

    expect(await probeRecorderDatabase(database)).toEqual({
      ok: false,
      error: {
        code: 'PERSISTENCE_UNAVAILABLE',
        message: expect.any(String),
      },
    });
  });
});
