import { describe, expect, it, vi } from 'vitest';

import type { ResolvedApplicationConfig } from '../src/public/types';
import type { RecordingBatchV1 } from '../src/pipeline/batcher';
import { createHttpTransport } from '../src/transport/http';

const config: ResolvedApplicationConfig = {
  appKey: 'di_t_cn1_K7J9M2X4',
  enabled: true,
  configVersion: '42',
  collectorUrls: [
    'https://collector-primary.example',
    'https://collector-backup.example',
  ],
  uploadToken: 'short-lived-token',
  expiresAt: '2026-10-26T12:00:00.000Z',
};

const batch = {
  schemaVersion: '1.0',
  appKey: config.appKey,
  batchId: 'batch-1',
  recordingId: 'recording-1',
  sequenceStart: 1,
  sequenceEnd: 2,
  contentHash: 'content-hash',
  events: [{ type: 4 }],
} as RecordingBatchV1;

const context = {
  signal: new AbortController().signal,
  attempt: 1,
  trigger: 'manual' as const,
};

function accepted(overrides: Record<string, unknown> = {}) {
  return {
    status: 'accepted',
    receipt: {
      persisted: true,
      batchId: batch.batchId,
      recordingId: batch.recordingId,
      sequenceStart: batch.sequenceStart,
      sequenceEnd: batch.sequenceEnd,
      contentHash: batch.contentHash,
      ...overrides,
    },
  };
}

describe('resolved HTTP Transport', () => {
  it('fails over to a configured backup and returns an exact persisted receipt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(accepted()), { status: 200 }),
      );
    const transport = createHttpTransport(config, fetchImpl as typeof fetch);

    await expect(transport.send(batch, context)).resolves.toEqual(accepted());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://collector-primary.example/api/events',
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://collector-backup.example/api/events',
    );
    const request = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(request.signal).toBe(context.signal);
    expect(request.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer short-lived-token',
        'Content-Type': 'application/json',
        'X-App-Key': config.appKey,
      }),
    );
    expect(JSON.parse(String(request.body))).toMatchObject({
      batchId: batch.batchId,
      appKey: config.appKey,
    });
  });

  it('never accepts HTTP success with a mismatched receipt', async () => {
    const transport = createHttpTransport(
      config,
      vi.fn(async () =>
        new Response(JSON.stringify(accepted({ batchId: 'other-batch' })), {
          status: 200,
        }),
      ) as typeof fetch,
    );

    await expect(transport.send(batch, context)).resolves.toEqual({
      status: 'retryable',
      reason: 'invalid-persisted-receipt',
    });
  });

  it('validates reconciliation data from a configured collector', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recordingId: batch.recordingId,
          contiguousSequenceEnd: 2,
          missingRanges: [],
          checkedAt: '2026-10-26T11:30:00.000Z',
        }),
        { status: 200 },
      ),
    );
    const transport = createHttpTransport(config, fetchImpl as typeof fetch);

    await expect(
      transport.reconcile(batch.recordingId, { signal: context.signal }),
    ).resolves.toEqual({
      recordingId: batch.recordingId,
      contiguousSequenceEnd: 2,
      missingRanges: [],
      checkedAt: '2026-10-26T11:30:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://collector-primary.example/api/recordings/${batch.recordingId}/delivery-state`,
      expect.objectContaining({ method: 'GET', signal: context.signal }),
    );
  });

  it('rejects malformed reconciliation data and sends nothing after destroy', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ recordingId: batch.recordingId }), {
        status: 200,
      }),
    );
    const transport = createHttpTransport(config, fetchImpl as typeof fetch);

    await expect(
      transport.reconcile(batch.recordingId, { signal: context.signal }),
    ).rejects.toThrow('RECONCILIATION_FAILED');
    await transport.destroy?.();
    await expect(transport.send(batch, context)).resolves.toEqual({
      status: 'rejected',
      reason: 'transport-destroyed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not leak token or network details into retry reasons', async () => {
    const transport = createHttpTransport(
      config,
      vi.fn(async () => {
        throw new Error('short-lived-token internal-host.example');
      }) as typeof fetch,
    );

    const result = await transport.send(batch, context);
    expect(result).toEqual({ status: 'retryable', reason: 'network-error' });
    expect(JSON.stringify(result)).not.toContain(config.uploadToken);
  });
});
