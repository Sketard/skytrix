import { Injectable, signal, type Signal } from '@angular/core';
import type { ReplayDuelAdapter } from './replay-duel-adapter';
import type { PhaseAnnouncementService } from '../duel-page/phase-announcement.service';
import type { PreComputedState, TurnMeta } from '../replay-ws.types';
import { EMPTY_DUEL_STATE } from '../types';

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
 * with the dependencies it needs (adapter handle, phase service for the
 * auto-advance guard, and the upstream signals `boardStates` /
 * `computedUpTo` / `animationsEnabled` / `promptMode` read at fire time
 * so changes flow through naturally).
 *
 * Cross-cutting cleanup of orchestrator/phase/adapter on user-driven
 * interruptions stays in the component as `abortAndClean()` — the
 * transport service does NOT touch the orchestrator or phase service
 * itself, except to read `phaseService.announcement()` for the
 * auto-play guard. The component is expected to call `abortAndClean()`
 * BEFORE invoking `seek/scrub/stepBack/skipStart/skipEnd/togglePerspective`.
 */

interface ReplayTransportConfig {
  adapter: ReplayDuelAdapter;
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
const PROMPT_DISPLAY_MIN = 800;
const PROMPT_DISPLAY_MAX = 3000;
const PROMPT_DISPLAY_FALLBACK = 1500;

const EMPTY_PRE_COMPUTED: PreComputedState = {
  boardState: EMPTY_DUEL_STATE,
  events: [],
  label: '',
  responseCount: 0,
};

@Injectable()
export class ReplayTransportService {
  /** Index of the currently displayed precomputed state. */
  readonly currentIndex = signal<number>(0);
  /** True when auto-play is active (driven by `togglePlay` / `startPlayback`). */
  readonly isPlaying = signal(false);
  /** True when auto-play has paused itself because we caught up to `computedUpTo`. */
  readonly pausedAtBoundary = signal(false);

  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last decision-prompt timestamp (ms epoch) used to derive `schedulePromptDismiss` duration. */
  private lastResponseTimestamp: number | null = null;

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
    const state = this.getCfg().boardStates()[index];
    if (state) this.getCfg().adapter.jumpToState(state);
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
   * `adapter.busy() / adapter.activePrompt() / phaseService.announcement()`.
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

    // Decision prompt appeared → auto-dismiss after proportional duration
    if (c.adapter.activePrompt()) {
      this.schedulePromptDismiss();
      return;
    }

    // Phase announcement still playing → wait for it to finish.
    if (c.phaseService.announcement()) return;

    // Transition complete (busy went false) → schedule next step
    if (!c.adapter.busy()) {
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

    if (c.adapter.activePrompt()) {
      this.schedulePromptDismiss();
      return;
    }

    if (this.currentIndex() === 0) {
      const first = c.boardStates()[0];
      if (first) {
        this.feedAnimatedTransition(EMPTY_PRE_COMPUTED, first);
        return;
      }
    }
    this.scheduleNext();
  }

  /** Internal step — does NOT pause playback (used by auto-play). */
  private doStepForward(): void {
    this.clearPlaybackTimer();
    const c = this.getCfg();

    if (c.adapter.activePrompt()) {
      c.adapter.resumeAfterPrompt();
      return;
    }

    const curr = this.currentIndex();
    const nextIdx = curr + 1;
    if (nextIdx > c.computedUpTo()) return;

    if (c.adapter.busy()) {
      c.adapter.abort();
    }

    this.currentIndex.set(nextIdx);
    this.feedTransition(curr, nextIdx);
  }

  private feedTransition(fromIdx: number, toIdx: number): void {
    const states = this.getCfg().boardStates();
    const prev = states[fromIdx];
    const next = states[toIdx];
    if (!prev || !next) return;
    this.feedAnimatedTransition(prev, next);
  }

  private feedAnimatedTransition(prev: PreComputedState, next: PreComputedState): void {
    const c = this.getCfg();
    if (c.animationsEnabled()) {
      if (c.promptMode() === 'decision') {
        c.adapter.feedTransitionPhased(prev, next);
      } else {
        c.adapter.feedTransition(prev, next);
      }
    } else {
      c.adapter.jumpToState(next);
      // Schedule next via timer to avoid synchronous recursion
      // (scheduleNext → doStepForward → feedAnimatedTransition → scheduleNext ...)
      this.playbackTimer = setTimeout(() => { this.playbackTimer = null; this.scheduleNext(); }, PLAYBACK_INTERVAL);
    }
  }

  private scheduleNext(): void {
    if (!this.isPlaying()) return;
    if (this.playbackTimer !== null) return; // Already scheduled — prevent double-fire
    const c = this.getCfg();
    if (c.adapter.busy()) return;

    if (this.currentIndex() >= c.computedUpTo()) {
      this.isPlaying.set(false);
      this.pausedAtBoundary.set(true);
      return;
    }

    this.doStepForward();
    // No timer here — feedAnimatedTransition already schedules the next
    // step via its own setTimeout when animations are disabled.
  }

  private schedulePromptDismiss(): void {
    this.clearPlaybackTimer();
    const c = this.getCfg();
    const tsStr = c.adapter.activeTimestamp();
    const ts = tsStr ? new Date(tsStr).getTime() : null;
    const prevTs = this.lastResponseTimestamp;
    this.lastResponseTimestamp = ts;
    const delta = (ts && prevTs) ? ts - prevTs : null;
    const duration = delta !== null
      ? Math.min(Math.max(delta * 0.6, PROMPT_DISPLAY_MIN), PROMPT_DISPLAY_MAX)
      : PROMPT_DISPLAY_FALLBACK;

    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = null;
      c.adapter.resumeAfterPrompt();
    }, duration);
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
