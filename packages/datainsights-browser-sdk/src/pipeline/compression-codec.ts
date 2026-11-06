import { gunzipSync, gzipSync } from 'fflate';

import { sha256Hex } from '../delivery/integrity';
import type { EncodedRecordingBatch } from '../public/types';
import type { RecordingBatchV1 } from './batcher';
import { canonicalSerialize } from './serializer';

const CODEC_VERSION = 1 as const;
const DEFAULT_MINIMUM_COMPRESSION_BYTES = 16 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export type RecordingCodecErrorCode =
  | 'CODEC_UNSUPPORTED'
  | 'CODEC_VERSION_UNSUPPORTED'
  | 'PAYLOAD_SIZE_MISMATCH'
  | 'PAYLOAD_CORRUPT'
  | 'DECODED_SIZE_EXCEEDED'
  | 'CONTENT_HASH_MISMATCH';

export class RecordingCodecError extends Error {
  constructor(readonly code: RecordingCodecErrorCode) {
    super(code);
    this.name = 'RecordingCodecError';
  }
}

export interface EncodeRecordingBatchOptions {
  readonly minimumCompressionBytes?: number;
  readonly gzip?: (bytes: Uint8Array) => Uint8Array;
}

export interface DecodeRecordingBatchOptions {
  readonly maxUncompressedBytes?: number;
  readonly gunzip?: (bytes: Uint8Array) => Uint8Array;
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : fallback;
}

function encodeCanonical(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalSerialize(value));
}

async function assertContentHash(
  batch: unknown,
  expectedHash: string,
): Promise<Readonly<RecordingBatchV1>> {
  if (
    typeof batch !== 'object' ||
    batch === null ||
    Array.isArray(batch) ||
    !('contentHash' in batch) ||
    typeof batch.contentHash !== 'string'
  ) {
    throw new RecordingCodecError('PAYLOAD_CORRUPT');
  }
  if (!HASH_PATTERN.test(expectedHash) || batch.contentHash !== expectedHash) {
    throw new RecordingCodecError('CONTENT_HASH_MISMATCH');
  }
  const { contentHash: _contentHash, ...hashInput } = batch;
  if ((await sha256Hex(encodeCanonical(hashInput))) !== expectedHash) {
    throw new RecordingCodecError('CONTENT_HASH_MISMATCH');
  }
  return batch as unknown as Readonly<RecordingBatchV1>;
}

function envelope(
  batch: Readonly<RecordingBatchV1>,
  uncompressedBytes: Uint8Array,
  codec: EncodedRecordingBatch['codec'],
  payload: Uint8Array,
): Readonly<EncodedRecordingBatch> {
  return Object.freeze({
    format: 'datainsights-recording-batch' as const,
    codec,
    codecVersion: CODEC_VERSION,
    uncompressedBytes: uncompressedBytes.byteLength,
    compressedBytes: payload.byteLength,
    contentHash: batch.contentHash,
    payload: Uint8Array.from(payload),
  });
}

export async function encodeRecordingBatch(
  batch: Readonly<RecordingBatchV1>,
  options: EncodeRecordingBatchOptions = {},
): Promise<Readonly<EncodedRecordingBatch>> {
  await assertContentHash(batch, batch.contentHash);
  const bytes = encodeCanonical(batch);
  const minimumCompressionBytes = nonNegativeInteger(
    options.minimumCompressionBytes,
    DEFAULT_MINIMUM_COMPRESSION_BYTES,
  );
  if (bytes.byteLength < minimumCompressionBytes) {
    return envelope(batch, bytes, 'identity', bytes);
  }

  let compressed: Uint8Array;
  try {
    compressed = (options.gzip ?? ((value) => gzipSync(value, { level: 6 })))(
      bytes,
    );
  } catch {
    return envelope(batch, bytes, 'identity', bytes);
  }
  if (compressed.byteLength >= bytes.byteLength) {
    return envelope(batch, bytes, 'identity', bytes);
  }
  return envelope(batch, bytes, 'gzip', compressed);
}

function assertEnvelope(
  encoded: Readonly<EncodedRecordingBatch>,
  maxUncompressedBytes: number,
): void {
  if (encoded.codecVersion !== CODEC_VERSION) {
    throw new RecordingCodecError('CODEC_VERSION_UNSUPPORTED');
  }
  if (encoded.codec !== 'identity' && encoded.codec !== 'gzip') {
    throw new RecordingCodecError('CODEC_UNSUPPORTED');
  }
  if (
    !Number.isSafeInteger(encoded.uncompressedBytes) ||
    encoded.uncompressedBytes < 0 ||
    encoded.uncompressedBytes > maxUncompressedBytes
  ) {
    throw new RecordingCodecError('DECODED_SIZE_EXCEEDED');
  }
  if (
    encoded.format !== 'datainsights-recording-batch' ||
    !(encoded.payload instanceof Uint8Array) ||
    !Number.isSafeInteger(encoded.compressedBytes) ||
    encoded.compressedBytes < 0 ||
    encoded.compressedBytes !== encoded.payload.byteLength
  ) {
    throw new RecordingCodecError('PAYLOAD_SIZE_MISMATCH');
  }
}

function assertGzipDeclaredSize(
  encoded: Readonly<EncodedRecordingBatch>,
  maxUncompressedBytes: number,
): void {
  if (encoded.payload.byteLength < 18) {
    throw new RecordingCodecError('PAYLOAD_CORRUPT');
  }
  const trailer = new DataView(
    encoded.payload.buffer,
    encoded.payload.byteOffset + encoded.payload.byteLength - 4,
    4,
  );
  const declaredBytes = trailer.getUint32(0, true);
  if (declaredBytes > maxUncompressedBytes) {
    throw new RecordingCodecError('DECODED_SIZE_EXCEEDED');
  }
  if (declaredBytes !== encoded.uncompressedBytes) {
    throw new RecordingCodecError('PAYLOAD_SIZE_MISMATCH');
  }
}

export async function decodeRecordingBatch(
  encoded: Readonly<EncodedRecordingBatch>,
  options: DecodeRecordingBatchOptions = {},
): Promise<Readonly<RecordingBatchV1>> {
  const maxUncompressedBytes = nonNegativeInteger(
    options.maxUncompressedBytes,
    DEFAULT_MAX_UNCOMPRESSED_BYTES,
  );
  assertEnvelope(encoded, maxUncompressedBytes);
  if (encoded.codec === 'gzip') {
    assertGzipDeclaredSize(encoded, maxUncompressedBytes);
  }

  let bytes: Uint8Array;
  try {
    bytes =
      encoded.codec === 'gzip'
        ? (options.gunzip ?? gunzipSync)(encoded.payload)
        : Uint8Array.from(encoded.payload);
  } catch {
    throw new RecordingCodecError('PAYLOAD_CORRUPT');
  }
  if (bytes.byteLength > maxUncompressedBytes) {
    throw new RecordingCodecError('DECODED_SIZE_EXCEEDED');
  }
  if (bytes.byteLength !== encoded.uncompressedBytes) {
    throw new RecordingCodecError('PAYLOAD_SIZE_MISMATCH');
  }

  let batch: unknown;
  try {
    batch = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RecordingCodecError('PAYLOAD_CORRUPT');
  }
  return assertContentHash(batch, encoded.contentHash);
}
