import { effect, Injectable, Injector, signal, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { LpAnimData } from './pvp-lp-badge/pvp-lp-badge.component';
import type { GameEvent } from '../types';
import type { MoveMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, ChainingMsg, ChainSolvingMsg, ChainSolvedMsg } from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { DuelWebSocketService } from './duel-web-socket.service';

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
 *      → processed normally, _boardEventsSinceSolving tracks count
 *
 *   3. Queue yields MSG_CHAIN_SOLVED(N)
 *      → calls applyChainSolved() which removes link N from activeChainLinks
 *      → sets chainOverlayBoardChanged based on whether board events occurred
 *      → returns 'async' — queue PAUSES, _waitingForOverlay = true
 *
 *   4. Overlay animates: exit card → cascade → board change pause (if needed)
 *      → sets chainOverlayReady = true
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
 * - Chain acceleration detection (AC5): ≥3 solved without prompt → faster animations
 */
@Injectable()
export class AnimationOrchestratorService {
  // --- Public read-only signals ---
  private readonly _isAnimating = signal(false);
  readonly isAnimating = this._isAnimating.asReadonly();

  readonly animatingZone = signal<{
    zoneId: string;
    animationType: 'summon' | 'destroy' | 'flip' | 'activate';
    relativePlayerIndex: number;
  } | null>(null);

  readonly animatingLpPlayer = signal<LpAnimData | null>(null);

  // --- Chain overlay async contract (see class doc "Chain resolution flow") ---
  /** Set to false by overlay on CHAIN_SOLVED, back to true after exit anim + board pause. */
  readonly chainOverlayReady = signal<boolean>(true);
  /** Whether board-changing events occurred between CHAIN_SOLVING and CHAIN_SOLVED. */
  readonly chainOverlayBoardChanged = signal<boolean>(false);

  /** True while the overlay entry animation is playing (gates SELECT_CHAIN in visiblePrompt). */
  readonly chainEntryAnimating = signal<boolean>(false);

  // --- Story 6.3 AC5: Auto-resolve acceleration ---
  readonly chainAccelerated = signal<boolean>(false);
  private _chainSolvedCount = 0;
  private _promptDuringChain = false;

  /** Board-changing events that increment the counter during chain resolution */
  private static readonly BOARD_CHANGING_EVENTS = new Set([
    'MSG_MOVE', 'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST', 'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS',
  ]);

  private _waitingForOverlay = false;
  private _insideChainResolution = false;
  private _boardEventsSinceSolving = 0;

  // --- Internal state ---
  private trackedLp: [number, number] = [8000, 8000];
  private animationTimeouts: ReturnType<typeof setTimeout>[] = [];

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
  private ownPlayerIndexFn!: () => number;
  private speedMultiplierFn!: () => number;

  /**
   * Must be called once after injection context is available.
   * Sets the external dependencies that cannot be injected directly
   * (because they are component-scoped or signal-derived).
   */
  init(config: {
    wsService: DuelWebSocketService;
    liveAnnouncer: LiveAnnouncer;
    ownPlayerIndex: () => number;
    speedMultiplier: () => number;
    injector: Injector;
  }): void {
    this.wsService = config.wsService;
    this.liveAnnouncer = config.liveAnnouncer;
    this.ownPlayerIndexFn = config.ownPlayerIndex;
    this.speedMultiplierFn = config.speedMultiplier;

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
      console.log('[ORCH-DBG] startProcessingIfIdle → starting');
      this._isAnimating.set(true);
      this.processAnimationQueue();
    } else {
      console.log('[ORCH-DBG] startProcessingIfIdle → already animating, waitingForOverlay=%s', this._waitingForOverlay);
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

  /** Notify the orchestrator that a prompt interrupted the chain. */
  notifyPromptDuringChain(): void {
    this._promptDuringChain = true;
    this.chainAccelerated.set(false);
  }

  /** Clean up all pending animation timeouts. */
  destroy(): void {
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    this.resetChainState();
  }

  /** Reset animation state for solo mode player switch. */
  resetForSwitch(): void {
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    this._isAnimating.set(false);
    this.chainEntryAnimating.set(false);
    this.animatingZone.set(null);
    this.animatingLpPlayer.set(null);
    this.resetChainState();
  }

  /** Centralized chain state reset — called from destroy, resetForSwitch, and MSG_CHAIN_END processing. */
  private resetChainState(): void {
    this._waitingForOverlay = false;
    this._insideChainResolution = false;
    this._boardEventsSinceSolving = 0;
    this._chainSolvedCount = 0;
    this._promptDuringChain = false;
    this.chainAccelerated.set(false);
  }

  // ---------------------------------------------------------------------------
  // Queue processing
  // ---------------------------------------------------------------------------

  private processAnimationQueue(): void {
    const queue = this.wsService.animationQueue();

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

    const event = this.wsService.dequeueAnimation();
    if (!event) {
      console.log('[ORCH-DBG] Queue empty → isAnimating=false');
      this._isAnimating.set(false);
      this.animatingZone.set(null);
      this.animatingLpPlayer.set(null);
      // Sync trackedLp to authoritative board state after all animations processed
      const state = this.wsService.duelState();
      if (state.players.length === 2) {
        this.trackedLp = [state.players[0].lp, state.players[1].lp];
      }
      return;
    }

    console.log('[ORCH-DBG] Processing event=%s queueRemaining=%d', event.type, this.wsService.animationQueue().length);
    const result = this.processEvent(event);

    if (result === 'async') {
      // Orchestrator pauses until overlay signals ready via chainOverlayReady
      this._waitingForOverlay = true;
      return;
    }

    // AC8: speed multiplier (0.5 when activation toggle is Off)
    const speedMultiplier = this.speedMultiplierFn();
    const adjustedDuration = Math.round(result * speedMultiplier);

    const timeout = setTimeout(() => {
      this.animatingZone.set(null);
      this.animatingLpPlayer.set(null);
      const idx = this.animationTimeouts.indexOf(timeout);
      if (idx !== -1) this.animationTimeouts.splice(idx, 1);
      this.processAnimationQueue();
    }, adjustedDuration);
    this.animationTimeouts.push(timeout);
  }

  private processEvent(event: GameEvent): number | 'async' {
    // Track board-changing events between CHAIN_SOLVING and CHAIN_SOLVED (drives board pause in overlay)
    if (this._insideChainResolution && AnimationOrchestratorService.BOARD_CHANGING_EVENTS.has(event.type)) {
      this._boardEventsSinceSolving++;
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
        const zoneId = locationToZoneId(msg.location, msg.sequence);
        if (zoneId) this.setAnimatingZone(zoneId, 'activate', msg.player);
        console.log('[ORCH-DBG] MSG_CHAINING chainIndex=%d → 1400ms', msg.chainIndex);
        return 1400;
      }
      case 'MSG_CHAIN_SOLVING': {
        const msg = event as ChainSolvingMsg;
        console.log('[ORCH-DBG] MSG_CHAIN_SOLVING chainIndex=%d → applyChainSolving + 600ms', msg.chainIndex);
        this.wsService.applyChainSolving(msg.chainIndex);
        this._insideChainResolution = true;
        this._boardEventsSinceSolving = 0;
        return 600;
      }
      case 'MSG_CHAIN_SOLVED': {
        const msg = event as ChainSolvedMsg;
        console.log('[ORCH-DBG] MSG_CHAIN_SOLVED chainIndex=%d boardEvents=%d → async', msg.chainIndex, this._boardEventsSinceSolving);
        this.wsService.applyChainSolved(msg.chainIndex);
        this.chainOverlayBoardChanged.set(this._boardEventsSinceSolving > 0);
        this._insideChainResolution = false;
        // AC5: Track solved count for acceleration detection
        this._chainSolvedCount++;
        if (!this._promptDuringChain && this._chainSolvedCount >= 3) {
          this.chainAccelerated.set(true);
        }
        return 'async';
      }
      case 'MSG_CHAIN_END':
        console.log('[ORCH-DBG] MSG_CHAIN_END → applyChainEnd + resetChainState + 400ms');
        this.wsService.applyChainEnd();
        this.resetChainState();
        return 400;
      // No-op events: dequeue immediately
      case 'MSG_DRAW':
      case 'MSG_SWAP':
      case 'MSG_ATTACK':
      case 'MSG_BATTLE':
        return 0;
      default:
        return 0;
    }
  }

  private processMoveEvent(msg: MoveMsg): number {
    const from = msg.fromLocation;
    const to = msg.toLocation;

    // Summon: HAND/EXTRA/DECK -> MZONE, or HAND -> SZONE (set)
    if ((to === LOCATION.MZONE && (from === LOCATION.HAND || from === LOCATION.EXTRA || from === LOCATION.DECK))
      || (to === LOCATION.SZONE && from === LOCATION.HAND)) {
      const zoneId = locationToZoneId(to, msg.toSequence);
      if (zoneId) {
        this.setAnimatingZone(zoneId, 'summon', msg.player);
        this.announceEvent('Card summoned', msg.player);
      }
      return 300;
    }

    // Destroy: MZONE/SZONE -> GRAVE/BANISHED/HAND/DECK (card disappears from field)
    if ((from === LOCATION.MZONE || from === LOCATION.SZONE)
      && (to === LOCATION.GRAVE || to === LOCATION.BANISHED || to === LOCATION.HAND || to === LOCATION.DECK)) {
      const zoneId = locationToZoneId(from, msg.fromSequence);
      if (zoneId) {
        this.setAnimatingZone(zoneId, 'destroy', msg.player);
        if (to === LOCATION.GRAVE || to === LOCATION.BANISHED) {
          this.announceEvent('Card destroyed', msg.player);
        }
      }
      return 300;
    }

    return 0;
  }

  private processLpEvent(player: number, amount: number, type: 'damage' | 'recover'): number {
    // Convert absolute OCGCore player index to relative (0=self, 1=opponent)
    // because trackedLp is indexed by relative position (synced from sanitized board state).
    const relativeIdx = player === this.ownPlayerIndexFn() ? 0 : 1;
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
      const idx = msg.player === this.ownPlayerIndexFn() ? 0 : 1;
      this.trackedLp[idx] = Math.max(0, (this.trackedLp[idx] ?? 8000) - msg.amount);
    } else if (event.type === 'MSG_RECOVER') {
      const msg = event as RecoverMsg;
      const idx = msg.player === this.ownPlayerIndexFn() ? 0 : 1;
      this.trackedLp[idx] = (this.trackedLp[idx] ?? 8000) + msg.amount;
    } else if (event.type === 'MSG_CHAIN_SOLVING') {
      this.wsService.applyChainSolving((event as ChainSolvingMsg).chainIndex);
      this._insideChainResolution = true;
      this._boardEventsSinceSolving = 0;
    } else if (event.type === 'MSG_CHAIN_SOLVED') {
      // Collapsed: bypass async overlay contract — just apply state
      this.wsService.applyChainSolved((event as ChainSolvedMsg).chainIndex);
      this._insideChainResolution = false;
    } else if (event.type === 'MSG_CHAIN_END') {
      this.wsService.applyChainEnd();
    }
  }

  private setAnimatingZone(
    zoneId: string,
    animationType: 'summon' | 'destroy' | 'flip' | 'activate',
    absolutePlayer: number,
  ): void {
    const relativePlayerIndex = absolutePlayer === this.ownPlayerIndexFn() ? 0 : 1;
    this.animatingZone.set({ zoneId, animationType, relativePlayerIndex });
  }

  private announceEvent(text: string, player: number): void {
    const isOwn = player === this.ownPlayerIndexFn();
    const prefix = isOwn ? '' : 'Opponent: ';
    this.liveAnnouncer.announce(`${prefix}${text}`);
  }
}
