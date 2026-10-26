import { generateUuid } from '../shared/uuid';

interface ClaimMessage {
  type: 'claim' | 'held';
  sessionId: string;
  pageInstanceId: string;
}

const CLAIM_WINDOW_MS = 25;

function isClaimMessage(value: unknown): value is ClaimMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ClaimMessage>;
  return (
    (candidate.type === 'claim' || candidate.type === 'held') &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.pageInstanceId === 'string'
  );
}

export class TabClaim {
  private readonly pageInstanceId = generateUuid();
  private channel: BroadcastChannel | undefined;
  private heldSessionId: string | undefined;

  constructor(private readonly appKey: string) {}

  async claim(sessionId: string): Promise<boolean> {
    const channel = this.ensureChannel();
    if (!channel) return false;

    let conflict = false;
    const detectConflict = (event: MessageEvent<unknown>) => {
      if (
        isClaimMessage(event.data) &&
        event.data.type === 'held' &&
        event.data.sessionId === sessionId &&
        event.data.pageInstanceId !== this.pageInstanceId
      ) {
        conflict = true;
      }
    };
    channel.addEventListener('message', detectConflict);
    channel.postMessage({
      type: 'claim',
      sessionId,
      pageInstanceId: this.pageInstanceId,
    } satisfies ClaimMessage);
    await new Promise<void>((resolve) => setTimeout(resolve, CLAIM_WINDOW_MS));
    channel.removeEventListener('message', detectConflict);
    return !conflict;
  }

  hold(sessionId: string): void {
    this.heldSessionId = sessionId;
    this.ensureChannel();
  }

  close(): void {
    this.channel?.close();
    this.channel = undefined;
    this.heldSessionId = undefined;
  }

  private ensureChannel(): BroadcastChannel | undefined {
    if (this.channel) return this.channel;
    if (typeof globalThis.BroadcastChannel !== 'function') return undefined;
    const channel = new globalThis.BroadcastChannel(
      `di:v1:${this.appKey}:session-claim`,
    );
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (
        isClaimMessage(event.data) &&
        event.data.type === 'claim' &&
        event.data.sessionId === this.heldSessionId &&
        event.data.pageInstanceId !== this.pageInstanceId
      ) {
        channel.postMessage({
          type: 'held',
          sessionId: event.data.sessionId,
          pageInstanceId: this.pageInstanceId,
        } satisfies ClaimMessage);
      }
    });
    this.channel = channel;
    return channel;
  }
}
