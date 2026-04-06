import { signal } from '@angular/core';
import { ChainLinkState, GameEvent } from '../types';
import type { ChainingMsg, ChainNegatedMsg, ChainSolvingMsg, ChainSolvedMsg, ServerMessage } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { DuelLogCategory, type DuelLogger } from './duel-logger';
import type { QueueEntry } from './animation-data-source';

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

  // Only visual + chain messages are enqueued (never prompts/system messages).
  // ServerMessage is a wider union, so the cast is safe at this single site.
  private enqueue(msg: ServerMessage): void {
    this._animationQueue.update(q => [...q, msg as GameEvent]);
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
    this._activeChainLinks.update(links =>
      links.filter(l => l.chainIndex !== chainIndex),
    );
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
