import { validatePersistedReceipt } from '../delivery/receipt-validator';
import type { RecordingBatchV1 } from '../pipeline/batcher';
import type { TestTransport, TransportContext, TransportResult } from './types';

export interface MockHttpResponse {
  readonly status: number;
  readonly body?: unknown;
}

export type MockHttpHandler = (
  batch: Readonly<RecordingBatchV1>,
  context: Readonly<TransportContext>,
) => Promise<MockHttpResponse>;

function isTransportResult(value: unknown): value is TransportResult {
  if (typeof value !== 'object' || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return (
    status === 'accepted' || status === 'retryable' || status === 'rejected'
  );
}

export class MockHttpTransport implements TestTransport {
  readonly name = 'mock-http';
  readonly capability = 'test-only';

  constructor(private readonly handler: MockHttpHandler) {}

  async send(
    batch: Readonly<RecordingBatchV1>,
    context: Readonly<TransportContext>,
  ): Promise<TransportResult> {
    let response: MockHttpResponse;
    try {
      response = await this.handler(batch, context);
    } catch (_error) {
      return { status: 'retryable', reason: 'network-error' };
    }

    if (response.status >= 200 && response.status < 300) {
      if (!isTransportResult(response.body)) {
        return { status: 'retryable', reason: 'missing-persisted-receipt' };
      }
      if (
        response.body.status === 'accepted' &&
        !validatePersistedReceipt(batch, response.body).ok
      ) {
        return { status: 'retryable', reason: 'invalid-persisted-receipt' };
      }
      return response.body;
    }
    if (
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      return { status: 'retryable', reason: `http-${response.status}` };
    }
    return { status: 'rejected', reason: `http-${response.status}` };
  }
}
