import {
  RecorderDatabase,
  requestResult,
  STORES,
  transactionDone,
} from './database';
import type { RecordingBatchContext } from '../pipeline/batcher';

const JOURNAL_WINDOW_MS = 1000;
const JOURNAL_EVENT_LIMIT = 20;

interface BufferedEvent {
  sequence: number;
  event: unknown;
}

export interface JournalChunk {
  key: string;
  appKey: string;
  recordingId: string;
  sequenceStart: number;
  sequenceEnd: number;
  events: unknown[];
  bytes: number;
  createdAt: number;
  context?: Readonly<RecordingBatchContext>;
  previousBatchHash?: string;
}

export interface JournalOptions {
  database: RecorderDatabase;
  appKey: string;
  recordingId: string;
  context?: () => Readonly<RecordingBatchContext> | undefined;
  previousBatchHash?: () => string | undefined;
  now?: () => number;
}

export class IndexedDbJournal {
  private readonly database: RecorderDatabase;
  private readonly appKey: string;
  private readonly recordingId: string;
  private readonly context?: () => Readonly<RecordingBatchContext> | undefined;
  private readonly previousBatchHash?: () => string | undefined;
  private readonly now: () => number;
  private buffer: BufferedEvent[] = [];
  private nextSequence = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<boolean> | undefined;

  constructor(options: JournalOptions) {
    this.database = options.database;
    this.appKey = options.appKey;
    this.recordingId = options.recordingId;
    this.context = options.context;
    this.previousBatchHash = options.previousBatchHash;
    this.now = options.now ?? Date.now;
  }

  get pendingCount(): number {
    return this.buffer.length;
  }

  async append(event: unknown): Promise<boolean> {
    this.buffer.push({ sequence: this.nextSequence, event });
    this.nextSequence += 1;
    if (this.buffer.length >= JOURNAL_EVENT_LIMIT) return this.flush();
    this.schedule();
    return true;
  }

  async flush(): Promise<boolean> {
    if (this.inFlight) {
      const inFlightSucceeded = await this.inFlight;
      if (!inFlightSucceeded) return false;
      return this.flush();
    }
    if (this.buffer.length === 0) return true;
    this.clearTimer();
    const pending = this.buffer;
    this.buffer = [];
    this.inFlight = this.writeChunk(pending)
      .then(() => true)
      .catch(() => {
        this.buffer = [...pending, ...this.buffer];
        return false;
      })
      .finally(() => {
        this.inFlight = undefined;
        if (this.buffer.length > 0) this.schedule();
      });
    return this.inFlight;
  }

  async waitForIdle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  async recover(): Promise<JournalChunk[]> {
    const records = await this.recoverAll();
    const chunks = records.filter(
      (chunk) => chunk.recordingId === this.recordingId,
    );
    const last = chunks.at(-1);
    if (last)
      this.nextSequence = Math.max(this.nextSequence, last.sequenceEnd + 1);
    return chunks;
  }

  async recoverAll(): Promise<JournalChunk[]> {
    const transaction = this.database.raw.transaction(
      STORES.journal,
      'readonly',
    );
    const completed = transactionDone(transaction);
    const records = (await requestResult(
      transaction
        .objectStore(STORES.journal)
        .index('byAppKey')
        .getAll(this.appKey),
    )) as JournalChunk[];
    await completed;
    records.sort(
      (left, right) =>
        left.createdAt - right.createdAt ||
        left.recordingId.localeCompare(right.recordingId) ||
        left.sequenceStart - right.sequenceStart,
    );
    return records;
  }

  bindLifecycle(target: EventTarget): () => void {
    const flush = () => void this.flush();
    target.addEventListener('pagehide', flush);
    target.addEventListener('visibilitychange', flush);
    return () => {
      target.removeEventListener('pagehide', flush);
      target.removeEventListener('visibilitychange', flush);
    };
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, JOURNAL_WINDOW_MS);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async writeChunk(events: readonly BufferedEvent[]): Promise<void> {
    const sequenceStart = events[0].sequence;
    const sequenceEnd = events.at(-1)?.sequence ?? sequenceStart;
    const payload = events.map(({ event }) => event);
    const chunk: JournalChunk = {
      key: `${this.appKey}:${this.recordingId}:${sequenceStart}`,
      appKey: this.appKey,
      recordingId: this.recordingId,
      sequenceStart,
      sequenceEnd,
      events: payload,
      bytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength,
      createdAt: this.now(),
      context: this.context?.(),
      previousBatchHash: this.previousBatchHash?.(),
    };
    const transaction = this.database.raw.transaction(
      STORES.journal,
      'readwrite',
    );
    const completed = transactionDone(transaction);
    transaction.objectStore(STORES.journal).put(chunk);
    await completed;
  }
}
