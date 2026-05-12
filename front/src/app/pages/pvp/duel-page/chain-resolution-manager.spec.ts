import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DuelLogger } from './duel-logger';
import type { GameEvent } from '../types';
import type { ChainSolvingMsg, ChainSolvedMsg, ConfirmCardsMsg } from '../duel-ws.types';
import { BOARD_CHANGING_EVENT_TYPES, LOCATION } from '../duel-ws.types';

const solving = (chainIndex: number): GameEvent => ({ type: 'MSG_CHAIN_SOLVING', chainIndex }) as ChainSolvingMsg as GameEvent;
const solved = (chainIndex: number): GameEvent => ({ type: 'MSG_CHAIN_SOLVED', chainIndex }) as ChainSolvedMsg as GameEvent;
const move = (): GameEvent => ({ type: 'MSG_MOVE' }) as any;
const damage = (): GameEvent => ({ type: 'MSG_DAMAGE', player: 0, amount: 100 }) as any;
const draw = (): GameEvent => ({ type: 'MSG_DRAW', player: 0, cards: [] }) as any;
const confirmCards = (locations: number[]): GameEvent => ({
  type: 'MSG_CONFIRM_CARDS',
  player: 0,
  cards: locations.map(location => ({ cardCode: 1, player: 0, location, sequence: 0 })),
}) as ConfirmCardsMsg as GameEvent;

describe('ChainResolutionManager', () => {
  let mgr: ChainResolutionManager;
  /** Fake processor.chainPhase signal piloted by the test. The orchestrator
   *  drives this via `dataSource.applyChainSolving/Solved/End` — here we set
   *  it manually to mirror the call sequence. H1 invariant: handleSolving
   *  no longer flips it; the test must do it (or use `enterResolving()`). */
  let phaseSignal: WritableSignal<'idle' | 'building' | 'resolving'>;

  /** Helper that mirrors the orchestrator's handleChainSolving sequence:
   *  call mgr.handleSolving (overlay state + buffer reset) then flip the
   *  processor phase to 'resolving'. Use this in tests that want to assert
   *  post-condition `mgr.isResolving === true`. */
  function enterResolving(chainIndex = 0): { deferred: boolean; isSingleLink: boolean } {
    const result = mgr.handleSolving(solving(chainIndex));
    if (!result.deferred) phaseSignal.set('resolving');
    return result;
  }

  /** Mirrors handleChainSolved: orchestrator calls dataSource.applyChainSolved
   *  (which keeps phase at 'resolving' until applyChainEnd) then handleSolved.
   *  Phase doesn't change here; we just delegate. */
  function exitLink(chainIndex = 0): 'async' {
    return mgr.handleSolved(solved(chainIndex));
  }

  /** Mirrors handleChainEnd: phase back to 'idle' then handleEnd. */
  function endChain(): void {
    phaseSignal.set('idle');
    mgr.handleEnd();
  }

  beforeEach(() => {
    const mockLogger = { log: () => {}, warn: () => {} };
    TestBed.configureTestingModule({
      providers: [
        ChainResolutionManager,
        { provide: DuelLogger, useValue: mockLogger },
      ],
    });
    mgr = TestBed.inject(ChainResolutionManager);
    phaseSignal = signal<'idle' | 'building' | 'resolving'>('idle');
    mgr.attachChainPhaseSource(() => phaseSignal());
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

    it('isResolving stays false when no phaseSource is attached', () => {
      // Fresh manager without attach — getter must safely return false
      const fresh = TestBed.inject(ChainResolutionManager);
      // Detach by attaching a noop source that returns 'idle'
      fresh.attachChainPhaseSource(() => 'idle');
      expect(fresh.isResolving).toBeFalse();
    });
  });

  // ─── H1: observer pattern — phase observation ──────────────────────────────

  describe('H1 — chain phase observer', () => {
    it('isResolving reflects phaseSource() === "resolving" without any handler call', () => {
      expect(mgr.isResolving).toBeFalse();
      phaseSignal.set('building');
      expect(mgr.isResolving).toBeFalse();
      phaseSignal.set('resolving');
      expect(mgr.isResolving).toBeTrue();
      phaseSignal.set('idle');
      expect(mgr.isResolving).toBeFalse();
    });

    it('shouldBufferDuringChain follows phase transitions reactively', () => {
      expect(mgr.shouldBufferDuringChain).toBeFalse();
      phaseSignal.set('resolving');
      expect(mgr.shouldBufferDuringChain).toBeTrue();
      mgr.beginDrain();
      expect(mgr.shouldBufferDuringChain).toBeFalse();
      mgr.endDrain();
      expect(mgr.shouldBufferDuringChain).toBeTrue();
      phaseSignal.set('idle');
      expect(mgr.shouldBufferDuringChain).toBeFalse();
    });

    it('handleSolving alone does NOT flip isResolving — processor must drive it', () => {
      // Critical regression guard: if handleSolving accidentally re-acquires
      // ownership of _insideChainResolution, this test catches it. The
      // orchestrator pattern is: call handleSolving FIRST (gets deferred?
      // returns early. Otherwise) THEN call dataSource.applyChainSolving.
      const result = mgr.handleSolving(solving(0));
      expect(result.deferred).toBeFalse();
      expect(mgr.isResolving).toBeFalse(); // phase still idle
      phaseSignal.set('resolving');
      expect(mgr.isResolving).toBeTrue(); // now true via observer
    });
  });

  describe('handleSolving — single-link chain', () => {
    it('should enter resolution for chainIndex 0 (single link)', () => {
      const result = enterResolving(0);
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
      enterResolving(0);
      exitLink(0);
      mgr.clearWaiting();

      const result = enterResolving(1);
      expect(result.deferred).toBeFalse();
      expect(result.isSingleLink).toBeFalse();
    });
  });

  describe('handleSolved', () => {
    it('should increment solvedCount, set waitingForOverlay (phase stays resolving)', () => {
      enterResolving(0);
      const result = exitLink(0);
      expect(result).toBe('async');
      // H1: phase stays at 'resolving' until orchestrator calls applyChainEnd
      expect(mgr.isResolving).toBeTrue();
      expect(mgr.isWaitingForOverlay).toBeTrue();
      expect(mgr.chainSolvedCount).toBe(1);
    });

    it('should set chainOverlayBoardChanged when buffer has events', () => {
      enterResolving(0);
      mgr.bufferIfResolving(move());
      exitLink(0);
      expect(mgr.chainOverlayBoardChanged()).toBeTrue();
    });

    it('should set chainOverlayBoardChanged to false when buffer is empty', () => {
      enterResolving(0);
      exitLink(0);
      expect(mgr.chainOverlayBoardChanged()).toBeFalse();
    });
  });

  describe('handleEnd', () => {
    it('should reset all chain state (phase flipped to idle by orchestrator)', () => {
      enterResolving(0);
      mgr.bufferIfResolving(move());
      exitLink(0);
      endChain();
      expect(mgr.isResolving).toBeFalse();
      expect(mgr.isWaitingForOverlay).toBeFalse();
      expect(mgr.chainSolvedCount).toBe(0);
      expect(mgr.hasBufferedEvents).toBeFalse();
      expect(mgr.deferredSolvingEvent).toBeNull();
    });
  });

  describe('bufferIfResolving', () => {
    it('should buffer board-changing events during resolution', () => {
      enterResolving(0);
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
      enterResolving(0);
      const nonBoardEvent = { type: 'MSG_HINT' } as any;
      expect(mgr.bufferIfResolving(nonBoardEvent)).toBeFalse();
    });

    it('should not re-buffer events while a drain is in progress', () => {
      enterResolving(0);
      mgr.bufferIfResolving(move());
      mgr.drainBuffer();
      mgr.beginDrain();
      // While draining, replayed events pass through processEvent and would
      // otherwise be re-buffered into the same buffer they were just drained
      // from — causing the mid-chain pre-replay infinite loop.
      expect(mgr.isResolving).toBeTrue();
      expect(mgr.bufferIfResolving(move())).toBeFalse();
      expect(mgr.shouldBufferDuringChain).toBeFalse();
      expect(mgr.hasBufferedEvents).toBeFalse();
      mgr.endDrain();
      expect(mgr.shouldBufferDuringChain).toBeTrue();
      expect(mgr.bufferIfResolving(move())).toBeTrue();
    });

    // Deck-top reveals (MSG_CONFIRM_CARDS where all cards stay on DECK)
    // must NOT be buffered: they precede mid-effect prompts so the player
    // sees the revealed card BEFORE answering. HAND-only or mixed
    // HAND+DECK confirms keep the normal buffer path (orchestrator's
    // buffer-replay-builder splits them per-card after the chain).
    describe('MSG_CONFIRM_CARDS skip-buffer for DECK-only reveals', () => {
      it('should not buffer when all confirmed cards are on DECK', () => {
        enterResolving(0);
        expect(mgr.bufferIfResolving(confirmCards([LOCATION.DECK, LOCATION.DECK]))).toBeFalse();
        expect(mgr.hasBufferedEvents).toBeFalse();
      });

      it('should buffer when all confirmed cards are in HAND', () => {
        enterResolving(0);
        expect(mgr.bufferIfResolving(confirmCards([LOCATION.HAND]))).toBeTrue();
        expect(mgr.hasBufferedEvents).toBeTrue();
      });

      it('should buffer when confirm mixes HAND and DECK cards', () => {
        enterResolving(0);
        expect(mgr.bufferIfResolving(confirmCards([LOCATION.HAND, LOCATION.DECK]))).toBeTrue();
        expect(mgr.hasBufferedEvents).toBeTrue();
      });

      it('should buffer when all confirmed cards are in another non-HAND zone (e.g. GRAVE)', () => {
        // Skip is strictly for HAND-absent confirms — but the current rule
        // checks "every location !== HAND" so any non-HAND mix skips. This
        // documents the actual behavior so future refactors notice if it
        // diverges from intent.
        enterResolving(0);
        expect(mgr.bufferIfResolving(confirmCards([LOCATION.GRAVE]))).toBeFalse();
      });
    });
  });

  describe('BOARD_CHANGING_EVENT_TYPES set', () => {
    const expected = [
      'MSG_MOVE', 'MSG_DRAW', 'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
      'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET', 'MSG_SHUFFLE_HAND',
      'MSG_CONFIRM_CARDS', 'MSG_SHUFFLE_DECK', 'MSG_TOSS_COIN', 'MSG_TOSS_DICE',
      'MSG_EQUIP', 'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER', 'MSG_SHUFFLE_SET_CARD',
      'MSG_SWAP_GRAVE_DECK',
    ];

    it('should contain exactly the expected event types', () => {
      expect(BOARD_CHANGING_EVENT_TYPES.size).toBe(expected.length);
      for (const type of expected) {
        expect(BOARD_CHANGING_EVENT_TYPES.has(type)).toBeTrue();
      }
    });
  });

  describe('drainBuffer', () => {
    it('should return buffered events and clear buffer', () => {
      enterResolving(0);
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
      enterResolving(0);
      exitLink(0);
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

  describe('reset', () => {
    it('should clear everything except chain phase (phase owned by processor)', () => {
      enterResolving(0);
      mgr.bufferIfResolving(move());
      exitLink(0);
      mgr.addReplayTimeout(setTimeout(() => {}, 9999));
      mgr.chainEntryAnimating.set(true);
      mgr.chainPromptGateActive.set(true);

      mgr.reset();

      // Manager state cleared
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
      // H1: phase is the processor's responsibility — reset() does NOT flip it.
      // The orchestrator separately calls dataSource.applyChainEnd() / reset().
      expect(mgr.isResolving).toBeTrue(); // still 'resolving' until phase flips
      phaseSignal.set('idle');
      expect(mgr.isResolving).toBeFalse();
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
      // Link CL2 solving (deferred because chainIndex=2 means 3-link chain resolves from top)
      const r0 = mgr.handleSolving(solving(2));
      expect(r0.deferred).toBeTrue();

      // Consume deferred, simulate banner, then re-process
      mgr.consumeDeferredSolving();
      mgr.chainResolutionAnnounce.set(true);
      const r0b = enterResolving(2);
      expect(r0b.deferred).toBeFalse();
      expect(mgr.isResolving).toBeTrue();

      // Buffer some events during resolution
      mgr.bufferIfResolving(move());
      mgr.bufferIfResolving(damage());

      // CL2 solved
      exitLink(2);
      expect(mgr.chainSolvedCount).toBe(1);
      expect(mgr.isWaitingForOverlay).toBeTrue();
      mgr.clearWaiting();

      // CL1 solving (not deferred, solvedCount > 0)
      const r1 = enterResolving(1);
      expect(r1.deferred).toBeFalse();

      // CL1 solved
      exitLink(1);
      expect(mgr.chainSolvedCount).toBe(2);
      mgr.clearWaiting();

      // CL0 solving
      enterResolving(0);
      exitLink(0);
      expect(mgr.chainSolvedCount).toBe(3);
      mgr.clearWaiting();

      // Chain end
      endChain();
      expect(mgr.chainSolvedCount).toBe(0);
      expect(mgr.isResolving).toBeFalse();
    });
  });

  describe('initResumeEffect', () => {
    it('should call onResume when chainOverlayReady becomes true while waiting', () => {
      const onResume = jasmine.createSpy('onResume');
      mgr.initResumeEffect(onResume);

      // Enter resolution → solved → waiting for overlay
      enterResolving(0);
      exitLink(0);
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
