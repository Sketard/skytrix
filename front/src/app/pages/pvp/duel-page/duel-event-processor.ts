import { signal } from '@angular/core';
import { ChainLinkState, GameEvent } from '../types';
import type { ChainingMsg, ChainNegatedMsg, ChainSolvingMsg, ChainSolvedMsg, ServerMessage } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { DuelLogCategory, type DuelLogger } from './duel-logger';
import type { QueueEntry } from './animation-data-source';

// Set of ServerMessage `type` values that map to a GameEvent member. Used as
// the runtime guard for the cast in `enqueue` (audit finding L26). The cast
// is safe because every entry here is a discriminant of the GameEvent union.
const GAME_EVENT_TYPES: ReadonlySet<GameEvent['type']> = new Set([
  'MSG_MOVE', 'MSG_DRAW', 'MSG_SHUFFLE_HAND', 'MSG_SHUFFLE_DECK',
  'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
  'MSG_CHAINING', 'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED', 'MSG_CHAIN_END',
  'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET', 'MSG_SWAP',
  'MSG_BECOME_TARGET', 'MSG_ATTACK', 'MSG_BATTLE', 'MSG_CONFIRM_CARDS',
  'MSG_TOSS_COIN', 'MSG_TOSS_DICE', 'MSG_EQUIP',
  'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER',
  'MSG_SHUFFLE_SET_CARD', 'MSG_SWAP_GRAVE_DECK',
]);

function isGameEvent(msg: ServerMessage): msg is GameEvent {
  return GAME_EVENT_TYPES.has(msg.type as GameEvent['type']);
}

/**
 * Shared chain state machine and animation queue routing.
 * Plain class (NOT injectable) — instantiated privately by DuelConnection and ReplayDuelAdapter.
 */
export class DuelEventProcessor {
  logger?: DuelLogger;

  private _activeChainLinks = signal<ChainLinkState[]>([]);
  private _chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  private _animationQueue = signal<QueueEntry[]>([]);
  private _hasPendingChainEntry = signal(false);
  private _pendingChainEntry: ChainLinkState | null = null;

  readonly activeChainLinks = this._activeChainLinks.asReadonly();
  readonly chainPhase = this._chainPhase.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly();
  readonly hasPendingChainEntry = this._hasPendingChainEntry.asReadonly();

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
    if (this._pendingChainEntry) {
      const entry = this._pendingChainEntry;
      this._pendingChainEntry = null;
      this._hasPendingChainEntry.set(false);
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
    switch (msg.type) {
      case 'MSG_CHAINING': {
        const chainingMsg = msg as ChainingMsg;
        if (this._chainPhase() === 'idle') {
          this._chainPhase.set('building');
        }
        this.commitPendingChainEntry();
        this._pendingChainEntry = this.buildChainLinkState(chainingMsg);
        this._hasPendingChainEntry.set(true);
        this.enqueue(msg);
        break;
      }
      case 'MSG_CHAIN_NEGATED': {
        const negMsg = msg as ChainNegatedMsg;
        this.logger?.log(DuelLogCategory.PROC, 'MSG_CHAIN_NEGATED chainIndex=%d', negMsg.chainIndex);
        if (this._pendingChainEntry?.chainIndex === negMsg.chainIndex) {
          this._pendingChainEntry = { ...this._pendingChainEntry, negated: true };
        }
        this._activeChainLinks.update(links =>
          links.map(l => l.chainIndex === negMsg.chainIndex ? { ...l, negated: true } : l),
        );
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
    this._pendingChainEntry = null;
    this._hasPendingChainEntry.set(false);
  }

  /** Clear only the animation queue — preserves chain state for cross-transition chains. */
  resetQueue(): void {
    this._animationQueue.set([]);
  }

  reset(): void {
    this._animationQueue.set([]);
    this._activeChainLinks.set([]);
    this._chainPhase.set('idle');
    this._pendingChainEntry = null;
    this._hasPendingChainEntry.set(false);
  }
}
