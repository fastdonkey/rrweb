import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  deleteRecorderDatabase,
  openRecorderDatabase,
  type RecorderDatabase,
} from '../src/persistence/database';

interface Lease {
  acquire(): Promise<boolean>;
  renew(): Promise<boolean>;
  release(): Promise<void>;
}

interface LeaseModule {
  DispatcherLease: new (
    database: RecorderDatabase,
    appKey: string,
    ownerId: string,
    options?: { now?: () => number; ttlMs?: number },
  ) => Lease;
}

async function loadLease(): Promise<LeaseModule> {
  return import(
    '../src/persistence/dispatcher-lease'
  ) as unknown as Promise<LeaseModule>;
}

describe('dispatcher lease', () => {
  beforeEach(async () => {
    await deleteRecorderDatabase();
  });

  it('provides a cross-tab lease implementation', async () => {
    expect(typeof (await loadLease()).DispatcherLease).toBe('function');
  });

  it('allows one owner and permits takeover only after expiry', async () => {
    const { DispatcherLease } = await loadLease();
    const database = await openRecorderDatabase();
    let now = 1000;
    const first = new DispatcherLease(database, 'app', 'tab-1', {
      now: () => now,
      ttlMs: 100,
    });
    const second = new DispatcherLease(database, 'app', 'tab-2', {
      now: () => now,
      ttlMs: 100,
    });

    expect(await first.acquire()).toBe(true);
    expect(await second.acquire()).toBe(false);
    now = 1101;
    expect(await second.acquire()).toBe(true);
    expect(await first.renew()).toBe(false);
    await second.release();
    expect(await first.acquire()).toBe(true);
    database.close();
  });
});
