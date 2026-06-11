import { effect, inject, Injectable, Injector, signal, type Signal, untracked } from '@angular/core';
import type { GameEvent } from '../types';
import type { ChainSolvingMsg, ConfirmCardsMsg } from '../duel-ws.types';
import { BOARD_CHANGING_EVENT_TYPES, LOCATION } from '../duel-ws.types';
import { duelAssert } from '../../../core/utilities/duel-assert';
import {
  ScopeResetDispatcher,
  type ResetTarget,
  type ScopeCategory,
} from '../projections';
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
 *
 * α.4b — implements `ResetTarget`. Chain state (signals +
 * `_chainSolvedCount` + `_bufferedBoardEvents` + `_deferredSolvingEvent`)
 * is `CONNECTION_LIFETIME` (survives a `PerspectiveSwitched`, cleared at
 * STATE_SYNC / reconnect).
 *
 * The declared `scope` stays the most volatile one (PERSPECTIVE_LIFETIME)
 * for historical cascade reasons : the manager used to own
 * PERSPECTIVE-scoped transport timers (the replay-stagger `_replayTimeouts`,
 * removed as dead code by audit 2026-06-11 #20 — zero production writers
 * since the buffer replay moved to queue directives). A PERSPECTIVE-only
 * reset is now a no-op here ; any wider reset (CONNECTION_LIFETIME /
 * DUEL_LIFETIME / …) carries PERSPECTIVE in the expanded set and branches
 * into the full state reset. This is the **mirror** of
 * `LpAnimationTracker` — LP declares the most durable (DUEL_LIFETIME) to
 * *avoid* being reset on a switch (except for its animation slice).
 */
@Injectable()
export class ChainResolutionManager implements ResetTarget {
  private readonly logger = inject(DuelLogger);
  private readonly injector = inject(Injector);
  private readonly dispatcher = inject(ScopeResetDispatcher);

  readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  constructor() {
    this.dispatcher.register(this);
  }

  // --- Public signals (overlay contract) ---
  /**
   * F15 (2026-05-31) — `chainResolutionAnnounce` is the SOLE source of
   * truth for the "Chain Resolution" banner state. It serves both the
   * reactive UI surface (templates + Effect D in `pvp-chain-overlay`)
   * AND the sync predicate inside `handleSolving`'s first-link
   * multi-link branch. Set via `markAnnouncePending()` (sync), cleared
   * via `handleEnd()` / `reset()` / `applyReset()`.
   *
   * Replaces the prior split-brain (β.3 Lot 3.2-REDO 2026-05-26) of a
   * `ChainResolutionAnnounceProjection` stream-observer + a private
   * `_announcePending: boolean` sync mirror. Per the CLAUDE.md doctrine
   * "projection vs signal manager", this state is dérivable du STATE
   * (a manager-owned boolean toggled by a callback), not a pure
   * function of the flux — so a signal manager is the correct shape,
   * not a `BaseProjection`. F-bugB4 (2026-05-31) exposed the split-
   * brain's fragility: an inconsistency between the sync mirror and
   * the stream-observed projection caused an infinite re-deferred loop
   * in the queue runner. Collapsing to one signal removes the class.
   */
  private readonly _announcing = signal<boolean>(false);
  readonly chainResolutionAnnounce: Signal<boolean> = this._announcing.asReadonly();
  readonly chainOverlayReady = signal<boolean>(true);
  readonly chainEntryAnimating = signal<boolean>(false);
  readonly chainPromptGateActive = signal<boolean>(false);

  // --- Internal state ---
  private _chainSolvedCount = 0;
  private _waitingForOverlay = false;
  private _drainingBuffer = false;
  private _bufferedBoardEvents: GameEvent[] = [];
  private _deferredSolvingEvent: GameEvent | null = null;
  // F15 (2026-05-31) — `_announcePending` retired ; `_announcing` signal
  // (above) is the single source of truth read both sync (via
  // `_announcing()` direct read) AND reactive (via the readonly
  // `chainResolutionAnnounce` accessor).
  /** Closure reading the processor's chainPhase signal — wired via
   *  `attachChainPhaseSource()`. Lazy: returns 'idle' if not yet attached. */
  private _phaseSource: (() => 'idle' | 'building' | 'resolving') | null = null;

  // --- State queries ---
  get isResolving(): boolean { return this._phaseSource?.() === 'resolving'; }
  get isWaitingForOverlay(): boolean { return this._waitingForOverlay; }
  get chainSolvedCount(): number { return this._chainSolvedCount; }
  get deferredSolvingEvent(): GameEvent | null { return this._deferredSolvingEvent; }
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

    // First solving of multi-link chain: pause to see chain, then banner, then resolve.
    // F15 (2026-05-31) — `_announcing()` is the sync read of the same
    // signal the templates / Effect D observe reactively. Was a
    // separate `_announcePending: boolean` mirror pre-F15.
    if (this._chainSolvedCount === 0 && msg.chainIndex > 0 && !this._deferredSolvingEvent && !this._announcing()) {
      this._deferredSolvingEvent = event;
      return { deferred: true, isSingleLink: false };
    }

    this._announcing.set(false);
    // H1 — phase flip is owned by the processor; orchestrator calls
    // `dataSource.applyChainSolving(msg.chainIndex)` immediately after this
    // method returns. Buffer is reset here because it's manager state.
    this._bufferedBoardEvents = [];
    const isSingleLink = this._chainSolvedCount === 0 && msg.chainIndex === 0;
    return { deferred: false, isSingleLink };
  }

  /**
   * F15 (2026-05-31) — flip the `_announcing` signal synchronously.
   * Called by the orchestrator's `announcement` directive `onShow`
   * callback. The signal serves BOTH the sync predicate inside
   * `handleSolving` (read via `_announcing()` direct call) AND the
   * reactive UI surface (templates + Effect D in `pvp-chain-overlay`
   * via the exposed readonly `chainResolutionAnnounce` accessor).
   *
   * Pre-F15: a parallel `_announcePending: boolean` + a stream-driven
   * `ChainResolutionAnnounceProjection` were updated in lock-step on
   * the same `pauseMs` timer — fragile, with no guarantee they agreed
   * within a tick. F-bugB4 (2026-05-31) exposed that fragility (an
   * infinite re-deferred loop when the projection lagged behind the
   * sync mirror).
   */
  markAnnouncePending(): void {
    this._announcing.set(true);
  }

  /** Handle MSG_CHAIN_SOLVED. Sets overlay state, returns 'async'.
   *
   *  H1 — phase stays at `'resolving'` after this returns; only `applyChainEnd`
   *  flips it back to `'idle'`. The transition assertion reads
   *  `processor.chainPhase()` via `isResolving`, so callers MUST have
   *  applied `dataSource.applyChainSolving` before calling this. */
  handleSolved(): 'async' {
    this.assertTransition('SOLVED', this.isResolving,
      'CHAIN_SOLVED without prior CHAIN_SOLVING — events arrived out of order?');
    this.assertTransition('SOLVED', !this._waitingForOverlay,
      'CHAIN_SOLVED while still waiting for overlay from previous link');
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
      // Deck-top reveals (CONFIRM_DECKTOP → MSG_CONFIRM_CARDS with every card
      // still on the DECK) precede mid-effect prompts (e.g. SelectYesNo for
      // fusion). Buffering them would delay the reveal until after the chain
      // overlay closes — i.e. after the player already answered. Skip
      // buffering ONLY for pure deck-top reveals so they play before the
      // decision. A CONFIRM for a card already moved to a FIELD zone (e.g.
      // a card Set face-down from the deck) MUST stay buffered — otherwise
      // it plays before its own MSG_MOVE travel, which is also buffered, and
      // the reveal animates on an empty zone before the card arrives.
      if (event.type === 'MSG_CONFIRM_CARDS') {
        const msg = event as ConfirmCardsMsg;
        if (msg.cards.every(c => c.location === LOCATION.DECK)) return false;
      }
      this._bufferedBoardEvents.push(event);
      return true;
    }
    return false;
  }

  // --- Replay ---

  /** Drain the buffer and return its contents. */
  drainBuffer(): GameEvent[] {
    const buffer = this._bufferedBoardEvents;
    this._bufferedBoardEvents = [];
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

  /**
   * α.4b — `ResetTarget` entry point. The declared `scope` is
   * `PERSPECTIVE_LIFETIME` (historical — see class docblock) so this is
   * reached by every reset event from PerspectiveSwitched upward.
   *
   * CONNECTION_LIFETIME present (carried by STATE_SYNC, RematchStarted,
   * ServerKicked, NavigationAway) → full chain state reset via `reset()`.
   * PERSPECTIVE_LIFETIME only (PerspectiveSwitched) → no-op : chain state
   * is intentionally preserved across the switch, and the manager no
   * longer owns transport timers (the dead replay-stagger mechanism was
   * removed by audit 2026-06-11 #20).
   */
  applyReset(scopes: ReadonlySet<ScopeCategory>): void {
    if (scopes.has('CONNECTION_LIFETIME')) {
      this.reset();
    }
  }

  /** Full reset — single source of truth for clearing all chain state + signals.
   *  H1 — chain phase is the processor's responsibility; orchestrator must call
   *  `dataSource.applyChainEnd()` separately to flip phase back to 'idle'. */
  reset(): void {
    this._waitingForOverlay = false;
    this._drainingBuffer = false;
    this._bufferedBoardEvents = [];
    this._chainSolvedCount = 0;
    this.chainPromptGateActive.set(false);
    // F15 (2026-05-31) — single source of truth, no separate mirror to keep.
    this._announcing.set(false);
    this.chainEntryAnimating.set(false);
    this.chainOverlayReady.set(true);
    this._deferredSolvingEvent = null;
  }

  // --- Dev-mode transition assertions ---

  private assertTransition(transition: string, condition: boolean, message: string): void {
    duelAssert(condition, `CHAIN:${transition}`,
      `${message} (solvedCount=${this._chainSolvedCount} resolving=${this.isResolving} waitingOverlay=${this._waitingForOverlay})`);
  }
}
