export type SDKErrorCode =
  | 'INVALID_CONFIG'
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

export interface Transport {
  readonly name: string;
  readonly capability: 'test-only' | 'persisted-receipt-v1';
  send(batch: unknown, context: unknown): Promise<unknown>;
}

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

export interface DataInsightsClient {
  init(options: DataInsightsOptions): SDKResult<DataInsightsClient>;
}
