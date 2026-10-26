import { validateConfig } from '../config/config';
import { ConsentManager } from '../consent/consent-manager';
import { IdentityManager } from '../identity/identity-manager';
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
import { SessionManager } from '../session/session-manager';
import { ActivityTracker } from './activity-tracker';

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

export function createClient(): DataInsightsClient {
  const state = new LifecycleStateMachine();
  const consentManager = new ConsentManager();
  let options: Readonly<DataInsightsOptions> | undefined;
  let identityManager: IdentityManager | undefined;
  let sessionManager: SessionManager | undefined;
  let activityTracker: ActivityTracker | undefined;
  let segmentTimer: ReturnType<typeof setInterval> | undefined;
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
      identityManager = new IdentityManager(validation.value.appKey);
      sessionManager = new SessionManager(validation.value.appKey);
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
          const identity = identityManager?.resolve(context?.userId);
          if (!identity?.ok) {
            state.transition('authorized');
            return (
              identity ??
              failure('IDENTITY_INVALID', 'Identity could not be resolved.')
            );
          }
          recordingContext = await sessionManager?.startRecording(
            identity.value.type,
            context?.journeyId,
          );
          if (!recordingContext) {
            state.transition('authorized');
            return failure('INVALID_STATE', 'Session could not be created.');
          }
          state.transition('recording');
          activityTracker = new ActivityTracker(
            () => sessionManager?.recordActivity(),
            () => void client.stop('idle-timeout'),
          );
          activityTracker.start();
          segmentTimer = setInterval(() => {
            if (recordingContext) {
              recordingContext =
                sessionManager?.rotateSegment(recordingContext);
            }
          }, 30 * 60 * 1000);
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

    identify(userId: string) {
      if (state.state === 'destroyed') {
        return failure('DESTROYED', 'The SDK instance has been destroyed.');
      }
      if (!consentManager.granted || !identityManager) {
        return failure(
          'CONSENT_REQUIRED',
          'Consent is required before setting identity.',
        );
      }
      return identityManager.identify(userId);
    },

    clearIdentity() {
      if (state.state === 'destroyed') {
        return failure('DESTROYED', 'The SDK instance has been destroyed.');
      }
      if (!consentManager.granted || !identityManager) {
        return failure(
          'CONSENT_REQUIRED',
          'Consent is required before clearing identity.',
        );
      }
      return identityManager.clear();
    },

    async stop(_reason: StopReason = 'manual') {
      if (state.state === 'destroyed') {
        return failure('DESTROYED', 'The SDK instance has been destroyed.');
      }
      if (state.state === 'starting' && startPromise) await startPromise;
      if (state.state !== 'recording' && state.state !== 'degraded') {
        return { ok: true, value: undefined };
      }
      activityTracker?.stop();
      activityTracker = undefined;
      if (segmentTimer !== undefined) clearInterval(segmentTimer);
      segmentTimer = undefined;
      sessionManager?.endRecording(_reason);
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
      activityTracker?.stop();
      if (segmentTimer !== undefined) clearInterval(segmentTimer);
      sessionManager?.destroy();
      state.transition('destroyed');
      return { ok: true, value: undefined };
    },
  };

  return Object.freeze(client);
}
