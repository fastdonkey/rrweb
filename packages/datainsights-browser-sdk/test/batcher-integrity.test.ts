import { describe, expect, it, vi } from 'vitest';

import {
  BatchEventTooLargeError,
  RecordingBatcher,
  type RecordingBatchContext,
} from '../src/pipeline/batcher';
import {
  canonicalSerialize,
  serializeBatch,
  serializeBatchSync,
} from '../src/pipeline/serializer';
import { serializeInWorker } from '../src/pipeline/serialization.worker';
import { sha256Hex } from '../src/delivery/integrity';

const context: RecordingBatchContext = {
  sdkVersion: '0.1.0',
  rrwebVersion: '2.2.0',
  rrwebCommit: 'rrweb-commit',
  appKey: 'app-web',
  identity: { type: 'host', id: 'customer-1' },
  consent: {
    noticeVersion: '2026-10',
    action: 'start-insurance',
    grantedAt: '2026-10-26T00:00:00.000Z',
  },
  journeyId: 'journey-1',
  sessionId: 'session-1',
  recordingId: 'recording-1',
  segmentId: 'segment-1',
};

describe('RecordingBatcher integrity', () => {
  it('assigns continuous sequences and seals at the event-count threshold', async () => {
    const batcher = new RecordingBatcher(context, {
      maxEvents: 2,
      createBatchId: () => 'batch-count',
      now: () => Date.parse('2026-10-26T01:00:00.000Z'),
    });

    expect(await batcher.add({ event: 1 })).toEqual([]);
    const [sealed] = await batcher.add({ event: 2 });

    expect(sealed.batch).toMatchObject({
      batchId: 'batch-count',
      sequenceStart: 1,
      sequenceEnd: 2,
      reason: 'count',
      events: [{ event: 1 }, { event: 2 }],
    });
    expect(sealed.batch.events).toHaveLength(
      sealed.batch.sequenceEnd - sealed.batch.sequenceStart + 1,
    );
    batcher.destroy();
  });

  it('seals by bytes, isolates an oversized event, and rejects events over 2 MiB', async () => {
    let batchNumber = 0;
    const batcher = new RecordingBatcher(context, {
      maxBytes: 60,
      maxSingleEventBytes: 200,
      createBatchId: () => `batch-${++batchNumber}`,
    });

    await batcher.add({ value: 'a'.repeat(25) });
    const boundary = await batcher.add({ value: 'b'.repeat(25) });
    expect(boundary).toHaveLength(1);
    expect(boundary[0].batch).toMatchObject({
      sequenceStart: 1,
      sequenceEnd: 1,
      reason: 'bytes',
    });

    const oversized = await batcher.add({ value: 'c'.repeat(100) });
    expect(oversized).toHaveLength(2);
    expect(oversized[1].batch).toMatchObject({
      sequenceStart: 3,
      sequenceEnd: 3,
      reason: 'bytes',
    });
    await expect(
      batcher.add({ value: 'd'.repeat(300) }),
    ).rejects.toBeInstanceOf(BatchEventTooLargeError);
    batcher.destroy();
  });

  it.each(['segment', 'stop', 'manual'] as const)(
    'seals pending events for the %s boundary',
    async (reason) => {
      const batcher = new RecordingBatcher(context, {
        createBatchId: () => `batch-${reason}`,
      });
      await batcher.add({ event: reason });

      const sealed = await batcher.flush(reason);

      expect(sealed?.batch.reason).toBe(reason);
      batcher.destroy();
    },
  );

  it('seals pending events after the interval', async () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const batcher = new RecordingBatcher(context, {
      flushIntervalMs: 5_000,
      createBatchId: () => 'batch-interval',
      onBatch: (sealed) => emitted.push(sealed.batch.reason),
    });
    await batcher.add({ event: 'waiting' });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(emitted).toEqual(['interval']);
    batcher.destroy();
    vi.useRealTimers();
  });

  it('creates immutable retry bytes and a previous-hash chain', async () => {
    let batchNumber = 0;
    const batcher = new RecordingBatcher(context, {
      createBatchId: () => `batch-${++batchNumber}`,
      now: () => Date.parse('2026-10-26T02:00:00.000Z'),
    });
    await batcher.add({ z: 1, a: 2 });
    const first = await batcher.flush('manual');
    await batcher.add({ event: 2 });
    const second = await batcher.flush('stop');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.batch.previousBatchHash).toBe(first?.batch.contentHash);
    expect(await serializeBatch(first!.batch)).toEqual(first!.serialized);
    expect(await sha256Hex(first!.hashInput.bytes)).toBe(
      first!.batch.contentHash,
    );
    expect(Object.isFrozen(first!.batch)).toBe(true);
    expect(Object.isFrozen(first!.batch.events)).toBe(true);
    batcher.destroy();
  });

  it('canonicalizes object keys and produces equivalent worker and fallback bytes', async () => {
    const value = {
      z: 1,
      nested: { y: true, a: 'first' },
      array: [{ b: 2, a: 1 }, undefined],
    };

    expect(canonicalSerialize(value)).toBe(
      '{"array":[{"a":1,"b":2},null],"nested":{"a":"first","y":true},"z":1}',
    );
    const sync = serializeBatchSync(value);
    const worker = serializeInWorker({ id: 'request-1', value });
    expect(worker).toEqual({ id: 'request-1', result: sync });
  });
});
