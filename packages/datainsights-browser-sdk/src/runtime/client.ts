import { validateConfig } from '../config/config';
import { ConsentManager } from '../consent/consent-manager';
import { IdentityManager } from '../identity/identity-manager';
import { sanitizeCustomEvent } from '../events/custom-event';
import {
  openRecorderDatabase,
  type RecorderDatabase,
} from '../persistence/database';
import { IndexedDbJournal } from '../persistence/indexeddb-journal';
import { IndexedDbOutbox } from '../persistence/indexeddb-outbox';
import {
  OutboxDispatcher,
  type DispatchOutbox,
} from '../pipeline/outbox-dispatcher';
import type { RecordingBatchV1 } from '../pipeline/batcher';
import type {
  ConsentEvidence,
  DataInsightsClient,
  DataInsightsOptions,
  RecordingContext,
  SDKResult,
  StartContext,
  StopReason,
} from '../public/types';
import {
  startRrwebRecorder,
  type RecorderHandle,
} from '../recorder/rrweb-adapter';
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
  let recorder: RecorderHandle | undefined;
  let database: RecorderDatabase | undefined;
  let journal: IndexedDbJournal | undefined;
  let outboxDispatcher: OutboxDispatcher | undefined;
  let journalDisposers: Array<() => void> = [];

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
          const indexedDbFactory = globalThis.indexedDB;
          if (indexedDbFactory === undefined) {
            state.transition('authorized');
            return failure(
              'PERSISTENCE_UNAVAILABLE',
              'Durable browser storage is unavailable.',
            );
          }
          database ??= await openRecorderDatabase(indexedDbFactory);
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
          journal = new IndexedDbJournal({
            database,
            appKey: options?.appKey ?? '',
            recordingId: recordingContext.recordingId,
          });
          await journal.recover();
          const outbox = new IndexedDbOutbox(database, options?.appKey ?? '');
          const dispatchOutbox: DispatchOutbox = {
            list: async () =>
              (await outbox.list()) as unknown as readonly Readonly<RecordingBatchV1>[],
            remove: (batchId) => outbox.remove(batchId),
          };
          outboxDispatcher = new OutboxDispatcher({
            outbox: dispatchOutbox,
            transport: options?.transport as NonNullable<
              typeof options
            >['transport'],
            eventTarget:
              typeof globalThis.window === 'undefined'
                ? undefined
                : globalThis.window,
            onBlocked: (batch) => {
              if (recordingContext?.recordingId === batch.recordingId) {
                void client.stop('recorder-error');
              }
            },
          });
          outboxDispatcher.start();
          if (typeof globalThis.window !== 'undefined') {
            journalDisposers.push(journal.bindLifecycle(globalThis.window));
          }
          if (typeof globalThis.document !== 'undefined') {
            journalDisposers.push(journal.bindLifecycle(globalThis.document));
          }
          if (typeof globalThis.document !== 'undefined') {
            recorder = await startRrwebRecorder({
              emit: (event) => void journal?.append(event),
              privacy: options?.privacy,
            });
            if (!recorder.started) {
              outboxDispatcher.destroy();
              outboxDispatcher = undefined;
              recordingContext = undefined;
              state.transition('authorized');
              return failure(
                'RECORDER_START_FAILED',
                'The browser recorder could not be started.',
              );
            }
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
          outboxDispatcher?.destroy();
          outboxDispatcher = undefined;
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

    addCustomEvent(name: string, data: unknown) {
      if (state.state === 'destroyed') {
        return failure('DESTROYED', 'The SDK instance has been destroyed.');
      }
      if (state.state !== 'recording') {
        return failure(
          'CUSTOM_EVENT_INVALID',
          'Custom events require an active recording.',
        );
      }
      const sanitized = sanitizeCustomEvent(name, data);
      if (!sanitized.ok) return sanitized;
      recorder?.addCustomEvent(name, sanitized.value.data);
      activityTracker?.markActivity();
      return { ok: true, value: undefined };
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
      recorder?.stop();
      recorder = undefined;
      outboxDispatcher?.destroy();
      outboxDispatcher = undefined;
      await journal?.flush();
      for (const dispose of journalDisposers) dispose();
      journalDisposers = [];
      journal = undefined;
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
      recorder?.stop();
      outboxDispatcher?.destroy();
      outboxDispatcher = undefined;
      await journal?.flush();
      for (const dispose of journalDisposers) dispose();
      journalDisposers = [];
      journal = undefined;
      if (segmentTimer !== undefined) clearInterval(segmentTimer);
      sessionManager?.destroy();
      database?.close();
      database = undefined;
      state.transition('destroyed');
      return { ok: true, value: undefined };
    },
  };

  return Object.freeze(client);
}
