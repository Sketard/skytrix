import { effect, Injectable, Injector, signal, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { LpAnimData } from './pvp-lp-badge/pvp-lp-badge.component';
import type { GameEvent } from '../types';
import type { CardOnField, MoveMsg, DrawMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ShuffleHandMsg, ConfirmCardsMsg, ShuffleDeckMsg, BecomeTargetMsg } from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';
import { locationToZoneId, locationToZoneKey } from '../pvp-zone.utils';
import { getCardImageUrlByCode } from '../pvp-card.utils';
import { DuelWebSocketService } from './duel-web-socket.service';
import { CardTravelService, type TravelOptions } from './card-travel.service';

/**
 * Central animation queue processor for the duel page.
 * Provided at component level (NOT root).
 *
 * ## Role in the chain animation protocol
 *
 * Three layers collaborate for chain animations:
 *   DuelConnection (data) → AnimationOrchestrator (timing) → PvpChainOverlay (visuals)
 *
 * This service is the timing layer. It dequeues events one-by-one from the animation queue
 * and controls WHEN signal mutations happen, ensuring the overlay sees state changes at the
 * right moment for animations.
 *
 * ## Chain resolution flow (per link)
 *
 *   1. Queue yields MSG_CHAIN_SOLVING(N)
 *      → calls applyChainSolving() which sets chainPhase='resolving' + marks link N as resolving
 *      → returns 600ms (pulse glow time)
 *
 *   2. Queue yields board-changing events (MSG_MOVE, MSG_DAMAGE, etc.)
 *      → buffered in _bufferedBoardEvents[] for replay after overlay hides
 *
 *   3. Queue yields MSG_CHAIN_SOLVED(N)
 *      → calls applyChainSolved() which removes link N from activeChainLinks
 *      → sets chainOverlayBoardChanged based on whether board events occurred
 *      → returns 'async' — queue PAUSES, _waitingForOverlay = true
 *
 *   4. Overlay runs the resolution sequence (see PvpChainOverlayComponent):
 *        hide overlay → replay board events → impact pause
 *        → re-show overlay (resolved card stays visible) → cleanup
 *      → sets chainOverlayReady = true
 *      The resolved card's exit is deferred: it is pushed out by the next
 *      MSG_CHAIN_SOLVING (Effect B). On chain end it disappears with the overlay.
 *
 *   5. Resume effect detects chainOverlayReady → resumes queue processing
 *
 *   6. Queue yields MSG_CHAIN_END
 *      → calls applyChainEnd() which sets chainPhase='idle' + clears all links
 *      → returns 400ms, then queue goes idle
 *
 * ## Queue collapse (AC7)
 *
 * When queue length > 5, all but the last 3 events are instantly applied (no animation).
 * Chain resolution events (CHAIN_SOLVING/SOLVED/END) are exempt — they need the async
 * overlay contract to work correctly.
 *
 * ## Other responsibilities
 * - LP tracking (trackedLp) with animated counter via baseLpDuration CSS token
 * - Zone animation signals (summon/destroy/flip/activate glow)
 * - Speed multiplier (AC8) applied to all sync durations
 */
@Injectable()
export class AnimationOrchestratorService {
  // --- Public read-only signals ---
  private readonly _isAnimating = signal(false);
  readonly isAnimating = this._isAnimating.asReadonly();

  readonly animatingZone = signal<{
    zoneId: string;
    animationType: 'flip' | 'activate';
    relativePlayerIndex: number;
  } | null>(null);

  readonly animatingLpPlayer = signal<LpAnimData | null>(null);

  /** Briefly true when chain resolution starts (for "Chain Resolution" banner). */
  readonly chainResolutionAnnounce = signal(false);

  // --- Chain overlay async contract (see class doc "Chain resolution flow") ---
  /** Set to false by overlay on CHAIN_SOLVED, back to true after exit anim + board pause. */
  readonly chainOverlayReady = signal<boolean>(true);
  /** Whether board-changing events occurred between CHAIN_SOLVING and CHAIN_SOLVED. */
  readonly chainOverlayBoardChanged = signal<boolean>(false);
  /** True while the overlay entry animation is playing (gates SELECT_CHAIN in visiblePrompt). */
  readonly chainEntryAnimating = signal<boolean>(false);
  /** True while the overlay is exiting to make room for a mid-resolution prompt. Gates visiblePrompt. */
  readonly chainPromptGateActive = signal<boolean>(false);

  /** Single source of truth for the chain pulse glow duration (ms). Used by both the orchestrator
   *  wait and the overlay CSS to stay in sync. */
  chainPulseDuration(): number {
    return Math.round(600 * this.speedMultiplierFn());
  }

  /** Single source of truth for the chain exit animation duration (ms). Used by both the
   *  orchestrator wait (MSG_CHAIN_SOLVING) and the overlay (Effect B exit→pulse sequence). */
  chainExitDuration(): number {
    return Math.round(600 * this.speedMultiplierFn());
  }

  /** Current speed multiplier (0.5 when speed toggle is Off, 1 otherwise). */
  speedMultiplier(): number {
    return this.speedMultiplierFn();
  }
  private _chainSolvedCount = 0;

  /** Board-changing events that increment the counter during chain resolution */
  private static readonly BOARD_CHANGING_EVENTS = new Set([
    'MSG_MOVE', 'MSG_DRAW', 'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST', 'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET',
    'MSG_SHUFFLE_HAND',
  ]);

  // Impact glow colors by destination
  private static readonly GLOW_GY      = 'rgba(160,160,190,0.6)';
  private static readonly GLOW_BANISH  = 'rgba(180,100,255,0.6)';
  private static readonly GLOW_NEUTRAL = 'rgba(180,180,220,0.5)'; // deck / field-to-field
  private static readonly GLOW_DISCARD = 'rgba(255,200,50,0.5)';  // departure: hand cost/discard

  private _waitingForOverlay = false;
  /**
   * Tracks in-flight draw sequences by relative player index.
   * Used by the replay's awaitDrawsComplete to wait for all draws to finish.
   * Cleaned up via finally() to prevent deadlocks on exceptions.
   */
  private _drawsInFlight = new Set<number>();
  /** Tracks whether each player's opening hand draw has already occurred. */
  private _initialDrawDone: [boolean, boolean] = [false, false];
  private _insideChainResolution = false;
  private _bufferedBoardEvents: GameEvent[] = [];
  private _replayPendingEvents: readonly GameEvent[] | null = null;
  private _replayTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** Deferred MSG_CHAIN_SOLVING event — re-processed after banner display */
  private _deferredSolvingEvent: GameEvent | null = null;
  private readonly _reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Internal state ---
  private trackedLp: [number, number] = [8000, 8000];
  private animationTimeouts: ReturnType<typeof setTimeout>[] = [];
  /**
   * Board state defer pattern — set by event handlers that manage board state themselves:
   * 1. Handler sets `_deferBoardState = true` before returning
   * 2. processAnimationQueue checks the flag AFTER processEvent returns — skips applyPendingBoardState
   * 3. processAnimationQueue resets the flag to `false` immediately after the check
   * Board state is then applied later by the handler itself (e.g. processShuffleEvent) or queue-empty.
   * Used by: processSingleDraw, processShuffleEvent, travelToHand.
   */
  private _deferBoardState = false;

  /** Specific hand card indices hidden per relative player [own, opponent]. */
  readonly hiddenHandIndices = signal<[ReadonlySet<number>, ReadonlySet<number>]>([new Set(), new Set()]);

  /** Hide entire hand per relative player until their initial draw animation starts. */
  readonly initialDrawPending = signal<[boolean, boolean]>([true, true]);

  /** Ghost cards appended to the hand during multi-draw/tutor animations (per relative player). */
  readonly handGhostCards = signal<[CardOnField[], CardOnField[]]>([[], []]);

  /** Zone keys (e.g. 'M3-0') whose card should be invisible until their travel lands. */
  readonly maskedZoneKeys = signal<ReadonlySet<string>>(new Set());

  /**
   * Pile zone keys mapped to the image of the previous top card to display during travel.
   * null = pile was empty before (show nothing). Missing key = not masked (normal render).
   */
  readonly maskedPileImages = signal<ReadonlyMap<string, string | null>>(new Map());

  /** Reference counts for concurrent travels to the same pile (e.g. two cards → GY at once). */
  private readonly _pileFlightCounts = new Map<string, number>();

  /** Pile keys currently masked on the SOURCE side (card leaving pile before animation starts). */
  private readonly _sourcePileMasks = new Set<string>();


  /**
   * Ghost divs created for hand cards that are about to leave but whose board state has already
   * removed them from the cards() array. Keyed by "{zoneKey}-{originalDomIndex}".
   */
  private readonly _handGhostDivs = new Map<string, HTMLDivElement>();

  /**
   * How many hand cards per zone key are currently in-flight (animation started, board state
   * already applied). Used to compute the correct original DOM index for subsequent ghost creation.
   */

  /**
   * Source zone keys (e.g. 'M3-0') mapped to the card that was there before the board state
   * removed it. Keeps the card visible in its zone until its travel animation actually starts,
   * preventing the card from disappearing before its animation begins (sequential queue case).
   */
  readonly maskedSourceImages = signal<ReadonlyMap<string, CardOnField>>(new Map());

  /** Zone keys of cards currently being targeted (MSG_BECOME_TARGET). */
  readonly targetedZoneKeys = signal<ReadonlySet<string>>(new Set());

  // Lazy CSS token reader (0ms under prefers-reduced-motion)
  private _baseLpDuration: number | null = null;
  private get baseLpDuration(): number {
    if (this._baseLpDuration === null) {
      const style = getComputedStyle(document.documentElement);
      const raw = style.getPropertyValue('--pvp-transition-lp-counter').trim();
      this._baseLpDuration = parseFloat(raw) || 0;
    }
    return this._baseLpDuration;
  }

  // Injected references (set via init)
  private wsService!: DuelWebSocketService;
  private liveAnnouncer!: LiveAnnouncer;
  private cardTravelService!: CardTravelService;
  private ownPlayerIndexFn!: () => number;
  private speedMultiplierFn!: () => number;
  private isBoardActiveFn!: () => boolean;

  /**
   * Must be called once after injection context is available.
   * Sets the external dependencies that cannot be injected directly
   * (because they are component-scoped or signal-derived).
   */
  init(config: {
    wsService: DuelWebSocketService;
    liveAnnouncer: LiveAnnouncer;
    cardTravelService: CardTravelService;
    ownPlayerIndex: () => number;
    speedMultiplier: () => number;
    isBoardActive: () => boolean;
    injector: Injector;
  }): void {
    this.wsService = config.wsService;
    this.liveAnnouncer = config.liveAnnouncer;
    this.cardTravelService = config.cardTravelService;
    this.ownPlayerIndexFn = config.ownPlayerIndex;
    this.speedMultiplierFn = config.speedMultiplier;
    this.isBoardActiveFn = config.isBoardActive;

    // Resume effect: when overlay signals ready, resume queue processing
    effect(() => {
      const ready = this.chainOverlayReady();
      untracked(() => {
        if (ready && this._isAnimating() && this._waitingForOverlay) {
          this._waitingForOverlay = false;
          this.processAnimationQueue();
        }
      });
    }, { injector: config.injector });
  }

  /** Called by the animation queue watcher effect in the component. */
  startProcessingIfIdle(): void {
    if (!this._isAnimating()) {
      this._isAnimating.set(true);
      this.wsService.setAnimating(true);
      this.processAnimationQueue();
    }
  }

  /**
   * Sync tracked LP to authoritative board state.
   * Called by the BOARD_STATE reset effect (guarded: only when not animating).
   */
  syncTrackedLp(playerLp: number, opponentLp: number): void {
    this.trackedLp = [playerLp, opponentLp];
  }

  /** Returns [playerLp, opponentLp] for the current tracked values. */
  getTrackedLp(): [number, number] {
    return [...this.trackedLp] as [number, number];
  }


  /**
   * Replay buffered board events as visible animations after overlay hides.
   * Beat 1: MSG_MOVE and MSG_DRAW travels in parallel with stagger.
   * Beat 2: LP events (MSG_DAMAGE, MSG_RECOVER, MSG_PAY_LPCOST) in parallel.
   *
   * MSG_FLIP_SUMMONING and MSG_CHANGE_POS are buffered (they trigger the overlay pause)
   * but intentionally not replayed — their in-place glow effects don't participate in
   * travel replay and BOARD_STATE already has the correct final state.
   */
  replayBufferedEvents(): Promise<void> {
    const buffer = this._bufferedBoardEvents;
    console.log('[ANIM:REPLAY] replayBufferedEvents — bufferLen=%d ownPlayer=%d', buffer.length, this.ownPlayerIndexFn());
    this._bufferedBoardEvents = [];
    this._replayTimeouts.forEach(t => clearTimeout(t));
    this._replayTimeouts = [];

    // Preserve masks for events still in the main queue (e.g. spell/trap leaving field post-chain,
    // pile destination masks for cards that haven't animated to GY yet).
    // Only clear masks whose zone key is used by a buffered event.
    const bufferMoves = buffer.filter(e => e.type === 'MSG_MOVE') as MoveMsg[];
    const bufferSrcKeys = new Set(bufferMoves.map(m => locationToZoneKey(m.fromLocation, m.fromSequence, this.relativePlayer(m.player))));
    const bufferDstKeys = new Set(bufferMoves.map(m => locationToZoneKey(m.toLocation, m.toSequence, this.relativePlayer(m.player))));

    this.maskedZoneKeys.set(new Set());
    this.maskedPileImages.update(map => {
      const next = new Map<string, string | null>();
      for (const [k, v] of map) {
        if (!bufferDstKeys.has(k)) next.set(k, v);
      }
      return next;
    });
    // Only clear flight counts and source pile masks for buffer keys
    for (const key of bufferDstKeys) this._pileFlightCounts.delete(key);
    for (const key of bufferSrcKeys) this._sourcePileMasks.delete(key);
    this.maskedSourceImages.update(map => {
      const next = new Map<string, CardOnField>();
      for (const [k, v] of map) {
        if (!bufferSrcKeys.has(k)) next.set(k, v);
      }
      return next;
    });
    this._clearHandGhosts();

    if (buffer.length === 0) return Promise.resolve();

    const zoneEvents = buffer.filter(e => e.type === 'MSG_MOVE' || e.type === 'MSG_DRAW');
    const shuffleEvents = buffer.filter(e => e.type === 'MSG_SHUFFLE_HAND') as ShuffleHandMsg[];
    const lpEvents = buffer.filter(e =>
      e.type === 'MSG_DAMAGE' || e.type === 'MSG_RECOVER' || e.type === 'MSG_PAY_LPCOST'
    );

    // Reduced motion: apply state changes instantly, skip all delays and travel animations
    if (this._reducedMotion) {
      for (const event of zoneEvents) {
        if (event.type === 'MSG_MOVE') this.processMoveEvent(event as MoveMsg);
        else if (event.type === 'MSG_DRAW') this.processDrawEvent(event as DrawMsg);
      }
      this.wsService.applyPendingBoardState();
      for (const event of lpEvents) {
        this.fireLpReplayEvent(event);
      }
      return Promise.resolve();
    }

    // Pre-mask destinations before the stagger fires: processDrawEvent calls applyPendingBoardState
    // internally, which would reveal MZONE/SZONE/pile destinations before their travel animations.
    // Also pre-capture hand ghost divs: preMaskQueuedSources() must run while cards are still in DOM.
    this.preMaskQueuedPileDestinations(zoneEvents);
    this.preMaskQueuedZoneDestinations(zoneEvents);
    this.preMaskQueuedSources(zoneEvents);
    // Expose replay events so travelMaskedPile keep-alive checks the buffer, not the live queue.
    // Cleared in the beat1 timeout once all travels have completed.
    this._replayPendingEvents = zoneEvents;

    const stagger = 50;
    const hasShuffle = shuffleEvents.length > 0;

    // Beat 1: fire all zone travels (MSG_MOVE + MSG_DRAW) with stagger.
    // MSG_DRAW may return 'async' (multi-card draw with highlights) —
    // collect all completion signals so we can await them before beat 1.5.
    const beat1Promises: Promise<void>[] = [];
    for (let i = 0; i < zoneEvents.length; i++) {
      const event = zoneEvents[i];
      const isLast = i === zoneEvents.length - 1;
      const id = setTimeout(() => {
        const moveInfo = event.type === 'MSG_MOVE' ? ` card=${(event as MoveMsg).cardCode} reason=0x${(event as MoveMsg).reason.toString(16)}` : '';
        console.log('[ANIM:REPLAY] Firing event %d/%d: %s%s', i + 1, zoneEvents.length, event.type, moveInfo);
        let result: number | 'async' | Promise<void> | undefined;
        if (event.type === 'MSG_MOVE') result = this.processMoveEvent(event as MoveMsg);
        else if (event.type === 'MSG_DRAW') result = this.processDrawEvent(event as DrawMsg);
        // After last travel captures its source rect, flush deferred board state
        // — unless a shuffle follows (it will apply board state after its animation)
        if (isLast && !hasShuffle) this.wsService.applyPendingBoardState();
        const isPromise = result instanceof Promise;
        console.log('[ANIM:REPLAY] Event %d result: %s', i + 1, isPromise ? 'Promise' : typeof result === 'number' ? `${result}ms` : String(result));
        if (isPromise) beat1Promises.push(result as Promise<void>);
      }, i * stagger);
      this._replayTimeouts.push(id);
    }
    if (zoneEvents.length === 0 && !hasShuffle) {
      this.wsService.applyPendingBoardState();
    }

    // Beat 2: fire all LP events after Beat 1 (and after shuffle if any)
    const beat2Duration = lpEvents.length > 0 ? this.baseLpDuration : 0;

    // Use a draw-completion signal for 'async' draws that can't return a Promise directly.
    // processSingleDraw adds to _drawsInFlight and calls processAnimationQueue when done.
    // We intercept that via a one-shot listener.
    const awaitDrawsComplete = (): Promise<void> => {
      if (this._drawsInFlight.size === 0 && beat1Promises.length === 0) return Promise.resolve();
      return new Promise<void>(resolve => {
        const check = () => {
          Promise.all(beat1Promises).then(() => {
            if (this._drawsInFlight.size === 0) { resolve(); return; }
            // Draw still running — poll briefly
            const tid = setTimeout(check, 50);
            this._replayTimeouts.push(tid);
          });
        };
        check();
      });
    };

    // Stagger fires the first event at t=0; wait for all travels + draws to complete.
    return new Promise<void>(resolve => {
      // Kick off the wait after the last stagger fires (all events dispatched)
      const lastStagger = Math.max(0, (zoneEvents.length - 1) * stagger);
      const t1 = setTimeout(async () => {
        await awaitDrawsComplete();
        this._replayPendingEvents = null; // all travels done — restore live-queue keep-alive

        // Beat 1.5: breathing room + shuffle animation + board state
        if (hasShuffle) {
          for (const shuffleMsg of shuffleEvents) {
            await this.processShuffleEvent(shuffleMsg);
          }
        }

        for (const event of lpEvents) {
          this.fireLpReplayEvent(event);
        }
        const t2 = setTimeout(() => resolve(), beat2Duration);
        this._replayTimeouts.push(t2);
      }, lastStagger);
      this._replayTimeouts.push(t1);
    });
  }

  private fireLpReplayEvent(event: GameEvent): void {
    if (event.type === 'MSG_DAMAGE') {
      this.processLpEvent((event as DamageMsg).player, (event as DamageMsg).amount, 'damage');
    } else if (event.type === 'MSG_RECOVER') {
      this.processLpEvent((event as RecoverMsg).player, (event as RecoverMsg).amount, 'recover');
    } else if (event.type === 'MSG_PAY_LPCOST') {
      this.processLpEvent((event as PayLpCostMsg).player, (event as PayLpCostMsg).amount, 'damage');
    }
  }

  private _unmaskZone(key: string): void {
    this.maskedZoneKeys.update(s => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }

  /** Clean up all pending animation timeouts. */
  destroy(): void {
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    this.resetChainState();
  }

  /** Reset animation state for solo mode player switch. */
  resetForSwitch(): void {
    console.log('[ANIM:SWITCH] resetForSwitch — clearing all masks & timeouts. maskedPileImages=%o maskedZoneKeys=%o',
      [...this.maskedPileImages().entries()], [...this.maskedZoneKeys()]);
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    this._isAnimating.set(false);
    this._drawsInFlight.clear();
    this._initialDrawDone = [false, false];
    this.resetHandAnimationState([true, true]);
    this.chainEntryAnimating.set(false);
    this.animatingZone.set(null);
    this.animatingLpPlayer.set(null);
    this.cardTravelService.clearAllTravels();
    // Remove CSS animation classes whose cleanup timeouts were just cancelled
    document.querySelectorAll<HTMLElement>('.pvp-deck-shuffle').forEach(el => {
      el.classList.remove('pvp-deck-shuffle');
      el.style.removeProperty('--pvp-shuffle-duration');
    });
    document.querySelectorAll<HTMLElement>('.pvp-xyz-detach').forEach(el => {
      el.classList.remove('pvp-xyz-detach');
      el.style.removeProperty('--pvp-detach-duration');
    });
    this.resetChainState();
  }

  /** Reset all animation state on STATE_SYNC (reconnection). Clears buffered events, chain state, and pending animations. */
  onStateSync(): void {
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    this._isAnimating.set(false);
    this._drawsInFlight.clear();
    this._initialDrawDone = [false, false];
    this.resetHandAnimationState([false, false]);
    this.chainEntryAnimating.set(false);
    this.animatingZone.set(null);
    this.animatingLpPlayer.set(null);
    this.resetChainState();
  }

  /** Centralized chain state reset — called from destroy, resetForSwitch, onStateSync, and MSG_CHAIN_END processing. */
  private resetChainState(): void {
    this._waitingForOverlay = false;
    this._insideChainResolution = false;
    this._bufferedBoardEvents = [];
    this._replayPendingEvents = null;
    this._replayTimeouts.forEach(t => clearTimeout(t));
    this._replayTimeouts = [];
    this.maskedZoneKeys.set(new Set());
    this.maskedPileImages.set(new Map());
    this._pileFlightCounts.clear();
    this._sourcePileMasks.clear();
    this.maskedSourceImages.set(new Map());
    this._clearHandGhosts();
    this._chainSolvedCount = 0;
    this.chainPromptGateActive.set(false);
    this.chainResolutionAnnounce.set(false);
    this._deferredSolvingEvent = null;
  }

  // ---------------------------------------------------------------------------
  // Queue processing
  // ---------------------------------------------------------------------------

  private processAnimationQueue(): void {
    // Guard: if reset mid-animation (e.g. player switch), stale Promise callbacks must not continue
    if (!this._isAnimating()) return;
    if (this._waitingForOverlay || this._drawsInFlight.size > 0) return;
    this.cardTravelService.clearLandedTravels();
    const queue = this.wsService.animationQueue();
    console.log('[ANIM:QUEUE] processAnimationQueue — queueLen=%d ownPlayer=%d maskedPile=%o maskedZones=%o',
      queue.length, this.ownPlayerIndexFn(), [...this.maskedPileImages().entries()], [...this.maskedZoneKeys()]);

    // Queue collapse (AC7): if queue > 5, instantly process all but last 3
    // Skip collapse when queue contains chain resolution events — these need the async overlay contract
    if (queue.length > 5 && !queue.some(e =>
      e.type === 'MSG_CHAIN_SOLVING' || e.type === 'MSG_CHAIN_SOLVED' || e.type === 'MSG_CHAIN_END'
    )) {
      const collapseCount = queue.length - 3;
      for (let i = 0; i < collapseCount; i++) {
        const event = this.wsService.dequeueAnimation();
        if (event) this.applyInstantAnimation(event);
      }
    }

    // Pre-capture before any board state is applied:
    // - pile destination masks prevent the new card from showing in GY during upstream delays (e.g. MSG_CHAINING 300ms)
    // - zone destination masks prevent the summoned card from showing before the travel animation (processDrawEvent calls applyPendingBoardState)
    // - hand ghosts must be captured while the card is still in the DOM, before processDrawEvent() applies board state
    this.preMaskQueuedPileDestinations();
    this.preMaskQueuedZoneDestinations();
    this.preMaskQueuedSources();

    const event = this._deferredSolvingEvent ?? this.wsService.dequeueAnimation();
    this._deferredSolvingEvent = null;
    if (!event) {
      // Mid-chain pre-replay: board events were buffered during chain resolution but a prompt
      // is already waiting. Replay them now so the player sees the animations before answering.
      if (this._insideChainResolution
        && this._bufferedBoardEvents.length > 0
        && this.wsService.pendingPrompt() !== null) {
        this.replayBufferedEvents().then(() => this.processAnimationQueue());
        return;
      }
      this._isAnimating.set(false);
      this.wsService.setAnimating(false);
      this.wsService.setDrawMaskActive(false);
      this.resetHandAnimationState([false, false]);
      this.animatingZone.set(null);
      this.animatingLpPlayer.set(null);
      // Finish any in-flight travels and remove all floating elements before prompt can appear
      this.cardTravelService.clearAllTravels();
      this.wsService.applyPendingBoardState();
      const state = this.wsService.duelState();
      if (state.players.length === 2) {
        this.trackedLp = [state.players[0].lp, state.players[1].lp];
      }
      return;
    }

    const result = this.processEvent(event);

    // Apply board state AFTER processEvent — travels have captured their source rects.
    // Skip when: chain is resolving (overlay replays need pre-destruction state),
    // or event explicitly deferred board state (hand destinations wait for shuffle/queue-empty).
    if (!this._deferBoardState && this.wsService.chainPhase() !== 'resolving') {
      this.preMaskQueuedSources();
      this.wsService.applyPendingBoardState();
    }
    this._deferBoardState = false;

    if (result === 'async') {
      console.log('[ANIM:EVENT] type=%s → async (waiting for overlay/draw signal)', event.type);
      // Orchestrator pauses until signalled (overlay ready or draw complete)
      return;
    }

    const continueQueue = (): void => {
      this.animatingZone.set(null);
      this.animatingLpPlayer.set(null);
      this.processAnimationQueue();
    };

    if (result instanceof Promise) {
      console.log('[ANIM:EVENT] type=%s → Promise (awaiting travel, maskedPile=%o maskedZones=%o)',
        event.type, [...this.maskedPileImages().entries()], [...this.maskedZoneKeys()]);
      // Guard against hung promises (element detached mid-animation, etc.) — force-continue after 3s.
      let settled = false;
      const done = () => { if (!settled) { settled = true; continueQueue(); } };
      const guard = setTimeout(() => {
        console.warn('[ANIM:DEADLOCK] Travel promise never resolved for %s — forcing queue continue', event.type);
        done();
      }, 3000);
      result.then(() => { clearTimeout(guard); done(); });
      return;
    }

    // AC8: speed multiplier (0.5 when activation toggle is Off)
    const speedMultiplier = this.speedMultiplierFn();
    const adjustedDuration = Math.round(result * speedMultiplier);

    console.log('[ANIM:EVENT] type=%s → setTimeout(%dms) ← BROWSER MAY RENDER HERE', event.type, adjustedDuration);
    const timeout = setTimeout(() => {
      const idx = this.animationTimeouts.indexOf(timeout);
      if (idx !== -1) this.animationTimeouts.splice(idx, 1);
      continueQueue();
    }, adjustedDuration);
    this.animationTimeouts.push(timeout);
  }

  private processEvent(event: GameEvent): number | 'async' | Promise<void> {
    // Buffer board-changing events during chain resolution for replay after overlay hides
    if (this._insideChainResolution && AnimationOrchestratorService.BOARD_CHANGING_EVENTS.has(event.type)) {
      const moveInfo = event.type === 'MSG_MOVE' ? ` card=${(event as MoveMsg).cardCode} reason=${(event as MoveMsg).reason}` : '';
      console.log('[ANIM:BUFFER] Buffering %s during chain resolution%s (bufferLen=%d)', event.type, moveInfo, this._bufferedBoardEvents.length + 1);
      this._bufferedBoardEvents.push(event);
      return 0;
    }

    switch (event.type) {
      case 'MSG_MOVE':
        return this.processMoveEvent(event as MoveMsg);
      case 'MSG_DAMAGE':
        return this.processLpEvent((event as DamageMsg).player, (event as DamageMsg).amount, 'damage');
      case 'MSG_RECOVER':
        return this.processLpEvent((event as RecoverMsg).player, (event as RecoverMsg).amount, 'recover');
      case 'MSG_PAY_LPCOST':
        return this.processLpEvent((event as PayLpCostMsg).player, (event as PayLpCostMsg).amount, 'damage');
      case 'MSG_FLIP_SUMMONING': {
        const msg = event as FlipSummoningMsg;
        const zoneId = locationToZoneId(msg.location, msg.sequence);
        if (zoneId) {
          this.setAnimatingZone(zoneId, 'flip', msg.player);
          this.announceEvent('Card flip summoned', msg.player);
        }
        return 300;
      }
      case 'MSG_CHANGE_POS': {
        const msg = event as ChangePosMsg;
        const wasFaceDown = (msg.previousPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
        const nowFaceUp = (msg.currentPosition & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
        if (wasFaceDown && nowFaceUp) {
          const zoneId = locationToZoneId(msg.location, msg.sequence);
          if (zoneId) this.setAnimatingZone(zoneId, 'flip', msg.player);
          return 300;
        }
        return 0;
      }
      case 'MSG_CHAINING': {
        const msg = event as ChainingMsg;
        const relPlayer = this.relativePlayer(msg.player);
        const zoneId = locationToZoneId(msg.location, msg.sequence);
        if (zoneId) {
          this.setAnimatingZone(zoneId, 'activate', msg.player);
          const zoneKey = locationToZoneKey(msg.location, msg.sequence, relPlayer);
          if (zoneKey) return this.cardTravelService.activateEffect(zoneKey, this.scaledDuration(500, 250));
        }
        if (msg.location === LOCATION.HAND) {
          const handEl = this.resolveHandTarget(`HAND-${relPlayer}`, msg.sequence);
          if (handEl instanceof HTMLElement) return this.cardTravelService.activateEffect(handEl, this.scaledDuration(500, 250));
        }
        return 400; // fallback: CSS glow (300ms) + breathing room (100ms)
      }
      case 'MSG_CHAIN_SOLVING': {
        const msg = event as ChainSolvingMsg;
        // First solving of multi-link chain: pause to see chain, then banner, then resolve
        if (this._chainSolvedCount === 0 && msg.chainIndex > 0 && !this._deferredSolvingEvent && !this.chainResolutionAnnounce()) {
          // 1s pause (overlay still visible) → then banner appears for 2s
          const pauseMs = this.scaledDuration(1000);
          const tid = setTimeout(() => this.chainResolutionAnnounce.set(true), pauseMs);
          this.animationTimeouts.push(tid);
          this._deferredSolvingEvent = event;
          return 3000;
        }
        this.chainResolutionAnnounce.set(false);
        this.wsService.applyChainSolving(msg.chainIndex);
        this._insideChainResolution = true;
        this._bufferedBoardEvents = [];
        // Single-link chain: no overlay to pulse, skip delay
        const isSingleLink = this._chainSolvedCount === 0 && msg.chainIndex === 0;
        // Subsequent solvings: previous card exits first (pushed out), then pulse
        const exitDelay = this._chainSolvedCount > 0 ? this.chainExitDuration() : 0;
        return isSingleLink ? 0 : exitDelay + this.chainPulseDuration() + this.scaledDuration(300);
      }
      case 'MSG_CHAIN_SOLVED': {
        const msg = event as ChainSolvedMsg;
        this.wsService.applyChainSolved(msg.chainIndex);
        this.chainOverlayBoardChanged.set(this._bufferedBoardEvents.length > 0);
        this._insideChainResolution = false;
        this._chainSolvedCount++;
        this._waitingForOverlay = true;
        return 'async';
      }
      case 'MSG_CHAIN_END':
        this.wsService.applyChainEnd();
        this.resetChainState();
        return 100;
      case 'MSG_DRAW':
        return this.processDrawEvent(event as DrawMsg);
      case 'MSG_SHUFFLE_HAND':
        return this.processShuffleEvent(event as ShuffleHandMsg);
      case 'MSG_CONFIRM_CARDS':
        return this.processConfirmCardsEvent(event as ConfirmCardsMsg);
      case 'MSG_SHUFFLE_DECK':
        return this.processShuffleDeckEvent(event as ShuffleDeckMsg);
      case 'MSG_BECOME_TARGET': {
        const msg = event as BecomeTargetMsg;
        const ownIdx = this.ownPlayerIndexFn();
        const keys = new Set(msg.cards.map(c => {
          const relPlayer = c.player === ownIdx ? 0 : 1;
          return locationToZoneKey(c.location, c.sequence, relPlayer);
        }));
        this.targetedZoneKeys.set(keys);
        const tid = setTimeout(() => this.targetedZoneKeys.set(new Set()), 800 * this.speedMultiplierFn());
        this.animationTimeouts.push(tid);
        return 800;
      }
      // No-op events: dequeue immediately
      case 'MSG_SWAP':
      case 'MSG_ATTACK':
      case 'MSG_BATTLE':
        return 0;
      default:
        return 0;
    }
  }

  private processMoveEvent(msg: MoveMsg): number | Promise<void> {
    const from = msg.fromLocation;
    const to = msg.toLocation;

    // Re-attachment to overlay: no animation, indicators update via BOARD_STATE
    if (to === LOCATION.OVERLAY) return 0;

    const relPlayer = this.relativePlayer(msg.player);
    const dstKey = locationToZoneKey(to, msg.toSequence, relPlayer);
    const srcKey = locationToZoneKey(from, msg.fromSequence, relPlayer);
    const fromPos = msg.fromPosition;
    const toPos = msg.toPosition;
    const isFaceUpFrom = (fromPos & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
    const isDefenseFrom = (fromPos & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const isFaceUpTo = (toPos & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
    const isDefenseTo = (toPos & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const locName = (v: number) => Object.keys(LOCATION).find(k => LOCATION[k as keyof typeof LOCATION] === v) ?? String(v);
    console.log('[ANIM:MOVE] %s→%s card=%d reason=0x%s relPlayer=%d(msgPlayer=%d/own=%d) fromSeq=%d toSeq=%d | from:%s%s → to:%s%s | src=%s dst=%s',
      locName(from), locName(to), msg.cardCode, msg.reason.toString(16),
      relPlayer, msg.player, this.ownPlayerIndexFn(),
      msg.fromSequence, msg.toSequence,
      isFaceUpFrom ? 'face-up' : 'face-down', isDefenseFrom ? '/defense' : '/attack',
      isFaceUpTo ? 'face-up' : 'face-down', isDefenseTo ? '/defense' : '/attack',
      srcKey, dstKey);
    const _boardZoneId = (loc: number, seq: number) =>
      loc === LOCATION.GRAVE ? 'GY' : loc === LOCATION.BANISHED ? 'BANISHED' : loc === LOCATION.EXTRA ? 'EXTRA' : locationToZoneId(loc, seq);
    const _pZones = this.wsService.duelState().players[relPlayer]?.zones ?? [];
    const _srcZone = _pZones.find(z => z.zoneId === _boardZoneId(from, msg.fromSequence));
    const _dstZone = _pZones.find(z => z.zoneId === _boardZoneId(to, msg.toSequence));
    console.log('[ANIM:BOARD] relPlayer=%d | src=%s cards=%o | dst=%s cards=%o',
      relPlayer,
      srcKey, (_srcZone?.cards ?? []).map(c => c.cardCode ?? 0),
      dstKey, (_dstZone?.cards ?? []).map(c => c.cardCode ?? 0));
    // When the server doesn't send the card code (opponent's hidden card = 0),
    // look it up from the destination zone — board state is already applied at this point.
    const resolvedCardCode = msg.cardCode || (_dstZone?.cards.at(-1)?.cardCode ?? 0);

    // Release source mask the moment this animation starts (card is now covered by the float)
    this._unmaskSourceZone(srcKey);

    // XYZ overlay detach: OVERLAY -> GRAVE/BANISHED
    if (from === LOCATION.OVERLAY && (to === LOCATION.GRAVE || to === LOCATION.BANISHED)) {
      const p = this.processOverlayDetachEvent(msg);
      return p instanceof Promise ? this.travelMaskedPile(dstKey, this.prevPileImage(to, msg.toSequence, relPlayer), p) : p;
    }

    // For HAND sources: use a pre-captured ghost div if available.
    // The ghost was created in preMaskQueuedSources() while the card was still in the DOM,
    // so it sits at the card's original screen position even after board state removes it.
    let handGhostDiv: HTMLDivElement | null = null;
    if (from === LOCATION.HAND) {
      const ghostKey = `${srcKey}-s${msg.fromSequence}`;
      handGhostDiv = this._handGhostDivs.get(ghostKey) ?? null;
      if (handGhostDiv) this._handGhostDivs.delete(ghostKey);
    }
    const src: string | HTMLElement = from === LOCATION.HAND
      ? (handGhostDiv ?? this.resolveHandTarget(srcKey, msg.fromSequence))
      : srcKey;
    const travelDuration = this.scaledDuration(400, 200);
    const cardImage = this.cardTravelService.toAbsoluteUrl(getCardImageUrlByCode(resolvedCardCode));
    const isFaceDown = (msg.fromPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const isBanishFaceDown = to === LOCATION.BANISHED
      && (msg.toPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    // Opponent cards are rendered rotated 180° in the board; apply the same rotation to the travel float.
    const baseRotateZ = relPlayer === 1 ? 180 : undefined;
    const isPile = (loc: number) => loc === LOCATION.GRAVE || loc === LOCATION.BANISHED || loc === LOCATION.EXTRA;

    // Summon/Activate to field: any pile/hand → MZONE (special summon), or HAND/GRAVE/BANISHED/DECK/EXTRA → SZONE (set/activate/pendulum)
    const isToMZONE = to === LOCATION.MZONE
      && (from === LOCATION.HAND || from === LOCATION.EXTRA || from === LOCATION.DECK
          || from === LOCATION.GRAVE || from === LOCATION.BANISHED);
    const isToSZONE = to === LOCATION.SZONE
      && (from === LOCATION.HAND || from === LOCATION.GRAVE || from === LOCATION.BANISHED
          || from === LOCATION.DECK || from === LOCATION.EXTRA);
    if (isToMZONE || isToSZONE) {
      const isMonsterDefense = to === LOCATION.MZONE
        && (msg.toPosition & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;
      const isSet = (msg.toPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
      this.announceEvent('Card summoned', msg.player);
      const summonP = this.cardTravelService.travel(src, dstKey, cardImage, {
        duration: travelDuration,
        destRotateZ: isMonsterDefense ? -90 : undefined,
        showBack: isSet, baseRotateZ,
        landingStyle: 'slam',
      });
      handGhostDiv?.remove(); // travel() captured position synchronously — safe to remove now
      return this.travelMasked(dstKey, summonP);
    }

    // Token dissolution: fade out in-place instead of traveling to GY
    if (msg.isToken && (from === LOCATION.MZONE || from === LOCATION.SZONE)
      && (to === LOCATION.GRAVE || to === LOCATION.BANISHED)) {
      if (this._reducedMotion) return 0;
      const srcElement = this.cardTravelService.getZoneElement(srcKey);
      this.announceEvent('Token removed', msg.player);
      if (!srcElement) return 0;
      const anim = srcElement.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.7)' }],
        { duration: this.scaledDuration(300, 100), easing: 'ease-out', fill: 'forwards' },
      );
      return anim.finished.then(() => {
        srcElement.getAnimations().forEach(a => a.cancel());
      });
    }

    // Leave field: MZONE/SZONE -> GRAVE/BANISHED/EXTRA (Pendulum monsters go to EXTRA face-up)
    if ((from === LOCATION.MZONE || from === LOCATION.SZONE)
      && (to === LOCATION.GRAVE || to === LOCATION.BANISHED || to === LOCATION.EXTRA)) {
      const isDestroy = (msg.reason & 0x1) !== 0; // OCGCore REASON_DESTROY
      const impactGlow = to === LOCATION.GRAVE
        ? AnimationOrchestratorService.GLOW_GY
        : to === LOCATION.BANISHED ? AnimationOrchestratorService.GLOW_BANISH : undefined;

      if (isDestroy) {
        this.announceEvent('Card destroyed', msg.player);
        const srcEl = this.cardTravelService.getZoneElement(srcKey);
        const preEffect = (srcEl && !this._reducedMotion)
          ? this.cardTravelService.preDestroyEffect(srcEl, isFaceDown ? null : cardImage, this.scaledDuration(400, 200))
          : Promise.resolve();
        return preEffect.then(() =>
          this.travelMaskedPile(dstKey, this.prevPileImage(to, msg.toSequence, relPlayer),
            this.cardTravelService.travel(srcKey, dstKey, cardImage, {
              duration: travelDuration,
              showBack: isFaceDown,
              flipDuringTravel: isBanishFaceDown,
              impactGlowColor: impactGlow,
              landingStyle: to === LOCATION.BANISHED ? 'banish' : 'soft',
              baseRotateZ,
            })));
      }

      // Non-destroy: tribute, cost, sent by effect, etc.
      this.announceEvent('Card sent off field', msg.player);
      return this.travelMaskedPile(dstKey, this.prevPileImage(to, msg.toSequence, relPlayer),
        this.cardTravelService.travel(srcKey, dstKey, cardImage, {
          duration: travelDuration,
          showBack: isFaceDown,
          flipDuringTravel: isBanishFaceDown,
          impactGlowColor: impactGlow,
          landingStyle: to === LOCATION.BANISHED ? 'banish' : 'soft',
          baseRotateZ,
        }));
    }

    // Bounce: MZONE/SZONE -> HAND
    if ((from === LOCATION.MZONE || from === LOCATION.SZONE) && to === LOCATION.HAND) {
      return this.travelToHand(srcKey, relPlayer, cardImage, { duration: travelDuration, baseRotateZ });
    }

    // Return to deck: MZONE/SZONE -> DECK (no masking — deck always shows card_back.jpg)
    if ((from === LOCATION.MZONE || from === LOCATION.SZONE) && to === LOCATION.DECK) {
      return this.cardTravelService.travel(srcKey, dstKey, cardImage, {
        duration: travelDuration, flipDuringTravel: true, impactGlowColor: AnimationOrchestratorService.GLOW_NEUTRAL, baseRotateZ,
      });
    }

    // Field-to-field: MZONE/SZONE -> MZONE/SZONE (repositioning, cross-zone moves)
    if ((from === LOCATION.MZONE || from === LOCATION.SZONE)
      && (to === LOCATION.MZONE || to === LOCATION.SZONE)) {
      return this.travelMasked(dstKey, this.cardTravelService.travel(srcKey, dstKey, cardImage, {
        duration: travelDuration, impactGlowColor: AnimationOrchestratorService.GLOW_NEUTRAL, baseRotateZ,
      }));
    }

    // Discard/banish from hand: HAND -> GRAVE/BANISHED (cost or effect)
    if (from === LOCATION.HAND && (to === LOCATION.GRAVE || to === LOCATION.BANISHED)) {
      const isHiddenCard = !msg.cardCode;
      const shouldFlip = isBanishFaceDown || (to === LOCATION.GRAVE && isHiddenCard);
      // Hidden opponent card: starts as card_back, flips to reveal face in GY.
      // Known card or banish face-down: starts face-up, flips to face-down (or no flip).
      const showBack = isHiddenCard && to === LOCATION.GRAVE;
      const impactGlow = to === LOCATION.GRAVE ? AnimationOrchestratorService.GLOW_GY : AnimationOrchestratorService.GLOW_BANISH;
      const discardP = this.cardTravelService.travel(src, dstKey, cardImage, {
        duration: travelDuration,
        flipDuringTravel: shouldFlip,
        showBack,
        departureGlowColor: AnimationOrchestratorService.GLOW_DISCARD,
        impactGlowColor: impactGlow,
        landingStyle: to === LOCATION.BANISHED ? 'banish' : 'soft',
        baseRotateZ,
      });
      handGhostDiv?.remove();
      return this.travelMaskedPile(dstKey, this.prevPileImage(to, msg.toSequence, relPlayer), discardP);
    }

    // Return from hand to deck: HAND -> DECK
    if (from === LOCATION.HAND && to === LOCATION.DECK) {
      const deckP = this.cardTravelService.travel(src, dstKey, cardImage, {
        duration: travelDuration, flipDuringTravel: true, impactGlowColor: AnimationOrchestratorService.GLOW_NEUTRAL, baseRotateZ,
      });
      handGhostDiv?.remove();
      return deckP;
    }

    // Send from deck/extra to GY or banished: DECK/EXTRA -> GRAVE/BANISHED (mill, cost, effect)
    if ((from === LOCATION.DECK || from === LOCATION.EXTRA)
      && (to === LOCATION.GRAVE || to === LOCATION.BANISHED)) {
      return this.travelMaskedPile(dstKey, this.prevPileImage(to, msg.toSequence, relPlayer),
        this.cardTravelService.travel(srcKey, dstKey, cardImage, {
          duration: travelDuration,
          showBack: isFaceDown,
          flipDuringTravel: isFaceDown && !isBanishFaceDown,
          impactGlowColor: to === LOCATION.GRAVE ? AnimationOrchestratorService.GLOW_GY : AnimationOrchestratorService.GLOW_BANISH,
          landingStyle: to === LOCATION.BANISHED ? 'banish' : 'soft',
          baseRotateZ,
        }));
    }

    // Add to hand from pile: GRAVE/BANISHED/EXTRA -> HAND
    if (isPile(from) && to === LOCATION.HAND) {
      return this.travelToHand(srcKey, relPlayer, cardImage, { duration: travelDuration, baseRotateZ });
    }

    // Return from pile to deck: GRAVE/BANISHED/EXTRA -> DECK
    if (isPile(from) && to === LOCATION.DECK) {
      return this.cardTravelService.travel(srcKey, dstKey, cardImage, {
        duration: travelDuration, flipDuringTravel: true, impactGlowColor: AnimationOrchestratorService.GLOW_NEUTRAL, baseRotateZ,
      });
    }

    // Pile-to-pile: GRAVE/BANISHED/EXTRA -> GRAVE/BANISHED/EXTRA (banish from GY, return from banish, etc.)
    if (isPile(from) && isPile(to)) {
      return this.travelMaskedPile(dstKey, this.prevPileImage(to, msg.toSequence, relPlayer),
        this.cardTravelService.travel(srcKey, dstKey, cardImage, {
          duration: travelDuration,
          showBack: isFaceDown,
          flipDuringTravel: isBanishFaceDown,
          impactGlowColor: to === LOCATION.BANISHED ? AnimationOrchestratorService.GLOW_BANISH : AnimationOrchestratorService.GLOW_GY,
          landingStyle: to === LOCATION.BANISHED ? 'banish' : 'soft',
          baseRotateZ,
        }));
    }

    // Generic fallback: any unhandled transition (HAND->EXTRA, DECK->HAND, OVERLAY->*, etc.)
    if (to === LOCATION.HAND) {
      handGhostDiv?.remove();
      return this.travelToHand(src, relPlayer, cardImage, { duration: travelDuration, baseRotateZ });
    }
    const fallbackP = this.cardTravelService.travel(src, dstKey, cardImage, { duration: travelDuration, baseRotateZ });
    handGhostDiv?.remove(); // travel() captured source rect synchronously — safe to remove now
    if (to === LOCATION.MZONE || to === LOCATION.SZONE) return this.travelMasked(dstKey, fallbackP);
    if (isPile(to)) return this.travelMaskedPile(dstKey, this.prevPileImage(to, msg.toSequence, relPlayer), fallbackP);
    return fallbackP;
  }

  private async travelMasked(dstKey: string, p: Promise<void>): Promise<void> {
    console.log('[ANIM:MASK-ZONE] SET dstKey=%s', dstKey);
    this.maskedZoneKeys.update(s => { const n = new Set(s); n.add(dstKey); return n; });
    await p;
    console.log('[ANIM:MASK-ZONE] CLEAR dstKey=%s', dstKey);
    this._unmaskZone(dstKey);
  }

  /**
   * Pre-mask source zones for events still in the queue before board state is applied.
   * - MZONE/SZONE: stores ghost card in maskedSourceImages so the zone keeps rendering the card.
   * - GRAVE/BANISHED/EXTRA: stores card image in maskedPileImages (source side) so the pile
   *   widget keeps showing the departing card until its travel animation actually starts.
   */
  private preMaskQueuedSources(events: readonly GameEvent[] = this.wsService.animationQueue()): void {
    const state = this.wsService.duelState();
    const currentSrcImages = this.maskedSourceImages();
    const currentPileImages = this.maskedPileImages();
    let srcUpdates: Map<string, CardOnField> | null = null;
    let pileUpdates: Map<string, string | null> | null = null;
    for (const event of events) {
      if (event.type !== 'MSG_MOVE') continue;
      const msg = event as MoveMsg;
      const from = msg.fromLocation;
      const relPlayer = this.relativePlayer(msg.player);
      const srcKey = locationToZoneKey(from, msg.fromSequence, relPlayer);

      if (from === LOCATION.MZONE || from === LOCATION.SZONE) {
        if (currentSrcImages.has(srcKey) || srcUpdates?.has(srcKey)) continue;
        const zoneId = locationToZoneId(from, msg.fromSequence);
        const card = zoneId
          ? state.players[relPlayer]?.zones.find(z => z.zoneId === zoneId)?.cards[0] ?? null
          : null;
        if (!card) continue;
        if (!srcUpdates) srcUpdates = new Map(currentSrcImages);
        srcUpdates.set(srcKey, card);
      } else if (from === LOCATION.GRAVE || from === LOCATION.BANISHED || from === LOCATION.EXTRA) {
        // Skip if already source-masked or destination-masked (avoids overwriting destination masks)
        if (this._sourcePileMasks.has(srcKey) || currentPileImages.has(srcKey) || pileUpdates?.has(srcKey)) continue;
        const image = msg.cardCode
          ? this.cardTravelService.toAbsoluteUrl(getCardImageUrlByCode(msg.cardCode))
          : this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');
        if (!pileUpdates) pileUpdates = new Map(currentPileImages);
        pileUpdates.set(srcKey, image);
        this._sourcePileMasks.add(srcKey);
      } else if (from === LOCATION.HAND) {
        // Use fromSequence as the stable ghost key — unique per card, immune to in-flight/scan-offset collisions.
        const ghostKey = `${srcKey}-s${msg.fromSequence}`;
        if (this._handGhostDivs.has(ghostKey)) continue;
        // DOM index == fromSequence: board state not yet applied, hand DOM still intact at scan time.
        const domIndex = msg.fromSequence;
        const zone = this.cardTravelService.getZoneElement(srcKey);
        const handCards = zone?.querySelectorAll<HTMLElement>('.hand-card');
        const el = handCards && domIndex < handCards.length ? handCards[domIndex] : null;
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) continue;
        const isOwn = relPlayer === 0;
        const imgSrc = isOwn && msg.cardCode
          ? getCardImageUrlByCode(msg.cardCode)
          : 'assets/images/card_back.jpg';
        const ghost = document.createElement('div');
        ghost.style.cssText = `position:fixed;pointer-events:none;z-index:999;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;overflow:hidden;border-radius:4px;`;
        const img = document.createElement('img');
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.src = this.cardTravelService.toAbsoluteUrl(imgSrc);
        ghost.appendChild(img);
        document.body.appendChild(ghost);
        this._handGhostDivs.set(ghostKey, ghost);
      }
    }

    if (srcUpdates) {
      console.log('[ANIM:PREMASK] maskedSourceImages updated keys=%o', [...srcUpdates.keys()]);
      this.maskedSourceImages.set(srcUpdates);
    }
    if (pileUpdates) {
      console.log('[ANIM:PREMASK] maskedPileImages updated keys=%o', [...pileUpdates.keys()]);
      this.maskedPileImages.set(pileUpdates);
    }
  }

  /**
   * Pre-mask pile destinations for upcoming MOVE events in the queue.
   * Called before processEvent() so the mask is in place before any applyPendingBoardState()
   * (including the one inside processDrawEvent()) adds the card to the destination pile.
   * Prevents the destination pile from "flashing" the final board state during upstream delays.
   */
  private preMaskQueuedPileDestinations(events: readonly GameEvent[] = this.wsService.animationQueue()): void {
    const currentPileImages = this.maskedPileImages();
    let updates: Map<string, string | null> | null = null;

    for (const event of events) {
      if (event.type !== 'MSG_MOVE') continue;
      const msg = event as MoveMsg;
      const to = msg.toLocation;
      if (to !== LOCATION.GRAVE && to !== LOCATION.BANISHED && to !== LOCATION.EXTRA) continue;
      const relPlayer = this.relativePlayer(msg.player);
      const dstKey = locationToZoneKey(to, msg.toSequence, relPlayer);
      if (currentPileImages.has(dstKey) || updates?.has(dstKey)) continue;
      const prevImage = this.prevPileImage(to, msg.toSequence, relPlayer);
      if (!updates) updates = new Map(currentPileImages);
      updates.set(dstKey, prevImage);
    }

    if (updates) this.maskedPileImages.set(updates);
  }

  /**
   * Pre-mask field zone destinations (MZONE/SZONE) for upcoming MOVE events in the queue.
   * Called before processEvent() so the mask is in place before applyPendingBoardState()
   * (including the one inside processDrawEvent()) makes the summoned card visible.
   *
   * Only pre-masks if no prior event in the queue sources the same zone — if a prior event
   * is destroying the current occupant, we must NOT mask early (would hide the old card
   * before its destroy animation plays).
   */
  private preMaskQueuedZoneDestinations(events: readonly GameEvent[] = this.wsService.animationQueue()): void {
    const current = this.maskedZoneKeys();
    const queue = events;
    let updates: Set<string> | null = null;

    for (let i = 0; i < queue.length; i++) {
      const event = queue[i];
      if (event.type !== 'MSG_MOVE') continue;
      const msg = event as MoveMsg;
      const to = msg.toLocation;
      if (to !== LOCATION.MZONE && to !== LOCATION.SZONE) continue;
      const relPlayer = this.relativePlayer(msg.player);
      const dstKey = locationToZoneKey(to, msg.toSequence, relPlayer);
      if (current.has(dstKey) || updates?.has(dstKey)) continue;

      // Skip if a prior event in the queue sources this zone: the current occupant will be
      // animated away first, and travelMasked will handle destination masking at that point.
      const priorSourcesZone = queue.slice(0, i).some(prior => {
        if (prior.type !== 'MSG_MOVE') return false;
        const p = prior as MoveMsg;
        const priorRel = this.relativePlayer(p.player);
        return locationToZoneKey(p.fromLocation, p.fromSequence, priorRel) === dstKey;
      });
      if (priorSourcesZone) continue;

      if (!updates) updates = new Set(current);
      updates.add(dstKey);
    }

    if (updates) this.maskedZoneKeys.set(updates);
  }

  private _unmaskSourceZone(srcKey: string): void {
    if (this.maskedSourceImages().has(srcKey)) {
      this.maskedSourceImages.update(m => { const n = new Map(m); n.delete(srcKey); return n; });
    }
    if (this._sourcePileMasks.has(srcKey)) {
      this._sourcePileMasks.delete(srcKey);
      this.maskedPileImages.update(m => { const n = new Map(m); n.delete(srcKey); return n; });
    }
  }

  private _clearHandGhosts(): void {
    for (const ghost of this._handGhostDivs.values()) ghost.remove();
    this._handGhostDivs.clear();

  }

  private peekAndDequeueMatching<T extends GameEvent>(predicate: (e: GameEvent) => boolean): T | null {
    const queue = this.wsService.animationQueue();
    const idx = queue.findIndex(predicate);
    if (idx === -1) return null;
    const msg = queue[idx] as T;
    this.wsService.removeAnimationAt(idx);
    return msg;
  }

  private resetHandAnimationState(pending: [boolean, boolean]): void {
    this.hiddenHandIndices.set([new Set(), new Set()]);
    this.initialDrawPending.set(pending);
    this.handGhostCards.set([[], []]);
    this._clearHandGhosts();
  }

  /**
   * Mask a pile destination during travel: show the previous top card while the new one is
   * in-flight, reveal it on landing. prevImage=null means the pile was empty (show nothing).
   *
   * Reference-counted for parallel travels (chain replay stagger). For sequential travels
   * (normal queue), when count drops to 0, the mask is kept alive if the remaining queue still
   * has events that will animate to the same pile — preventing a one-render-cycle flash of the
   * final board state between consecutive animations. The next travelMaskedPile call "takes
   * over" the existing mask (count 0→1, image not overwritten).
   */
  private async travelMaskedPile(dstKey: string, prevImage: string | null, p: Promise<void>): Promise<void> {
    const count = (this._pileFlightCounts.get(dstKey) ?? 0) + 1;
    this._pileFlightCounts.set(dstKey, count);
    const alreadyMasked = this.maskedPileImages().has(dstKey);
    console.log('[ANIM:MASK-PILE] SET dstKey=%s prevImage=%s count=%d alreadyMasked=%o',
      dstKey, prevImage ? 'has-image' : 'null', count, alreadyMasked);
    // Only set the image on the first travel, or when taking over an existing mask (count was 0)
    if (!alreadyMasked) {
      this.maskedPileImages.update(m => { const n = new Map(m); n.set(dstKey, prevImage); return n; });
    }
    await p;
    const remaining = (this._pileFlightCounts.get(dstKey) ?? 1) - 1;
    if (remaining <= 0) {
      this._pileFlightCounts.delete(dstKey);
      // Keep mask alive if a queued event will animate to the same pile (sequential queue case).
      // During chain replay, check the replay buffer (not the live queue — buffered events are
      // not in wsService.animationQueue() and the keep-alive would always miss them).
      const eventsToCheck = this._replayPendingEvents ?? this.wsService.animationQueue();
      const nextPileEvent = eventsToCheck.find(e => {
        if (e.type !== 'MSG_MOVE') return false;
        const m = e as MoveMsg;
        const rp = this.relativePlayer(m.player);
        return locationToZoneKey(m.toLocation, m.toSequence, rp) === dstKey;
      }) as MoveMsg | undefined;
      console.log('[ANIM:MASK-PILE] TRAVEL DONE dstKey=%s remaining=0 nextPileEvent=%o → %s',
        dstKey, !!nextPileEvent, nextPileEvent ? 'REFRESH+KEEP' : 'CLEAR');
      if (!nextPileEvent) {
        this.maskedPileImages.update(m => { const n = new Map(m); n.delete(dstKey); return n; });
      } else {
        // Refresh mask to intermediate pile state: board state may have changed since the mask
        // was first set (e.g. after mid-chain pre-replay). Show what the pile looks like just
        // before the next card arrives, not what it looked like before the current card arrived.
        const rp = this.relativePlayer(nextPileEvent.player);
        const refreshed = this.prevPileImage(nextPileEvent.toLocation, nextPileEvent.toSequence, rp);
        this.maskedPileImages.update(m => { const n = new Map(m); n.set(dstKey, refreshed); return n; });
      }
    } else {
      console.log('[ANIM:MASK-PILE] TRAVEL DONE dstKey=%s remaining=%d → KEEP', dstKey, remaining);
      this._pileFlightCounts.set(dstKey, remaining);
    }
  }

  /**
   * Read the pile top card image BEFORE the arriving card (for pile masking).
   *
   * Detection: in normal flow zone.cards.length === toSequence (pre-update);
   *            in replay    zone.cards.length >  toSequence (post-update).
   *
   * - Normal flow: last card in array is the previous top.
   * - Replay, toSequence > 0: cards[toSequence-1] is the previous top.
   * - Replay, toSequence = 0: pile was empty; show the arriving card itself
   *   (zone.cards[0]) to avoid a jarring blank flash during the animation.
   */
  private prevPileImage(to: number, toSequence: number, relPlayer: number): string | null {
    // locationToZoneId only covers MZONE/SZONE; pile zones need explicit mapping
    const zoneId = to === LOCATION.GRAVE ? 'GY'
      : to === LOCATION.BANISHED ? 'BANISHED'
      : to === LOCATION.EXTRA ? 'EXTRA'
      : locationToZoneId(to, toSequence);
    const zones = this.wsService.duelState().players[relPlayer]?.zones;
    const zone = zones?.find(z => z.zoneId === zoneId);
    if (!zone || zone.cards.length === 0) {
      console.log('[ANIM:PILE-PREV] zoneId=%s toSeq=%d relPlayer=%d zone.cards=%d → null (empty/not found)',
        zoneId, toSequence, relPlayer, zone?.cards.length ?? -1);
      return null;
    }

    const isReplay = zone.cards.length > toSequence;
    let prevTop: typeof zone.cards[0] | null;
    if (isReplay) {
      // toSequence=0: pile was empty before this card — show nothing during animation
      if (toSequence === 0) {
        console.log('[ANIM:PILE-PREV] zoneId=%s toSeq=0 relPlayer=%d isReplay=true → null (was empty)', zoneId, relPlayer);
        return null;
      }
      prevTop = zone.cards[toSequence - 1];
    } else {
      prevTop = zone.cards[zone.cards.length - 1];
    }

    if (!prevTop) {
      console.log('[ANIM:PILE-PREV] zoneId=%s toSeq=%d relPlayer=%d zone.cards=%d isReplay=%o → null (no prevTop)',
        zoneId, toSequence, relPlayer, zone.cards.length, isReplay);
      return null;
    }
    const src = prevTop.cardCode
      ? getCardImageUrlByCode(prevTop.cardCode)
      : 'assets/images/card_back.jpg';
    console.log('[ANIM:PILE-PREV] zoneId=%s toSeq=%d relPlayer=%d zone.cards=%d isReplay=%o prevCardCode=%d → image',
      zoneId, toSequence, relPlayer, zone.cards.length, isReplay, prevTop.cardCode ?? 0);
    return this.cardTravelService.toAbsoluteUrl(src);
  }

  private processLpEvent(player: number, amount: number, type: 'damage' | 'recover'): number {
    // Convert absolute OCGCore player index to relative (0=self, 1=opponent)
    // because trackedLp is indexed by relative position (synced from sanitized board state).
    const relativeIdx = this.relativePlayer(player);
    const fromLp = this.trackedLp[relativeIdx] ?? 8000;
    const toLp = type === 'damage' ? Math.max(0, fromLp - amount) : fromLp + amount;
    this.trackedLp[relativeIdx] = toLp;

    const speedMultiplier = this.speedMultiplierFn();
    const durationMs = Math.round(this.baseLpDuration * speedMultiplier);
    this.animatingLpPlayer.set({ player, fromLp, toLp, type, durationMs });

    // LiveAnnouncer: announce LP change
    const isOwn = player === this.ownPlayerIndexFn();
    const label = isOwn ? 'Your' : 'Opponent';
    this.liveAnnouncer.announce(`${label} LP: ${toLp}`);

    return this.baseLpDuration;
  }

  private applyInstantAnimation(event: GameEvent): void {
    // For collapsed events: apply LP tracking without visual animation.
    // Convert absolute OCGCore player index to relative (0=self, 1=opponent).
    if (event.type === 'MSG_DAMAGE' || event.type === 'MSG_PAY_LPCOST') {
      const msg = event as DamageMsg | PayLpCostMsg;
      const idx = this.relativePlayer(msg.player);
      this.trackedLp[idx] = Math.max(0, (this.trackedLp[idx] ?? 8000) - msg.amount);
    } else if (event.type === 'MSG_RECOVER') {
      const msg = event as RecoverMsg;
      const idx = this.relativePlayer(msg.player);
      this.trackedLp[idx] = (this.trackedLp[idx] ?? 8000) + msg.amount;
    } else if (event.type === 'MSG_CHAIN_SOLVING') {
      this.wsService.applyChainSolving((event as ChainSolvingMsg).chainIndex);
      this._insideChainResolution = true;
      this._bufferedBoardEvents = [];
    } else if (event.type === 'MSG_CHAIN_SOLVED') {
      // Collapsed: bypass async overlay contract — just apply state
      this.wsService.applyChainSolved((event as ChainSolvedMsg).chainIndex);
      this._insideChainResolution = false;
      this._bufferedBoardEvents = [];
    } else if (event.type === 'MSG_CHAIN_END') {
      this.wsService.applyChainEnd();
    }
  }

  private setAnimatingZone(
    zoneId: string,
    animationType: 'flip' | 'activate',
    absolutePlayer: number,
  ): void {
    const relativePlayerIndex = this.relativePlayer(absolutePlayer);
    this.animatingZone.set({ zoneId, animationType, relativePlayerIndex });
  }

  private processDrawEvent(msg: DrawMsg): number | 'async' {
    if (!this.isBoardActiveFn()) return 0;
    if (this._reducedMotion) return 0;
    const relPlayer = this.relativePlayer(msg.player);
    const isInitialDraw = !this._initialDrawDone[relPlayer];
    if (isInitialDraw) this._initialDrawDone[relPlayer] = true;

    // Initial draw: wait briefly for the other player's MSG_DRAW, then animate in parallel.
    if (isInitialDraw) {
      this._drawsInFlight.add(relPlayer);
      this.launchInitialDraw(msg);
      return 'async';
    }

    return this.processSingleDraw(msg, relPlayer, false);
  }

  /** Wait for the other player's initial draw, then launch parallel or single sequence. */
  private async launchInitialDraw(msg: DrawMsg): Promise<void> {
    // Poll briefly for the other player's MSG_DRAW (up to ~200ms)
    let otherMsg: DrawMsg | null = null;
    for (let attempt = 0; attempt < 5 && !otherMsg; attempt++) {
      await new Promise<void>(r => setTimeout(r, 40));
      otherMsg = this.peekAndDequeueOtherInitialDraw(msg);
    }

    if (otherMsg) {
      await this.runParallelInitialDraw(msg, otherMsg);
    } else {
      await this.runSingleInitialDraw(msg);
    }

    this._drawsInFlight.clear();
    this.processAnimationQueue();
  }

  /**
   * Peek the animation queue for the other player's initial MSG_DRAW.
   * If found, dequeue it and return it; otherwise return null.
   */
  private peekAndDequeueOtherInitialDraw(firstMsg: DrawMsg): DrawMsg | null {
    const otherMsg = this.peekAndDequeueMatching<DrawMsg>(
      e => e.type === 'MSG_DRAW' && (e as DrawMsg).player !== firstMsg.player,
    );
    if (otherMsg) this._initialDrawDone[this.relativePlayer(otherMsg.player)] = true;
    return otherMsg;
  }

  /** Animate two initial draws simultaneously with a per-card stagger. */
  private async runParallelInitialDraw(msgA: DrawMsg, msgB: DrawMsg): Promise<void> {
    const draws = [msgA, msgB].map(m => this.buildDrawConfig(m));
    await this.runInitialDrawSequence(draws, msgA.player);
  }

  /** Fallback: animate a single initial draw when the other player's draw wasn't found in the queue. */
  private async runSingleInitialDraw(msg: DrawMsg): Promise<void> {
    await this.runInitialDrawSequence([this.buildDrawConfig(msg)], msg.player);
  }

  private buildDrawConfig(msg: DrawMsg): {
    msg: DrawMsg; relPlayer: number; isOwn: boolean;
    drawCount: number; drawnIndices: number[];
    srcKey: string; dstKey: string;
  } {
    const relPlayer = this.relativePlayer(msg.player);
    const isOwn = relPlayer === 0;
    const drawCount = msg.cards.length;
    const drawnIndices = Array.from({ length: drawCount }, (_, i) => i);
    return { msg, relPlayer, isOwn, drawCount, drawnIndices, srcKey: `DECK-${relPlayer}`, dstKey: `HAND-${relPlayer}` };
  }

  /** Shared initial draw sequence for both parallel (2 players) and single (1 player) cases. */
  private async runInitialDrawSequence(
    draws: Array<ReturnType<typeof this.buildDrawConfig>>,
    announcePlayer: number,
  ): Promise<void> {
    const travelDuration = this.scaledDuration(300, 150);

    // Hide all drawn cards + clear initialDrawPending
    this.initialDrawPending.set([false, false]);
    this.hiddenHandIndices.update(c => {
      const next: [ReadonlySet<number>, ReadonlySet<number>] = [new Set(c[0]), new Set(c[1])];
      for (const d of draws) {
        for (const idx of d.drawnIndices) (next[d.relPlayer] as Set<number>).add(idx);
      }
      return next;
    });
    this.wsService.setDrawMaskActive(true);
    this.cardTravelService.clearLandedTravels();
    this.wsService.applyPendingBoardState();

    this.announceEvent('Card drawn', announcePlayer);

    const runPlayerSequence = async (d: typeof draws[0], delay: number): Promise<void> => {
      await new Promise<void>(r => setTimeout(r, 16 + delay));
      for (let i = 0; i < d.drawCount; i++) {
        const card = d.msg.cards[i];
        const cardImage = d.isOwn && card
          ? this.cardTravelService.toAbsoluteUrl(`/api/documents/small/code/${card}`)
          : this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');
        const idx = d.drawnIndices[i];
        const targetEl = this.resolveHandTarget(d.dstKey, idx);
        await this.cardTravelService.travel(d.srcKey, targetEl, cardImage, {
          duration: travelDuration, showBack: true, flipDuringTravel: d.isOwn && !!card,
        });
        this.cardTravelService.clearLandedTravels();
        this.revealHandCardAtIndex(d.relPlayer, idx);
      }
    };

    if (draws.length === 2) {
      const stagger = this.scaledDuration(150, 75);
      await Promise.all(draws.map((d, i) => runPlayerSequence(d, i * stagger)));
    } else {
      await runPlayerSequence(draws[0], 0);
    }
  }

  /**
   * Standard mid-game draw. Cards fly to the hand zone and floats stay landed.
   * Board state is NOT applied here — it will be applied by processShuffleEvent
   * (if a shuffle follows) or by the queue-empty handler.
   */
  private processSingleDraw(msg: DrawMsg, relPlayer: number, _isInitialDraw: false): number | 'async' {
    this._deferBoardState = true;
    const isOwnDraw = relPlayer === 0;
    const srcKey = `DECK-${relPlayer}`;
    const travelDuration = this.scaledDuration(400, 200);
    const drawCount = msg.cards.length;

    const guardId = setTimeout(() => {
      console.warn('[ANIM:DEADLOCK] Draw sequence timed out — forcing queue continue');
      this._drawsInFlight.delete(relPlayer);
      if (!this._replayPendingEvents) this.processAnimationQueue();
    }, drawCount * (travelDuration + this.scaledDuration(400, 200)) + 600) as unknown as ReturnType<typeof setTimeout>;
    this.animationTimeouts.push(guardId);

    const runSequence = async (): Promise<void> => {
      for (let i = 0; i < drawCount; i++) {
        const card = msg.cards[i];
        const cardImage = isOwnDraw && card
          ? this.cardTravelService.toAbsoluteUrl(`/api/documents/small/code/${card}`)
          : this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');
        await this.travelToHand(srcKey, relPlayer, cardImage, {
          duration: travelDuration, showBack: true, flipDuringTravel: isOwnDraw && !!card,
        });
        this.cardTravelService.clearLandedTravels();
      }
      clearTimeout(guardId);
    };

    this._drawsInFlight.add(relPlayer);
    runSequence().finally(() => {
      this._drawsInFlight.delete(relPlayer);
      if (!this._replayPendingEvents) this.processAnimationQueue();
    });
    this.announceEvent('Card drawn', msg.player);
    return 'async';
  }

  /** Blue frame pulse on a drawn/tutored card (two expanding boxShadow pulses). */
  private async highlightDrawnCard(el: HTMLElement, duration: number): Promise<void> {
    await el.animate([
      { transform: 'translateY(-12px)', boxShadow: '0 0 0 0px rgba(80,160,255,0)',   offset: 0    },
      { transform: 'translateY(-12px)', boxShadow: '0 0 0 3px rgba(80,160,255,0.9)', offset: 0.10 },
      { transform: 'translateY(-12px)', boxShadow: '0 0 0 8px rgba(80,160,255,0)',   offset: 0.45 },
      { transform: 'translateY(-12px)', boxShadow: '0 0 0 0px rgba(80,160,255,0)',   offset: 0.46 },
      { transform: 'translateY(-12px)', boxShadow: '0 0 0 3px rgba(80,160,255,0.9)', offset: 0.55 },
      { transform: 'translateY(-12px)', boxShadow: '0 0 0 8px rgba(80,160,255,0)',   offset: 0.90 },
      { transform: 'translateY(0px)',   boxShadow: '0 0 0 0px rgba(80,160,255,0)',   offset: 1.0  },
    ], { duration, fill: 'none', easing: 'ease-out', composite: 'add' }).finished;
  }

  /**
   * Shuffle event. During chain resolution, the MSG_MOVE is buffered alongside this event
   * and replayed by replayBufferedEvents. Outside chains, the MSG_MOVE may follow in the queue.
   * Final sequence: [travel to hand →] breathing room → FLIP hand reorder → board state applied.
   */
  private async processShuffleEvent(msg: ShuffleHandMsg): Promise<void> {
    this._deferBoardState = true;
    const relPlayer = this.relativePlayer(msg.player);
    const handZoneKey = `HAND-${relPlayer}`;

    // Peek queue for a following MSG_MOVE to hand — process it first (outside chain resolution)
    const moveMsg = this.peekAndDequeueMatching<MoveMsg>(
      e => e.type === 'MSG_MOVE' && (e as MoveMsg).toLocation === LOCATION.HAND,
    );
    if (moveMsg) {
      const moveResult = this.processMoveEvent(moveMsg);
      if (moveResult instanceof Promise) await moveResult;
    }

    const breathingRoom = this.scaledDuration(100, 50);

    // Breathing room after travel animation
    await new Promise<void>(r => {
      const tid = setTimeout(r, breathingRoom);
      this.animationTimeouts.push(tid);
    });

    // Capture old card positions (keyed by cardCode) before board state changes the order
    const handZone = this.cardTravelService.getZoneElement(handZoneKey);
    const oldCardEls = handZone?.querySelectorAll<HTMLElement>('.hand-card');
    const oldPositions = new Map<string, DOMRect[]>();
    oldCardEls?.forEach(el => {
      const code = el.dataset['cardCode'] ?? '';
      if (!oldPositions.has(code)) oldPositions.set(code, []);
      oldPositions.get(code)!.push(el.getBoundingClientRect());
    });

    // Remove ghosts, clear any stale hidden indices, and apply board state
    this.handGhostCards.set([[], []]);
    this.hiddenHandIndices.set([new Set(), new Set()]);
    this.cardTravelService.clearAllTravels();
    this.wsService.applyPendingBoardState();

    if (this._reducedMotion || !handZone) return;

    // Wait for Angular to render the new order
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    // FLIP: animate each card from its old position to its new position
    const flipDuration = this.scaledDuration(400, 200);
    const newCardEls = handZone.querySelectorAll<HTMLElement>('.hand-card');
    const animations: Animation[] = [];

    newCardEls.forEach(el => {
      const code = el.dataset['cardCode'] ?? '';
      const oldRects = oldPositions.get(code);
      if (!oldRects?.length) return;
      const oldRect = oldRects.shift()!;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      animations.push(el.animate([
        { transform: `translate(${dx}px, ${dy}px)`, composite: 'add' },
        { transform: 'translate(0, 0)', composite: 'add' },
      ], { duration: flipDuration, easing: 'ease-out' }));
    });

    if (animations.length > 0) {
      await Promise.all(animations.map(a => a.finished));
    }
  }

  private processShuffleDeckEvent(msg: ShuffleDeckMsg): number {
    if (this._reducedMotion) return 0;
    const relPlayer = this.relativePlayer(msg.player);
    const deckKey = `DECK-${relPlayer}`;
    const deckZone = this.cardTravelService.getZoneElement(deckKey);
    const pile = deckZone?.querySelector<HTMLElement>('.zone-pile');
    if (!pile) return 0;

    const duration = this.scaledDuration(500, 250);
    pile.style.setProperty('--pvp-shuffle-duration', `${duration}ms`);
    pile.classList.add('pvp-deck-shuffle');

    const tid = setTimeout(() => {
      pile.classList.remove('pvp-deck-shuffle');
      pile.style.removeProperty('--pvp-shuffle-duration');
    }, duration);
    this.animationTimeouts.push(tid);

    return duration;
  }

  private processConfirmCardsEvent(msg: ConfirmCardsMsg): number | 'async' {
    if (!this.isBoardActiveFn() || this._reducedMotion || msg.cards.length === 0) return 0;
    const relPlayer = this.relativePlayer(msg.player);
    const deckKey = `DECK-${relPlayer}`;
    const flipDuration = this.scaledDuration(500, 200);
    const holdDuration = this.scaledDuration(700, 200);

    const totalMs = msg.cards.length * (flipDuration + holdDuration);
    const guardId = setTimeout(() => {
      console.warn('[ANIM:DEADLOCK] Confirm-cards sequence timed out — forcing queue continue');
      this.processAnimationQueue();
    }, totalMs + 800) as unknown as ReturnType<typeof setTimeout>;
    this.animationTimeouts.push(guardId);

    const runSequence = async (): Promise<void> => {
      this.cardTravelService.clearLandedTravels();
      for (const card of msg.cards) {
        const cardImage = this.cardTravelService.toAbsoluteUrl(`/api/documents/small/code/${card.cardCode}`);
        // Travel from deck to deck (same position) with flip: back → face-up
        await this.cardTravelService.travel(deckKey, deckKey, cardImage, {
          duration: flipDuration,
          showBack: true,
          flipDuringTravel: true,
        });
        // Hold the revealed card face-up before moving to the next
        await new Promise<void>(r => setTimeout(r, holdDuration));
        this.cardTravelService.clearLandedTravels();
      }
      clearTimeout(guardId);
    };

    runSequence().finally(() => {
      if (!this._replayPendingEvents) this.processAnimationQueue();
    });
    this.announceEvent('Cards revealed', msg.player);
    return 'async';
  }

  private processOverlayDetachEvent(msg: MoveMsg): number | Promise<void> {
    if (this._reducedMotion) return 0;
    const relPlayer = this.relativePlayer(msg.player);
    const srcKey = locationToZoneKey(LOCATION.OVERLAY, msg.fromSequence, relPlayer);
    const dstKey = locationToZoneKey(msg.toLocation, msg.toSequence, relPlayer);
    const slideOutDuration = this.scaledDuration(200, 100);
    const travelDuration = this.scaledDuration(400, 200);
    const cardBackImage = this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');

    const srcElement = this.cardTravelService.getZoneElement(srcKey);
    this.announceEvent('Material detached', msg.player);
    if (!srcElement) return 0;

    srcElement.style.setProperty('--pvp-detach-duration', `${slideOutDuration}ms`);
    srcElement.classList.add('pvp-xyz-detach');

    return new Promise<void>(resolve => {
      const tid = setTimeout(() => {
        srcElement.classList.remove('pvp-xyz-detach');
        srcElement.style.removeProperty('--pvp-detach-duration');
        this.cardTravelService.travel(srcKey, dstKey, cardBackImage, {
          duration: travelDuration,
          showBack: true,
          departureGlowColor: 'rgba(0, 150, 255, 0.4)',
          impactGlowColor: msg.toLocation === LOCATION.GRAVE ? 'rgba(160,160,190,0.6)' : 'rgba(180,100,255,0.6)',
          landingStyle: msg.toLocation === LOCATION.GRAVE ? 'soft' : 'banish',
        }).then(resolve);
      }, slideOutDuration);
      this.animationTimeouts.push(tid);
    });
  }

  /**
   * Travel a card to the hand zone. The float stays landed until the next
   * board state is applied (either by processShuffleEvent or queue-empty handler).
   */
  private async travelToHand(
    src: string | HTMLElement,
    relPlayer: number,
    cardImage: string,
    options: TravelOptions,
  ): Promise<void> {
    this._deferBoardState = true;
    const dstKey = `HAND-${relPlayer}`;

    // Insert a hidden ghost card so the fan expands BEFORE the travel starts.
    // This way the float lands at the new card's position, not on top of the last card.
    const realHandSize = this.wsService.duelState().players[relPlayer]?.zones?.find(
      (z: { zoneId: string }) => z.zoneId === 'HAND',
    )?.cards?.length ?? 0;
    const ghostIdx = realHandSize + this.handGhostCards()[relPlayer].length;
    this.hiddenHandIndices.update(c => {
      const next: [ReadonlySet<number>, ReadonlySet<number>] = [new Set(c[0]), new Set(c[1])];
      (next[relPlayer] as Set<number>).add(ghostIdx);
      return next;
    });
    this.handGhostCards.update(c => {
      const next: [CardOnField[], CardOnField[]] = [[...c[0]], [...c[1]]];
      next[relPlayer] = [...next[relPlayer], {
        cardCode: null, name: null, position: POSITION.FACEDOWN_DEFENSE,
        overlayMaterials: [], counters: {},
      }];
      return next;
    });
    // Wait for Angular to render the ghost so the fan layout updates
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    // Target the newly created ghost (last .hand-card) so the float lands at the end of the expanded fan.
    const target = this.resolveHandTarget(dstKey, 'last');
    await this.cardTravelService.travel(src, target, cardImage, options);
    const floatEl = this.cardTravelService.getLastLandedFloat();
    if (floatEl) {
      await this.highlightDrawnCard(floatEl, this.scaledDuration(400, 200));
    }
  }

  /** Resolve a .hand-card element by numeric index or 'last' within a hand zone. */
  private resolveHandTarget(zoneKey: string, index: number | 'last'): HTMLElement | string {
    const zone = this.cardTravelService.getZoneElement(zoneKey);
    const cards = zone?.querySelectorAll('.hand-card');
    if (!cards?.length) return zoneKey;
    if (index === 'last') return cards[cards.length - 1] as HTMLElement;
    return (index >= 0 && index < cards.length) ? cards[index] as HTMLElement : zoneKey;
  }

  private revealHandCardAtIndex(relPlayer: number, index: number): void {
    this.hiddenHandIndices.update(c => {
      const next: [ReadonlySet<number>, ReadonlySet<number>] = [new Set(c[0]), new Set(c[1])];
      (next[relPlayer] as Set<number>).delete(index);
      return next;
    });
    if (this.hiddenHandIndices()[relPlayer].size === 0) {
      this.wsService.setDrawMaskActive(false);
    }
  }

  private announceEvent(text: string, player: number): void {
    const isOwn = player === this.ownPlayerIndexFn();
    const prefix = isOwn ? '' : 'Opponent: ';
    this.liveAnnouncer.announce(`${prefix}${text}`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Scale a duration by the current speed multiplier, with optional minimum clamp. */
  private scaledDuration(base: number, min = 0): number {
    return Math.max(min, Math.round(base * this.speedMultiplierFn()));
  }

  /** Convert an absolute OCGCore player index to relative (0 = self, 1 = opponent). */
  private relativePlayer(absolutePlayer: number): 0 | 1 {
    return absolutePlayer === this.ownPlayerIndexFn() ? 0 : 1;
  }
}
