import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

interface RecordingContext {
  sessionId: string;
  recordingId: string;
  segmentId: string;
}

interface SessionClient {
  init(options: Record<string, unknown>): Result;
  consent: { grant(evidence: Record<string, unknown>): Result };
  start(context?: Record<string, unknown>): Promise<Result<RecordingContext>>;
  stop(reason?: string): Promise<Result>;
  destroy(): Promise<Result>;
  getDebugInfo(): { state: string };
}

const transport = {
  name: 'session-test',
  capability: 'test-only',
  async send() {
    return { status: 'accepted' };
  },
};

class FakeBroadcastChannel extends EventTarget {
  static readonly channels = new Map<string, Set<FakeBroadcastChannel>>();

  constructor(private readonly channelName: string) {
    super();
    const members = FakeBroadcastChannel.channels.get(channelName) ?? new Set();
    members.add(this);
    FakeBroadcastChannel.channels.set(channelName, members);
  }

  postMessage(data: unknown): void {
    for (const member of FakeBroadcastChannel.channels.get(this.channelName) ??
      []) {
      if (member !== this) {
        queueMicrotask(() =>
          member.dispatchEvent(new MessageEvent('message', { data })),
        );
      }
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.get(this.channelName)?.delete(this);
  }

  static reset(): void {
    FakeBroadcastChannel.channels.clear();
  }
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    values,
  };
}

async function freshClient(): Promise<SessionClient> {
  vi.resetModules();
  const { DataInsights } = await import('../src/index');
  return DataInsights as unknown as SessionClient;
}

async function waitForAdditionalTimer(previousCount: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (vi.getTimerCount() > previousCount) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('BroadcastChannel claim timer was not scheduled');
}

function authorize(client: SessionClient): void {
  client.init({ appKey: 'insurance-h5', transport });
  client.consent.grant({
    noticeVersion: 'insurance-notice-v1',
    action: 'start-insurance',
  });
}

describe('Session lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
    vi.setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    FakeBroadcastChannel.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('preserves Session but rotates Recording on the same tab', async () => {
    const client = await freshClient();
    authorize(client);

    const first = await client.start({ journeyId: 'journey-1' });
    await client.stop('manual');
    const second = await client.start({ journeyId: 'journey-1' });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.sessionId).toBe(first.value.sessionId);
    expect(second.value.recordingId).not.toBe(first.value.recordingId);
  });

  it('restores a refreshed tab after the previous page releases its claim', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const firstPage = await freshClient();
    authorize(firstPage);
    const first = await firstPage.start();
    await firstPage.stop('manual');
    await firstPage.destroy();

    const refreshedPage = await freshClient();
    authorize(refreshedPage);
    const timerCount = vi.getTimerCount();
    const pending = refreshedPage.start();
    await waitForAdditionalTimer(timerCount);
    await vi.advanceTimersByTimeAsync(25);
    const refreshed = await pending;

    expect(first.ok && refreshed.ok).toBe(true);
    if (first.ok && refreshed.ok) {
      expect(refreshed.value.sessionId).toBe(first.value.sessionId);
      expect(refreshed.value.recordingId).not.toBe(first.value.recordingId);
    }
  });

  it('rotates Session when another active tab holds the cloned state', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const firstTab = await freshClient();
    authorize(firstTab);
    const first = await firstTab.start();

    const secondTab = await freshClient();
    authorize(secondTab);
    const timerCount = vi.getTimerCount();
    const pending = secondTab.start();
    await waitForAdditionalTimer(timerCount);
    await vi.advanceTimersByTimeAsync(25);
    const second = await pending;

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.sessionId).not.toBe(first.value.sessionId);
    }
  });

  it('creates a new Session when BroadcastChannel is unavailable', async () => {
    const storage = sessionStorage as unknown as ReturnType<
      typeof createStorage
    >;
    storage.values.set(
      'di:v1:insurance-h5:session',
      JSON.stringify({
        sessionId: '11111111-1111-4111-8111-111111111111',
        lastActivityAt: Date.now(),
      }),
    );
    vi.stubGlobal('BroadcastChannel', undefined);
    const client = await freshClient();
    authorize(client);

    const result = await client.start();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).not.toBe(
        '11111111-1111-4111-8111-111111111111',
      );
    }
  });

  it('keeps recording active while rotating Segment after 30 minutes', async () => {
    const client = await freshClient();
    authorize(client);
    const first = await client.start();
    if (!first.ok) throw new Error('recording did not start');

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    window.dispatchEvent(new Event('click'));
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    const current = await client.start();

    expect(client.getDebugInfo().state).toBe('recording');
    expect(current.ok && current.value.segmentId).not.toBe(
      first.value.segmentId,
    );
  });

  it('ends an inactive Session after 30 minutes', async () => {
    const client = await freshClient();
    authorize(client);
    await client.start();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(client.getDebugInfo().state).toBe('authorized');
  });

  it.each([
    'completed',
    'cancelled',
    'logout',
    'auth-expired',
    'consent-revoked',
    'idle-timeout',
    'manual',
    'capacity',
    'recorder-error',
  ])('accepts the %s stop reason', async (reason) => {
    const client = await freshClient();
    authorize(client);
    await client.start();

    expect((await client.stop(reason)).ok).toBe(true);
    expect(client.getDebugInfo().state).toBe('authorized');
  });
});
