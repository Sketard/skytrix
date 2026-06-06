import { Injectable, signal, type Signal } from '@angular/core';
import type { MockDuelConnection } from './mock-duel-connection';
import type { PhaseAnnouncementService } from '../duel-page/phase-announcement.service';
import type { PreComputedState, TurnMeta } from '../replay-ws.types';

/**
 * Replay playback transport — owns the player-controlled state machine
 * (`currentIndex`, `isPlaying`, `pausedAtBoundary`) and the auto-play
 * scheduler (single setTimeout slot, scheduleNext / schedulePromptDismiss).
 *
 * Extracted from `replay-page.component.ts` (audit M10): the component
 * was pushing 250+ LOC of transport bookkeeping intermixed with view
 * computeds + 8 reactive effects. The transport service makes the
 * playback contract testable in isolation (no DOM dependencies) and
 * keeps the component focused on view + lifecycle wiring.
 *
 * The service is component-scoped (provided in `replay-page.component`).
 * It is configured at the component constructor via {@link configure}
 * with the dependencies it needs (mock handle, phase service for the
 * auto-advance guard, and the upstream signals `boardStates` /
 * `computedUpTo` / `animationsEnabled` / `promptMode` read at fire time
 * so changes flow through naturally).
 *
 * Cross-cutting cleanup of orchestrator/phase on user-driven
 * interruptions stays in the component as `abortAndClean()` — the
 * transport service does NOT touch the orchestrator or phase service
 * itself, except to read `phaseService.announcement()` for the
 * auto-play guard. The component is expected to call `abortAndClean()`
 * BEFORE invoking `seek/scrub/stepBack/skipStart/skipEnd/togglePerspective`.
 *
 * v4 Phase 5 (2026-06-05) — the legacy `ReplayDuelAdapter` was retired
 * and its surfaces (`busy`, `activePrompt`, `feedTransition`, `jumpToState`,
 * `abort`, `resumeAfterPrompt`) all migrated to `MockDuelConnection`.
 * The transport now pilots ONLY the mock ; the auto-play loop pumps
 * `mockConn.dispatchNext()` until reaching the next nav offset, and
 * seek/scrub/skip use `mockConn.seekToOffset(index)` directly.
 */

interface ReplayTransportConfig {
  mockConn: MockDuelConnection;
  phaseService: PhaseAnnouncementService;
  boardStates: Signal<PreComputedState[]>;
  computedUpTo: Signal<number>;
  animationsEnabled: Signal<boolean>;
  promptMode: Signal<'result' | 'decision'>;
  /**
   * Chain-overlay activity gate (F1, 2026-06-03). When `true`, the chain
   * overlay is mid-animation (entry swoop / pulse / exit) and the replay
   * scheduler must NOT call `schedulePromptDismiss` yet — otherwise the
   * auto-dismiss window starts ticking against an invisible prompt that
   * is hidden by the overlay-gate of `pvp-prompt-dialog` (Approach A).
   *
   * Wired by the component to `chainOverlay.overlayActive()`. PvP has no
   * equivalent — its scheduler doesn't auto-dismiss prompts (the player
   * clicks). Cf. chat 2026-06-03.
   */
  overlayActive: Signal<boolean>;
}

const PLAYBACK_INTERVAL = 500;
/**
 * v4 Phase 5 (2026-06-05) — fixed prompt auto-dismiss delay. Replaces
 * the legacy `lastResponseTimestamp`-based `min(max(delta * 0.6, MIN), MAX)`
 * calculation that read `adapter.activeTimestamp`. The doctrine acted
 * for Phase 4 (spec maître Décision 1) : human timing is replaced by a
 * fixed delay scaled by `playbackSpeed`. 1200ms is the "average human
 * read time for a modal prompt" baseline ; tunable via Preferences in
 * a later phase.
 */
const REPLAY_PROMPT_DELAY_MS = 1200;

@Injectable()
export class ReplayTransportService {
  /** Index of the currently displayed precomputed state. */
  readonly currentIndex = signal<number>(0);
  /** True when auto-play is active (driven by `togglePlay` / `startPlayback`). */
  readonly isPlaying = signal(false);
  /** True when auto-play has paused itself because we caught up to `computedUpTo`. */
  readonly pausedAtBoundary = signal(false);

  private playbackTimer: ReturnType<typeof setTimeout> | null = null;

  private cfg: ReplayTransportConfig | null = null;

  configure(config: ReplayTransportConfig): void {
    this.cfg = config;
  }

  private getCfg(): ReplayTransportConfig {
    if (!this.cfg) throw new Error('ReplayTransportService: configure() not called');
    return this.cfg;
  }

  // =============================================================================
  // Public transport controls
  // =============================================================================

  /** Pause playback + jump to `index` (clamped to 0 on the low end). Shared
   *  by every imperative seek; bounds-check on the *high* end is enforced by
   *  the caller (out-of-range index simply leaves the rendered state at the
   *  last known step). */
  private jumpTo(index: number): void {
    this.pausePlayback();
    if (index < 0) return;
    this.currentIndex.set(index);
    // v4 Phase 5 (2026-06-05) — `seekToOffset` reads the nav entry's
    // embedded `boardStateSnapshot` + `chainSnapshot` and restores via
    // the SHARED `chainingMsgsToLinkStates` / `processor.restoreChainState`
    // helpers — same restore path as the PvP `CHAIN_STATE` reconnect
    // handshake. No-op when no nav entry exists for `index` (stream not
    // loaded yet, or `index` out of the precomputed navIndex range — the
    // mock logs and returns).
    this.getCfg().mockConn.seekToOffset(index);
  }

  seek(index: number): void  { this.jumpTo(index); }
  scrub(index: number): void { this.jumpTo(index); }

  stepForward(): void {
    this.pausePlayback();
    this.doStepForward();
  }

  stepBack(): void {
    this.jumpTo(this.currentIndex() - 1);
  }

  togglePlay(): void {
    if (this.isPlaying()) {
      this.pausePlayback();
      this.pausedAtBoundary.set(false);
    } else {
      if (this.atEnd()) return;
      this.startPlayback();
    }
  }

  skipStart(): void {
    this.jumpTo(0);
  }

  skipEnd(): void {
    this.jumpTo(this.getCfg().computedUpTo());
  }

  /**
   * Jump to the start of a specific turn (used by the mobile stepper picker — F2).
   * Refuses on out-of-bounds indexes or when the target turn's startIndex hasn't
   * been pre-computed yet. Otherwise delegates to {@link seek} which handles
   * pausing playback + jumpToState.
   *
   * The caller is expected to have already invoked `abortAndClean()` before
   * (same contract as the other transport ops — see class header).
   */
  seekToTurn(turnIndex: number, turns: readonly TurnMeta[]): void {
    const turn = turns[turnIndex];
    if (!turn) return;
    if (turn.startIndex > this.getCfg().computedUpTo()) return;
    this.seek(turn.startIndex);
  }

  /**
   * Stop playback + clear the timer without flipping `pausedAtBoundary`.
   * Used by `onTogglePerspective` and `onToggleAnimations` which need to
   * resume auto-play themselves after the side-effect.
   */
  haltPlaybackTimer(): void {
    this.clearPlaybackTimer();
  }

  /**
   * Restart from the current index (used when toggling animations while
   * isPlaying is already true).
   */
  restart(): void {
    this.pausePlayback();
    this.startPlayback();
  }

  /**
   * Auto-play step requested by the component effect that watches
   * `mockConn.busy() / mockConn.pendingPrompt() / phaseService.announcement()`.
   * Decides between scheduling a prompt-dismiss timeout or stepping forward.
   * No-op if not currently playing.
   */
  maybeAdvance(): void {
    if (!this.isPlaying()) return;
    const c = this.getCfg();

    // F1 (2026-06-03) — chain overlay mid-animation. The prompt-dialog
    // gates its `dialogState=open` on this same signal (Approach A), so
    // calling `schedulePromptDismiss` now would start the auto-dismiss
    // timer against a prompt that the user cannot see yet. Bail — the
    // component effect that drives `maybeAdvance` re-fires when
    // `overlayActive` flips back to false, and we land here again with
    // the gate clear.
    if (c.overlayActive()) return;

    // Decision prompt appeared → auto-dismiss after fixed delay
    if (c.mockConn.pendingPrompt()) {
      this.schedulePromptDismiss();
      return;
    }

    // Phase announcement still playing → wait for it to finish.
    if (c.phaseService.announcement()) return;

    // Transition complete (busy went false) → schedule next step
    if (!c.mockConn.busy()) {
      this.scheduleNext();
    }
  }

  /**
   * Auto-resume hook called by the component when `computedUpTo` increases
   * past `currentIndex` while `pausedAtBoundary` is true (more states arrived
   * after we caught up). Returns true if playback was resumed.
   */
  resumeIfBoundaryWaiting(): boolean {
    if (!this.pausedAtBoundary()) return false;
    if (this.getCfg().computedUpTo() <= this.currentIndex()) return false;
    this.startPlayback();
    this.pausedAtBoundary.set(false);
    return true;
  }

  /** Tear down the playback timer — called from the component's ngOnDestroy. */
  destroy(): void {
    this.clearPlaybackTimer();
  }

  /** True when the cursor has reached the last computed state. */
  atEnd(): boolean {
    const upTo = this.getCfg().computedUpTo();
    return upTo > 0 && this.currentIndex() >= upTo;
  }

  // =============================================================================
  // Internal playback engine
  // =============================================================================

  private startPlayback(): void {
    const c = this.getCfg();
    if (c.computedUpTo() <= 0) return;
    if (this.currentIndex() >= c.computedUpTo()) return;
    this.isPlaying.set(true);

    // A prompt may already be visible at the current index — let the
    // dismiss timer handle it before stepping forward.
    if (c.mockConn.pendingPrompt()) {
      this.schedulePromptDismiss();
      return;
    }

    // v4 Phase 5 — initial seek-to-0 + first step. The seek is idempotent
    // if we're already at index 0, but it commits the boardStateSnapshot
    // to the rendered surface (skeleton replacement). The actual playback
    // is then driven by `scheduleNext → doStepForward → dispatchMockUntilIndex`.
    if (this.currentIndex() === 0) {
      c.mockConn.seekToOffset(0);
    }
    this.scheduleNext();
  }

  /** Internal step — does NOT pause playback (used by auto-play). */
  private doStepForward(): void {
    this.clearPlaybackTimer();
    const c = this.getCfg();

    // If a prompt is up, the auto-dismiss handler takes care of advancing.
    // doStepForward shouldn't be called in that case — guard defensively.
    if (c.mockConn.pendingPrompt()) {
      this.schedulePromptDismiss();
      return;
    }

    const curr = this.currentIndex();
    const nextIdx = curr + 1;
    if (nextIdx > c.computedUpTo()) return;

    this.currentIndex.set(nextIdx);
    // v4 Phase 5 — dispatch mock messages forward up to the next nav
    // boundary. The pipeline anim runs as messages flow through
    // `mockConn.dispatchNext()` → `processor.processMessage` →
    // `orchestrator`. When animations are disabled, snap to the target
    // via `seekToOffset` and schedule the next step via a fixed
    // interval to avoid synchronous recursion.
    if (c.animationsEnabled()) {
      this.dispatchMockUntilIndex(nextIdx);
    } else {
      c.mockConn.seekToOffset(nextIdx);
      this.playbackTimer = setTimeout(() => {
        this.playbackTimer = null;
        this.scheduleNext();
      }, PLAYBACK_INTERVAL);
    }
  }

  /**
   * Anim-pipeline v4 — pump the mock connection cursor up to the
   * message offset corresponding to `boardStates[targetIdx]`. By
   * construction the v4 precompute (replay-precompute.ts:recordStreamFlush)
   * keeps a 1-to-1 mapping between `PreComputedState[]` entries and nav
   * index entries, so `navIndex[targetIdx]` gives the target offset
   * directly.
   *
   * Defensive : if `navIndex` is shorter than `targetIdx` (the nav data
   * hasn't streamed yet for this position), we dispatch up to the
   * buffered cursor. The next chunk receipt will catch up via the
   * effect that watches `navIndex` changes (wired in the component).
   */
  private dispatchMockUntilIndex(targetIdx: number): void {
    const mock = this.getCfg().mockConn;
    const nav = mock.navIndex();
    if (targetIdx >= nav.length) {
      // Not yet streamed — dispatch as much as we have buffered.
      while (mock.dispatchNext()) { /* drain */ }
      return;
    }
    const targetOffset = nav[targetIdx].messageOffset;
    while (mock.messageCursor() < targetOffset && mock.dispatchNext()) {
      // Loop intentionally empty — dispatchNext advances the cursor.
      // A SELECT_* dispatched inside this loop will set `pendingPrompt`
      // which the `maybeAdvance` effect picks up via its subscription
      // to `mockConn.pendingPrompt()`. The loop exits naturally when
      // `dispatchNext` returns false (cursor at end or buffer drained).
      if (mock.pendingPrompt()) return; // a prompt landed — yield to auto-dismiss
    }
  }

  private scheduleNext(): void {
    if (!this.isPlaying()) return;
    if (this.playbackTimer !== null) return; // Already scheduled — prevent double-fire
    const c = this.getCfg();
    if (c.mockConn.busy()) return;

    if (this.currentIndex() >= c.computedUpTo()) {
      this.isPlaying.set(false);
      this.pausedAtBoundary.set(true);
      return;
    }

    this.doStepForward();
  }

  /**
   * v4 Phase 5 — fixed-delay prompt auto-dismiss. Replaces the
   * `lastResponseTimestamp`-based legacy calculation (which read
   * `adapter.activeTimestamp`). Doctrine acted (spec maître Décision 1) :
   * human timing is replaced by a fixed delay scaled by `playbackSpeed`.
   *
   * On fire, the auto-response payload is read from
   * `mockConn.getAutoResponseAt(cursor - 1)` (the cursor already
   * advanced past the SELECT_* inside `dispatchNext`) and fed via
   * `mockConn.simulatePlayerResponse(...)`. The prompt-dialog
   * `pendingPrompt` flips to null, which re-fires the `maybeAdvance`
   * effect → `scheduleNext` → `doStepForward` resumes.
   */
  private schedulePromptDismiss(): void {
    this.clearPlaybackTimer();
    const c = this.getCfg();
    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = null;
      const cursor = c.mockConn.messageCursor();
      // The SELECT_* lives at cursor - 1 (dispatchNext advanced past it).
      const response = c.mockConn.getAutoResponseAt(cursor - 1);
      if (response) {
        c.mockConn.simulatePlayerResponse(response);
      } else {
        // No recorded response (replay truncated mid-prompt?). Clear the
        // prompt manually so playback doesn't stall — `simulatePlayerResponse`
        // with a no-op payload does the right thing.
        c.mockConn.simulatePlayerResponse({ promptType: 'UNKNOWN', data: {} });
      }
    }, REPLAY_PROMPT_DELAY_MS);
  }

  private pausePlayback(): void {
    this.isPlaying.set(false);
    this.clearPlaybackTimer();
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer !== null) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }
}
