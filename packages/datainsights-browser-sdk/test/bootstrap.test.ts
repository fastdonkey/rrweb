import { describe, expect, it, vi } from 'vitest';

import type {
  DataInsightsBootstrapOptions,
  DataInsightsClient,
  ResolvedApplicationConfig,
  SDKResult,
} from '../src/public/types';
import { installBootstrap } from '../src/runtime/bootstrap';

const config: ResolvedApplicationConfig = {
  appKey: 'di_t_cn1_K7J9M2X4',
  enabled: true,
  configVersion: '42',
  collectorUrls: ['https://collector-test-cn1.datainsights.io'],
  uploadToken: 'short-lived-token',
  expiresAt: '2026-10-26T12:00:00.000Z',
};

const options: DataInsightsBootstrapOptions = {
  appKey: config.appKey,
  consent: {
    startSelector: '#start-insurance',
    noticeVersion: 'insurance-notice-v1',
  },
  resolveUserId: () => 'policy-user-1',
};

function createFixture() {
  const document = new EventTarget();
  const init = vi.fn(() => ({ ok: true, value: client } as const));
  const grant = vi.fn(() => ({ ok: true, value: undefined } as const));
  const start = vi.fn(async () => ({
    ok: true,
    value: {
      identityType: 'host' as const,
      sessionId: 'session-1',
      recordingId: 'recording-1',
      segmentId: 'segment-1',
    },
  }));
  const client = {
    init,
    consent: { grant, revoke: vi.fn() },
    start,
  } as unknown as DataInsightsClient;
  const transport = {
    name: 'bootstrap-test',
    capability: 'persisted-receipt-v1',
    send: vi.fn(),
    reconcile: vi.fn(),
  } as const;
  const resolveConfig = vi.fn(
    async () => ({ ok: true, value: config } as const),
  );
  const createTransport = vi.fn(() => transport);
  const recordError = vi.fn();

  function click(matches = true): void {
    const event = new Event('click');
    Object.defineProperty(event, 'target', {
      value: {
        closest: (selector: string) => (matches && selector ? {} : null),
      },
    });
    document.dispatchEvent(event);
  }

  return {
    client,
    document,
    init,
    grant,
    start,
    resolveConfig,
    createTransport,
    recordError,
    click,
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('simplified bootstrap', () => {
  it('resolves configuration without consent and starts only after the matching click', async () => {
    const fixture = createFixture();
    const installed = await installBootstrap(fixture.client, options, {
      document: fixture.document,
      resolveConfig: fixture.resolveConfig,
      createTransport: fixture.createTransport,
      workerUrl: 'https://cdn.datainsights.io/sdk/v1/serialization.worker.js',
      recordError: fixture.recordError,
    });

    expect(installed.ok).toBe(true);
    expect(fixture.resolveConfig).toHaveBeenCalledWith(config.appKey);
    expect(fixture.init).toHaveBeenCalledWith({
      appKey: config.appKey,
      transport: expect.any(Object),
      workerUrl: 'https://cdn.datainsights.io/sdk/v1/serialization.worker.js',
    });
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();

    fixture.click(false);
    fixture.click(true);
    await flushAsyncWork();

    expect(fixture.grant).toHaveBeenCalledWith({
      noticeVersion: 'insurance-notice-v1',
      action: 'start-insurance',
    });
    expect(fixture.start).toHaveBeenCalledWith({ userId: 'policy-user-1' });
  });

  it('fails before config resolution for unsafe selectors and notice versions', async () => {
    const fixture = createFixture();
    const result = await installBootstrap(
      fixture.client,
      {
        appKey: config.appKey,
        consent: { startSelector: '[', noticeVersion: '' },
      },
      {
        document: fixture.document,
        resolveConfig: fixture.resolveConfig,
        createTransport: fixture.createTransport,
        recordError: fixture.recordError,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONFIG' },
    });
    expect(fixture.resolveConfig).not.toHaveBeenCalled();
  });

  it('returns remote config failures without installing a click listener', async () => {
    const fixture = createFixture();
    fixture.resolveConfig.mockResolvedValueOnce({
      ok: false,
      error: { code: 'APPLICATION_DISABLED', message: 'disabled' },
    } as SDKResult<ResolvedApplicationConfig>);

    const result = await installBootstrap(fixture.client, options, {
      document: fixture.document,
      resolveConfig: fixture.resolveConfig,
      createTransport: fixture.createTransport,
      recordError: fixture.recordError,
    });
    fixture.click();
    await flushAsyncWork();

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'APPLICATION_DISABLED' },
    });
    expect(fixture.grant).not.toHaveBeenCalled();
  });

  it('falls back to anonymous identity when the host resolver throws', async () => {
    const fixture = createFixture();
    const installed = await installBootstrap(
      fixture.client,
      {
        ...options,
        resolveUserId: () => {
          throw new Error('host-private-detail');
        },
      },
      {
        document: fixture.document,
        resolveConfig: fixture.resolveConfig,
        createTransport: fixture.createTransport,
        recordError: fixture.recordError,
      },
    );

    fixture.click();
    await flushAsyncWork();

    expect(installed.ok).toBe(true);
    expect(fixture.start).toHaveBeenCalledWith({});
    expect(fixture.recordError).toHaveBeenCalledWith('IDENTITY_INVALID');
    expect(JSON.stringify(fixture.recordError.mock.calls)).not.toContain(
      'host-private-detail',
    );
  });

  it('deduplicates rapid clicks and removes the listener on dispose', async () => {
    const fixture = createFixture();
    let finishStart: (() => void) | undefined;
    fixture.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStart = () =>
            resolve({
              ok: true,
              value: {
                identityType: 'anonymous',
                sessionId: 'session-1',
                recordingId: 'recording-1',
                segmentId: 'segment-1',
              },
            });
        }),
    );
    const installed = await installBootstrap(fixture.client, options, {
      document: fixture.document,
      resolveConfig: fixture.resolveConfig,
      createTransport: fixture.createTransport,
      recordError: fixture.recordError,
    });

    fixture.click();
    fixture.click();
    await flushAsyncWork();
    expect(fixture.start).toHaveBeenCalledTimes(1);
    finishStart?.();
    await flushAsyncWork();

    if (installed.ok) installed.value.dispose();
    fixture.click();
    await flushAsyncWork();
    expect(fixture.start).toHaveBeenCalledTimes(1);
  });
});
