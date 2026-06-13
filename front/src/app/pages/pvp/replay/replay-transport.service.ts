import { Injectable, signal, type Signal } from '@angular/core';
import type { MockDuelConnection } from './mock-duel-connection';
import { devAnimSpeedMultiplier } from '../duel-page/duel-context';
import type { PhaseAnnouncementService } from '../duel-page/phase-announcement.service';
import type { TurnMeta } from '../replay-ws.types';

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
 * auto-advance guard, and the upstream signals `computedUpTo` /
 * `animationsEnabled` / `overlayActive` read at fire time so changes
 * flow through naturally). Nav data is read from `mockConn.navIndex()`
 * directly.
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
  computedUpTo: Signal<number>;
  animationsEnabled: Signal<boolean>;
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
/** Étape 2 (2026-06-12) — the auto-play step interval dominates dense-
 *  replay wall-clock (67 nav entries × 500ms ≈ 33s on the D/D/D) and is
 *  NOT an animation, so `scaledDuration` never touches it. Scale it by
 *  the same dev-only override the animations use (1 in prod), floored
 *  at 50ms so a 0.05 multiplier can't busy-loop the scheduler. */
function playbackIntervalMs(): number {
  return Math.max(50, Math.round(PLAYBACK_INTERVAL * devAnimSpeedMultiplier()));
}
/**
 * v4 Phase 5 (2026-06-05) — fixed prompt auto-dismiss delay. Replaces
 * the legacy `lastResponseTimestamp`-based `min(max(delta * 0.6, MIN), MAX)`
 * calculation that read `adapter.activeTimestamp`. The doctrine acted
 * for Phase 4 (spec maître Décision 1) : human timing is replaced by a
 * fixed delay. NOT speed-scaled today (audit 2026-06-11 doc fix — the
 * setTimeout applies the constant verbatim). 1200ms is the "average
 * human read time for a modal prompt" baseline ; tunable via
 * Preferences in a later phase.
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

  /** F10-bis (2026-06-12) — dev-only override of the prompt auto-dismiss
   *  delay. Exposed via `__skytrixDebug.replay.setPromptDelay(ms)` so the
   *  debug harness can play dense replays fast (273 prompts × 1.2s ≈ 5.5min
   *  at the product cadence). `null` = product default
   *  (`REPLAY_PROMPT_DELAY_MS`). NOT a product surface — the Preferences
   *  speed control remains a separate future phase. */
  private _promptDelayOverrideMs: number | null = null;
  setPromptDelayOverride(ms: number | null): void {
    this._promptDelayOverrideMs = ms;
  }

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

  /** Pause playback + jump to `index`. Shared by every imperative seek.
   *
   *  F9 (2026-06-06) — bounds-check the HIGH end BEFORE mutating
   *  `currentIndex`. The legacy implementation set `currentIndex` first
   *  and then called `seekToOffset`, which silently no-ops on out-of-range
   *  (mock returns when `index >= navIndex.length`). Result : the UI
   *  displayed an index that didn't correspond to any rendered board state
   *  (board frozen on the previous step). Caller-side bound-check was
   *  documented as "enforced by the caller" but no caller actually did it.
   *  Centralising here is the canonical fix.
   *
   *  Gate uses `cfg.computedUpTo()` (the public scrubber bound surfaced by
   *  the page) rather than `mockConn.navIndex().length` directly — the two
   *  are equivalent in production (computedUpTo = navIndex.length - 1) but
   *  `computedUpTo` is the API the rest of the transport already uses
   *  (`atEnd`, `scheduleNext`). A `computedUpTo === -1` (stream not yet
   *  streamed) is treated as "no upper bound enforced yet" — the seek
   *  falls through to `seekToOffset` which silently no-ops, matching the
   *  pre-F9 behavior for the not-yet-streamed case. */
  private jumpTo(index: number): void {
    this.pausePlayback();
    if (index < 0) return;
    const upTo = this.getCfg().computedUpTo();
    if (upTo >= 0 && index > upTo) {
      // Out-of-range past the precomputed end. Don't touch `currentIndex`
      // — letting it land at an index without a matching render would
      // desync the UI from the board.
      return;
    }
    this.currentIndex.set(index);
    // v4 Phase 5 (2026-06-05) — `seekToOffset` reads the nav entry's
    // embedded `boardStateSnapshot` + `chainSnapshot` and restores via
    // the SHARED `chainingMsgsToLinkStates` / `processor.restoreChainState`
    // helpers — same restore path as the PvP `CHAIN_STATE` reconnect
    // handshake.
    this.getCfg().mockConn.seekToOffset(index);
  }

  seek(index: number): void {
    this.jumpTo(index);
  }
  scrub(index: number): void {
    this.jumpTo(index);
  }

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

  /** True when the cursor has reached the last computed state AND that
   *  state's message span is fully dispatched (F22 — a mid-span pause at
   *  the last index is NOT the end ; `togglePlay` must stay usable). */
  atEnd(): boolean {
    const upTo = this.getCfg().computedUpTo();
    return upTo > 0 && this.currentIndex() >= upTo && !this.currentSpanUnfinished();
  }

  /**
   * F22 (2026-06-12) — true when the CURRENT nav entry's message span is
   * only partially dispatched, i.e. `dispatchMockUntilIndex` yielded at a
   * SELECT_* inside the entry and the auto-response is resuming us.
   *
   * Load-bearing for the whole scheduler : pre-fix, every prompt
   * auto-dismiss resumed through `doStepForward`, whose unconditional
   * `currentIndex` increment consumed ONE NAV INDEX PER PROMPT. A nav
   * entry can contain several prompts, so on prompt-dense replays the
   * index hit `computedUpTo` while the message cursor was still
   * mid-chain — `scheduleNext` took the boundary-pause branch, playback
   * froze (MSG_CHAIN_SOLVING never dispatched), the UI reported
   * end-of-replay and the Play button was dead (`startPlayback`
   * early-return). Full trace :
   * `_bmad-output/planning-artifacts/f10-parity-investigation-2026-06-12.md`
   * finding 1.
   *
   * Only meaningful when animations are enabled — the animations-off
   * path advances via `seekToOffset(index)`, which keeps index and
   * cursor in lock-step by construction.
   */
  private currentSpanUnfinished(): boolean {
    const c = this.getCfg();
    if (!c.animationsEnabled()) return false;
    const entry = c.mockConn.navIndex()[this.currentIndex()];
    return entry !== undefined && c.mockConn.messageCursor() < entry.messageOffset;
  }

  // =============================================================================
  // Internal playback engine
  // =============================================================================

  private startPlayback(): void {
    const c = this.getCfg();
    if (c.computedUpTo() <= 0) return;
    // F22 — `&& !currentSpanUnfinished()` : paused mid-span at the last
    // computed index is resumable, not "at end" (pre-fix the Play button
    // was dead in the frozen state this guard used to create).
    if (this.currentIndex() >= c.computedUpTo() && !this.currentSpanUnfinished()) return;
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

    // F22 (2026-06-12) — resume the CURRENT entry's span without consuming
    // a nav index. A prompt that yielded mid-entry resumes here after its
    // auto-response ; incrementing would burn one index per prompt and
    // desync index vs message cursor (see `currentSpanUnfinished`).
    if (this.currentSpanUnfinished()) {
      const idx = this.currentIndex();
      this.dispatchMockUntilIndex(idx);
      // Terminal guard (defer #4, 2026-06-13) — on the LAST computed entry,
      // `armContinuationTimer` no-ops (`idx < computedUpTo` is false). If the
      // resumed tail was non-animating (e.g. MSG_HINT / MSG_WIN — neither
      // enqueues, so `busy` never flips), nothing re-fires `maybeAdvance`
      // and playback would sit `isPlaying=true` forever (the F21 stall class
      // on the resume path). Only safe to stop when the WHOLE stream is in
      // (`streamComplete`) — otherwise this IS the precompute-front boundary
      // and `pausedAtBoundary` + `resumeIfBoundaryWaiting` must keep the
      // door open for the next chunk (the legitimate F22 case the pins
      // protect). The boundary-pause flip mirrors `scheduleNext`'s path so
      // the timeline shows a clean end and `togglePlay` stays usable.
      if (
        idx >= c.computedUpTo() &&
        !this.currentSpanUnfinished() &&
        !c.mockConn.pendingPrompt() &&
        !c.mockConn.busy() &&
        c.mockConn.streamComplete()
      ) {
        this.isPlaying.set(false);
        this.pausedAtBoundary.set(true);
        return;
      }
      this.armContinuationTimer(idx);
      return;
    }

    const curr = this.currentIndex();
    const nextIdx = curr + 1;
    if (nextIdx > c.computedUpTo()) {
      // F21 (2026-06-07) — auto-play stall fix. The legacy silent exit here
      // left the transport in a dead state : `isPlaying=true` + no timer
      // armed + no `pausedAtBoundary` flip → the only re-wake hook is the
      // `maybeAdvance` effect, which subscribes to `busy/pendingPrompt/
      // phaseAnnouncement/chainOverlayActive` — none of which flip when
      // playback stalls at the boundary. Result : the replay window froze
      // and required a manual pause/play to resume. Axel observed this
      // 2026-06-07 during harness Phase 0 debug.
      //
      // Mirror `scheduleNext`'s boundary path : flip pausedAtBoundary so
      // the `resumeIfBoundaryWaiting` effect picks up the next chunk
      // arrival via its `computedUpTo` subscription.
      this.isPlaying.set(false);
      this.pausedAtBoundary.set(true);
      return;
    }

    this.currentIndex.set(nextIdx);
    // v4 Phase 5 — dispatch mock messages forward up to the next nav
    // boundary. The pipeline anim runs as messages flow through
    // `mockConn.dispatchNext()` → `processor.processMessage` →
    // `orchestrator`. When animations are disabled, snap to the target
    // via `seekToOffset` and schedule the next step via a fixed
    // interval to avoid synchronous recursion.
    if (c.animationsEnabled()) {
      this.dispatchMockUntilIndex(nextIdx);
      this.armContinuationTimer(nextIdx);
    } else {
      c.mockConn.seekToOffset(nextIdx);
      this.playbackTimer = setTimeout(() => {
        this.playbackTimer = null;
        this.scheduleNext();
      }, playbackIntervalMs());
    }
  }

  /**
   * F21 fix bis (2026-06-07, extracted F22) — if the dispatch loop didn't
   * push any animation onto the queue (e.g. BOARD_STATE-only step) and
   * there's no pending prompt, the `maybeAdvance` effect won't fire (none
   * of busy/pendingPrompt/phaseAnnouncement/chainOverlayActive flips) and
   * playback stalls silently. Re-schedule explicitly via setTimeout so
   * the auto-play loop continues — but ONLY if there are still steps
   * ahead, otherwise we'd loop on the boundary path. The timeout falls
   * through to `scheduleNext` which re-checks the state and routes to
   * either `doStepForward` (more to play), the boundary pause, or the
   * pending-prompt branch.
   */
  private armContinuationTimer(idx: number): void {
    const c = this.getCfg();
    const moreToPlay = idx < c.computedUpTo();
    if (moreToPlay && !c.mockConn.busy() && !c.mockConn.pendingPrompt()) {
      this.playbackTimer = setTimeout(() => {
        this.playbackTimer = null;
        this.scheduleNext();
      }, playbackIntervalMs());
    }
  }

  /**
   * Anim-pipeline v4 — pump the mock connection cursor up to the
   * message offset corresponding to `navIndex[targetIdx]`. Phase 6
   * (2026-06-06) made `navIndex` the sole timeline data structure —
   * each nav entry IS the unit of seek granularity.
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
      while (mock.dispatchNext()) {
        /* drain */
      }
      // Note (F21, 2026-06-07) — no pausedAtBoundary flip here. The drain
      // loop pushes events into the animation queue → `busy()` flips true
      // → `maybeAdvance` effect re-fires when queue eventually drains →
      // `scheduleNext` runs and (if cursor really is past computedUpTo)
      // pauses via its own boundary path. The corresponding fix in
      // `doStepForward` covers the edge case where the dispatch loop
      // pushes nothing (cursor was already at end).
      return;
    }
    const targetOffset = nav[targetIdx].messageOffset;
    while (mock.messageCursor() < targetOffset && mock.dispatchNext()) {
      // Loop intentionally empty — dispatchNext advances the cursor.
      // A SELECT_* dispatched inside this loop will set `pendingPrompt`
      // which the `maybeAdvance` effect picks up via its subscription
      // to `mockConn.pendingPrompt()`. The loop exits naturally when
      // `dispatchNext` returns false (cursor at end or buffer drained).
      if (mock.pendingPrompt()) {
        // F10-bis (2026-06-12) — a live client receives [SELECT_*,
        // BOARD_STATE] in the same WS batch and processes the BOARD_STATE
        // while the prompt is displayed. Mirror that here : dispatch the
        // trailing BOARD_STATE BEFORE yielding to the auto-dismiss, so
        // `updateLogical` lands ahead of any in-flight travel commit.
        // Without it, a travel landing inside the 1.2s dismiss window
        // commits against a STALE logical (rendered hole — the regenese
        // Triple Tactics Talent tail case, post-F10 visual pass).
        //
        // Bounded on `targetOffset`: the trailing BOARD_STATE is part of
        // THIS entry's [SELECT_*, BOARD_STATE] batch (cursor still < target).
        // Without the bound a next-entry leading BOARD_STATE would be drained
        // early, pushing the cursor past `targetOffset` → `currentSpanUnfinished`
        // flips false and the index/cursor desync the F22 fix closed reopens
        // in the opposite direction.
        while (mock.messageCursor() < targetOffset && mock.peekNextType() === 'BOARD_STATE') {
          mock.dispatchNext();
        }
        return; // yield to auto-dismiss
      }
    }
  }

  private scheduleNext(): void {
    if (!this.isPlaying()) return;
    if (this.playbackTimer !== null) return; // Already scheduled — prevent double-fire
    const c = this.getCfg();
    if (c.mockConn.busy()) return;

    // F22 — a prompt answered inside the LAST computed entry resumes here
    // with `currentIndex === computedUpTo` while the entry's span is only
    // partially dispatched. Boundary-pausing would freeze mid-entry ;
    // fall through to `doStepForward`, whose resume branch finishes the
    // span without consuming an index.
    if (this.currentIndex() >= c.computedUpTo() && !this.currentSpanUnfinished()) {
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
      // F10-bis — the prompt's own offset is tracked by the mock
      // (`lastPromptOffset`). The historical `cursor - 1` arithmetic broke
      // once the trailing BOARD_STATE started dispatching before the yield.
      const response = c.mockConn.getAutoResponseAt(c.mockConn.lastPromptOffset());
      if (response) {
        c.mockConn.simulatePlayerResponse(response);
      } else {
        // No recorded response (replay truncated mid-prompt?). Clear the
        // prompt manually so playback doesn't stall — `simulatePlayerResponse`
        // with a no-op payload does the right thing.
        c.mockConn.simulatePlayerResponse({ promptType: 'UNKNOWN', data: {} });
      }
    }, this._promptDelayOverrideMs ?? REPLAY_PROMPT_DELAY_MS);
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
