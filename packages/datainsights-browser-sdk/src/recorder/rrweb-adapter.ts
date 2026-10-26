import type { eventWithTime } from '@rrweb/types';

import { buildPrivacyPolicy } from '../privacy/privacy-policy';
import type { DataInsightsOptions } from '../public/types';

export interface RecorderAdapterInput {
  emit: (event: eventWithTime) => void;
  privacy?: DataInsightsOptions['privacy'];
  onError?: () => void;
}

export interface RecorderHandle {
  readonly started: boolean;
  stop(): void;
}

type RecorderOptions = ReturnType<typeof buildPrivacyPolicy> & {
  emit: (event: eventWithTime) => void;
  sampling: {
    mousemove: false;
    scroll: number;
    input: 'last';
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
  record(options: RecorderOptions): (() => void) | undefined;
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
      scroll: 150,
      input: 'last',
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
  try {
    const { record } = await loadRecord();
    const stop = record(buildRecorderOptions(input));
    return {
      started: typeof stop === 'function',
      stop() {
        try {
          stop?.();
        } catch {
          input.onError?.();
        }
      },
    };
  } catch {
    input.onError?.();
    return { started: false, stop() {} };
  }
}
