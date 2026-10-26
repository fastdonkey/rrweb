// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { eventWithTime } from '@rrweb/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RecorderAdapterModule {
  buildRecorderOptions: (input: {
    emit: (event: eventWithTime) => void;
    privacy?: Record<string, string>;
  }) => Record<string, unknown>;
  startRrwebRecorder: (
    input: {
      emit: (event: eventWithTime) => void;
      privacy?: Record<string, string>;
      onError?: () => void;
    },
    loadRecord?: () => Promise<never>,
  ) => Promise<{
    started: boolean;
    takeFullSnapshot(): void;
    stop(): void;
  }>;
}

async function loadAdapter(): Promise<RecorderAdapterModule | undefined> {
  return import('../src/recorder/rrweb-adapter').catch(() => undefined);
}

function loadFixture(): void {
  const fixturePath = resolve(process.cwd(), 'test/fixtures/privacy-form.html');
  document.body.innerHTML = readFileSync(fixturePath, 'utf8');
}

describe('rrweb privacy adapter', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('provides a real rrweb adapter with mandatory privacy settings', async () => {
    const adapter = await loadAdapter();

    expect(adapter).toBeDefined();
    expect(typeof adapter?.buildRecorderOptions).toBe('function');
    const options = adapter?.buildRecorderOptions({ emit: () => undefined });
    expect(options).toMatchObject({
      maskAllInputs: false,
      maskInputOptions: { password: true },
      blockClass: 'rr-sensitive',
      recordCanvas: false,
      recordCrossOriginIframes: false,
      checkoutEveryNms: 60_000,
      checkoutEveryNth: 1_000,
      plugins: [],
    });
    expect(options?.blockSelector).toContain('input[type="hidden"]');
    expect(options?.blockSelector).toContain('[data-di-block]');
  });

  it('records ordinary insurance fields but never secret fields', async () => {
    loadFixture();
    const adapter = await loadAdapter();
    if (!adapter) throw new Error('rrweb adapter is unavailable');
    const events: eventWithTime[] = [];
    const recorder = await adapter.startRrwebRecorder({
      emit: (event) => events.push(event),
    });

    const premium = document.querySelector<HTMLInputElement>('#premium');
    const password = document.querySelector<HTMLInputElement>('#password');
    if (!premium || !password) throw new Error('privacy fixture is invalid');
    premium.value = '1566.80';
    premium.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'UpdatedPassword!';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    recorder.stop();

    const serialized = JSON.stringify(events);
    expect(serialized).toContain('1566.80');
    expect(serialized).toContain('POLICY-2026-001');
    expect(serialized).not.toContain('NeverRecordMe!');
    expect(serialized).not.toContain('UpdatedPassword!');
    expect(serialized).not.toContain('csrf-secret-token');
    expect(serialized).not.toContain('identity-card-310000000000000000');
    expect(serialized).not.toContain('authorization-bearer-secret');
  });

  it('only allows customers to expand privacy selectors', async () => {
    const adapter = await loadAdapter();
    const options = adapter?.buildRecorderOptions({
      emit: () => undefined,
      privacy: { blockSelector: '.customer-secret' },
    });

    expect(options?.blockSelector).toContain('.customer-secret');
    expect(options?.blockSelector).toContain('input[type="hidden"]');
  });

  it('contains recorder failures instead of throwing into the host page', async () => {
    loadFixture();
    const adapter = await loadAdapter();
    if (!adapter) throw new Error('rrweb adapter is unavailable');

    const onError = vi.fn();
    const recorder = await adapter.startRrwebRecorder(
      { emit: () => undefined, onError },
      async () => {
        throw new Error('rrweb failed to load');
      },
    );

    expect(recorder.started).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('exposes a guarded full snapshot checkpoint for segment rotation', async () => {
    const adapter = await loadAdapter();
    if (!adapter) throw new Error('rrweb adapter is unavailable');
    const takeFullSnapshot = vi.fn();
    const onError = vi.fn();
    const recorder = await adapter.startRrwebRecorder(
      { emit: () => undefined, onError },
      async () =>
        ({
          record: Object.assign(() => () => undefined, {
            addCustomEvent: vi.fn(),
            takeFullSnapshot,
          }),
        } as never),
    );

    recorder.takeFullSnapshot();

    expect(takeFullSnapshot).toHaveBeenCalledWith(true);
    expect(onError).not.toHaveBeenCalled();
  });
});
