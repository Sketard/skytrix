import { InjectionToken, Signal } from '@angular/core';
import type { Prompt, GameEvent, ChainLinkState, DuelState, StreamEvent } from '../types';
import type { BoardStateView, RenderedBoardStateService } from './rendered-board-state.service';

// ---------------------------------------------------------------------------
// Queue directive types (Phase 6)
// ---------------------------------------------------------------------------

/**
 * β.3 — sequential-announcement-gating directive (catalogue ε3 cas #13,
 * 2026-05-26). Bloque le dispatch des events suivants pendant
 * `durationMs` d'affichage d'une annonce visuelle (phase / chain
 * resolution / future banners). Le runner appelle `onShow()`
 * synchronement, awaite `durationMs` (scalé par speedMultiplier),
 * puis appelle `onClear()` avant de relâcher la queue. Une seule
 * directive d'annonce active à la fois — la sérialisation est garantie
 * par la queue elle-même.
 *
 * `source` est un identifiant logique (phase / chain-resolution / …)
 * destiné au tracing + à la déduplication éventuelle si plusieurs sites
 * de production enqueueraient des annonces concurrentes.
 */
export interface AnnouncementDirective {
  kind: 'announcement';
  source: string;
  /**
   * Total time the directive holds the banner visible. `onShow` fires at
   * `prePauseMs` (default 0) ; `onClear` fires at `durationMs`. The runner
   * scales both via `ctx.scaledDuration` so playback-speed applies. Asymmetric
   * pause + show lets the chain banner reproduce its 1000ms pre-pause +
   * 2000ms visible-window timing inside a single directive.
   */
  durationMs: number;
  prePauseMs?: number;
  /**
   * When `true`, the directive fires `onShow` synchronously, schedules
   * `onClear` via setTimeout, and returns 'continue' immediately — the
   * queue does NOT pause for `durationMs`. Used by phase announces (DRAW
   * / STANDBY / MAIN1 / …) so the next MSG_DRAW / event animation can play
   * in parallel with the banner. Default `false` keeps the chain-resolution
   * banner blocking (its `MSG_CHAIN_SOLVING` companion is in the queue
   * RIGHT after and must wait for the banner to clear).
   */
  nonBlocking?: boolean;
  onShow: () => void;
  onClear: () => void;
}

export type QueueDirective =
  | { kind: 'group'; events: GameEvent[]; staggerMs?: number }
  | { kind: 'barrier' }
  | { kind: 'lp'; event: GameEvent }
  | { kind: 'batch-end'; resolve: () => void }
  | { kind: 'await-signal'; signal: Signal<boolean> }
  | AnnouncementDirective;

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
 * Implemented by `DuelWebSocketService` (live PvP + SOLO multiplex) and
 * `MockDuelConnection` (replay). Injected by `AnimationOrchestratorService`
 * and `PvpChainOverlayComponent` via the `ANIMATION_DATA_SOURCE` token —
 * they never reference the concrete class.
 *
 * **Scope** : data + lifecycle calls needed by the animation pipeline
 * (orchestrator + managers + queue runner). Methods that are mode-specific
 * (only PvP, or only replay) stay OFF this interface and are reached via a
 * direct concrete injection on the page that needs them — see the
 * **mode-specific surfaces** list below.
 *
 * **Mode-specific surfaces** (NOT part of this contract — injected
 * directly by the consumer that needs them) :
 *  - `attachDrawNewTurnSink(sink)` — PvP/SOLO only ; replay rebuilds the
 *    journal via the per-state `events[]`, no live turn-delta needed.
 *  - `onStateSync` (callback field) — PvP/SOLO only ; STATE_SYNC is a WS
 *    reconnect/cancel-rollback mechanism that has no replay analogue.
 *  - `setBoardActive(active)` — PvP/SOLO only ; the replay adapter has no
 *    "board active" gate (precompute drives `busy`).
 *  - The `MockDuelConnection` stream-consumption API (`dispatchNext`,
 *    `appendChunk`, `seekToOffset`, `busy`, `pendingPrompt` extras, …)
 *    — replay only.
 *
 * Adding a member here forces BOTH impls to implement it. If a new
 * concept is genuinely shared (e.g. a future demo / sub-replay mode that
 * needs it), add it ; otherwise keep it as a mode-specific surface.
 */
export interface AnimationDataSource {
  readonly renderedBoardState: RenderedBoardStateService;
  /** Read-only view of board state. Distinct from `renderedBoardState` :
   *  the latter is the full write/control surface (locks, commits) used
   *  by the orchestrator + managers ; this one is the read surface for
   *  templates + non-orchestrator consumers (audit L25). */
  readonly boardStateView: BoardStateView;
  readonly animationQueue: Signal<QueueEntry[]>;
  readonly activeChainLinks: Signal<ChainLinkState[]>;
  readonly chainPhase: Signal<'idle' | 'building' | 'resolving'>;
  readonly hasPendingChainEntry: Signal<boolean>;
  readonly pendingChainEntry: Signal<ChainLinkState | null>;
  readonly pendingPrompt: Signal<Prompt | null>;

  dequeueAnimation(): QueueEntry | null;
  removeAnimationAt(index: number): void;
  prependToQueue(entries: QueueEntry[]): void;
  /**
   * β.3 cas #13 (2026-05-26) — append-side enqueue for directives produced
   * outside the message pipeline (phase announcement, future banners).
   * Differs from `prependToQueue` in that it adds to the TAIL — incoming
   * server events keep priority over a presentation gate. The runner
   * picks the directive up on the next tick after the current queue
   * drains.
   */
  enqueueDirective(directive: QueueDirective): void;
  setAnimating(animating: boolean): void;
  applyChainSolving(chainIndex: number): void;
  /** Returns whether a dispatching-generation link was actually dropped. The
   *  overlay-arming guard MUST consume this rather than re-derive on
   *  chainIndex alone (dense back-to-back chains share chainIndex 0). */
  applyChainSolved(chainIndex: number): boolean;
  applyChainEnd(): void;
  /**
   * Palier 0 — attach the EventStream sink. The page bootstrap wires
   * this to `orchestrator.pushToStream` (γ-c cleanup F-1.2 retired the
   * `notifyOutOfBandEvent` wrapper). Routes events that bypass the
   * animation queue by design (`MSG_CHAIN_NEGATED`, `SELECT_CARD`,
   * synthesised `MSG_WIN` from `DUEL_END`, β.1 `BoundaryEvent`s) onto
   * the stream so the journal + projections observe them in arrival
   * order. Both impls wire this to their underlying
   * `DuelEventProcessor.onEvent`.
   */
  attachOutOfBandSink(sink: (event: StreamEvent) => void): void;
}

export const ANIMATION_DATA_SOURCE = new InjectionToken<AnimationDataSource>('AnimationDataSource');

/**
 * Shared BOARD_STATE sync decision — used by both DuelConnection and
 * MockDuelConnection. Preserves current PvP semantics exactly.
 */
export function syncAfterBoardState(
  rbs: RenderedBoardStateService,
  chainPhase: 'idle' | 'building' | 'resolving',
  queueLength: number,
  boardState: DuelState,
  boardActive: boolean,
): void {
  // 2026-06-04 Option N — Skip updateLogical if the chain is resolving AND
  // there are still events in the queue. The BOARD_STATE that arrives mid-
  // chain (typically right after MSG_CHAIN_END is enqueued via WS) carries
  // the FINAL post-chain state. Letting it overwrite logical now causes the
  // first MOVE's destination commit (e.g. GY-0 after Krosea HAND→GY travel)
  // to copy the FINAL logical → rendered → subsequent MOVE's destination
  // card appears at the DOM before its own travel even starts.
  //
  // The per-event `boardStateAfter` snapshots (server Option 2b + Option O
  // — the tracker no longer resets per runDuelLoop, so the window survives
  // across player prompts inside a chain) advance the logical state at
  // each event's dispatch. The mid-chain BOARD_STATE is redundant for
  // these zones and harmful for the dispatch-order invariant.
  //
  // Bug repro: PvP discard cost + self-destroy scenario, see spec
  // `_bmad-output/planning-artifacts/bug-post-chain-solved-buffer-drain-2026-06-04.md`.
  const skipUpdateLogical = chainPhase === 'resolving' && queueLength > 0;
  if (!skipUpdateLogical) {
    rbs.updateLogical(boardState);
  }
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
  /**
   * Optional barrier : stop scanning (return null) if an event satisfying
   * `stopBefore` is encountered before a `predicate` match. Lets a caller
   * restrict the steal to the queue prefix that belongs to the current
   * logical unit (e.g. the shuffle-induced MOVE→HAND steal must not reach
   * across a chain boundary into a *future* chain's tutor move — D/D/D
   * tutor cluster, 2026-06-12). Directives are skipped, not treated as
   * barriers.
   */
  stopBefore?: (e: GameEvent) => boolean,
): T | null {
  const queue = dataSource.animationQueue();
  let idx = -1;
  for (let i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (isDirective(e)) continue;
    if (predicate(e)) { idx = i; break; }
    if (stopBefore?.(e)) return null;
  }
  if (idx === -1) return null;
  const msg = queue[idx] as T;
  dataSource.removeAnimationAt(idx);
  return msg;
}
