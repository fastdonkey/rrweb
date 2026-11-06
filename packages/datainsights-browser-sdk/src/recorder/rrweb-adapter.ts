import type { eventWithTime } from '@rrweb/types';
import { captureCanvases } from './canvas-capture';

import { buildPrivacyPolicy } from '../privacy/privacy-policy';
import type { DataInsightsOptions } from '../public/types';

export interface RecorderAdapterInput {
  emit: (event: eventWithTime) => void;
  privacy?: DataInsightsOptions['privacy'];
  onError?: () => void;
}

export interface RecorderHandle {
  readonly started: boolean;
  addCustomEvent(name: string, data: unknown): void;
  takeFullSnapshot(): void;
  stop(): void;
}

type RecorderOptions = ReturnType<typeof buildPrivacyPolicy> & {
  emit: (event: eventWithTime) => void;
  sampling: {
    mousemove: false;
    scroll: number;
    input: 'all';
    media: number;
  };
  checkoutEveryNms: number;
  checkoutEveryNth: number;
  slimDOMOptions: {
    script: true;
    comment: true;
    headFavicon: false;
    headWhitespace: false;
  };
  plugins: [];
  recordCanvas: false;
  recordCrossOriginIframes: false;
  errorHandler: () => void;
};

type RecordLoader = () => Promise<{
  record: {
    (options: RecorderOptions): (() => void) | undefined;
    addCustomEvent(name: string, data: unknown): void;
    takeFullSnapshot(isCheckout?: boolean): void;
    mirror?: { getId(node: Node): number };
  };
}>;

export function buildRecorderOptions(
  input: RecorderAdapterInput,
): RecorderOptions {
  const privacy = buildPrivacyPolicy(input.privacy);
  return {
    emit: input.emit,
    ...privacy,
    sampling: {
      mousemove: false,
      scroll: 50,
      input: 'all',
      media: 800,
    },
    checkoutEveryNms: 60_000,
    checkoutEveryNth: 1_000,
    slimDOMOptions: {
      script: true,
      comment: true,
      headFavicon: false,
      headWhitespace: false,
    },
    plugins: [],
    recordCanvas: false,
    recordCrossOriginIframes: false,
    errorHandler: () => input.onError?.(),
  };
}

export async function startRrwebRecorder(
  input: RecorderAdapterInput,
  loadRecord: RecordLoader = () => import('@rrweb/record'),
): Promise<RecorderHandle> {
  let canvases: ReturnType<typeof captureCanvases> | undefined;
  try {
    const { record } = await loadRecord();
    const privacy = buildPrivacyPolicy(input.privacy);
    canvases = captureCanvases(record.mirror, input.emit, ['.rr-sensitive', privacy.blockSelector, privacy.maskTextSelector, privacy.ignoreSelector].filter(Boolean).join(','));
    const stop = record(buildRecorderOptions({ ...input, emit: event => { canvases?.snapshot(event); input.emit(event); } }));
    if (typeof stop !== 'function') canvases.stop();
    return {
      started: typeof stop === 'function',
      addCustomEvent(name, data) {
        try {
          record.addCustomEvent(name, data);
        } catch {
          input.onError?.();
        }
      },
      takeFullSnapshot() {
        try {
          record.takeFullSnapshot(true);
        } catch {
          input.onError?.();
        }
      },
      stop() {
        try {
          canvases?.stop();
          stop?.();
        } catch {
          input.onError?.();
        }
      },
    };
  } catch {
    canvases?.stop();
    input.onError?.();
    return {
      started: false,
      addCustomEvent() {},
      takeFullSnapshot() {},
      stop() {},
    };
  }
}
