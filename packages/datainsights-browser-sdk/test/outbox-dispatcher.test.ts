import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { createClient } from '../src/runtime/client';
import { openRecorderDatabase } from '../src/persistence/database';
import { IndexedDbOutbox } from '../src/persistence/indexeddb-outbox';
import type { RecordingBatchV1 } from '../src/pipeline/batcher';
import { OutboxDispatcher } from '../src/pipeline/outbox-dispatcher';
import type {
  Transport,
  TransportContext,
  TransportResult,
} from '../src/transport/types';

function makeBatch(sequenceStart: number): RecordingBatchV1 {
  return {
    schemaVersion: '1.0',
    sdkVersion: '0.1.0',
    rrwebVersion: '2.2.0',
    rrwebCommit: 'commit',
    appKey: 'app',
    identity: { type: 'anonymous', id: 'anonymous-1' },
    consent: {
      noticeVersion: 'v1',
      action: 'start-insurance',
      grantedAt: '2026-10-26T00:00:00.000Z',
    },
    sessionId: 'session-1',
    recordingId: 'recording-1',
    segmentId: 'segment-1',
    batchId: `batch-${sequenceStart}`,
    sequenceStart,
    sequenceEnd: sequenceStart,
    contentHash: `hash-${sequenceStart}`,
    createdAt: new Date(sequenceStart).toISOString(),
    reason: 'manual',
    events: [{ sequenceStart }],
  };
}

function accepted(batch: RecordingBatchV1): TransportResult {
  return {
    status: 'accepted',
    receipt: {
      persisted: true,
      batchId: batch.batchId,
      recordingId: batch.recordingId,
      sequenceStart: batch.sequenceStart,
      sequenceEnd: batch.sequenceEnd,
      contentHash: batch.contentHash,
    },
  };
}

function createOutbox(batches: RecordingBatchV1[]) {
  return {
    batches,
    async list() {
      return this.batches;
    },
    async remove(batchId: string) {
      this.batches = this.batches.filter((batch) => batch.batchId !== batchId);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OutboxDispatcher', () => {
  it('sends FIFO batches through one channel and removes exact acknowledgements', async () => {
    const first = makeBatch(1);
    const second = makeBatch(2);
    const outbox = createOutbox([first, second]);
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const transport: Transport = {
      name: 'ordered',
      capability: 'test-only',
      async send(batch) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(batch.batchId);
        await Promise.resolve();
        active -= 1;
        return accepted(batch);
      },
    };
    const dispatcher = new OutboxDispatcher({ outbox, transport });

    const firstRun = dispatcher.dispatch('manual');
    const concurrentRun = dispatcher.dispatch('online');
    expect(concurrentRun).toBe(firstRun);
    expect(await firstRun).toMatchObject({ state: 'idle', sent: 2 });
    expect(order).toEqual(['batch-1', 'batch-2']);
    expect(maximumActive).toBe(1);
    expect(outbox.batches).toEqual([]);
  });

  it('uses 1s/2s/4s jittered retries and preserves a batch when exhausted', async () => {
    vi.useFakeTimers();
    const batch = makeBatch(1);
    const outbox = createOutbox([batch]);
    const attempts: number[] = [];
    const transport: Transport = {
      name: 'offline',
      capability: 'test-only',
      async send(_batch, context) {
        attempts.push(context.attempt);
        return { status: 'retryable' };
      },
    };
    const dispatcher = new OutboxDispatcher({
      outbox,
      transport,
      random: () => 0.5,
    });

    const result = dispatcher.dispatch('manual');
    await vi.advanceTimersByTimeAsync(7_000);

    expect(await result).toMatchObject({ state: 'backoff', sent: 0 });
    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(outbox.batches).toEqual([batch]);
  });

  it('marks rejected delivery blocked, preserves data, and notifies the recorder', async () => {
    const batch = makeBatch(1);
    const outbox = createOutbox([batch]);
    const blocked: string[] = [];
    const dispatcher = new OutboxDispatcher({
      outbox,
      transport: {
        name: 'rejecting',
        capability: 'test-only',
        send: async () => ({ status: 'rejected', reason: 'policy' }),
      },
      onBlocked: (blockedBatch) => blocked.push(blockedBatch.recordingId),
    });

    expect(await dispatcher.dispatch('manual')).toMatchObject({
      state: 'blocked',
      sent: 0,
    });
    expect(blocked).toEqual(['recording-1']);
    expect(outbox.batches).toEqual([batch]);
  });

  it('wakes on startup, online, scheduled, pagehide, and manual triggers', async () => {
    vi.useFakeTimers();
    const eventTarget = new EventTarget();
    const triggers: TransportContext['trigger'][] = [];
    let sequence = 0;
    const outbox = createOutbox([] as RecordingBatchV1[]);
    const transport: Transport = {
      name: 'wakeups',
      capability: 'test-only',
      async send(batch, context) {
        triggers.push(context.trigger);
        return accepted(batch);
      },
    };
    const dispatcher = new OutboxDispatcher({
      outbox,
      transport,
      eventTarget,
      scheduleIntervalMs: 10_000,
    });

    const addPending = () => outbox.batches.push(makeBatch(++sequence));
    addPending();
    dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    addPending();
    eventTarget.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    addPending();
    await vi.advanceTimersByTimeAsync(10_000);
    addPending();
    eventTarget.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    addPending();
    await dispatcher.dispatch('manual');

    expect(triggers).toEqual([
      'startup',
      'online',
      'scheduled',
      'pagehide',
      'manual',
    ]);
    dispatcher.destroy();
  });

  it('cancels retry timers through AbortSignal without deleting data', async () => {
    vi.useFakeTimers();
    const batch = makeBatch(1);
    const outbox = createOutbox([batch]);
    const abortController = new AbortController();
    let calls = 0;
    const dispatcher = new OutboxDispatcher({
      outbox,
      transport: {
        name: 'cancel',
        capability: 'test-only',
        send: async () => {
          calls += 1;
          return { status: 'retryable' };
        },
      },
      signal: abortController.signal,
    });

    const result = dispatcher.dispatch('manual');
    await vi.advanceTimersByTimeAsync(0);
    abortController.abort();
    await vi.runAllTimersAsync();

    expect(await result).toMatchObject({ state: 'idle', cancelled: true });
    expect(calls).toBe(1);
    expect(outbox.batches).toEqual([batch]);
  });

  it('starts recovery dispatch from the SDK lifecycle and cancels it on stop', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const factory = new IDBFactory();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: factory,
    });
    const pending = makeBatch(1);
    const database = await openRecorderDatabase(factory);
    const persisted = new IndexedDbOutbox(database, pending.appKey);
    await persisted.enqueueFromJournal(
      { ...pending, bytes: 100, createdAt: 1 },
      [],
    );
    database.close();
    const sends: string[] = [];
    const client = createClient();

    try {
      client.init({
        appKey: pending.appKey,
        transport: {
          name: 'recovery',
          capability: 'test-only',
          async send(delivered) {
            sends.push(delivered.batchId);
            return accepted(delivered);
          },
        },
      });
      client.consent.grant({
        noticeVersion: 'v1',
        action: 'start-insurance',
      });
      expect((await client.start()).ok).toBe(true);
      await vi.waitFor(() => expect(sends).toEqual(['batch-1']));
      expect((await client.stop()).ok).toBe(true);
      await client.destroy();
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });
});
