export type LifecycleState =
  | 'uninitialized'
  | 'configuring'
  | 'initialized'
  | 'authorized'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'degraded'
  | 'destroyed';

const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> =
  {
    uninitialized: ['configuring', 'initialized', 'destroyed'],
    configuring: ['uninitialized', 'initialized', 'destroyed'],
    initialized: ['authorized', 'destroyed'],
    authorized: ['initialized', 'starting', 'destroyed'],
    starting: ['authorized', 'recording', 'destroyed'],
    recording: ['stopping', 'degraded', 'destroyed'],
    stopping: ['authorized', 'initialized', 'destroyed'],
    degraded: ['authorized', 'destroyed'],
    destroyed: [],
  };

export class LifecycleStateMachine {
  private currentState: LifecycleState = 'uninitialized';

  get state(): LifecycleState {
    return this.currentState;
  }

  transition(next: LifecycleState): boolean {
    if (next === this.currentState) return true;
    if (!TRANSITIONS[this.currentState].includes(next)) return false;
    this.currentState = next;
    return true;
  }
}
