import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';

import { syncAfterBoardState, type AnimationDataSource, type QueueDirective, type QueueEntry } from '../duel-page/animation-data-source';
import { DuelEventProcessor } from '../duel-page/duel-event-processor';
import { DuelLogCategory, DuelLogger } from '../duel-page/duel-logger';
import { RenderedBoardStateService, type BoardStateView } from '../duel-page/rendered-board-state.service';
import { swapBoardState, swapEventBoardStates } from '../board-state-swap';
import type { HintContext, Prompt, StreamEvent } from '../types';
import type {
  BoardStatePayload, DecisionMoment, PreComputedState,
  ServerMessage, CardInfo,
} from '../duel-ws.types';


interface AnimateStep { kind: 'animate'; events: ServerMessage[]; pendingState?: BoardStatePayload }
interface DecideStep { kind: 'decide'; decision: DecisionMoment }
type ReplayStep = AnimateStep | DecideStep;

@Injectable()
export class ReplayDuelAdapter implements AnimationDataSource, OnDestroy {

  // ══════════════════════════════════════════════════
  //  AnimationDataSource contract (orchestrator interface)
  // ══════════════════════════════════════════════════

  private readonly logger = inject(DuelLogger);
  private readonly processor = (() => { const p = new DuelEventProcessor(); p.logger = this.logger; return p; })();
  private readonly rbs = (() => { const s = new RenderedBoardStateService(); s.logger = this.logger; return s; })();
  /** Full RBS — write/control surface used by AnimationDataSource (orchestrator + managers). */
  readonly renderedBoardState = this.rbs;
  /** Read-only view of board state used by replay-page template + non-orchestrator consumers (audit L25). */
  readonly boardStateView: BoardStateView = this.rbs;

  readonly animationQueue = this.processor.animationQueue;
  readonly activeChainLinks = this.processor.activeChainLinks;
  readonly chainPhase = this.processor.chainPhase;
  readonly hasPendingChainEntry = this.processor.hasPendingChainEntry;
  readonly pendingChainEntry = this.processor.pendingChainEntry;
  readonly pendingPrompt = signal<Prompt | null>(null); // Always null — replay has no interactive prompts

  dequeueAnimation(): QueueEntry | null {
    return this.processor.dequeueAnimation();
  }

  removeAnimationAt(index: number): void {
    this.processor.removeAnimationAt(index);
  }

  prependToQueue(entries: QueueEntry[]): void {
    this.processor.prependToQueue(entries);
  }

  enqueueDirective(directive: QueueDirective): void {
    this.processor.enqueueDirective(directive);
  }

  setAnimating(animating: boolean): void {
    if (!animating) {
      const qBefore = this.processor.animationQueue().length;
      this.advanceStep();
      const qAfter = this.processor.animationQueue().length;
      this.logger.log(DuelLogCategory.REPLAY,
        'setAnimating(false) → advanceStep done | qBefore=%d qAfter=%d steps=%d busy=%s',
        qBefore, qAfter, this._steps.length, this.busy());
    }
  }

  applyChainSolving(chainIndex: number): void {
    this.processor.applyChainSolving(chainIndex);
  }

  applyChainSolved(chainIndex: number): void {
    this.processor.applyChainSolved(chainIndex);
  }

  applyChainEnd(): void {
    this.processor.applyChainEnd();
  }

  /**
   * Palier 0 — attach the EventStream sink (orchestrator's
   * `notifyOutOfBandEvent`). Replay only needs the processor's `onEvent`
   * for `MSG_CHAIN_NEGATED`: `SELECT_CARD` is not surfaced in replay
   * (the adapter never emits prompts as events), and `MSG_WIN` doesn't
   * need to reach EventStream on this side at all — the replay seek path
   * rebuilds the journal via `DuelGameLogService.rebuildUpTo` which calls
   * `GameLogBuilder.ingestState` directly on the precompute's per-state
   * `events[]` (which retain the original `MSG_WIN`), so the 🏆 row is
   * produced without touching the live event stream. The processor's
   * `enqueue` guard would drop `MSG_WIN` anyway (it isn't a `GameEvent`).
   */
  attachOutOfBandSink(sink: (event: StreamEvent) => void): void {
    this.processor.onEvent = sink;
  }

  // ══════════════════════════════════════════════════
  //  Perspective swap — board states arrive in absolute P0 order.
  //  When perspectiveIndex = 1, swap players so the RBS is
  //  perspective-relative (players[0] = own, players[1] = opponent),
  //  matching the PvP convention that the animation pipeline expects.
  // ══════════════════════════════════════════════════

  readonly perspectiveIndex = signal<0 | 1>(0);

  /**
   * γ Option C (PR2 c4.4, 2026-05-28) — `swapBoardState` and
   * `swapEventBoardStates` extracted to `pvp/board-state-swap.ts` as pure
   * helpers so `DuelConnection` (SOLO multiplex BOARD_STATE swap A17) can
   * reuse the same code path. The local instance methods become thin
   * adapters that close over `this.perspectiveIndex()`.
   */
  private swapBs(bs: BoardStatePayload): BoardStatePayload {
    return swapBoardState(bs, this.perspectiveIndex());
  }

  private swapEvents(events: ServerMessage[]): ServerMessage[] {
    return swapEventBoardStates(events, this.perspectiveIndex());
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
    return h ? { hintType: h.hintType, player: d!.player, value: h.value, cardName: h.cardName } : null;
  });
  readonly activeConfirmedCards = computed<CardInfo[] | null>(() => this._activeDecision()?.confirmedCards ?? null);
  readonly activeTimestamp      = computed(() => this._activeDecision()?.response.timestamp ?? null);

  private _steps: ReplayStep[] = [];

  feedTransition(prev: PreComputedState, next: PreComputedState): void {
    this.busy.set(true);
    this._steps = [];
    this.rbs.updateLogical(this.swapBs(prev.boardState));
    this.rbs.assertNoLocks('feedTransition');
    this.rbs.syncRendered();

    this.resetProcessorForTransition();
    for (const event of this.swapEvents(next.events)) {
      this.processor.processMessage(event);
    }

    const nextSwapped = this.swapBs(next.boardState);
    syncAfterBoardState(this.rbs, this.processor.chainPhase(),
      this.processor.animationQueue().length, nextSwapped, true);
    // β.1 — feed the BoundaryProcessor with the swapped board state
    // (perspective-relative, matching what PvP feeds). Turn/Phase
    // deltas emit `*Started/Ended` on the stream so the journal stays
    // PvP/Replay-parity by construction.
    this.processor.observeBoardState(nextSwapped);

    if (this.processor.animationQueue().length === 0) {
      this.rbs.syncRendered();
      this.busy.set(false);
      return;
    }
  }

  feedTransitionPhased(
    prev: PreComputedState,
    next: PreComputedState,
  ): 'prompt' | 'done' {
    if (!next.decisions?.length) {
      this.feedTransition(prev, next);
      return 'done';
    }

    this.logger.log(DuelLogCategory.REPLAY, 'feedPhased prevPhase=%s nextPhase=%s events=%d decisions=%d',
      prev.boardState.phase, next.boardState.phase, next.events.length, next.decisions.length);
    this.busy.set(true);
    this.rbs.updateLogical(this.swapBs(prev.boardState));
    this.rbs.assertNoLocks('feedTransitionPhased');
    this.rbs.syncRendered();

    this.resetProcessorForTransition();
    this._steps = this.buildSteps(
      this.swapEvents(next.events), next.decisions, this.swapBs(next.boardState));
    this.logger.log(DuelLogCategory.REPLAY, 'feedPhased steps=%o', this._steps.map(s => s.kind));
    this.advanceStep();
    return this._activeDecision() ? 'prompt' : 'done';
  }

  private buildSteps(
    rawEvents: ServerMessage[],
    decisions: DecisionMoment[],
    finalBoardState: BoardStatePayload,
  ): ReplayStep[] {
    const selectCount = rawEvents.filter(e => e.type.startsWith('SELECT_')).length;
    if (selectCount !== decisions.length) {
      this.logger.warn('[DECISION-MISMATCH] %d SELECT_* events but %d decisions — falling back to non-phased',
        selectCount, decisions.length);
      return [{ kind: 'animate', events: rawEvents, pendingState: finalBoardState }];
    }

    const steps: ReplayStep[] = [];
    let segment: ServerMessage[] = [];
    let di = 0;

    for (const e of rawEvents) {
      if (e.type.startsWith('SELECT_') && di < decisions.length) {
        // Include the SELECT_* event at the end of the preceding segment so that
        // the processor sees it during event feeding and commits pending chain entry.
        segment.push(e);
        // The decision's boardState is the state AFTER the events in this segment
        // (matches the BOARD_STATE the PvP client receives before the prompt).
        const decision = decisions[di++];
        steps.push({ kind: 'animate', events: [...segment], pendingState: decision.boardState ? this.swapBs(decision.boardState) : undefined });
        steps.push({ kind: 'decide', decision });
        segment = [];
      } else {
        segment.push(e);
      }
    }
    // Final segment: use the transition's next.boardState as pendingState so that
    // processShuffleEvent applies the post-shuffle state (matching PvP behavior where
    // the next BOARD_STATE from the server includes the shuffle result).
    steps.push({ kind: 'animate', events: [...segment], pendingState: finalBoardState });

    return steps;
  }

  private advanceStep(): void {
    while (true) {
      const step = this._steps.shift();

      if (!step) {
        this.rbs.assertNoLocks('advanceStep:done');
        this.rbs.syncRendered();
        this.busy.set(false);
        this.logger.log(DuelLogCategory.PIPELINE, 'advanceStep: end (steps exhausted)');
        return;
      }

      if (step.kind === 'decide') {
        const cards = 'cards' in step.decision.prompt
          ? (step.decision.prompt as ServerMessage & { cards: unknown[] }).cards
          : undefined;

        if (step.decision.prompt.type === 'SELECT_CHAIN') {
          // Auto-skip chain windows with no chainable cards — in PvP these are
          // auto-declined by the activation toggle and never shown to the player.
          if (!cards?.length) {
            this.logger.log(DuelLogCategory.PIPELINE,
              'advanceStep: skip SELECT_CHAIN (no chainable cards)');
            continue;
          }
        }

        this.logger.log(DuelLogCategory.PIPELINE,
          'advanceStep: decide prompt=%s', step.decision.prompt.type);
        this._activeDecision.set(step.decision);
        return; // busy stays true — waiting for resumeAfterPrompt()
      }

      this.logger.log(DuelLogCategory.PIPELINE,
        'advanceStep: animate events=%d hasPending=%s',
        step.events.length, !!step.pendingState);
      // Feed events FIRST (same as PvP: events arrive before BOARD_STATE)
      for (const event of step.events) {
        this.processor.processMessage(event);
      }

      // Shared sync — same decision as PvP BOARD_STATE handler.
      // When queue > 0 and chainPhase idle: syncRendered runs, but
      // pre-locks (from startProcessingIfIdle) protect animated zones.
      if (step.pendingState) {
        syncAfterBoardState(this.rbs, this.processor.chainPhase(),
          this.processor.animationQueue().length, step.pendingState, true);
        // β.1 — same as feedTransition: feed boundary detector with the
        // already-swapped pendingState (buildSteps swaps via buildSteps caller).
        this.processor.observeBoardState(step.pendingState);
      }

      if (this.processor.animationQueue().length === 0) {
        if (step.pendingState && this.processor.chainPhase() === 'idle') {
          this.rbs.syncRendered();
        }
        this.logger.log(DuelLogCategory.PIPELINE,
          'advanceStep: continue (queue still empty after %d events — events absorbed)',
          step.events.length);
        continue;
      }
      return;
    }
  }

  resumeAfterPrompt(): void {
    if (!this._activeDecision()) return;
    this._activeDecision.set(null);
    this.advanceStep();
  }

  collapseRemainingSteps(): void {
    this._activeDecision.set(null);
    // Clear any active zone locks before re-feeding — animations may still hold locks
    // from the interrupted step. commitAll() is the replay equivalent of PvP's onStateSync().
    this.rbs.commitAll();
    const remainingSteps = this._steps.filter((s): s is AnimateStep => s.kind === 'animate');
    const remaining = remainingSteps.flatMap(s => s.events);
    // Extract the last pendingState — fixes absorbed bug where intermediate state was lost
    const lastState = [...remainingSteps].reverse().find(s => s.pendingState)?.pendingState;
    this._steps = [];
    if (remaining.length > 0) {
      for (const event of remaining) {
        this.processor.processMessage(event);
      }
    }
    if (lastState) {
      syncAfterBoardState(this.rbs, this.processor.chainPhase(),
        this.processor.animationQueue().length, lastState, true);
      // β.1 — collapseRemainingSteps fast-forwards through the last
      // pendingState; feed it to the BP so Turn/Phase deltas still
      // emit. Without this, a "skip to end" replay control would
      // silence the closing boundaries.
      this.processor.observeBoardState(lastState);
    }
    if (this.processor.animationQueue().length === 0) {
      this.rbs.syncRendered();
      this.busy.set(false);
    }
  }

  /**
   * Reset processor for a new transition. Mid-chain transitions (chainPhase !== 'idle')
   * only clear the animation queue — chain signals (activeChainLinks, chainPhase) are
   * preserved so multi-link chains accumulate correctly across transitions.
   */
  private resetProcessorForTransition(): void {
    if (this.processor.chainPhase() === 'idle') {
      this.processor.reset();
    } else {
      this.processor.resetQueue();
    }
  }

  abort(): void {
    this.processor.reset();
    this.rbs.commitAll();
    this._steps = [];
    this._activeDecision.set(null);
    this.busy.set(false);
  }

  jumpToState(state: PreComputedState): void {
    this.abort();
    this.rbs.updateLogical(this.swapBs(state.boardState));
    this.rbs.commitAll();
  }

  ngOnDestroy(): void {
    this.rbs.destroy();
  }
}
