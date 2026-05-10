import { effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';
import type { GameEvent } from '../types';
import type { ChainSolvingMsg, ChainSolvedMsg } from '../duel-ws.types';
import { BOARD_CHANGING_EVENT_TYPES } from '../duel-ws.types';
import { duelAssert } from '../../../core/utilities/duel-assert';
import { DuelLogCategory, DuelLogger } from './duel-logger';

/**
 * Manages chain resolution state: signals for the overlay contract,
 * board-event buffering during resolution, and replay timeout tracking.
 * Provided at component level (NOT root).
 *
 * H1 (audit pvp-replay-2026-05-08, observer pattern) — `isResolving` is a
 * pure read of `DuelEventProcessor.chainPhase()` via `attachChainPhaseSource`.
 * The manager NEVER owns its own `_insideChainResolution` flag; the processor
 * is single source of truth. Orchestrator MUST call
 * `dataSource.applyChainSolving/Solved/End` to drive the phase — calling
 * `handleSolving/Solved/End` on this manager only handles overlay state,
 * buffer, and counters.
 */
@Injectable()
export class ChainResolutionManager {
  private readonly logger = inject(DuelLogger);
  private readonly injector = inject(Injector);

  // --- Public signals (overlay contract) ---
  readonly chainResolutionAnnounce = signal(false);
  readonly chainOverlayReady = signal<boolean>(true);
  readonly chainOverlayBoardChanged = signal<boolean>(false);
  readonly chainEntryAnimating = signal<boolean>(false);
  readonly chainPromptGateActive = signal<boolean>(false);

  // --- Internal state ---
  private _chainSolvedCount = 0;
  private _waitingForOverlay = false;
  private _drainingBuffer = false;
  private _bufferedBoardEvents: GameEvent[] = [];
  private _replayTimeouts: ReturnType<typeof setTimeout>[] = [];
  private _deferredSolvingEvent: GameEvent | null = null;
  private _bannerTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** Closure reading the processor's chainPhase signal — wired via
   *  `attachChainPhaseSource()`. Lazy: returns 'idle' if not yet attached. */
  private _phaseSource: (() => 'idle' | 'building' | 'resolving') | null = null;

  // --- State queries ---
  get isResolving(): boolean { return this._phaseSource?.() === 'resolving'; }
  get isWaitingForOverlay(): boolean { return this._waitingForOverlay; }
  get chainSolvedCount(): number { return this._chainSolvedCount; }
  get deferredSolvingEvent(): GameEvent | null { return this._deferredSolvingEvent; }
  get hasActiveReplayTimeouts(): boolean { return this._replayTimeouts.length > 0; }
  get hasBufferedEvents(): boolean { return this._bufferedBoardEvents.length > 0; }
  get isDraining(): boolean { return this._drainingBuffer; }
  /**
   * True iff a board-changing event arriving now should be buffered.
   * Equivalent to "chain is resolving server-side AND we are not currently
   * draining the buffer for animation". Decouples engine state from
   * animation-pipeline state — without this, mid-chain pre-replay events
   * passed through `processEvent` get re-buffered into the same buffer they
   * were just drained from, causing an infinite loop.
   */
  get shouldBufferDuringChain(): boolean { return this.isResolving && !this._drainingBuffer; }

  /** Wire the processor's chainPhase signal. Called once by the orchestrator
   *  during init. After this, `isResolving` reflects the processor by
   *  construction — no parallel state machine to keep in sync. */
  attachChainPhaseSource(source: () => 'idle' | 'building' | 'resolving'): void {
    this._phaseSource = source;
  }

  // --- Event handlers ---

  /**
   * Handle MSG_CHAIN_SOLVING. Returns structured result for the orchestrator
   * to compute the appropriate delay duration.
   */
  handleSolving(event: GameEvent): { deferred: boolean; isSingleLink: boolean } {
    this.assertTransition('SOLVING', !this._waitingForOverlay,
      'CHAIN_SOLVING while waiting for overlay — missed CHAIN_SOLVED → overlay resume?');
    const msg = event as ChainSolvingMsg;

    // First solving of multi-link chain: pause to see chain, then banner, then resolve
    if (this._chainSolvedCount === 0 && msg.chainIndex > 0 && !this._deferredSolvingEvent && !this.chainResolutionAnnounce()) {
      this._deferredSolvingEvent = event;
      return { deferred: true, isSingleLink: false };
    }

    this.chainResolutionAnnounce.set(false);
    // H1 — phase flip is owned by the processor; orchestrator calls
    // `dataSource.applyChainSolving(msg.chainIndex)` immediately after this
    // method returns. Buffer is reset here because it's manager state.
    this._bufferedBoardEvents = [];
    const isSingleLink = this._chainSolvedCount === 0 && msg.chainIndex === 0;
    return { deferred: false, isSingleLink };
  }

  /** Schedule the banner announce after a pause. Returns the timeout ID for the orchestrator to track. */
  scheduleBannerAnnounce(pauseMs: number): ReturnType<typeof setTimeout> {
    const tid = setTimeout(() => this.chainResolutionAnnounce.set(true), pauseMs);
    this._bannerTimeouts.push(tid);
    return tid;
  }

  /** Handle MSG_CHAIN_SOLVED. Sets overlay state, returns 'async'.
   *
   *  H1 — phase stays at `'resolving'` after this returns; only `applyChainEnd`
   *  flips it back to `'idle'`. The transition assertion reads
   *  `processor.chainPhase()` via `isResolving`, so callers MUST have
   *  applied `dataSource.applyChainSolving` before calling this. */
  handleSolved(event: GameEvent): 'async' {
    this.assertTransition('SOLVED', this.isResolving,
      'CHAIN_SOLVED without prior CHAIN_SOLVING — events arrived out of order?');
    this.assertTransition('SOLVED', !this._waitingForOverlay,
      'CHAIN_SOLVED while still waiting for overlay from previous link');
    const _msg = event as ChainSolvedMsg;
    this.chainOverlayBoardChanged.set(this._bufferedBoardEvents.length > 0);
    this._chainSolvedCount++;
    this._waitingForOverlay = true;
    return 'async';
  }

  /** Handle MSG_CHAIN_END. Resets chain state. */
  handleEnd(): void {
    this.reset();
  }

  /** Consume the deferred solving event (returns it and clears the slot). */
  consumeDeferredSolving(): GameEvent | null {
    const e = this._deferredSolvingEvent;
    this._deferredSolvingEvent = null;
    return e;
  }

  /** Clear the waiting-for-overlay flag (called by resume effect). */
  clearWaiting(): void {
    this._waitingForOverlay = false;
  }

  // --- Queue integration ---

  /** Buffer a board-changing event during chain resolution. Returns true if buffered. */
  bufferIfResolving(event: GameEvent): boolean {
    if (this.shouldBufferDuringChain && BOARD_CHANGING_EVENT_TYPES.has(event.type)) {
      this._bufferedBoardEvents.push(event);
      return true;
    }
    return false;
  }

  // --- Replay ---

  /** Drain the buffer and return its contents. Clears replay timeouts. */
  drainBuffer(): GameEvent[] {
    const buffer = this._bufferedBoardEvents;
    this._bufferedBoardEvents = [];
    this._replayTimeouts.forEach(t => clearTimeout(t));
    this._replayTimeouts = [];
    return buffer;
  }

  /**
   * Mark the start of a buffer drain. While set, `bufferIfResolving` returns
   * false even if `_insideChainResolution` is still true — this prevents
   * events that are being replayed from the buffer from re-entering the same
   * buffer (infinite loop on mid-chain pre-replay).
   */
  beginDrain(): void { this._drainingBuffer = true; }
  /** Mark the end of a buffer drain. Must be paired with `beginDrain`. */
  endDrain(): void { this._drainingBuffer = false; }

  /** Track a replay stagger timeout. */
  addReplayTimeout(t: ReturnType<typeof setTimeout>): void {
    this._replayTimeouts.push(t);
  }

  /** Clear all replay timeouts (without draining buffer). */
  clearReplayTimeouts(): void {
    this._replayTimeouts.forEach(t => clearTimeout(t));
    this._replayTimeouts = [];
  }

  // --- Lifecycle ---

  /** Create the effect that watches chainOverlayReady and calls onResume. */
  initResumeEffect(onResume: () => void): void {
    effect(() => {
      const ready = this.chainOverlayReady();
      untracked(() => {
        this.logger.log(DuelLogCategory.CHAIN, 'resumeEffect — ready=%s waitingForOverlay=%s', ready, this._waitingForOverlay);
        if (ready && this._waitingForOverlay) {
          this.logger.log(DuelLogCategory.CHAIN, 'resumeEffect → RESUMING');
          this._waitingForOverlay = false;
          onResume();
        }
      });
    }, { injector: this.injector });
  }

  /** Full reset — single source of truth for clearing all chain state + signals.
   *  H1 — chain phase is the processor's responsibility; orchestrator must call
   *  `dataSource.applyChainEnd()` separately to flip phase back to 'idle'. */
  reset(): void {
    this._waitingForOverlay = false;
    this._drainingBuffer = false;
    this._bufferedBoardEvents = [];
    this._replayTimeouts.forEach(t => clearTimeout(t));
    this._replayTimeouts = [];
    this._chainSolvedCount = 0;
    this.chainPromptGateActive.set(false);
    this.chainResolutionAnnounce.set(false);
    this.chainEntryAnimating.set(false);
    this.chainOverlayBoardChanged.set(false);
    this.chainOverlayReady.set(true);
    this._deferredSolvingEvent = null;
    this._bannerTimeouts.forEach(t => clearTimeout(t));
    this._bannerTimeouts = [];
  }

  /** Clear banner + replay timeouts (called by orchestrator's resetForSwitch, onStateSync, destroy). */
  clearTimeouts(): void {
    this._bannerTimeouts.forEach(t => clearTimeout(t));
    this._bannerTimeouts = [];
    this._replayTimeouts.forEach(t => clearTimeout(t));
    this._replayTimeouts = [];
  }

  // --- Dev-mode transition assertions ---

  private assertTransition(transition: string, condition: boolean, message: string): void {
    duelAssert(condition, `CHAIN:${transition}`,
      `${message} (solvedCount=${this._chainSolvedCount} resolving=${this.isResolving} waitingOverlay=${this._waitingForOverlay})`);
  }
}
