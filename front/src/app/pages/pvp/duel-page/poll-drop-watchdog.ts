import { POLL_DROP_REGRESSION_WATCHDOG_MS } from './animation-constants';

/**
 * State the watchdog re-reads at fire time to decide whether the stall is
 * real. Supplied by the orchestrator as a live snapshot getter.
 */
export interface PollDropWatchdogState {
  /** True when `chainPhase === 'resolving'`. */
  isResolving: boolean;
  /** Current animation queue length. */
  queueLen: number;
  /** True while the orchestrator's queue loop is animating. */
  isAnimating: boolean;
}

/**
 * POLL-DROP REGRESSION watchdog — extracted from `AnimationOrchestratorService`
 * so the arm / clear / pause / fire-decision logic is unit-testable without
 * standing up the whole orchestrator (which pulls ~14 injected deps).
 *
 * Context: the legacy chain-poll back-off was removed 2026-05-10 (see
 * CLAUDE.md "Polling Removal — Regression Surface"). This watchdog is the
 * safety net: armed at finalize-during-resolving, it fires after
 * `POLL_DROP_REGRESSION_WATCHDOG_MS` if the chain is still resolving with an
 * empty, non-animating queue — the pathological state the dropped poll would
 * have rescued.
 *
 * Pause-awareness: a resolving chain with an empty queue is EXPECTED while
 * replay auto-play is paused (the next link / MSG_CHAIN_END are in a
 * not-yet-loaded transition). `setPaused(true)` clears the timer and blocks
 * arming; `setPaused(false)` re-arms if still mid-resolution. PvP never
 * pauses, so `_paused` stays false there.
 *
 * Pure except for the `setTimeout` handle + the injected `onFire` callback —
 * the fire DECISION (`shouldFire`) is a static pure function, fully tested
 * in isolation.
 */
export class PollDropWatchdog {
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _paused = false;

  /**
   * @param readState  live snapshot getter, read at fire time.
   * @param onFire     invoked when a genuine stall is detected — the
   *                   orchestrator wires this to its console.error +
   *                   duelAssert. Not called for moot timers.
   * @param delayMs    timeout (overridable for tests).
   */
  constructor(
    private readonly readState: () => PollDropWatchdogState,
    private readonly onFire: () => void,
    private readonly delayMs: number = POLL_DROP_REGRESSION_WATCHDOG_MS,
  ) {}

  /** True while replay playback is paused (arming is suppressed). */
  get isPaused(): boolean {
    return this._paused;
  }

  /**
   * Pure fire-decision: given the state at timeout AND whether playback is
   * paused, should the watchdog surface the regression? A stall is real only
   * when the chain is still resolving, the queue is still empty, nothing is
   * animating, and playback is NOT paused.
   */
  static shouldFire(state: PollDropWatchdogState, paused: boolean): boolean {
    return state.isResolving
      && state.queueLen === 0
      && !state.isAnimating
      && !paused;
  }

  /**
   * Arm the watchdog (clearing any prior timer). No-op while paused — a
   * paused resolving chain is healthy, not stalled.
   */
  arm(): void {
    this.clear();
    if (this._paused) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (PollDropWatchdog.shouldFire(this.readState(), this._paused)) {
        this.onFire();
      }
    }, this.delayMs);
  }

  /** Cancel any pending timer. Idempotent. */
  clear(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Pause/resume notifier. On pause: clear the timer + block arming. On
   * resume: re-arm if the chain is still mid-resolution with an empty,
   * non-animating queue (a genuine stall then surfaces as before).
   * No-op when the flag is unchanged.
   */
  setPaused(paused: boolean): void {
    if (this._paused === paused) return;
    this._paused = paused;
    if (paused) {
      this.clear();
      return;
    }
    const s = this.readState();
    if (s.isResolving && s.queueLen === 0 && !s.isAnimating) {
      this.arm();
    }
  }

  /** True if a timer is currently pending (test/diagnostic helper). */
  get isArmed(): boolean {
    return this._timer !== null;
  }
}
