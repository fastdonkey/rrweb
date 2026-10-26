export async function sha256Hex(
  bytes: Uint8Array,
  cryptoSource: Crypto = globalThis.crypto,
): Promise<string> {
  if (!cryptoSource?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable.');
  }
  const input = Uint8Array.from(bytes).buffer;
  const digest = await cryptoSource.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
