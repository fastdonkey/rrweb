import { validateConfig } from '../config/config';
import { ConsentManager } from '../consent/consent-manager';
import type {
  ConsentEvidence,
  DataInsightsClient,
  DataInsightsOptions,
  RecordingContext,
  SDKResult,
  StartContext,
  StopReason,
} from '../public/types';
import { LifecycleStateMachine } from './state-machine';

function failure(
  code: Extract<SDKResult, { ok: false }>['error']['code'],
  message: string,
): SDKResult<never> {
  return { ok: false, error: { code, message } };
}

function equivalentConfig(
  left: Readonly<DataInsightsOptions>,
  right: Readonly<DataInsightsOptions>,
): boolean {
  return (
    left.appKey === right.appKey &&
    left.transport === right.transport &&
    left.onDeliveryStateChange === right.onDeliveryStateChange &&
    left.debug === right.debug &&
    JSON.stringify(left.privacy) === JSON.stringify(right.privacy) &&
    JSON.stringify(left.batching) === JSON.stringify(right.batching)
  );
}

function createTemporaryRecordingContext(
  context: StartContext | undefined,
): RecordingContext {
  const createId = (): string => globalThis.crypto.randomUUID();
  return {
    identityType: context?.userId ? 'host' : 'anonymous',
    sessionId: createId(),
    recordingId: createId(),
    segmentId: createId(),
  };
}

export function createClient(): DataInsightsClient {
  const state = new LifecycleStateMachine();
  const consentManager = new ConsentManager();
  let options: Readonly<DataInsightsOptions> | undefined;
  let startPromise: Promise<SDKResult<RecordingContext>> | undefined;
  let recordingContext: RecordingContext | undefined;

  const client: DataInsightsClient = {
    init(candidate) {
      if (state.state === 'destroyed') {
        return failure('DESTROYED', 'The SDK instance has been destroyed.');
      }
      const validation = validateConfig(candidate);
      if (!validation.ok) return validation;
      if (options) {
        return equivalentConfig(options, validation.value)
          ? { ok: true, value: client }
          : failure(
              'ALREADY_INITIALIZED_WITH_DIFFERENT_CONFIG',
              'The SDK is already initialized with different configuration.',
            );
      }
      options = validation.value;
      state.transition('initialized');
      return { ok: true, value: client };
    },

    consent: {
      grant(evidence: ConsentEvidence) {
        if (state.state === 'destroyed') {
          return failure('DESTROYED', 'The SDK instance has been destroyed.');
        }
        if (state.state === 'uninitialized') {
          return failure('INVALID_STATE', 'Initialize the SDK before consent.');
        }
        const result = consentManager.grant(evidence);
        if (result.ok && state.state === 'initialized') {
          state.transition('authorized');
        }
        return result;
      },

      async revoke() {
        if (state.state === 'destroyed') {
          return failure('DESTROYED', 'The SDK instance has been destroyed.');
        }
        if (state.state === 'recording' || state.state === 'starting') {
          await client.stop('consent-revoked');
        }
        consentManager.revoke();
        if (state.state === 'authorized') state.transition('initialized');
        return { ok: true, value: undefined };
      },
    },

    start(context?: StartContext) {
      if (state.state === 'destroyed') {
        return Promise.resolve(
          failure('DESTROYED', 'The SDK instance has been destroyed.'),
        );
      }
      if (state.state === 'recording' && recordingContext) {
        return Promise.resolve({ ok: true, value: recordingContext });
      }
      if (state.state === 'starting' && startPromise) return startPromise;
      if (!consentManager.granted || state.state !== 'authorized') {
        return Promise.resolve(
          failure('CONSENT_REQUIRED', 'Consent is required before recording.'),
        );
      }

      state.transition('starting');
      startPromise = (async () => {
        try {
          await Promise.resolve();
          const persistenceAvailable =
            typeof globalThis.indexedDB !== 'undefined';
          if (!persistenceAvailable) {
            state.transition('authorized');
            return failure(
              'PERSISTENCE_UNAVAILABLE',
              'Durable browser storage is unavailable.',
            );
          }
          recordingContext = createTemporaryRecordingContext(context);
          state.transition('recording');
          return { ok: true, value: recordingContext };
        } catch {
          state.transition('authorized');
          return failure(
            'PERSISTENCE_UNAVAILABLE',
            'Durable browser storage could not be prepared.',
          );
        } finally {
          startPromise = undefined;
        }
      })();
      return startPromise;
    },

    async stop(_reason: StopReason = 'manual') {
      if (state.state === 'destroyed') {
        return failure('DESTROYED', 'The SDK instance has been destroyed.');
      }
      if (state.state === 'starting' && startPromise) await startPromise;
      if (state.state !== 'recording' && state.state !== 'degraded') {
        return { ok: true, value: undefined };
      }
      recordingContext = undefined;
      if (state.state === 'recording') {
        state.transition('stopping');
        state.transition('authorized');
      } else {
        state.transition('authorized');
      }
      return { ok: true, value: undefined };
    },

    getDebugInfo() {
      return Object.freeze({ state: state.state });
    },

    async destroy() {
      if (state.state === 'destroyed') {
        return { ok: true, value: undefined };
      }
      if (state.state === 'recording' || state.state === 'starting') {
        await client.stop();
      }
      state.transition('destroyed');
      return { ok: true, value: undefined };
    },
  };

  return Object.freeze(client);
}
