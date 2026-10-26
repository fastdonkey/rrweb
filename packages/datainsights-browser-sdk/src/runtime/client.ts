import { validateConfig } from '../config/config';
import { BUILD_INFO } from '../build-info';
import { ConsentManager } from '../consent/consent-manager';
import { DiagnosticsStore } from '../diagnostics/diagnostics';
import {
  IdentityManager,
  type ResolvedIdentity,
} from '../identity/identity-manager';
import { sanitizeCustomEvent } from '../events/custom-event';
import {
  openRecorderDatabase,
  type RecorderDatabase,
} from '../persistence/database';
import { probeRecorderDatabase } from '../persistence/capability';
import { IndexedDbJournal } from '../persistence/indexeddb-journal';
import { IndexedDbOutbox } from '../persistence/indexeddb-outbox';
import {
  OutboxDispatcher,
  type DispatchOutbox,
} from '../pipeline/outbox-dispatcher';
import {
  RecordingBatcher,
  type BatchReason,
  type RecordingBatchContext,
  type RecordingBatchV1,
} from '../pipeline/batcher';
import {
  createWorkerFirstSerializer,
  type WorkerFirstSerializer,
} from '../pipeline/serializer';
import { isUnconfiguredTransport } from '../transport/unconfigured';
import type {
  ConsentEvidence,
  DataInsightsBootstrapOptions,
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
import { ResourceRegistry } from './resource-registry';
import { installBootstrap } from './bootstrap';

const PERSISTENCE_CAPACITY_BYTES = 100 * 1024 * 1024;

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
    left.workerUrl === right.workerUrl &&
    left.onDeliveryStateChange === right.onDeliveryStateChange &&
    left.debug === right.debug &&
    JSON.stringify(left.privacy) === JSON.stringify(right.privacy) &&
    JSON.stringify(left.batching) === JSON.stringify(right.batching)
  );
}

function equivalentBootstrap(
  left: Readonly<DataInsightsBootstrapOptions>,
  right: Readonly<DataInsightsBootstrapOptions>,
): boolean {
  return (
    left.appKey === right.appKey &&
    left.consent.startSelector === right.consent.startSelector &&
    left.consent.noticeVersion === right.consent.noticeVersion &&
    left.resolveUserId === right.resolveUserId &&
    left.onDeliveryStateChange === right.onDeliveryStateChange &&
    left.debug === right.debug &&
    JSON.stringify(left.privacy) === JSON.stringify(right.privacy)
  );
}

export function createClient(): DataInsightsClient {
  const state = new LifecycleStateMachine();
  const consentManager = new ConsentManager();
  const resources = new ResourceRegistry();
  let diagnostics = new DiagnosticsStore();
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
  let outbox: IndexedDbOutbox | undefined;
  let outboxDispatcher: OutboxDispatcher | undefined;
  let activeIdentity: ResolvedIdentity | undefined;
  let activeJourneyId: string | undefined;
  const previousBatchHashes = new Map<string, string>();
  let pipelineTimer: ReturnType<typeof setInterval> | undefined;
  let drainPromise: Promise<boolean> | undefined;
  let serializer: WorkerFirstSerializer | undefined;
  let journalDisposers: Array<() => void> = [];
  let bootstrapOptions: Readonly<DataInsightsBootstrapOptions> | undefined;
  let bootstrapPromise: Promise<SDKResult<DataInsightsClient>> | undefined;
  let disposeBootstrap: (() => void) | undefined;

  function activeBatchContext(): RecordingBatchContext | undefined {
    const consent = consentManager.currentEvidence;
    if (
      !options ||
      !recordingContext ||
      !activeIdentity ||
      !consent?.grantedAt
    ) {
      return undefined;
    }
    return {
      ...BUILD_INFO,
      appKey: options.appKey,
      identity: activeIdentity,
      consent: {
        noticeVersion: consent.noticeVersion,
        action: consent.action,
        grantedAt: consent.grantedAt,
      },
      journeyId: activeJourneyId,
      sessionId: recordingContext.sessionId,
      recordingId: recordingContext.recordingId,
      segmentId: recordingContext.segmentId,
    };
  }

  function drainJournal(reason: BatchReason): Promise<boolean> {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      if (
        !journal ||
        !outbox ||
        !outboxDispatcher ||
        !recordingContext ||
        !activeIdentity ||
        !options
      ) {
        return false;
      }
      const chunks = await journal.recoverAll();
      if (chunks.length === 0) return true;
      const pendingOutbox = await outbox.list();
      const groups = new Map<string, typeof chunks>();
      for (const chunk of chunks) {
        const group = groups.get(chunk.recordingId) ?? [];
        group.push(chunk);
        groups.set(chunk.recordingId, group);
      }
      const sealed = [];
      const nextBatchHashes = new Map<string, string>();
      for (const [recordingId, recordingChunks] of groups) {
        const context =
          recordingChunks[0].context ??
          (recordingId === recordingContext.recordingId
            ? activeBatchContext()
            : undefined);
        if (!context) return false;
        const previousOutboxBatch = pendingOutbox
          .filter((batch) => batch.recordingId === recordingId)
          .sort((left, right) => right.sequenceEnd - left.sequenceEnd)[0];
        let batchIndex = 0;
        const batcher = new RecordingBatcher(context, {
          ...options.batching,
          initialSequence: recordingChunks[0].sequenceStart,
          previousBatchHash:
            recordingChunks[0].previousBatchHash ??
            previousBatchHashes.get(recordingId) ??
            (typeof previousOutboxBatch?.contentHash === 'string'
              ? previousOutboxBatch.contentHash
              : undefined),
          now: () => recordingChunks[0].createdAt,
          createBatchId: () =>
            `${recordingId}:${
              recordingChunks[0].sequenceStart
            }:${++batchIndex}`,
          serialize: (value) =>
            serializer?.serialize(value) ??
            Promise.reject(new Error('Serializer unavailable.')),
        });
        const recordingSealed = [];
        for (const chunk of recordingChunks) {
          for (const event of chunk.events) {
            recordingSealed.push(...(await batcher.add(event)));
          }
        }
        const tail = await batcher.flush(
          reason === 'count' || reason === 'bytes' ? 'manual' : reason,
        );
        if (tail) recordingSealed.push(tail);
        batcher.destroy();
        const lastHash = recordingSealed.at(-1)?.batch.contentHash;
        if (lastHash) nextBatchHashes.set(recordingId, lastHash);
        sealed.push(...recordingSealed);
      }
      if (sealed.length === 0) return true;
      const stored = await outbox.enqueueManyFromJournal(
        sealed.map(({ batch, serialized }) => ({
          ...batch,
          events: [...batch.events],
          bytes: serialized.bytes.byteLength,
        })),
        chunks.map(({ key }) => key),
      );
      if (!stored) return false;
      for (const [recordingId, hash] of nextBatchHashes) {
        previousBatchHashes.set(recordingId, hash);
      }
      const firstDispatch = await outboxDispatcher.dispatch('manual');
      let pending = await outbox.list();
      // A startup dispatch can still be reading an empty Outbox while the
      // first recording batch is committed. Run once more after that flight
      // completes so stop/flush cannot strand a newly durable batch.
      if (firstDispatch.state === 'idle' && pending.length > 0) {
        await outboxDispatcher.dispatch('manual');
        pending = await outbox.list();
      }
      diagnostics.updatePending(
        pending.length,
        pending.reduce((total, batch) => total + batch.bytes, 0),
      );
      return true;
    })().finally(() => {
      drainPromise = undefined;
    });
    return drainPromise;
  }

  async function releasePreparedRecording(): Promise<void> {
    outboxDispatcher?.destroy();
    outboxDispatcher = undefined;
    recorder?.stop();
    recorder = undefined;
    await resources.disposeAll();
    journalDisposers = [];
    journal = undefined;
    outbox = undefined;
    serializer?.destroy();
    serializer = undefined;
    activityTracker = undefined;
    if (segmentTimer !== undefined) clearInterval(segmentTimer);
    segmentTimer = undefined;
    if (pipelineTimer !== undefined) clearInterval(pipelineTimer);
    pipelineTimer = undefined;
    sessionManager?.endRecording('recorder-error');
    recordingContext = undefined;
    activeIdentity = undefined;
    activeJourneyId = undefined;
  }

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
      diagnostics = new DiagnosticsStore(
        validation.value.onDeliveryStateChange,
      );
      identityManager = new IdentityManager(validation.value.appKey);
      sessionManager = new SessionManager(validation.value.appKey);
      state.transition('initialized');
      return { ok: true, value: client };
    },

    bootstrap(candidate) {
      if (state.state === 'destroyed') {
        return Promise.resolve(
          failure('DESTROYED', 'The SDK instance has been destroyed.'),
        );
      }
      if (bootstrapOptions) {
        return Promise.resolve(
          equivalentBootstrap(bootstrapOptions, candidate)
            ? { ok: true, value: client }
            : failure(
                'ALREADY_INITIALIZED_WITH_DIFFERENT_CONFIG',
                'The SDK is already initialized with different configuration.',
              ),
        );
      }
      if (bootstrapPromise) return bootstrapPromise;
      if (state.state !== 'uninitialized') {
        return Promise.resolve(
          failure(
            'ALREADY_INITIALIZED_WITH_DIFFERENT_CONFIG',
            'The SDK is already initialized through the advanced API.',
          ),
        );
      }
      state.transition('configuring');
      bootstrapPromise = installBootstrap(client, candidate, {
        recordError: (code) => diagnostics.recordError(code),
      })
        .then((installed): SDKResult<DataInsightsClient> => {
          if (!installed.ok) {
            state.transition('uninitialized');
            return installed;
          }
          bootstrapOptions = Object.freeze(candidate);
          disposeBootstrap = installed.value.dispose;
          return { ok: true, value: client };
        })
        .catch(() => {
          state.transition('uninitialized');
          return failure(
            'REMOTE_CONFIG_FAILED',
            'The application configuration could not be prepared.',
          );
        })
        .finally(() => {
          bootstrapPromise = undefined;
        });
      return bootstrapPromise;
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
      if (isUnconfiguredTransport(options?.transport)) {
        return Promise.resolve(
          failure(
            'TRANSPORT_NOT_CONFIGURED',
            'A delivery Transport must be configured before recording.',
          ),
        );
      }

      state.transition('starting');
      startPromise = (async () => {
        let persistencePassed = false;
        try {
          await Promise.resolve();
          const indexedDbFactory = globalThis.indexedDB;
          if (indexedDbFactory === undefined) {
            diagnostics.updatePersistence({
              available: false,
              persisted: 'unsupported',
            });
            diagnostics.recordError('PERSISTENCE_UNAVAILABLE');
            state.transition('authorized');
            return failure(
              'PERSISTENCE_UNAVAILABLE',
              'Durable browser storage is unavailable.',
            );
          }
          database ??= await openRecorderDatabase(indexedDbFactory);
          const persistence = await probeRecorderDatabase(
            database,
            typeof navigator === 'undefined' ? undefined : navigator.storage,
          );
          if (!persistence.ok) {
            diagnostics.updatePersistence({
              available: false,
              persisted: 'unsupported',
            });
            diagnostics.recordError('PERSISTENCE_UNAVAILABLE');
            database.close();
            database = undefined;
            state.transition('authorized');
            return persistence;
          }
          diagnostics.updatePersistence(persistence.value);
          persistencePassed = true;
          const identity = identityManager?.resolve(context?.userId);
          if (!identity?.ok) {
            state.transition('authorized');
            return (
              identity ??
              failure('IDENTITY_INVALID', 'Identity could not be resolved.')
            );
          }
          activeIdentity = identity.value;
          activeJourneyId = context?.journeyId;
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
            context: activeBatchContext,
            previousBatchHash: () =>
              recordingContext
                ? previousBatchHashes.get(recordingContext.recordingId)
                : undefined,
          });
          const recoveredJournal = await journal.recoverAll();
          outbox = new IndexedDbOutbox(database, options?.appKey ?? '');
          const pendingOutbox = await outbox.list();
          const pendingBytes =
            recoveredJournal.reduce((total, chunk) => total + chunk.bytes, 0) +
            pendingOutbox.reduce((total, batch) => total + batch.bytes, 0);
          diagnostics.updatePending(pendingOutbox.length, pendingBytes);
          diagnostics.updateCapacity(pendingBytes, PERSISTENCE_CAPACITY_BYTES);
          if (diagnostics.delivery.capacityLevel === 'full') {
            diagnostics.recordError('PERSISTENCE_CAPACITY_EXCEEDED');
            sessionManager?.endRecording('capacity');
            journal = undefined;
            outbox = undefined;
            recordingContext = undefined;
            state.transition('authorized');
            return failure(
              'PERSISTENCE_CAPACITY_EXCEEDED',
              'Durable recording capacity is full.',
            );
          }
          const dispatchOutbox: DispatchOutbox = {
            list: async () =>
              ((await outbox?.list()) ?? []).map(
                ({ key: _key, bytes: _bytes, ...batch }) =>
                  batch as unknown as Readonly<RecordingBatchV1>,
              ),
            remove: (batchId) => outbox!.remove(batchId),
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
          // Finish the startup Outbox scan before rrweb can create the first
          // new batch. This prevents a later stop/flush from joining an
          // earlier empty scan and leaving the first durable batch stranded.
          await outboxDispatcher.dispatch('startup');
          const activeDispatcher = outboxDispatcher;
          resources.add(() => activeDispatcher.destroy());
          serializer = createWorkerFirstSerializer(options?.workerUrl);
          const activeSerializer = serializer;
          resources.add(() => activeSerializer.destroy());
          void drainJournal('manual').catch(() => undefined);
          if (typeof globalThis.window !== 'undefined') {
            const dispose = journal.bindLifecycle(globalThis.window);
            journalDisposers.push(dispose);
            resources.add(dispose);
          }
          if (typeof globalThis.document !== 'undefined') {
            const dispose = journal.bindLifecycle(globalThis.document);
            journalDisposers.push(dispose);
            resources.add(dispose);
          }
          if (typeof globalThis.document !== 'undefined') {
            recorder = await startRrwebRecorder({
              emit: (event) => void journal?.append(event),
              privacy: options?.privacy,
            });
            if (!recorder.started) {
              await releasePreparedRecording();
              state.transition('authorized');
              return failure(
                'RECORDER_START_FAILED',
                'The browser recorder could not be started.',
              );
            }
            const activeRecorder = recorder;
            resources.add(() => activeRecorder.stop());
          }
          state.transition('recording');
          activityTracker = new ActivityTracker(
            () => sessionManager?.recordActivity(),
            () => void client.stop('idle-timeout'),
          );
          activityTracker.start();
          const activeTracker = activityTracker;
          resources.add(() => activeTracker.stop());
          segmentTimer = setInterval(() => {
            void (async () => {
              await journal?.flush();
              await drainJournal('segment');
              if (recordingContext) {
                recordingContext =
                  sessionManager?.rotateSegment(recordingContext);
                recorder?.takeFullSnapshot();
              }
            })();
          }, 30 * 60 * 1000);
          const activeSegmentTimer = segmentTimer;
          resources.add(() => clearInterval(activeSegmentTimer));
          pipelineTimer = setInterval(() => {
            void journal
              ?.flush()
              .then(() => drainJournal('interval'))
              .catch(() => undefined);
          }, options?.batching?.flushIntervalMs ?? 5_000);
          const activePipelineTimer = pipelineTimer;
          resources.add(() => clearInterval(activePipelineTimer));
          return { ok: true, value: recordingContext };
        } catch {
          await releasePreparedRecording();
          if (!persistencePassed) {
            diagnostics.updatePersistence({
              available: false,
              persisted: 'unsupported',
            });
          }
          diagnostics.recordError('PERSISTENCE_UNAVAILABLE');
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
      if (pipelineTimer !== undefined) clearInterval(pipelineTimer);
      pipelineTimer = undefined;
      if (segmentTimer !== undefined) clearInterval(segmentTimer);
      segmentTimer = undefined;
      recorder?.stop();
      recorder = undefined;
      await journal?.flush();
      let drained = await drainJournal('stop');
      if (outbox && outboxDispatcher) {
        let pendingAtStop = await outbox.list();
        if (pendingAtStop.length > 0) {
          const finalDispatch = await outboxDispatcher.dispatch('manual');
          pendingAtStop = await outbox.list();
          drained =
            drained &&
            finalDispatch.state === 'idle' &&
            pendingAtStop.length === 0;
          diagnostics.updatePending(
            pendingAtStop.length,
            pendingAtStop.reduce((total, batch) => total + batch.bytes, 0),
          );
        }
      }
      outboxDispatcher?.destroy();
      outboxDispatcher = undefined;
      for (const dispose of journalDisposers) dispose();
      journalDisposers = [];
      journal = undefined;
      outbox = undefined;
      serializer?.destroy();
      serializer = undefined;
      await resources.disposeAll();
      sessionManager?.endRecording(_reason);
      recordingContext = undefined;
      activeIdentity = undefined;
      activeJourneyId = undefined;
      if (state.state === 'recording') {
        state.transition('stopping');
        state.transition('authorized');
      } else {
        state.transition('authorized');
      }
      if (!drained) {
        diagnostics.recordError('PERSISTENCE_WRITE_FAILED');
        return failure(
          'PERSISTENCE_WRITE_FAILED',
          'Recorded events could not be moved into the durable Outbox.',
        );
      }
      return { ok: true, value: undefined };
    },

    getDebugInfo() {
      return diagnostics.snapshot({
        lifecycleState: state.state,
        resourceCount: resources.count,
        hasHostIdentity: recordingContext?.identityType === 'host',
        workerFallback: serializer?.usingFallback,
      });
    },

    async destroy() {
      if (state.state === 'destroyed') {
        return { ok: true, value: undefined };
      }
      if (state.state === 'recording' || state.state === 'starting') {
        await client.stop();
      }
      disposeBootstrap?.();
      disposeBootstrap = undefined;
      activityTracker?.stop();
      recorder?.stop();
      outboxDispatcher?.destroy();
      outboxDispatcher = undefined;
      await journal?.flush();
      for (const dispose of journalDisposers) dispose();
      journalDisposers = [];
      journal = undefined;
      if (segmentTimer !== undefined) clearInterval(segmentTimer);
      if (pipelineTimer !== undefined) clearInterval(pipelineTimer);
      await resources.disposeAll();
      sessionManager?.destroy();
      database?.close();
      database = undefined;
      outbox = undefined;
      serializer?.destroy();
      serializer = undefined;
      state.transition('destroyed');
      return { ok: true, value: undefined };
    },
  };

  return Object.freeze(client);
}
