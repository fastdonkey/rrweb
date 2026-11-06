import { describe, expect, it } from 'vitest';

import { RecordingBatcher } from '../src/pipeline/batcher';
import {
  decodeRecordingBatch,
  encodeRecordingBatch,
  RecordingCodecError,
} from '../src/pipeline/compression-codec';

async function createBatch(value: string) {
  const batcher = new RecordingBatcher(
    {
      sdkVersion: '0.1.0',
      rrwebVersion: '2.2.0',
      rrwebCommit: 'rrweb-commit',
      appKey: 'di_t_cn1_CODEC_TEST',
      identity: { type: 'host', id: 'codec-user' },
      consent: {
        noticeVersion: 'compression-v1',
        action: 'start-insurance',
        grantedAt: '2026-10-27T00:00:00.000Z',
      },
      sessionId: 'session-codec',
      recordingId: 'recording-codec',
      segmentId: 'segment-codec',
    },
    {
      createBatchId: () => 'batch-codec',
      now: () => Date.parse('2026-10-27T00:00:01.000Z'),
    },
  );
  await batcher.add({ type: 3, data: { text: value }, timestamp: 1 });
  const sealed = await batcher.flush('manual');
  batcher.destroy();
  if (!sealed) throw new Error('Expected a sealed test batch.');
  return sealed.batch;
}

describe('recording compression codec', () => {
  it('gzip encodes a repetitive batch and restores the exact canonical batch', async () => {
    const batch = await createBatch('保险录制内容'.repeat(2_000));

    const encoded = await encodeRecordingBatch(batch, {
      minimumCompressionBytes: 0,
    });

    expect(encoded.codec).toBe('gzip');
    expect(encoded.codecVersion).toBe(1);
    expect(encoded.payload).toBeInstanceOf(Uint8Array);
    expect(encoded.compressedBytes).toBe(encoded.payload.byteLength);
    expect(encoded.compressedBytes).toBeLessThan(encoded.uncompressedBytes);
    expect(encoded.contentHash).toBe(batch.contentHash);
    await expect(decodeRecordingBatch(encoded)).resolves.toEqual(batch);
  });

  it('uses identity below the threshold without changing the content hash', async () => {
    const batch = await createBatch('small');

    const encoded = await encodeRecordingBatch(batch, {
      minimumCompressionBytes: Number.MAX_SAFE_INTEGER,
    });

    expect(encoded).toMatchObject({
      codec: 'identity',
      codecVersion: 1,
      contentHash: batch.contentHash,
      uncompressedBytes: encoded.payload.byteLength,
      compressedBytes: encoded.payload.byteLength,
    });
    await expect(decodeRecordingBatch(encoded)).resolves.toEqual(batch);
  });

  it('falls back to identity when gzip has no size benefit', async () => {
    const batch = await createBatch('not-compressible-enough');

    const encoded = await encodeRecordingBatch(batch, {
      minimumCompressionBytes: 0,
      gzip: (bytes) => Uint8Array.from([...bytes, 0]),
    });

    expect(encoded.codec).toBe('identity');
    expect(encoded.compressedBytes).toBe(encoded.uncompressedBytes);
  });

  it('rejects unknown versions, corrupted data, decoded overflow and hash mismatch', async () => {
    const batch = await createBatch('校验压缩内容'.repeat(1_000));
    const encoded = await encodeRecordingBatch(batch, {
      minimumCompressionBytes: 0,
    });

    await expect(
      decodeRecordingBatch({ ...encoded, codecVersion: 2 as 1 }),
    ).rejects.toMatchObject<Partial<RecordingCodecError>>({
      code: 'CODEC_VERSION_UNSUPPORTED',
    });
    await expect(
      decodeRecordingBatch({
        ...encoded,
        codec: 'brotli' as 'gzip',
      }),
    ).rejects.toMatchObject<Partial<RecordingCodecError>>({
      code: 'CODEC_UNSUPPORTED',
    });

    const corrupted = Uint8Array.from(encoded.payload);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    await expect(
      decodeRecordingBatch({ ...encoded, payload: corrupted }),
    ).rejects.toMatchObject<Partial<RecordingCodecError>>({
      code: 'PAYLOAD_CORRUPT',
    });

    await expect(
      decodeRecordingBatch(encoded, {
        maxUncompressedBytes: encoded.uncompressedBytes - 1,
      }),
    ).rejects.toMatchObject<Partial<RecordingCodecError>>({
      code: 'DECODED_SIZE_EXCEEDED',
    });

    await expect(
      decodeRecordingBatch({
        ...encoded,
        contentHash: '0'.repeat(64),
      }),
    ).rejects.toMatchObject<Partial<RecordingCodecError>>({
      code: 'CONTENT_HASH_MISMATCH',
    });

    const invalidBatchPayload = new TextEncoder().encode('null');
    await expect(
      decodeRecordingBatch({
        format: 'datainsights-recording-batch',
        codec: 'identity',
        codecVersion: 1,
        uncompressedBytes: invalidBatchPayload.byteLength,
        compressedBytes: invalidBatchPayload.byteLength,
        contentHash: '0'.repeat(64),
        payload: invalidBatchPayload,
      }),
    ).rejects.toMatchObject<Partial<RecordingCodecError>>({
      code: 'PAYLOAD_CORRUPT',
    });
  });
});
