import { computed, signal } from '@angular/core';
import { ChainLinkState, GameEvent, StreamEvent } from '../types';
import type { BoardStatePayload, ChainingMsg, ChainNegatedMsg, ChainSolvingMsg, ChainSolvedMsg, ServerMessage } from '../duel-ws.types';
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
  MSG_MOVE: true, MSG_DRAW: true, MSG_SHUFFLE_HAND: true, MSG_SHUFFLE_DECK: true,
  MSG_DAMAGE: true, MSG_RECOVER: true, MSG_PAY_LPCOST: true,
  MSG_CHAINING: true, MSG_CHAIN_SOLVING: true, MSG_CHAIN_SOLVED: true, MSG_CHAIN_END: true,
  MSG_FLIP_SUMMONING: true, MSG_CHANGE_POS: true, MSG_SET: true, MSG_SWAP: true,
  MSG_BECOME_TARGET: true, MSG_ATTACK: true, MSG_BATTLE: true, MSG_CONFIRM_CARDS: true,
  MSG_TOSS_COIN: true, MSG_TOSS_DICE: true, MSG_EQUIP: true,
  MSG_ADD_COUNTER: true, MSG_REMOVE_COUNTER: true,
  MSG_SHUFFLE_SET_CARD: true, MSG_SWAP_GRAVE_DECK: true,
};

/** Runtime view of the GameEvent type union — derived from the exhaustive
 *  map. Exported for the F8 invariant spec (`BOARD_CHANGING_EVENT_TYPES`
 *  ⊆ this set). */
export const GAME_EVENT_TYPES: ReadonlySet<GameEvent['type']> =
  new Set(Object.keys(GAME_EVENT_TYPE_MAP) as Array<GameEvent['type']>);

function isGameEvent(msg: ServerMessage): msg is GameEvent {
  return GAME_EVENT_TYPES.has(msg.type as GameEvent['type']);
}

/**
 * Shared chain state machine and animation queue routing.
 * Plain class (NOT injectable) — instantiated privately by DuelConnection and ReplayDuelAdapter.
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
   * the adapters (DuelConnection / ReplayDuelAdapter) only know about
   * the processor, not about the BP itself.
   * Sync mandatory: chain boundaries fire inside `_processMessageInner`
   * BEFORE any state mutation, so a stream consumer never sees
   * `MSG_CHAINING(N)` without `ChainStarted(N)` first.
   *
   * `getLogger` is a closure so the BP reads the processor's `logger`
   * field lazily — the field is assigned after construction by the
   * site that wires the BP (DuelConnection / ReplayDuelAdapter), and
   * capturing it at field-init time would bind `undefined`.
   */
  private readonly boundary = new BoundaryProcessor(
    e => this.onEvent?.(e),
    () => this.logger,
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
    };
  }

  processMessage(msg: ServerMessage): void {
    const qBefore = this._animationQueue().length;
    const phaseBefore = this._chainPhase();
    this.logger?.log(DuelLogCategory.PIPELINE, 'processMessage in: type=%s qLen=%d phase=%s',
      msg.type, qBefore, phaseBefore);
    this._processMessageInner(msg);
    const qAfter = this._animationQueue().length;
    const phaseAfter = this._chainPhase();
    if (qAfter !== qBefore || phaseAfter !== phaseBefore) {
      this.logger?.log(DuelLogCategory.PIPELINE, 'processMessage out: type=%s qLen=%d→%d phase=%s→%s',
        msg.type, qBefore, qAfter, phaseBefore, phaseAfter);
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
        this._activeChainLinks.update(links =>
          links.map(l => l.chainIndex === negMsg.chainIndex ? { ...l, negated: true } : l),
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

  applyChainSolving(chainIndex: number): void {
    this._chainPhase.set('resolving');
    this._activeChainLinks.update(links =>
      links.map(l => l.chainIndex === chainIndex ? { ...l, resolving: true } : l),
    );
  }

  applyChainSolved(chainIndex: number): void {
    const before = this._activeChainLinks();
    const matched = before.some(l => l.chainIndex === chainIndex);
    this._activeChainLinks.update(links =>
      links.filter(l => l.chainIndex !== chainIndex),
    );
    if (!matched) {
      // L27 — server/client chain index drift: every CHAIN_SOLVING should
      // pair with a tracked link. Missing match means the link was already
      // pruned (replay edge) or the index never registered (server bug).
      this.logger?.warn('applyChainSolved: chainIndex %d not in active links %o',
        chainIndex, before.map(l => l.chainIndex));
    }
    this.logger?.log(DuelLogCategory.PROC, 'applyChainSolved idx=%d → remaining links=%o',
      chainIndex, this._activeChainLinks().map(l => ({ idx: l.chainIndex, loc: l.location, seq: l.sequence, zoneId: l.zoneId })));
  }

  applyChainEnd(): void {
    this._chainPhase.set('idle');
    this._activeChainLinks.set([]);
    this.logger?.log(DuelLogCategory.PROC, 'applyChainEnd → phase=idle, links cleared');
  }

  /** Restore chain state from server (reconnect CHAIN_STATE message). */
  restoreChainState(links: ChainLinkState[], phase: 'idle' | 'building' | 'resolving'): void {
    this._activeChainLinks.set(links);
    this._chainPhase.set(phase);
    this._pendingChainEntry.set(null);
  }

  /**
   * β.1 — feed a BOARD_STATE payload to the boundary detector. Called
   * by the WS adapter (DuelConnection / ReplayDuelAdapter) from its
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

  /** Clear only the animation queue — preserves chain state for cross-transition chains. */
  resetQueue(): void {
    this._animationQueue.set([]);
  }

  reset(): void {
    this._animationQueue.set([]);
    this._activeChainLinks.set([]);
    this._chainPhase.set('idle');
    this._pendingChainEntry.set(null);
    // β.1 — drop boundary state silently. `reset()` is hard teardown
    // (duel destroy, fresh start) — the stream subscriber dies with the
    // same scope, so emitting `*Ended` here would just pollute a stream
    // nobody is reading. Use `forceBoundaryClosure(reason)` from the
    // adapter when a §3.6 checkpoint is the actual cause and the
    // journal should see the closures.
    this.boundary.silentReset();
  }
}
