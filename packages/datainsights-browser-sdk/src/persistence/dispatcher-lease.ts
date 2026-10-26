import {
  RecorderDatabase,
  requestResult,
  STORES,
  transactionDone,
} from './database';

const DEFAULT_LEASE_TTL_MS = 10_000;

interface LeaseRecord {
  appKey: string;
  ownerId: string;
  expiresAt: number;
}

export class DispatcherLease {
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly database: RecorderDatabase,
    private readonly appKey: string,
    private readonly ownerId: string,
    options: { now?: () => number; ttlMs?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  }

  acquire(): Promise<boolean> {
    return this.writeIfOwnedOrExpired(false);
  }

  renew(): Promise<boolean> {
    return this.writeIfOwnedOrExpired(true);
  }

  async release(): Promise<void> {
    const transaction = this.database.raw.transaction(
      STORES.leases,
      'readwrite',
    );
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORES.leases);
    const current = (await requestResult(store.get(this.appKey))) as
      | LeaseRecord
      | undefined;
    if (current?.ownerId === this.ownerId) store.delete(this.appKey);
    await completed;
  }

  private async writeIfOwnedOrExpired(
    requireOwnership: boolean,
  ): Promise<boolean> {
    const transaction = this.database.raw.transaction(
      STORES.leases,
      'readwrite',
    );
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORES.leases);
    const current = (await requestResult(store.get(this.appKey))) as
      | LeaseRecord
      | undefined;
    const timestamp = this.now();
    const owned = current?.ownerId === this.ownerId;
    const available = !current || current.expiresAt <= timestamp;
    if (
      (requireOwnership && !owned) ||
      (!requireOwnership && !owned && !available)
    ) {
      await completed;
      return false;
    }
    store.put({
      appKey: this.appKey,
      ownerId: this.ownerId,
      expiresAt: timestamp + this.ttlMs,
    } satisfies LeaseRecord);
    await completed;
    return true;
  }
}
