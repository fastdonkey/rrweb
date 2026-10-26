import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { RecordingBatcher } from '../../src/pipeline/batcher';

const context = {
  sdkVersion: '0.1.0',
  rrwebVersion: '2.2.0',
  rrwebCommit: 'benchmark',
  appKey: 'benchmark-app',
  identity: { type: 'anonymous' as const, id: 'benchmark-id' },
  consent: {
    noticeVersion: 'benchmark',
    action: 'start-insurance' as const,
    grantedAt: '2026-10-26T00:00:00.000Z',
  },
  sessionId: 'benchmark-session',
  recordingId: 'benchmark-recording',
  segmentId: 'benchmark-segment',
};

describe('SDK overhead budgets', () => {
  it('processes a deterministic two-hour event model within event and memory budgets', async () => {
    const eventDurations: number[] = [];
    let batchId = 0;
    const batcher = new RecordingBatcher(context, {
      createBatchId: () => `benchmark-${++batchId}`,
      now: () => 0,
    });
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    for (let second = 0; second < 2 * 60 * 60; second += 5) {
      const eventStarted = performance.now();
      await batcher.add({
        type: 3,
        timestamp: second * 1_000,
        data: { source: 3, x: second % 800, y: second % 600 },
      });
      eventDurations.push(performance.now() - eventStarted);
    }
    await batcher.flush('stop');
    batcher.destroy();
    const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
    const sorted = [...eventDurations].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    expect(p95).toBeLessThan(2);
    expect(heapGrowth).toBeLessThan(50 * 1024 * 1024);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(batchId).toBeGreaterThan(1);
  });
});
