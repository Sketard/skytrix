import { computed, signal } from '@angular/core';
import { ChainLinkState, GameEvent, StreamEvent } from '../types';
import type {
  BoardStatePayload,
  ChainingMsg,
  ChainNegatedMsg,
  ChainSolvingMsg,
  ChainSolvedMsg,
  ServerMessage,
} from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { BoundaryProcessor, type BoundaryClosureReason } from './boundary-processor';
import { DuelLogCategory, type DuelLogger } from './duel-logger';
import type { QueueEntry } from './animation-data-source';

// Exhaustive map keyed on every member of the `GameEvent` type union (F8,
// 2026-05-31). TypeScript will fail to compile if a new GameEvent variant
// is added without a corresponding entry here (key missing on
// `Record<…, true>`) or if an entry strays outside the union ("…" is not
// assignable to "GameEvent['type']"). Either side stays in sync by
// construction; no runtime test can degrade silently. Replaces the prior
// hand-written `new Set([…])` whose hand-maintained list could diverge
// from `GameEvent` undetected — causing `enqueue` to silently drop the new
// event with a `logger.warn` (in chain resolution: bufferIfResolving still
// captured it via BOARD_CHANGING_EVENT_TYPES, then drainBuffer → enqueue
// → drop, leaving a hole in the animation sequence). Used as the runtime
// guard for the cast in `enqueue` (audit finding L26).
const GAME_EVENT_TYPE_MAP: Record<GameEvent['type'], true> = {
  MSG_MOVE: true,
  MSG_DRAW: true,
  MSG_SHUFFLE_HAND: true,
  MSG_SHUFFLE_DECK: true,
  MSG_DAMAGE: true,
  MSG_RECOVER: true,
  MSG_PAY_LPCOST: true,
  MSG_CHAINING: true,
  MSG_CHAIN_SOLVING: true,
  MSG_CHAIN_SOLVED: true,
  MSG_CHAIN_END: true,
  MSG_FLIP_SUMMONING: true,
  MSG_CHANGE_POS: true,
  MSG_SET: true,
  MSG_SWAP: true,
  MSG_BECOME_TARGET: true,
  MSG_ATTACK: true,
  MSG_BATTLE: true,
  MSG_CONFIRM_CARDS: true,
  MSG_TOSS_COIN: true,
  MSG_TOSS_DICE: true,
  MSG_EQUIP: true,
  MSG_ADD_COUNTER: true,
  MSG_REMOVE_COUNTER: true,
  MSG_SHUFFLE_SET_CARD: true,
  MSG_SWAP_GRAVE_DECK: true,
};

/** Runtime view of the GameEvent type union — derived from the exhaustive
 *  map. Exported for the F8 invariant spec (`BOARD_CHANGING_EVENT_TYPES`
 *  ⊆ this set). */
export const GAME_EVENT_TYPES: ReadonlySet<GameEvent['type']> = new Set(
  Object.keys(GAME_EVENT_TYPE_MAP) as Array<GameEvent['type']>
);

function isGameEvent(msg: ServerMessage): msg is GameEvent {
  return GAME_EVENT_TYPES.has(msg.type as GameEvent['type']);
}

/**
 * Shared chain state machine and animation queue routing.
 * Plain class (NOT injectable) — instantiated privately by DuelConnection and MockDuelConnection.
 *
 * F9 (2026-05-31) — cross-side parity invariant. The server mirrors a
 * minimal version of this machine in
 * `duel-server/src/chain-state-tracker.ts` (`applyChainTransition`).
 * The transition table MUST stay aligned — see CLAUDE.md → "Cross-side
 * `chainPhase` parity (F9)" for the full matrix. Client-side, the
 * machine is split across `_processMessageInner` (CHAINING/NEGATED
 * sync, BELOW) and `applyChainSolving`/`applyChainEnd` (driven from
 * the queue runner, lower in this file). Any change to either branch
 * MUST be reflected in `applyChainTransition` server-side or the
 * `CHAIN_STATE` reconnect handshake will drift silently.
 */
export class DuelEventProcessor {
  logger?: DuelLogger;
  /**
   * Palier 0 — out-of-band hook for `GameEvent`s the processor consumes
   * without enqueueing (currently only `MSG_CHAIN_NEGATED`). The hook lets
   * the orchestrator surface them on its `EventStream` so the Game Log
   * sees the "Nié" badge in PvP live. NOT called for events that DO
   * enqueue — those reach the orchestrator's `processEvent` naturally and
   * are tapped there. The invariant "`MSG_CHAIN_NEGATED` is NOT pushed to
   * `animationQueue`" stays true: the callback is a parallel stream.
   */
  onEvent?: (event: StreamEvent) => void;

  private _activeChainLinks = signal<ChainLinkState[]>([]);
  private _chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  private _animationQueue = signal<QueueEntry[]>([]);
  // The chain link from the latest MSG_CHAINING — held here until the next
  // chain message commits it into `_activeChainLinks` (deferred so cards
  // that need cost payment finish their move animation first). Exposed so the
  // hand row can already mark a just-activated card as revealed (z-index +
  // chain badge) before the commit lands.
  private _pendingChainEntry = signal<ChainLinkState | null>(null);
  // Dense-chain fix (2026-06-12) — the two ends of the generation window.
  // `_chainGeneration` counts MSG_CHAIN_END *received* (sync, wire order);
  // every link built tags the current value. `_dispatchedEndCount` counts
  // applyChainEnd calls (queue dispatch, FIFO ⇒ the Nth call closes
  // generation N-1). Without the scoping, chain N's END dispatch wiped the
  // links of chain N+1 already committed by sync receipt (CHAINING(N+1) +
  // SOLVING(N+1) received while chain N's END still sat in the animation
  // queue) — the overlay then had no link to drop at SOLVED(N+1) dispatch,
  // never signalled `chainOverlayReady`, and the runner deadlocked on
  // `isWaitingForOverlay` (D/D/D 24-chain fixture, trace in
  // _bmad-output/debug-solo/ddd-stall-diag/).
  private _chainGeneration = 0;
  private _dispatchedEndCount = 0;

  readonly activeChainLinks = this._activeChainLinks.asReadonly();
  readonly chainPhase = this._chainPhase.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly();
  readonly pendingChainEntry = this._pendingChainEntry.asReadonly();
  readonly hasPendingChainEntry = computed(() => this._pendingChainEntry() !== null);

  /**
   * β.1 (2026-05-26) — boundary detector. Emits `ChainStarted/Ended`,
   * `TurnStarted/Ended`, `PhaseStarted/Ended` on the same `onEvent`
   * sink as `MSG_CHAIN_NEGATED` etc. The processor delegates two
   * public methods (`observeBoardState`, `forceBoundaryClosure`) so
   * the adapters (DuelConnection / MockDuelConnection) only know about
   * the processor, not about the BP itself.
   * Sync mandatory: chain boundaries fire inside `_processMessageInner`
   * BEFORE any state mutation, so a stream consumer never sees
   * `MSG_CHAINING(N)` without `ChainStarted(N)` first.
   *
   * `getLogger` is a closure so the BP reads the processor's `logger`
   * field lazily — the field is assigned after construction by the
   * site that wires the BP (DuelConnection / MockDuelConnection), and
   * capturing it at field-init time would bind `undefined`.
   */
  private readonly boundary = new BoundaryProcessor(
    e => this.onEvent?.(e),
    () => this.logger
  );

  // Enqueue only if `msg` is a known GameEvent — runtime guard via
  // GAME_EVENT_TYPES set lets us narrow the discriminated union without an
  // unchecked cast. Non-GameEvent messages reaching here would indicate a
  // routing bug; the logger trace surfaces it instead of corrupting the queue.
  private enqueue(msg: ServerMessage): void {
    if (!isGameEvent(msg)) {
      this.logger?.warn('enqueue: dropped non-GameEvent type %s', msg.type);
      return;
    }
    this._animationQueue.update(q => [...q, msg]);
  }

  private commitPendingChainEntry(): void {
    const entry = this._pendingChainEntry();
    if (entry) {
      this._pendingChainEntry.set(null);
      this._activeChainLinks.update(links => [...links, entry]);
    }
  }

  private buildChainLinkState(msg: ChainingMsg): ChainLinkState {
    return {
      chainIndex: msg.chainIndex,
      cardCode: msg.cardCode,
      cardName: msg.cardName,
      player: msg.player,
      zoneId: locationToZoneId(msg.location, msg.sequence),
      location: msg.location,
      sequence: msg.sequence,
      resolving: false,
      negated: false,
      descriptionText: msg.descriptionText,
      handCopiesAtChaining: msg.handCopiesAtChaining,
      generation: this._chainGeneration,
    };
  }

  processMessage(msg: ServerMessage): void {
    const qBefore = this._animationQueue().length;
    const phaseBefore = this._chainPhase();
    this.logger?.log(
      DuelLogCategory.PIPELINE,
      'processMessage in: type=%s qLen=%d phase=%s',
      msg.type,
      qBefore,
      phaseBefore
    );
    this._processMessageInner(msg);
    const qAfter = this._animationQueue().length;
    const phaseAfter = this._chainPhase();
    if (qAfter !== qBefore || phaseAfter !== phaseBefore) {
      this.logger?.log(
        DuelLogCategory.PIPELINE,
        'processMessage out: type=%s qLen=%d→%d phase=%s→%s',
        msg.type,
        qBefore,
        qAfter,
        phaseBefore,
        phaseAfter
      );
    }
  }

  private _processMessageInner(msg: ServerMessage): void {
    // β.1 — boundary detection runs FIRST so a `ChainStarted(N)` is
    // emitted on `onEvent` before the matching `MSG_CHAINING(N)` is
    // enqueued and forwarded. Sync-mandatory ordering by construction.
    this.boundary.observeMessage(msg);
    switch (msg.type) {
      case 'MSG_CHAINING': {
        const chainingMsg = msg as ChainingMsg;
        if (this._chainPhase() === 'idle') {
          this._chainPhase.set('building');
        }
        this.commitPendingChainEntry();
        this._pendingChainEntry.set(this.buildChainLinkState(chainingMsg));
        this.enqueue(msg);
        break;
      }
      case 'MSG_CHAIN_NEGATED': {
        const negMsg = msg as ChainNegatedMsg;
        this.logger?.log(DuelLogCategory.PROC, 'MSG_CHAIN_NEGATED chainIndex=%d', negMsg.chainIndex);
        const pending = this._pendingChainEntry();
        if (pending?.chainIndex === negMsg.chainIndex) {
          this._pendingChainEntry.set({ ...pending, negated: true });
        }
        // Dense-chain fix — a NEGATED received now belongs to the current
        // RECEIPT generation; don't flag a same-index link of a previous
        // chain still awaiting its dispatch-side clear.
        this._activeChainLinks.update(links =>
          links.map(l =>
            l.chainIndex === negMsg.chainIndex && (l.generation ?? 0) === this._chainGeneration
              ? { ...l, negated: true }
              : l
          )
        );
        this.onEvent?.(negMsg);
        break;
      }
      case 'WAITING_RESPONSE':
        this.commitPendingChainEntry();
        break;
      case 'MSG_CHAIN_SOLVING':
        this.logger?.log(DuelLogCategory.PROC, 'MSG_CHAIN_SOLVING chainIndex=%d', (msg as ChainSolvingMsg).chainIndex);
        this.commitPendingChainEntry();
        this.enqueue(msg);
        break;
      case 'MSG_CHAIN_SOLVED':
        this.logger?.log(DuelLogCategory.PROC, 'MSG_CHAIN_SOLVED chainIndex=%d', (msg as ChainSolvedMsg).chainIndex);
        this.enqueue(msg);
        break;
      case 'MSG_CHAIN_END':
        this.logger?.log(DuelLogCategory.PROC, 'MSG_CHAIN_END');
        this.commitPendingChainEntry();
        // Dense-chain fix — close the receipt-side generation AFTER the
        // pending commit (a pending entry at END receipt belongs to the
        // closing chain: wire order guarantees CHAINING(N+1) arrives after
        // END(N)). Links built from here on belong to the next chain and
        // survive this END's dispatch-side clear.
        this._chainGeneration++;
        this.enqueue(msg);
        break;
      default:
        if (msg.type.startsWith('SELECT_') || msg.type.startsWith('ANNOUNCE_') || msg.type.startsWith('SORT_')) {
          this.commitPendingChainEntry();
        } else {
          this.enqueue(msg);
        }
        break;
    }
  }

  dequeueAnimation(): QueueEntry | null {
    const q = this._animationQueue();
    if (q.length === 0) return null;
    const first = q[0];
    this._animationQueue.update(queue => queue.slice(1));
    return first;
  }

  removeAnimationAt(index: number): void {
    this._animationQueue.update(q => [...q.slice(0, index), ...q.slice(index + 1)]);
  }

  prependToQueue(entries: QueueEntry[]): void {
    this._animationQueue.update(q => [...entries, ...q]);
  }

  /** β.3 cas #13 — append-side enqueue (typically an `announcement`
   *  directive produced outside the message pipeline). Server events
   *  already in queue keep priority. */
  enqueueDirective(directive: QueueEntry): void {
    this._animationQueue.update(q => [...q, directive]);
  }

  /** Dense-chain fix — a dispatching SOLVING/SOLVED always belongs to the
   *  generation currently being dispatched (`_dispatchedEndCount`: ENDs
   *  dispatched so far). Matching on chainIndex alone would hit a
   *  same-index link of the NEXT chain already committed by sync receipt
   *  (chain indices restart at 0 every chain). */
  private isDispatchingGenerationLink(l: ChainLinkState, chainIndex: number): boolean {
    return l.chainIndex === chainIndex && (l.generation ?? 0) === this._dispatchedEndCount;
  }

  applyChainSolving(chainIndex: number): void {
    this._chainPhase.set('resolving');
    this._activeChainLinks.update(links =>
      links.map(l => (this.isDispatchingGenerationLink(l, chainIndex) ? { ...l, resolving: true } : l))
    );
  }

  /**
   * Drops the dispatching-generation link matching `chainIndex` and returns
   * whether a link was actually removed. The caller's overlay-arming guard
   * MUST consume this bool rather than re-derive it on chainIndex alone — in
   * a dense back-to-back chain a same-index link of the NEXT generation is
   * already committed by sync receipt, so a chainIndex-only test reports a
   * phantom match while THIS drop removes nothing, arming an overlay wait
   * that can never resolve (runner deadlock on pause-external).
   */
  applyChainSolved(chainIndex: number): boolean {
    const before = this._activeChainLinks();
    const matched = before.some(l => this.isDispatchingGenerationLink(l, chainIndex));
    this._activeChainLinks.update(links => links.filter(l => !this.isDispatchingGenerationLink(l, chainIndex)));
    if (!matched) {
      // L27 — server/client chain index drift: every CHAIN_SOLVING should
      // pair with a tracked link. Missing match means the link was already
      // pruned (replay edge) or the index never registered (server bug).
      this.logger?.warn(
        'applyChainSolved: chainIndex %d not in active links %o',
        chainIndex,
        before.map(l => l.chainIndex)
      );
    }
    this.logger?.log(
      DuelLogCategory.PROC,
      'applyChainSolved idx=%d → remaining links=%o',
      chainIndex,
      this._activeChainLinks().map(l => ({ idx: l.chainIndex, loc: l.location, seq: l.sequence, zoneId: l.zoneId }))
    );
    return matched;
  }

  /**
   * Dense-chain fix (2026-06-12) — the clear is GENERATION-SCOPED, not a
   * blanket wipe. The Nth dispatched END closes generation N-1 (FIFO queue
   * ⇒ dispatch order = receipt order); links of a later generation were
   * committed for the NEXT chain (its CHAINING/SOLVING received while this
   * END was still queued) and MUST survive, otherwise the overlay has no
   * link to drop at the next chain's SOLVED dispatch and the runner
   * deadlocks on `isWaitingForOverlay`. Survivors ⇒ phase 'building' (the
   * next chain is announced but not yet resolving — mirrors the server's
   * container, which already holds those links at this point).
   */
  applyChainEnd(): void {
    const closedGeneration = this._dispatchedEndCount++;
    const remaining = this._activeChainLinks().filter(l => (l.generation ?? 0) > closedGeneration);
    this._activeChainLinks.set(remaining);
    this._chainPhase.set(remaining.length > 0 ? 'building' : 'idle');
    this.logger?.log(
      DuelLogCategory.PROC,
      'applyChainEnd → phase=%s, gen %d closed, %d link(s) survive',
      this._chainPhase(),
      closedGeneration,
      remaining.length
    );
  }

  /** Restore chain state from server (reconnect CHAIN_STATE message). */
  restoreChainState(links: ChainLinkState[], phase: 'idle' | 'building' | 'resolving'): void {
    // Dense-chain fix — rebase the generation window. Restored links carry
    // no `generation` (the server snapshot ships raw ChainingMsg data) and
    // read as generation 0 via the `?? 0` fallbacks, so the counters must
    // restart at 0 for the dispatch-side matching to find them.
    //
    // The rebase is only sound on an EMPTY queue: a stale MSG_CHAIN_END left
    // queued would dispatch later, bump `_dispatchedEndCount`, and close the
    // freshly rebased generation 0 — wiping every restored link mid-restore.
    // The nominal PvP path (STATE_SYNC → reset → CHAIN_STATE) and the replay
    // seek path both clear the queue first, but the degraded "CHAIN_STATE
    // without STATE_SYNC" branch (protocol violation, best-effort restore)
    // does NOT — so clear it here to make the precondition self-enforcing
    // rather than caller-dependent. Idempotent for the paths that already reset.
    this._animationQueue.set([]);
    this._chainGeneration = 0;
    this._dispatchedEndCount = 0;
    this._activeChainLinks.set(links);
    this._chainPhase.set(phase);
    this._pendingChainEntry.set(null);
  }

  /**
   * β.1 — feed a BOARD_STATE payload to the boundary detector. Called
   * by the WS adapter (DuelConnection / MockDuelConnection) from its
   * BOARD_STATE handler. The BP emits `TurnStarted/Ended` and
   * `PhaseStarted/Ended` on `onEvent` based on `turnCount/turnPlayer/phase`
   * deltas.
   */
  observeBoardState(payload: BoardStatePayload): void {
    this.boundary.observeBoardState(payload);
  }

  /**
   * β.1 — force-close every open boundary group (chain / turn / phase).
   * Called by the WS adapter on `STATE_SYNC`, `RematchStarted`, or
   * `DUEL_END` per §3.6 + §3.8: a checkpoint closes the causality and
   * anything previously open must be ended synthetically before fresh
   * boundaries can open.
   */
  forceBoundaryClosure(reason: BoundaryClosureReason): void {
    this.boundary.forceClosure(reason);
  }

  reset(): void {
    this._animationQueue.set([]);
    this._activeChainLinks.set([]);
    this._chainPhase.set('idle');
    this._pendingChainEntry.set(null);
    this._chainGeneration = 0;
    this._dispatchedEndCount = 0;
    // β.1 — drop boundary state silently. `reset()` is hard teardown
    // (duel destroy, fresh start) — the stream subscriber dies with the
    // same scope, so emitting `*Ended` here would just pollute a stream
    // nobody is reading. Use `forceBoundaryClosure(reason)` from the
    // adapter when a §3.6 checkpoint is the actual cause and the
    // journal should see the closures.
    this.boundary.silentReset();
  }
}
