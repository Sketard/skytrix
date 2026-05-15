import { InjectionToken, Signal } from '@angular/core';
import type { Prompt, GameEvent, ChainLinkState, DuelState } from '../types';
import type { RenderedBoardStateService } from './rendered-board-state.service';

// ---------------------------------------------------------------------------
// Queue directive types (Phase 6)
// ---------------------------------------------------------------------------

export type QueueDirective =
  | { kind: 'group'; events: GameEvent[]; staggerMs?: number }
  | { kind: 'barrier' }
  | { kind: 'lp'; event: GameEvent }
  | { kind: 'batch-end'; resolve: () => void }
  | { kind: 'await-signal'; signal: Signal<boolean> };

export type QueueEntry = GameEvent | QueueDirective;

export function isDirective(entry: QueueEntry): entry is QueueDirective {
  return 'kind' in entry;
}

// ---------------------------------------------------------------------------
// Data source interface
// ---------------------------------------------------------------------------

/**
 * Data source interface for the animation pipeline.
 *
 * Implemented by DuelWebSocketService (live PvP) and ReplayDuelAdapter (replay).
 * Injected by AnimationOrchestratorService and PvpChainOverlayComponent via
 * the ANIMATION_DATA_SOURCE token — they never reference the concrete class.
 *
 * NOTE: DuelConnection (duel-connection.ts) is an EXISTING concrete class
 * with WebSocket internals. Do NOT modify it. This interface extracts only
 * the subset needed by the animation pipeline.
 */
export interface AnimationDataSource {
  readonly renderedBoardState: RenderedBoardStateService;
  readonly animationQueue: Signal<QueueEntry[]>;
  readonly activeChainLinks: Signal<ChainLinkState[]>;
  readonly chainPhase: Signal<'idle' | 'building' | 'resolving'>;
  readonly pendingPrompt: Signal<Prompt | null>;

  dequeueAnimation(): QueueEntry | null;
  removeAnimationAt(index: number): void;
  prependToQueue(entries: QueueEntry[]): void;
  setAnimating(animating: boolean): void;
  applyChainSolving(chainIndex: number): void;
  applyChainSolved(chainIndex: number): void;
  applyChainEnd(): void;
}

export const ANIMATION_DATA_SOURCE = new InjectionToken<AnimationDataSource>('AnimationDataSource');

/**
 * Shared BOARD_STATE sync decision — used by both DuelConnection and
 * ReplayDuelAdapter. Preserves current PvP semantics exactly.
 */
export function syncAfterBoardState(
  rbs: RenderedBoardStateService,
  chainPhase: 'idle' | 'building' | 'resolving',
  queueLength: number,
  boardState: DuelState,
  boardActive: boolean,
): void {
  rbs.updateLogical(boardState);
  if (!boardActive) {
    // Pre-activation: the orchestrator parks the initial MSG_DRAW × 5 in
    // `_preActivationBuffer` while `boardActive=false`. A full `commitAll()`
    // here would copy the server's post-draw zones (HAND already populated)
    // straight into the rendered state, so when the buffer drains the
    // animation plays ON TOP of cards already visible in hand. Use
    // `syncPileCounts()` instead: it brings DECK/EXTRA counts + global
    // metadata up to date (so the deck pile is visible to "draw from")
    // without touching the zone arrays. The buffered MSG_DRAWs commit
    // HAND via their normal lockZone/commit cycle after the drain.
    rbs.syncPileCounts();
  } else if (chainPhase === 'idle' && queueLength === 0) {
    rbs.syncRendered();
  } else if (chainPhase !== 'resolving') {
    // Queue has events whose zones may not be pre-locked yet (pre-locks
    // are placed by the orchestrator after the queue watcher fires).
    // Full syncRendered() would expose animated zones prematurely (e.g.
    // HAND showing cards before draw animation). Only sync pile counts
    // (DECK/EXTRA) which are never locked and would otherwise stay stale
    // until the next commitUnlocked().
    rbs.syncPileCounts();
  }
  // resolving: defer — orchestrator controls commits via chain overlay contract
}

/**
 * Peek into the animation queue, find the first event matching predicate,
 * remove it, and return it.
 *
 * **Complexity**: O(n) per call — `findIndex` walks the queue and
 * `removeAnimationAt` re-spreads it. Callers must NOT loop this over a
 * large queue (would be O(m·n)).
 *
 * **Expected queue size**: ≤ 50 entries in PvP/replay (typical: 5-15 for
 * initial draw, 1-3 mid-game, up to 30-40 during long chains with buffer
 * replay). Both current callers (`DrawSequenceManager.peekAndDequeueOther
 * InitialDraw` and the MSG_MOVE pairing path in draw sequences) make a
 * single call per event, so amortized cost is bounded.
 *
 * If the queue ever grows beyond 100, switch to an indexed structure
 * (Map<eventType, indexSet>) before this becomes a real hot-path concern.
 */
export function peekAndDequeueMatching<T extends GameEvent>(
  dataSource: AnimationDataSource,
  predicate: (e: GameEvent) => boolean,
): T | null {
  const queue = dataSource.animationQueue();
  const idx = queue.findIndex(e => !isDirective(e) && predicate(e));
  if (idx === -1) return null;
  const msg = queue[idx] as T;
  dataSource.removeAnimationAt(idx);
  return msg;
}
