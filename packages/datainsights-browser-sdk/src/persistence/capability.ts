import type { SDKResult } from '../public/types';
import {
  openRecorderDatabase,
  requestResult,
  type RecorderDatabase,
  STORES,
  transactionDone,
} from './database';

export interface PersistenceCapability {
  readonly available: boolean;
  readonly persisted: boolean | 'unsupported';
  readonly quota?: number;
  readonly usage?: number;
}

type StorageCapabilityManager = Partial<
  Pick<StorageManager, 'estimate' | 'persist' | 'persisted'>
>;

interface CapabilityProbeRecord {
  readonly key: string;
  readonly nonce: string;
}

function unavailable(): SDKResult<never> {
  return {
    ok: false,
    error: {
      code: 'PERSISTENCE_UNAVAILABLE',
      message: 'Durable browser storage failed its runtime capability check.',
    },
  };
}

function createNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function inspectStorageManager(
  storage?: StorageCapabilityManager,
): Promise<Omit<PersistenceCapability, 'available'>> {
  if (!storage) return { persisted: 'unsupported' };

  let quota: number | undefined;
  let usage: number | undefined;
  try {
    const estimate = await storage.estimate?.call(storage);
    quota = estimate?.quota;
    usage = estimate?.usage;
  } catch (_error) {
    // Storage estimates are advisory and do not invalidate a successful IDB probe.
  }

  if (!storage.persisted || !storage.persist) {
    return { persisted: 'unsupported', quota, usage };
  }

  let persisted = false;
  try {
    persisted = await storage.persisted.call(storage);
    if (!persisted) persisted = await storage.persist.call(storage);
  } catch (_error) {
    persisted = false;
  }
  return { persisted, quota, usage };
}

export async function probeRecorderDatabase(
  database: RecorderDatabase,
  storage?: StorageCapabilityManager,
): Promise<SDKResult<PersistenceCapability>> {
  const nonce = createNonce();
  const probeKey = `__datainsights_capability_probe__:${nonce}`;
  try {
    const transaction = database.raw.transaction(STORES.metadata, 'readwrite');
    const completed = transactionDone(transaction);
    const metadata = transaction.objectStore(STORES.metadata);
    await requestResult(
      metadata.put({ key: probeKey, nonce } satisfies CapabilityProbeRecord),
    );
    const recovered = await requestResult<CapabilityProbeRecord | undefined>(
      metadata.get(probeKey),
    );
    if (recovered?.nonce !== nonce) {
      transaction.abort();
      await completed.catch(() => undefined);
      return unavailable();
    }
    await requestResult(metadata.delete(probeKey));
    await completed;

    return {
      ok: true,
      value: {
        available: true,
        ...(await inspectStorageManager(storage)),
      },
    };
  } catch (_error) {
    return unavailable();
  }
}

export async function probePersistenceCapability(
  factory?: IDBFactory,
  storage?: StorageCapabilityManager,
): Promise<SDKResult<PersistenceCapability>> {
  if (!factory) return unavailable();

  let database: RecorderDatabase | undefined;
  try {
    database = await openRecorderDatabase(factory);
    return await probeRecorderDatabase(database, storage);
  } catch (_error) {
    return unavailable();
  } finally {
    database?.close();
  }
}
