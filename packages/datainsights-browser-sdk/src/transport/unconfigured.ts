import type { TestTransport } from './types';

export const UNCONFIGURED_TRANSPORT: TestTransport = Object.freeze({
  name: 'unconfigured',
  capability: 'test-only' as const,
  async send() {
    return { status: 'rejected' as const, reason: 'transport-not-configured' };
  },
});

export function isUnconfiguredTransport(value: unknown): boolean {
  return value === UNCONFIGURED_TRANSPORT;
}
