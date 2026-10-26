export type SDKErrorCode =
  | 'INVALID_CONFIG'
  | 'APP_KEY_ROUTE_UNSUPPORTED'
  | 'REMOTE_CONFIG_FAILED'
  | 'REMOTE_CONFIG_INVALID'
  | 'APPLICATION_DISABLED'
  | 'CONFIG_UNSUPPORTED_SAMPLING'
  | 'ALREADY_INITIALIZED_WITH_DIFFERENT_CONFIG'
  | 'CONSENT_REQUIRED'
  | 'INVALID_STATE'
  | 'IDENTITY_INVALID'
  | 'CUSTOM_EVENT_INVALID'
  | 'RECORDER_START_FAILED'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'PERSISTENCE_CAPACITY_EXCEEDED'
  | 'QUEUE_CAPACITY_EXCEEDED'
  | 'TRANSPORT_NOT_CONFIGURED'
  | 'TRANSPORT_FAILED'
  | 'RECEIPT_INVALID'
  | 'RECONCILIATION_FAILED'
  | 'DESTROYED';

export type SDKResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: { code: SDKErrorCode; message: string } };

export interface DeliveryStateSnapshot {
  state: 'idle' | 'sending' | 'backoff' | 'reconciling' | 'blocked';
  capacityLevel: 'normal' | 'warning' | 'critical' | 'full';
  pendingBatches: number;
  pendingBytes: number;
  lastErrorCode?: SDKErrorCode;
}

export interface DataInsightsOptions {
  appKey: string;
  transport: Transport;
  workerUrl?: string;
  onDeliveryStateChange?: (state: Readonly<DeliveryStateSnapshot>) => void;
  privacy?: {
    blockSelector?: string;
    maskTextSelector?: string;
    ignoreSelector?: string;
  };
  batching?: {
    maxEvents?: number;
    maxBytes?: number;
    flushIntervalMs?: number;
  };
  debug?: boolean;
}

export interface ResolvedApplicationConfig {
  readonly appKey: string;
  readonly enabled: true;
  readonly configVersion: string;
  readonly collectorUrls: readonly [string, ...string[]];
  readonly uploadToken: string;
  readonly expiresAt: string;
}

export interface RemoteConfigResolverOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  /** Internal SDK-script origin for private/local deployments; not a host integration option. */
  readonly trustedConfigOrigin?: string;
}

export interface DataInsightsBootstrapOptions {
  readonly appKey: string;
  readonly consent: {
    readonly startSelector: string;
    readonly noticeVersion: string;
  };
  readonly resolveUserId?: () =>
    | string
    | undefined
    | Promise<string | undefined>;
  readonly onDeliveryStateChange?: (
    state: Readonly<DeliveryStateSnapshot>,
  ) => void;
  readonly privacy?: DataInsightsOptions['privacy'];
  readonly debug?: boolean;
}

export interface ConsentEvidence {
  noticeVersion: string;
  action: 'start-insurance';
  grantedAt?: string;
}

export interface StartContext {
  userId?: string;
  journeyId?: string;
}

export interface RecordingContext {
  identityType: 'host' | 'anonymous';
  sessionId: string;
  recordingId: string;
  segmentId: string;
}

export type StopReason =
  | 'completed'
  | 'cancelled'
  | 'logout'
  | 'auth-expired'
  | 'consent-revoked'
  | 'idle-timeout'
  | 'manual'
  | 'capacity'
  | 'recorder-error';

export interface DebugInfo {
  state:
    | 'uninitialized'
    | 'configuring'
    | 'initialized'
    | 'authorized'
    | 'starting'
    | 'recording'
    | 'stopping'
    | 'degraded'
    | 'destroyed';
  readonly sdkVersion: string;
  readonly rrwebVersion: string;
  readonly rrwebCommit: string;
  readonly delivery: Readonly<DeliveryStateSnapshot>;
  readonly resourceCount: number;
  readonly hasHostIdentity: boolean;
  readonly workerFallback: boolean;
  readonly recentErrors: readonly Readonly<{ code: SDKErrorCode }>[];
}

export interface DataInsightsClient {
  init(options: DataInsightsOptions): SDKResult<DataInsightsClient>;
  bootstrap(
    options: DataInsightsBootstrapOptions,
  ): Promise<SDKResult<DataInsightsClient>>;
  consent: {
    grant(evidence: ConsentEvidence): SDKResult;
    revoke(): Promise<SDKResult>;
  };
  start(context?: StartContext): Promise<SDKResult<RecordingContext>>;
  identify(userId: string): SDKResult;
  clearIdentity(): SDKResult;
  addCustomEvent(name: string, data: unknown): SDKResult;
  stop(reason?: StopReason): Promise<SDKResult>;
  getDebugInfo(): Readonly<DebugInfo>;
  destroy(): Promise<SDKResult>;
}
import type { Transport } from '../transport/types';

export type {
  PersistedReceipt,
  PersistedReceiptTransport,
  ReconciliationResult,
  SequenceRange,
  TestTransport,
  Transport,
  TransportContext,
  TransportResult,
} from '../transport/types';
