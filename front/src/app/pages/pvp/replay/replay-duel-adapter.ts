import { computed, Injectable, signal, type Signal } from '@angular/core';

import type { AnimationDataSource } from '../duel-page/animation-data-source';
import type { DuelState, ChainLinkState, GameEvent, HintContext, Prompt } from '../types';
import { EMPTY_DUEL_STATE } from '../types';
import type {
  BoardStatePayload, ChainNegatedMsg, ChainingMsg, DecisionMoment, PreComputedState,
  ServerMessage, CardInfo,
} from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';

interface AnimateStep { kind: 'animate'; events: GameEvent[]; pendingState?: BoardStatePayload }
interface DecideStep { kind: 'decide'; decision: DecisionMoment }
type ReplayStep = AnimateStep | DecideStep;

const INTERNAL_TYPES = new Set(['MSG_CHAIN_NEGATED', 'WAITING_RESPONSE']);

@Injectable()
export class ReplayDuelAdapter implements AnimationDataSource {

  // ══════════════════════════════════════════════════
  //  AnimationDataSource contract (orchestrator interface)
  // ══════════════════════════════════════════════════

  private readonly _duelState = signal<DuelState>(EMPTY_DUEL_STATE);
  private readonly _activeChainLinks = signal<ChainLinkState[]>([]);
  private readonly _chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  // Typed as ServerMessage[] internally — dequeueAnimation() consumes non-GameEvent
  // types defensively (MSG_CHAIN_NEGATED, WAITING_RESPONSE, SELECT_*).
  // The public getter is cast to GameEvent[] to satisfy AnimationDataSource.
  // This cast is safe: filterEventsForQueue strips non-GameEvent types before
  // insertion, and dequeueAnimation() handles any that slip through.
  private readonly _animationQueue = signal<ServerMessage[]>([]);
  private _pendingBoardState: BoardStatePayload | null = null;

  readonly duelState = this._duelState.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly() as unknown as Signal<GameEvent[]>;
  readonly activeChainLinks = this._activeChainLinks.asReadonly();
  readonly chainPhase = this._chainPhase.asReadonly();
  readonly pendingPrompt = signal<Prompt | null>(null); // Always null — replay has no interactive prompts

  // ── Pending chain entry — mirrors DuelConnection's deferred commit pattern ──
  private _pendingChainEntry: ChainLinkState | null = null;

  private commitPendingChainEntry(): void {
    if (this._pendingChainEntry) {
      this._activeChainLinks.update(links => [...links, this._pendingChainEntry!]);
      this._pendingChainEntry = null;
    }
  }

  dequeueAnimation(): GameEvent | null {
    while (true) {
      const q = this._animationQueue();
      if (q.length === 0) return null;
      const first = q[0];
      this._animationQueue.update(queue => queue.slice(1));

      // ── Internal types: consume and continue (not returned) ──
      if (first.type === 'MSG_CHAIN_NEGATED') {
        this._activeChainLinks.update(links =>
          links.map(l => l.chainIndex === (first as ChainNegatedMsg).chainIndex
            ? { ...l, negated: true } : l));
        continue;
      }
      if (first.type === 'WAITING_RESPONSE') {
        this.commitPendingChainEntry();
        continue;
      }
      if (first.type.startsWith('SELECT_')) {
        this.commitPendingChainEntry();
        continue;
      }

      // ── GameEvent types: chain bookkeeping + return to orchestrator ──
      if (first.type === 'MSG_CHAINING') {
        this.commitPendingChainEntry();
        if (this._chainPhase() === 'idle') {
          this._chainPhase.set('building');
        }
        const chaining = first as ChainingMsg;
        this._pendingChainEntry = {
          chainIndex: chaining.chainIndex,
          cardCode: chaining.cardCode,
          cardName: chaining.cardName,
          player: chaining.player,
          zoneId: locationToZoneId(chaining.location, chaining.sequence),
          location: chaining.location,
          sequence: chaining.sequence,
          resolving: false,
          negated: false,
        };
      }
      if (first.type === 'MSG_CHAIN_SOLVING' || first.type === 'MSG_CHAIN_END') {
        this.commitPendingChainEntry();
      }
      return first as GameEvent;
    }
  }

  removeAnimationAt(index: number): void {
    this._animationQueue.update(q => [...q.slice(0, index), ...q.slice(index + 1)]);
  }

  applyPendingBoardState(): void {
    if (!this._pendingBoardState) return;
    // Apply but do NOT clear — the same final state may be re-applied on
    // subsequent calls within the same transition (draw/shuffle flows).
    // Without intermediate board states, the board jumps to the final state
    // after the first event. Masking hides destination zones during travel
    // so the visual result is acceptable.
    this._duelState.set(this._pendingBoardState);
  }

  setAnimating(animating: boolean): void {
    if (!animating) {
      this.advanceStep();
    }
  }

  setDrawMaskActive(_active: boolean): void {
    // No-op — hands always visible in omniscient replay.
  }

  applyChainSolving(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.map(l => l.chainIndex === chainIndex ? { ...l, resolving: true } : l));
    this._chainPhase.set('resolving');
  }

  applyChainSolved(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.filter(l => l.chainIndex !== chainIndex));
  }

  applyChainEnd(): void {
    this._activeChainLinks.set([]);
    this._chainPhase.set('idle');
  }

  // ══════════════════════════════════════════════════
  //  Replay-specific API — Step Queue + Decision State
  // ══════════════════════════════════════════════════

  readonly busy = signal(false);

  // ── Single source of truth for active decision ──
  private readonly _activeDecision = signal<DecisionMoment | null>(null);

  readonly activePrompt         = computed<Prompt | null>(() => {
    const p = this._activeDecision()?.prompt;
    return p && p.type.startsWith('SELECT_') ? p as Prompt : null;
  });
  readonly activeResponse       = computed(() => this._activeDecision()?.response.data ?? null);
  readonly activePlayer         = computed(() => this._activeDecision()?.player ?? 0);
  readonly activeHint           = computed<HintContext | null>(() => {
    const d = this._activeDecision();
    const h = d?.hint;
    return h ? { hintType: h.hintType, player: d!.player, value: h.value, cardName: h.cardName, hintAction: h.hintAction } : null;
  });
  readonly activeConfirmedCards = computed<CardInfo[] | null>(() => this._activeDecision()?.confirmedCards ?? null);
  readonly activeTimestamp      = computed(() => this._activeDecision()?.response.timestamp ?? null);

  private _steps: ReplayStep[] = [];

  private filterEventsForQueue(events: ServerMessage[]): GameEvent[] {
    return events.filter(
      (e): e is GameEvent =>
        !e.type.startsWith('SELECT_') && !INTERNAL_TYPES.has(e.type)
    );
  }

  feedTransition(prev: PreComputedState, next: PreComputedState): void {
    this.busy.set(true);
    this._steps = [];
    this._duelState.set(prev.boardState);
    this._pendingBoardState = next.boardState;
    const filtered = this.filterEventsForQueue(next.events);
    if (filtered.length === 0) {
      this.applyPendingBoardState();
      this.busy.set(false);
      return;
    }
    this._animationQueue.set(filtered);
  }

  feedTransitionPhased(
    prev: PreComputedState,
    next: PreComputedState,
  ): 'prompt' | 'done' {
    if (!next.decisions?.length) {
      this.feedTransition(prev, next);
      return 'done';
    }

    console.log('[ADAPTER:FEED-PHASED] prevPhase=%s nextPhase=%s events=%d decisions=%d',
      prev.boardState.phase, next.boardState.phase, next.events.length, next.decisions.length);
    this.busy.set(true);
    this._duelState.set(prev.boardState);
    this._pendingBoardState = next.boardState;
    this._steps = this.buildSteps(next.events, next.decisions, next.boardState);
    console.log('[ADAPTER:FEED-PHASED] steps=%o', this._steps.map(s => s.kind));
    this.advanceStep();
    return this._activeDecision() ? 'prompt' : 'done';
  }

  private buildSteps(
    rawEvents: ServerMessage[],
    decisions: DecisionMoment[],
    finalBoardState: BoardStatePayload,
  ): ReplayStep[] {
    const steps: ReplayStep[] = [];
    let segment: ServerMessage[] = [];
    let di = 0;

    for (const e of rawEvents) {
      if (e.type.startsWith('SELECT_') && di < decisions.length) {
        // The decision's boardState is the state AFTER the events in this segment
        // (matches the BOARD_STATE the PvP client receives before the prompt).
        const decision = decisions[di++];
        steps.push({ kind: 'animate', events: this.filterEventsForQueue(segment), pendingState: decision.boardState });
        steps.push({ kind: 'decide', decision });
        segment = [];
      } else {
        segment.push(e);
      }
    }
    // Final segment: use the transition's next.boardState as pendingState so that
    // processShuffleEvent applies the post-shuffle state (matching PvP behavior where
    // the next BOARD_STATE from the server includes the shuffle result).
    steps.push({ kind: 'animate', events: this.filterEventsForQueue(segment), pendingState: finalBoardState });

    return steps;
  }

  private advanceStep(): void {
    while (true) {
      const step = this._steps.shift();

      if (!step) {
        if (this._pendingBoardState) {
          this._duelState.set(this._pendingBoardState);
          this._pendingBoardState = null;
        }
        this.busy.set(false);
        return;
      }

      if (step.kind === 'decide') {
        const prompt = step.decision.prompt as unknown as Record<string, unknown>;
        const cards = prompt['cards'] as unknown[] | undefined;

        if (step.decision.prompt.type === 'SELECT_CHAIN') {
          this.commitPendingChainEntry();
          // Auto-skip chain windows with no chainable cards — in PvP these are
          // auto-declined by the activation toggle and never shown to the player.
          if (!cards?.length) continue;
        }

        this._activeDecision.set(step.decision);
        return; // busy stays true — waiting for resumeAfterPrompt()
      }

      // Always update _pendingBoardState so it tracks the correct intermediate
      // state at each step (matching what the PvP server would send at each prompt).
      if (step.pendingState) {
        this._pendingBoardState = step.pendingState;
      }

      if (step.events.length === 0) {
        // No events — apply the state now only if no chain is active.
        // During a chain, the orchestrator controls when to apply via
        // applyPendingBoardState() (with proper masks in place). Applying
        // here during auto-skipped steps would flash future state.
        if (step.pendingState && this._chainPhase() === 'idle') {
          this.applyPendingBoardState();
        }
        continue;
      }
      this._animationQueue.set(step.events);
      return;
    }
  }

  resumeAfterPrompt(): void {
    this._activeDecision.set(null);
    this.advanceStep();
  }

  collapseRemainingSteps(): void {
    this._activeDecision.set(null);
    const remaining = this._steps
      .filter((s): s is AnimateStep => s.kind === 'animate')
      .flatMap(s => s.events);
    this._steps = [];
    if (remaining.length > 0) {
      this._animationQueue.update(q => [...q, ...remaining]);
    } else {
      if (this._pendingBoardState) this.applyPendingBoardState();
      this.busy.set(false);
    }
  }

  abort(): void {
    this._animationQueue.set([]);
    this._pendingBoardState = null;
    this._pendingChainEntry = null;
    this._steps = [];
    this._activeDecision.set(null);
    this._activeChainLinks.set([]);
    this._chainPhase.set('idle');
    this.busy.set(false);
  }

  jumpToState(state: PreComputedState): void {
    this.abort();
    this._duelState.set(state.boardState);
  }
}
