import { LOCATION } from '../duel-ws.types';
import type { ChainingMsg, ChainNegatedMsg, ChainSolvingMsg, ChainSolvedMsg, ServerMessage } from '../duel-ws.types';
import type { GameEvent } from '../types';
import type { QueueEntry } from './animation-data-source';
import { DuelEventProcessor } from './duel-event-processor';

/** Narrows a QueueEntry to GameEvent for `.type` access in assertions. */
const asEvent = (e: QueueEntry): GameEvent => e as GameEvent;

const chaining = (chainIndex: number, cardCode = 100, sequence = 0): ChainingMsg => ({
  type: 'MSG_CHAINING', chainIndex, cardCode, cardName: `Card ${cardCode}`,
  player: 0, location: LOCATION.HAND, sequence, description: 0,
});

const chainSolving = (chainIndex: number): ChainSolvingMsg => ({ type: 'MSG_CHAIN_SOLVING', chainIndex });
const chainSolved = (chainIndex: number): ChainSolvedMsg => ({ type: 'MSG_CHAIN_SOLVED', chainIndex });
const chainEnd = (): ServerMessage => ({ type: 'MSG_CHAIN_END' }) as any;
const chainNegated = (chainIndex: number): ChainNegatedMsg => ({ type: 'MSG_CHAIN_NEGATED', chainIndex });
const waitingResponse = (): ServerMessage => ({ type: 'WAITING_RESPONSE' }) as any;
const selectCard = (): ServerMessage => ({ type: 'SELECT_CARD' }) as any;
const msgMove = (): ServerMessage => ({ type: 'MSG_MOVE' }) as any;
const msgDamage = (): ServerMessage => ({ type: 'MSG_DAMAGE', player: 0, amount: 500 }) as any;

describe('DuelEventProcessor', () => {
  let proc: DuelEventProcessor;

  beforeEach(() => { proc = new DuelEventProcessor(); });

  describe('initial state', () => {
    it('should start idle with empty queue and no chain links', () => {
      expect(proc.chainPhase()).toBe('idle');
      expect(proc.activeChainLinks()).toEqual([]);
      expect(proc.animationQueue()).toEqual([]);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });
  });

  describe('processMessage — chain lifecycle', () => {
    it('should transition to building on first MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      expect(proc.chainPhase()).toBe('building');
    });

    it('should not overwrite building phase on second MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      expect(proc.chainPhase()).toBe('building');
    });

    it('should set hasPendingChainEntry on MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      expect(proc.hasPendingChainEntry()).toBeTrue();
    });

    it('should commit pending entry and replace it on consecutive MSG_CHAINING', () => {
      proc.processMessage(chaining(0, 100));
      proc.processMessage(chaining(1, 200));
      // First chaining committed to activeChainLinks, second is pending
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].chainIndex).toBe(0);
      expect(proc.hasPendingChainEntry()).toBeTrue();
    });

    it('should commit pending entry on WAITING_RESPONSE', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    it('should commit pending entry on SELECT_* prompts', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(selectCard());
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    it('should commit pending entry on MSG_CHAIN_SOLVING', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chainSolving(0));
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    it('should commit pending entry on MSG_CHAIN_END', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chainEnd());
      expect(proc.activeChainLinks().length).toBe(1);
    });
  });

  describe('processMessage — chain link state', () => {
    it('should build ChainLinkState with correct zoneId from location+sequence', () => {
      proc.processMessage({
        type: 'MSG_CHAINING', chainIndex: 0, cardCode: 42, cardName: 'Monster',
        player: 1, location: LOCATION.MZONE, sequence: 2, description: 0,
      } as ChainingMsg);
      proc.processMessage(waitingResponse());
      const link = proc.activeChainLinks()[0];
      expect(link.zoneId).toBe('M3');
      expect(link.player).toBe(1);
      expect(link.resolving).toBeFalse();
      expect(link.negated).toBeFalse();
    });

    it('should set zoneId to null for HAND location', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      expect(proc.activeChainLinks()[0].zoneId).toBeNull();
    });
  });

  describe('processMessage — MSG_CHAIN_NEGATED', () => {
    it('should mark committed chain link as negated', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      proc.processMessage(chainNegated(0));
      expect(proc.activeChainLinks()[0].negated).toBeTrue();
    });

    it('should mark pending chain entry as negated', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chainNegated(0));
      // Commit and check
      proc.processMessage(waitingResponse());
      expect(proc.activeChainLinks()[0].negated).toBeTrue();
    });

    it('should not affect other chain links', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      proc.processMessage(waitingResponse());
      proc.processMessage(chainNegated(1));
      expect(proc.activeChainLinks()[0].negated).toBeFalse();
      expect(proc.activeChainLinks()[1].negated).toBeTrue();
    });

    it('should NOT enqueue MSG_CHAIN_NEGATED', () => {
      proc.processMessage(chaining(0));
      const qBefore = proc.animationQueue().length;
      proc.processMessage(chainNegated(0));
      expect(proc.animationQueue().length).toBe(qBefore);
    });
  });

  describe('processMessage — queue routing', () => {
    it('should enqueue MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      expect(proc.animationQueue().length).toBe(1);
      expect(asEvent(proc.animationQueue()[0]).type).toBe('MSG_CHAINING');
    });

    it('should enqueue MSG_CHAIN_SOLVING', () => {
      proc.processMessage(chainSolving(0));
      expect(proc.animationQueue().some(e => asEvent(e).type === 'MSG_CHAIN_SOLVING')).toBeTrue();
    });

    it('should enqueue MSG_CHAIN_SOLVED', () => {
      proc.processMessage(chainSolved(0));
      expect(proc.animationQueue().some(e => asEvent(e).type === 'MSG_CHAIN_SOLVED')).toBeTrue();
    });

    it('should enqueue MSG_CHAIN_END', () => {
      proc.processMessage(chainEnd());
      expect(proc.animationQueue().some(e => asEvent(e).type === 'MSG_CHAIN_END')).toBeTrue();
    });

    it('should enqueue generic visual messages (MSG_MOVE, MSG_DAMAGE)', () => {
      proc.processMessage(msgMove());
      proc.processMessage(msgDamage());
      expect(proc.animationQueue().length).toBe(2);
    });

    it('should NOT enqueue SELECT_* prompts', () => {
      proc.processMessage(selectCard());
      expect(proc.animationQueue().length).toBe(0);
    });

    it('should NOT enqueue WAITING_RESPONSE', () => {
      proc.processMessage(waitingResponse());
      expect(proc.animationQueue().length).toBe(0);
    });
  });

  describe('applyChainSolving', () => {
    it('should set phase to resolving and mark link', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(0);
      expect(proc.chainPhase()).toBe('resolving');
      expect(proc.activeChainLinks()[0].resolving).toBeTrue();
    });

    it('should only mark the targeted chain link', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(1);
      expect(proc.activeChainLinks()[0].resolving).toBeFalse();
      expect(proc.activeChainLinks()[1].resolving).toBeTrue();
    });
  });

  describe('applyChainSolved', () => {
    it('should remove the solved link', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      proc.processMessage(waitingResponse());
      proc.applyChainSolved(1);
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].chainIndex).toBe(0);
    });
  });

  describe('applyChainEnd', () => {
    it('should reset to idle with no links', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(0);
      proc.applyChainEnd();
      expect(proc.chainPhase()).toBe('idle');
      expect(proc.activeChainLinks()).toEqual([]);
    });
  });

  describe('queue operations', () => {
    it('dequeueAnimation should return first entry and remove it', () => {
      proc.processMessage(msgMove());
      proc.processMessage(msgDamage());
      const first = proc.dequeueAnimation()!;
      expect(asEvent(first).type).toBe('MSG_MOVE');
      expect(proc.animationQueue().length).toBe(1);
    });

    it('dequeueAnimation should return null on empty queue', () => {
      expect(proc.dequeueAnimation()).toBeNull();
    });

    it('removeAnimationAt should remove entry at given index', () => {
      proc.processMessage(msgMove());
      proc.processMessage(msgDamage());
      proc.processMessage(msgMove());
      proc.removeAnimationAt(1);
      expect(proc.animationQueue().length).toBe(2);
      expect(proc.animationQueue().every(e => asEvent(e).type === 'MSG_MOVE')).toBeTrue();
    });

    it('prependToQueue should insert entries before existing ones', () => {
      proc.processMessage(msgDamage());
      proc.prependToQueue([msgMove() as any]);
      expect(asEvent(proc.animationQueue()[0]).type).toBe('MSG_MOVE');
      expect(asEvent(proc.animationQueue()[1]).type).toBe('MSG_DAMAGE');
    });
  });

  describe('restoreChainState', () => {
    it('should restore links and phase, clearing pending entry', () => {
      proc.processMessage(chaining(0));
      const links = [{ chainIndex: 2, cardCode: 50, cardName: 'X', player: 0, zoneId: 'M1', location: LOCATION.MZONE, sequence: 0, resolving: true, negated: false }];
      proc.restoreChainState(links, 'resolving');
      expect(proc.activeChainLinks()).toEqual(links);
      expect(proc.chainPhase()).toBe('resolving');
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(msgDamage());
      proc.reset();
      expect(proc.chainPhase()).toBe('idle');
      expect(proc.activeChainLinks()).toEqual([]);
      expect(proc.animationQueue()).toEqual([]);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });
  });

  describe('resetQueue', () => {
    it('should clear queue but preserve chain state', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(0);
      proc.processMessage(msgDamage());
      proc.resetQueue();
      expect(proc.animationQueue()).toEqual([]);
      expect(proc.chainPhase()).toBe('resolving');
      expect(proc.activeChainLinks().length).toBe(1);
    });
  });
});
