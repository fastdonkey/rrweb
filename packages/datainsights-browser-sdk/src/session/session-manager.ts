import type { RecordingContext, StopReason } from '../public/types';
import { generateUuid } from '../shared/uuid';
import { TabClaim } from './tab-claim';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const END_SESSION_REASONS = new Set<StopReason>([
  'completed',
  'cancelled',
  'logout',
  'auth-expired',
  'consent-revoked',
  'idle-timeout',
]);

interface PersistedSession {
  traceId?: string;
  sessionId: string;
  lastActivityAt: number;
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedSession>;
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.lastActivityAt === 'number' &&
    (candidate.traceId === undefined ||
      (typeof candidate.traceId === 'string' &&
        UUID_V4_PATTERN.test(candidate.traceId)))
  );
}

export class SessionManager {
  private readonly storageKey: string;
  private readonly claim: TabClaim;
  private session: PersistedSession | undefined;
  isNewTrace = false;

  constructor(
    appKey: string,
    private readonly now: () => number = Date.now,
    private readonly getStorage: () => Pick<
      Storage,
      'getItem' | 'setItem' | 'removeItem'
    > = () => globalThis.sessionStorage,
  ) {
    this.storageKey = `di:v1:${appKey}:session`;
    this.claim = new TabClaim(appKey);
  }

  async startRecording(
    identityType: RecordingContext['identityType'],
  ): Promise<RecordingContext> {
    const timestamp = this.now();
    this.isNewTrace = false;
    if (!this.session || this.isExpired(this.session, timestamp)) {
      const restored = await this.restore(timestamp);
      this.isNewTrace = !restored;
      this.session = restored ?? {
        traceId: generateUuid(),
        sessionId: generateUuid(),
        lastActivityAt: timestamp,
      };
    }
    if (!this.session.traceId) {
      this.session.traceId = generateUuid();
      this.isNewTrace = true;
    }
    this.session.lastActivityAt = timestamp;
    this.claim.hold(this.session.sessionId);
    this.persist();
    return {
      identityType,
      traceId: this.session.traceId,
      sessionId: this.session.sessionId,
      recordingId: generateUuid(),
      segmentId: generateUuid(),
    };
  }

  recordActivity(): void {
    if (!this.session) return;
    this.session.lastActivityAt = this.now();
    this.persist();
  }

  rotateSegment(context: RecordingContext): RecordingContext {
    return { ...context, segmentId: generateUuid() };
  }

  endRecording(reason: StopReason): void {
    if (END_SESSION_REASONS.has(reason)) {
      this.session = undefined;
      this.claim.close();
      try {
        this.getStorage().removeItem(this.storageKey);
      } catch {
        // Session continuity degrades to a new Session when storage fails.
      }
      return;
    }
    this.recordActivity();
  }

  destroy(): void {
    this.claim.close();
  }

  private isExpired(session: PersistedSession, timestamp: number): boolean {
    return timestamp - session.lastActivityAt >= INACTIVITY_TIMEOUT_MS;
  }

  private async restore(
    timestamp: number,
  ): Promise<PersistedSession | undefined> {
    try {
      const raw = this.getStorage().getItem(this.storageKey);
      if (!raw) return undefined;
      const candidate: unknown = JSON.parse(raw);
      if (
        !isPersistedSession(candidate) ||
        this.isExpired(candidate, timestamp)
      ) {
        return undefined;
      }
      return (await this.claim.claim(candidate.sessionId))
        ? candidate
        : undefined;
    } catch {
      return undefined;
    }
  }

  private persist(): void {
    if (!this.session) return;
    try {
      this.getStorage().setItem(this.storageKey, JSON.stringify(this.session));
    } catch {
      // Recording continues with in-memory Session state.
    }
  }
}
