import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiagnosticsStore } from '../src/diagnostics/diagnostics';
import { ResourceRegistry } from '../src/runtime/resource-registry';
import { createClient } from '../src/runtime/client';
import {
  deleteRecorderDatabase,
  openRecorderDatabase,
} from '../src/persistence/database';
import { IndexedDbOutbox } from '../src/persistence/indexeddb-outbox';

describe('local diagnostics and resources', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await deleteRecorderDatabase();
  });

  it.each([
    [0, 'normal'],
    [69, 'normal'],
    [70, 'warning'],
    [89, 'warning'],
    [90, 'critical'],
    [99, 'critical'],
    [100, 'full'],
    [120, 'full'],
  ] as const)('maps %s%% capacity to %s', (percentage, expected) => {
    const diagnostics = new DiagnosticsStore();
    diagnostics.updateCapacity(percentage, 100);
    expect(diagnostics.delivery.capacityLevel).toBe(expected);
  });

  it('isolates callback errors and exposes only a redacted local snapshot', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const callback = vi.fn(() => {
      throw new Error('host callback failed');
    });
    const diagnostics = new DiagnosticsStore(callback);

    expect(() => diagnostics.updateCapacity(90, 100)).not.toThrow();
    diagnostics.recordError('TRANSPORT_FAILED', {
      appKey: 'complete-app-key',
      userId: 'complete-user-id',
      url: 'https://insurance.example/app?token=secret-query',
      payload: { password: 'must-never-appear' },
    });
    const snapshot = diagnostics.snapshot({
      lifecycleState: 'recording',
      resourceCount: 3,
      hasHostIdentity: true,
    });
    const serialized = JSON.stringify(snapshot);

    expect(callback).toHaveBeenCalled();
    expect(serialized).not.toContain('complete-app-key');
    expect(serialized).not.toContain('complete-user-id');
    expect(serialized).not.toContain('secret-query');
    expect(serialized).not.toContain('must-never-appear');
    expect(snapshot).toMatchObject({
      state: 'recording',
      hasHostIdentity: true,
      resourceCount: 3,
      recentErrors: [{ code: 'TRANSPORT_FAILED' }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('disposes listeners, timers, and throwing cleanup functions exactly once', async () => {
    vi.useFakeTimers();
    const registry = new ResourceRegistry();
    const target = new EventTarget();
    const listener = vi.fn();
    registry.listen(target, 'event', listener);
    registry.setTimeout(() => undefined, 1_000);
    registry.setInterval(() => undefined, 1_000);
    const disposed = vi.fn();
    registry.add(disposed);
    registry.add(() => {
      throw new Error('isolated cleanup failure');
    });
    expect(registry.count).toBe(5);

    expect(await registry.disposeAll()).toEqual({ errors: 1 });
    expect(registry.count).toBe(0);
    expect(disposed).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('event'));
    expect(listener).not.toHaveBeenCalled();
    expect(await registry.disposeAll()).toEqual({ errors: 0 });
    vi.useRealTimers();
  });

  it('fails closed at full durable capacity and preserves existing Outbox data', async () => {
    const database = await openRecorderDatabase();
    const outbox = new IndexedDbOutbox(database, 'capacity-app');
    expect(
      await outbox.enqueueFromJournal(
        {
          batchId: 'retained-batch',
          recordingId: 'retained-recording',
          sequenceStart: 1,
          sequenceEnd: 1,
          events: [{}],
          bytes: 100 * 1024 * 1024,
          createdAt: 1,
        },
        [],
      ),
    ).toBe(true);
    database.close();
    const send = vi.fn();
    const client = createClient();
    client.init({
      appKey: 'capacity-app',
      transport: {
        name: 'must-not-send',
        capability: 'test-only',
        send,
      },
    });
    client.consent.grant({ noticeVersion: 'v1', action: 'start-insurance' });

    expect(await client.start()).toEqual({
      ok: false,
      error: {
        code: 'PERSISTENCE_CAPACITY_EXCEEDED',
        message: expect.any(String),
      },
    });
    expect(client.getDebugInfo()).toMatchObject({
      state: 'authorized',
      delivery: { capacityLevel: 'full' },
    });
    expect(send).not.toHaveBeenCalled();
    await client.destroy();

    const reopened = await openRecorderDatabase();
    expect(
      await new IndexedDbOutbox(reopened, 'capacity-app').list(),
    ).toHaveLength(1);
    reopened.close();
  });
});
