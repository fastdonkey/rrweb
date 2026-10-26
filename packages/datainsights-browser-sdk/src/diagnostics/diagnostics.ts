import type {
  DebugInfo,
  DeliveryStateSnapshot,
  SDKErrorCode,
} from '../public/types';

const MAX_RECENT_ERRORS = 20;

export type DeliveryStateCallback = (
  state: Readonly<DeliveryStateSnapshot>,
) => void;

function capacityLevel(
  usedBytes: number,
  maximumBytes: number,
): DeliveryStateSnapshot['capacityLevel'] {
  if (maximumBytes <= 0 || usedBytes >= maximumBytes) return 'full';
  const ratio = usedBytes / maximumBytes;
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.7) return 'warning';
  return 'normal';
}

export class DiagnosticsStore {
  private deliveryState: DeliveryStateSnapshot = Object.freeze({
    state: 'idle',
    capacityLevel: 'normal',
    pendingBatches: 0,
    pendingBytes: 0,
  });
  private readonly errors: Array<{ readonly code: SDKErrorCode }> = [];

  constructor(private readonly callback?: DeliveryStateCallback) {}

  get delivery(): Readonly<DeliveryStateSnapshot> {
    return this.deliveryState;
  }

  updateCapacity(usedBytes: number, maximumBytes: number): void {
    this.updateDelivery({
      capacityLevel: capacityLevel(usedBytes, maximumBytes),
      pendingBytes: Math.max(0, usedBytes),
    });
  }

  updatePending(pendingBatches: number, pendingBytes: number): void {
    this.updateDelivery({
      pendingBatches: Math.max(0, Math.trunc(pendingBatches)),
      pendingBytes: Math.max(0, pendingBytes),
    });
  }

  updateDelivery(patch: Partial<Readonly<DeliveryStateSnapshot>>): void {
    this.deliveryState = Object.freeze({ ...this.deliveryState, ...patch });
    try {
      this.callback?.(this.deliveryState);
    } catch (_error) {
      return;
    }
  }

  recordError(code: SDKErrorCode, _unsafeDetails?: unknown): void {
    this.errors.push(Object.freeze({ code }));
    if (this.errors.length > MAX_RECENT_ERRORS) this.errors.shift();
    this.updateDelivery({ lastErrorCode: code });
  }

  snapshot(input: {
    readonly lifecycleState: DebugInfo['state'];
    readonly resourceCount: number;
    readonly hasHostIdentity: boolean;
    readonly workerFallback?: boolean;
  }): Readonly<DebugInfo> {
    return Object.freeze({
      state: input.lifecycleState,
      delivery: this.deliveryState,
      resourceCount: input.resourceCount,
      hasHostIdentity: input.hasHostIdentity,
      workerFallback: input.workerFallback ?? false,
      recentErrors: Object.freeze([...this.errors]),
    });
  }
}
