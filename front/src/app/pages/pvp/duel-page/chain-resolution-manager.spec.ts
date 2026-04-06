import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DuelLogger } from './duel-logger';
import type { GameEvent } from '../types';
import type { ChainSolvingMsg, ChainSolvedMsg } from '../duel-ws.types';

const solving = (chainIndex: number): GameEvent => ({ type: 'MSG_CHAIN_SOLVING', chainIndex }) as ChainSolvingMsg as GameEvent;
const solved = (chainIndex: number): GameEvent => ({ type: 'MSG_CHAIN_SOLVED', chainIndex }) as ChainSolvedMsg as GameEvent;
const move = (): GameEvent => ({ type: 'MSG_MOVE' }) as any;
const damage = (): GameEvent => ({ type: 'MSG_DAMAGE', player: 0, amount: 100 }) as any;
const draw = (): GameEvent => ({ type: 'MSG_DRAW', player: 0, cards: [] }) as any;
const chainEnd = (): GameEvent => ({ type: 'MSG_CHAIN_END' }) as any;

describe('ChainResolutionManager', () => {
  let mgr: ChainResolutionManager;

  beforeEach(() => {
    const mockLogger = { log: () => {}, warn: () => {} };
    TestBed.configureTestingModule({
      providers: [
        ChainResolutionManager,
        { provide: DuelLogger, useValue: mockLogger },
      ],
    });
    mgr = TestBed.inject(ChainResolutionManager);
  });

  describe('initial state', () => {
    it('should start idle', () => {
      expect(mgr.isResolving).toBeFalse();
      expect(mgr.isWaitingForOverlay).toBeFalse();
      expect(mgr.chainSolvedCount).toBe(0);
      expect(mgr.hasActiveReplayTimeouts).toBeFalse();
      expect(mgr.hasBufferedEvents).toBeFalse();
      expect(mgr.deferredSolvingEvent).toBeNull();
    });
  });

  describe('handleSolving — single-link chain', () => {
    it('should enter resolution for chainIndex 0 (single link)', () => {
      const result = mgr.handleSolving(solving(0));
      expect(result.deferred).toBeFalse();
      expect(result.isSingleLink).toBeTrue();
      expect(mgr.isResolving).toBeTrue();
    });
  });

  describe('handleSolving — multi-link chain (first solving deferred)', () => {
    it('should defer first solving when chainIndex > 0 and solvedCount === 0', () => {
      const result = mgr.handleSolving(solving(2));
      expect(result.deferred).toBeTrue();
      expect(mgr.isResolving).toBeFalse();
      expect(mgr.deferredSolvingEvent).toBeTruthy();
    });

    it('should not defer when solvedCount > 0 (subsequent links)', () => {
      // Simulate first link resolved
      mgr.handleSolving(solving(0));
      mgr.handleSolved(solved(0));
      mgr.clearWaiting();

      const result = mgr.handleSolving(solving(1));
      expect(result.deferred).toBeFalse();
      expect(result.isSingleLink).toBeFalse();
    });
  });

  describe('handleSolved', () => {
    it('should exit resolution, increment solvedCount, set waitingForOverlay', () => {
      mgr.handleSolving(solving(0));
      const result = mgr.handleSolved(solved(0));
      expect(result).toBe('async');
      expect(mgr.isResolving).toBeFalse();
      expect(mgr.isWaitingForOverlay).toBeTrue();
      expect(mgr.chainSolvedCount).toBe(1);
    });

    it('should set chainOverlayBoardChanged when buffer has events', () => {
      mgr.handleSolving(solving(0));
      mgr.bufferIfResolving(move());
      mgr.handleSolved(solved(0));
      expect(mgr.chainOverlayBoardChanged()).toBeTrue();
    });

    it('should set chainOverlayBoardChanged to false when buffer is empty', () => {
      mgr.handleSolving(solving(0));
      mgr.handleSolved(solved(0));
      expect(mgr.chainOverlayBoardChanged()).toBeFalse();
    });
  });

  describe('handleEnd', () => {
    it('should reset all chain state', () => {
      mgr.handleSolving(solving(0));
      mgr.bufferIfResolving(move());
      mgr.handleSolved(solved(0));
      mgr.handleEnd();
      expect(mgr.isResolving).toBeFalse();
      expect(mgr.isWaitingForOverlay).toBeFalse();
      expect(mgr.chainSolvedCount).toBe(0);
      expect(mgr.hasBufferedEvents).toBeFalse();
      expect(mgr.deferredSolvingEvent).toBeNull();
    });
  });

  describe('bufferIfResolving', () => {
    it('should buffer board-changing events during resolution', () => {
      mgr.handleSolving(solving(0));
      expect(mgr.bufferIfResolving(move())).toBeTrue();
      expect(mgr.bufferIfResolving(damage())).toBeTrue();
      expect(mgr.bufferIfResolving(draw())).toBeTrue();
      expect(mgr.hasBufferedEvents).toBeTrue();
    });

    it('should not buffer when not resolving', () => {
      expect(mgr.bufferIfResolving(move())).toBeFalse();
      expect(mgr.hasBufferedEvents).toBeFalse();
    });

    it('should not buffer non-board-changing events', () => {
      mgr.handleSolving(solving(0));
      const nonBoardEvent = { type: 'MSG_HINT' } as any;
      expect(mgr.bufferIfResolving(nonBoardEvent)).toBeFalse();
    });
  });

  describe('BOARD_CHANGING_EVENTS set', () => {
    const expected = [
      'MSG_MOVE', 'MSG_DRAW', 'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
      'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET', 'MSG_SHUFFLE_HAND',
      'MSG_CONFIRM_CARDS', 'MSG_SHUFFLE_DECK', 'MSG_TOSS_COIN', 'MSG_TOSS_DICE',
      'MSG_EQUIP', 'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER', 'MSG_SHUFFLE_SET_CARD',
      'MSG_SWAP_GRAVE_DECK',
    ];

    it('should contain exactly the expected event types', () => {
      expect(ChainResolutionManager.BOARD_CHANGING_EVENTS.size).toBe(expected.length);
      for (const type of expected) {
        expect(ChainResolutionManager.BOARD_CHANGING_EVENTS.has(type)).toBeTrue();
      }
    });
  });

  describe('drainBuffer', () => {
    it('should return buffered events and clear buffer', () => {
      mgr.handleSolving(solving(0));
      mgr.bufferIfResolving(move());
      mgr.bufferIfResolving(damage());
      const drained = mgr.drainBuffer();
      expect(drained.length).toBe(2);
      expect(mgr.hasBufferedEvents).toBeFalse();
    });

    it('should call clearTimeout on each replay timeout', () => {
      spyOn(globalThis, 'clearTimeout').and.callThrough();
      const t1 = setTimeout(() => {}, 9999);
      const t2 = setTimeout(() => {}, 9999);
      mgr.addReplayTimeout(t1);
      mgr.addReplayTimeout(t2);
      mgr.drainBuffer();
      expect(globalThis.clearTimeout).toHaveBeenCalledWith(t1);
      expect(globalThis.clearTimeout).toHaveBeenCalledWith(t2);
      expect(mgr.hasActiveReplayTimeouts).toBeFalse();
    });
  });

  describe('replay timeouts', () => {
    it('should track and clear replay timeouts', () => {
      spyOn(globalThis, 'clearTimeout').and.callThrough();
      const t1 = setTimeout(() => {}, 9999);
      const t2 = setTimeout(() => {}, 9999);
      mgr.addReplayTimeout(t1);
      mgr.addReplayTimeout(t2);
      expect(mgr.hasActiveReplayTimeouts).toBeTrue();
      mgr.clearReplayTimeouts();
      expect(mgr.hasActiveReplayTimeouts).toBeFalse();
      expect(globalThis.clearTimeout).toHaveBeenCalledWith(t1);
      expect(globalThis.clearTimeout).toHaveBeenCalledWith(t2);
    });
  });

  describe('consumeDeferredSolving', () => {
    it('should return and clear the deferred event', () => {
      mgr.handleSolving(solving(2)); // deferred
      const event = mgr.consumeDeferredSolving();
      expect(event).toBeTruthy();
      expect((event as any).chainIndex).toBe(2);
      expect(mgr.deferredSolvingEvent).toBeNull();
    });

    it('should return null when nothing deferred', () => {
      expect(mgr.consumeDeferredSolving()).toBeNull();
    });
  });

  describe('clearWaiting', () => {
    it('should clear the waiting-for-overlay flag', () => {
      mgr.handleSolving(solving(0));
      mgr.handleSolved(solved(0));
      expect(mgr.isWaitingForOverlay).toBeTrue();
      mgr.clearWaiting();
      expect(mgr.isWaitingForOverlay).toBeFalse();
    });
  });

  describe('scheduleBannerAnnounce', () => {
    it('should set chainResolutionAnnounce after delay', fakeAsync(() => {
      expect(mgr.chainResolutionAnnounce()).toBeFalse();
      mgr.scheduleBannerAnnounce(10);
      tick(10);
      expect(mgr.chainResolutionAnnounce()).toBeTrue();
    }));
  });

  describe('instant (queue collapse)', () => {
    it('applyInstantSolving should enter resolution and clear buffer', () => {
      mgr.handleSolving(solving(0));
      mgr.bufferIfResolving(move());
      mgr.applyInstantSolving();
      expect(mgr.isResolving).toBeTrue();
      expect(mgr.hasBufferedEvents).toBeFalse();
    });

    it('applyInstantSolved should exit resolution and clear buffer', () => {
      mgr.applyInstantSolving();
      mgr.applyInstantSolved();
      expect(mgr.isResolving).toBeFalse();
      expect(mgr.hasBufferedEvents).toBeFalse();
    });
  });

  describe('reset', () => {
    it('should clear everything', () => {
      mgr.handleSolving(solving(0));
      mgr.bufferIfResolving(move());
      mgr.handleSolved(solved(0));
      mgr.addReplayTimeout(setTimeout(() => {}, 9999));
      mgr.chainEntryAnimating.set(true);
      mgr.chainPromptGateActive.set(true);

      mgr.reset();

      expect(mgr.isResolving).toBeFalse();
      expect(mgr.isWaitingForOverlay).toBeFalse();
      expect(mgr.chainSolvedCount).toBe(0);
      expect(mgr.hasBufferedEvents).toBeFalse();
      expect(mgr.hasActiveReplayTimeouts).toBeFalse();
      expect(mgr.deferredSolvingEvent).toBeNull();
      expect(mgr.chainResolutionAnnounce()).toBeFalse();
      expect(mgr.chainEntryAnimating()).toBeFalse();
      expect(mgr.chainPromptGateActive()).toBeFalse();
      expect(mgr.chainOverlayBoardChanged()).toBeFalse();
      expect(mgr.chainOverlayReady()).toBeTrue();
    });
  });

  describe('clearTimeouts', () => {
    it('should clear banner and replay timeouts', () => {
      mgr.scheduleBannerAnnounce(9999);
      mgr.addReplayTimeout(setTimeout(() => {}, 9999));
      mgr.clearTimeouts();
      expect(mgr.hasActiveReplayTimeouts).toBeFalse();
    });
  });

  describe('full chain lifecycle', () => {
    it('should handle a complete 3-link chain resolution', () => {
      // Link CL0 solving (deferred because chainIndex=2 means 3-link chain resolves from top)
      // Actually, first solving is chainIndex=2 (top of 3-link chain)
      const r0 = mgr.handleSolving(solving(2));
      expect(r0.deferred).toBeTrue();

      // Consume deferred, simulate banner, then re-process
      mgr.consumeDeferredSolving();
      mgr.chainResolutionAnnounce.set(true);
      const r0b = mgr.handleSolving(solving(2));
      expect(r0b.deferred).toBeFalse();
      expect(mgr.isResolving).toBeTrue();

      // Buffer some events during resolution
      mgr.bufferIfResolving(move());
      mgr.bufferIfResolving(damage());

      // CL2 solved
      mgr.handleSolved(solved(2));
      expect(mgr.chainSolvedCount).toBe(1);
      expect(mgr.isWaitingForOverlay).toBeTrue();
      mgr.clearWaiting();

      // CL1 solving (not deferred, solvedCount > 0)
      const r1 = mgr.handleSolving(solving(1));
      expect(r1.deferred).toBeFalse();

      // CL1 solved
      mgr.handleSolved(solved(1));
      expect(mgr.chainSolvedCount).toBe(2);
      mgr.clearWaiting();

      // CL0 solving
      mgr.handleSolving(solving(0));
      mgr.handleSolved(solved(0));
      expect(mgr.chainSolvedCount).toBe(3);
      mgr.clearWaiting();

      // Chain end
      mgr.handleEnd();
      expect(mgr.chainSolvedCount).toBe(0);
      expect(mgr.isResolving).toBeFalse();
    });
  });

  describe('initResumeEffect', () => {
    it('should call onResume when chainOverlayReady becomes true while waiting', () => {
      const onResume = jasmine.createSpy('onResume');
      mgr.initResumeEffect(onResume);

      // Enter resolution → solved → waiting for overlay
      mgr.handleSolving(solving(0));
      mgr.handleSolved(solved(0));
      expect(mgr.isWaitingForOverlay).toBeTrue();

      // Simulate overlay completing (ready goes false → true)
      mgr.chainOverlayReady.set(false);
      TestBed.flushEffects();
      expect(onResume).not.toHaveBeenCalled();

      mgr.chainOverlayReady.set(true);
      TestBed.flushEffects();
      expect(onResume).toHaveBeenCalledTimes(1);
      expect(mgr.isWaitingForOverlay).toBeFalse();
    });

    it('should not call onResume when not waiting for overlay', () => {
      const onResume = jasmine.createSpy('onResume');
      mgr.initResumeEffect(onResume);

      mgr.chainOverlayReady.set(false);
      TestBed.flushEffects();
      mgr.chainOverlayReady.set(true);
      TestBed.flushEffects();
      expect(onResume).not.toHaveBeenCalled();
    });
  });
});
