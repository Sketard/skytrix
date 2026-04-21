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
  private _insideChainResolution = false;
  private _bufferedBoardEvents: GameEvent[] = [];
  private _replayTimeouts: ReturnType<typeof setTimeout>[] = [];
  private _deferredSolvingEvent: GameEvent | null = null;
  private _bannerTimeouts: ReturnType<typeof setTimeout>[] = [];

  /**
   * Re-exported for legacy call sites (`ChainResolutionManager.BOARD_CHANGING_EVENTS`).
   * New code should import `BOARD_CHANGING_EVENT_TYPES` directly from
   * `duel-ws.types` — single source of truth shared with the server.
   */
  static readonly BOARD_CHANGING_EVENTS = BOARD_CHANGING_EVENT_TYPES;

  // --- State queries ---
  get isResolving(): boolean { return this._insideChainResolution; }
  get isWaitingForOverlay(): boolean { return this._waitingForOverlay; }
  get chainSolvedCount(): number { return this._chainSolvedCount; }
  get deferredSolvingEvent(): GameEvent | null { return this._deferredSolvingEvent; }
  get hasActiveReplayTimeouts(): boolean { return this._replayTimeouts.length > 0; }
  get hasBufferedEvents(): boolean { return this._bufferedBoardEvents.length > 0; }

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
    this._insideChainResolution = true;
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

  /** Handle MSG_CHAIN_SOLVED. Sets overlay state, returns 'async'. */
  handleSolved(event: GameEvent): 'async' {
    this.assertTransition('SOLVED', this._insideChainResolution,
      'CHAIN_SOLVED without prior CHAIN_SOLVING — events arrived out of order?');
    this.assertTransition('SOLVED', !this._waitingForOverlay,
      'CHAIN_SOLVED while still waiting for overlay from previous link');
    const msg = event as ChainSolvedMsg;
    this.chainOverlayBoardChanged.set(this._bufferedBoardEvents.length > 0);
    this._insideChainResolution = false;
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
    if (this._insideChainResolution && ChainResolutionManager.BOARD_CHANGING_EVENTS.has(event.type)) {
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

  /** Track a replay stagger timeout. */
  addReplayTimeout(t: ReturnType<typeof setTimeout>): void {
    this._replayTimeouts.push(t);
  }

  /** Clear all replay timeouts (without draining buffer). */
  clearReplayTimeouts(): void {
    this._replayTimeouts.forEach(t => clearTimeout(t));
    this._replayTimeouts = [];
  }

  // --- Instant (queue collapse) ---

  applyInstantSolving(): void {
    this._insideChainResolution = true;
    this._bufferedBoardEvents = [];
  }

  applyInstantSolved(): void {
    this._insideChainResolution = false;
    this._bufferedBoardEvents = [];
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

  /** Full reset — single source of truth for clearing all chain state + signals. */
  reset(): void {
    this._waitingForOverlay = false;
    this._insideChainResolution = false;
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
      `${message} (solvedCount=${this._chainSolvedCount} resolving=${this._insideChainResolution} waitingOverlay=${this._waitingForOverlay})`);
  }
}
