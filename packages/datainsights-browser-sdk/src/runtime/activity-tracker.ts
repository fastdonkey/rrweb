const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVITY_EVENTS = [
  'click',
  'pointerdown',
  'touchstart',
  'keydown',
  'input',
  'change',
  'scroll',
  'popstate',
  'hashchange',
] as const;

export class ActivityTracker {
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private active = false;

  constructor(
    private readonly onActivity: () => void,
    private readonly onIdle: () => void,
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    if (typeof globalThis.window !== 'undefined') {
      for (const eventName of ACTIVITY_EVENTS) {
        globalThis.window.addEventListener(eventName, this.handleActivity, {
          capture: true,
          passive: true,
        });
      }
    }
    this.resetTimer();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (typeof globalThis.window !== 'undefined') {
      for (const eventName of ACTIVITY_EVENTS) {
        globalThis.window.removeEventListener(eventName, this.handleActivity, {
          capture: true,
        });
      }
    }
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  markActivity(): void {
    if (!this.active) return;
    this.onActivity();
    this.resetTimer();
  }

  private readonly handleActivity = (): void => {
    this.markActivity();
  };

  private resetTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.active) return;
      this.active = false;
      this.onIdle();
    }, INACTIVITY_TIMEOUT_MS);
  }
}
