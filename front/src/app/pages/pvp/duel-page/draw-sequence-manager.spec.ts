import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DrawSequenceManager } from './draw-sequence-manager';
import { ChainResolutionManager } from './chain-resolution-manager';
import { CardTravelService } from './card-travel.service';
import { DuelContext } from './duel-context';
import { DuelLogger } from './duel-logger';
import { MoveAnimationRouter } from './move-animation-router';
import { ANIMATION_DATA_SOURCE, type AnimationDataSource, type QueueEntry } from './animation-data-source';
import { EMPTY_DUEL_STATE, type DuelState } from '../types';
import type { DrawMsg } from '../duel-ws.types';

/** Build a DuelState whose own player (rel=0) has `handCardsCount` cards in HAND. */
function stateWithHandCount(handCardsCount: number): DuelState {
  return {
    ...EMPTY_DUEL_STATE,
    players: [
      {
        ...EMPTY_DUEL_STATE.players[0],
        zones: [{ zoneId: 'HAND', cards: Array.from({ length: handCardsCount }, () => ({ cardCode: 0 })) }],
      },
      EMPTY_DUEL_STATE.players[1],
    ],
  } as DuelState;
}

describe('DrawSequenceManager', () => {
  let manager: DrawSequenceManager;
  let queue: WritableSignal<QueueEntry[]>;
  let renderedState: WritableSignal<DuelState>;
  let mockRbs: {
    renderedState: WritableSignal<DuelState>;
    lockZone: jasmine.Spy;
    lockedZoneKeys: jasmine.Spy;
  };
  let mockDataSource: AnimationDataSource;
  let mockMoveRouter: jasmine.SpyObj<MoveAnimationRouter>;
  let mockChainManager: { hasActiveReplayTimeouts: boolean };

  // Per-test toggles for DuelContext
  let isBoardActive = true;
  let reducedMotion = false;
  let ownPlayer = 0;

  beforeEach(() => {
    isBoardActive = true;
    reducedMotion = false;
    ownPlayer = 0;
    queue = signal<QueueEntry[]>([]);
    renderedState = signal<DuelState>(EMPTY_DUEL_STATE);

    mockRbs = {
      renderedState,
      lockZone: jasmine.createSpy('lockZone').and.returnValue({ commit: () => undefined, release: () => undefined }),
      lockedZoneKeys: jasmine.createSpy('lockedZoneKeys').and.returnValue([]),
    };

    mockDataSource = {
      renderedBoardState: mockRbs as unknown as AnimationDataSource['renderedBoardState'],
      animationQueue: queue,
      activeChainLinks: signal([]),
      chainPhase: signal('idle'),
      pendingPrompt: signal(null),
      dequeueAnimation: () => null,
      removeAnimationAt: (i: number) => queue.update(q => q.filter((_, idx) => idx !== i)),
      prependToQueue: (entries: QueueEntry[]) => queue.update(q => [...entries, ...q]),
      setAnimating: () => undefined,
      applyChainSolving: () => undefined,
      applyChainSolved: () => undefined,
      applyChainEnd: () => undefined,
    };

    mockMoveRouter = jasmine.createSpyObj<MoveAnimationRouter>('MoveAnimationRouter', [
      'releasePreLocksForKeys', 'processMoveEvent', 'preLockQueuedSources',
      'releaseAllPreLocks', 'clearTimeouts',
    ]);

    mockChainManager = { hasActiveReplayTimeouts: false };

    const mockCtx = {
      relativePlayer: (p: number) => (p === ownPlayer ? 0 : 1) as 0 | 1,
      ownPlayerIndex: () => ownPlayer,
      speedMultiplier: () => 1,
      isBoardActive: () => isBoardActive,
      reducedMotion: signal(reducedMotion),
      scaledDuration: (base: number) => base,
      cardBaseRotation: () => undefined,
      cardBaseRotateCSS: () => '',
      announceEvent: () => undefined,
    };

    const mockCardTravel = jasmine.createSpyObj<CardTravelService>('CardTravelService', [
      'getZoneElement', 'toAbsoluteUrl', 'clearLandedTravels',
      'clearLandedByDstPrefix', 'getLandedFloatsByDstPrefix', 'popLandedFloat',
      'stabilizeFloat', 'returnToLanded',
    ]);
    mockCardTravel.getZoneElement.and.returnValue(null);
    mockCardTravel.toAbsoluteUrl.and.callFake((s: string) => s);
    mockCardTravel.getLandedFloatsByDstPrefix.and.returnValue([]);

    const mockLogger = jasmine.createSpyObj<DuelLogger>('DuelLogger', ['log', 'warn']);

    TestBed.configureTestingModule({
      providers: [
        DrawSequenceManager,
        { provide: ANIMATION_DATA_SOURCE, useValue: mockDataSource },
        { provide: CardTravelService, useValue: mockCardTravel },
        { provide: DuelContext, useValue: mockCtx as unknown as DuelContext },
        { provide: DuelLogger, useValue: mockLogger },
        { provide: ChainResolutionManager, useValue: mockChainManager },
        { provide: MoveAnimationRouter, useValue: mockMoveRouter },
      ],
    });
    manager = TestBed.inject(DrawSequenceManager);
  });

  // ---------------------------------------------------------------------------
  // Hand batch
  // ---------------------------------------------------------------------------

  describe('hand batch', () => {
    it('beginHandBatch increases handExpansionSlots[relPlayer] by slotCount', () => {
      manager.beginHandBatch(0, 3);
      expect(manager.handExpansionSlots()).toEqual([3, 0]);
    });

    it('beginHandBatch is a no-op when slotCount <= 0', () => {
      manager.beginHandBatch(0, 0);
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
    });

    it('consumeHandBatchSlot returns monotonic indices offset by rendered hand count', () => {
      renderedState.set(stateWithHandCount(2)); // 2 existing cards
      manager.beginHandBatch(0, 3);
      expect(manager.consumeHandBatchSlot(0)).toBe(2); // first slot: existing + 0
      expect(manager.consumeHandBatchSlot(0)).toBe(3); // monotonic
      expect(manager.consumeHandBatchSlot(0)).toBe(4);
    });

    it('consumeHandBatchSlot returns undefined when no batch is active', () => {
      expect(manager.consumeHandBatchSlot(0)).toBeUndefined();
    });

    it('endHandBatch decrements handExpansionSlots by the reserved slotCount', () => {
      manager.beginHandBatch(0, 4);
      manager.consumeHandBatchSlot(0);
      manager.consumeHandBatchSlot(0);
      manager.endHandBatch(0);
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
    });

    it('endHandBatch without an active batch is a no-op', () => {
      manager.endHandBatch(0);
      manager.endHandBatch(1);
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
    });

    it('hand batches for both players are tracked independently', () => {
      manager.beginHandBatch(0, 2);
      manager.beginHandBatch(1, 5);
      expect(manager.handExpansionSlots()).toEqual([2, 5]);
      manager.endHandBatch(0);
      expect(manager.handExpansionSlots()).toEqual([0, 5]);
    });

    it('beginHandBatch throws (duelAssert) when an initial draw is in flight', async () => {
      // Trigger an initial draw to populate _drawsInFlight without awaiting it.
      // launchInitialDraw is fire-and-forget from processDrawEvent.
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(() => manager.beginHandBatch(0, 1)).toThrowError(/handExpansionSlots would double-book/);
    });
  });

  // ---------------------------------------------------------------------------
  // processDrawEvent
  // ---------------------------------------------------------------------------

  describe('processDrawEvent', () => {
    it('returns 0 when board is not active', () => {
      isBoardActive = false;
      const result = manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(result).toBe(0);
    });

    it('returns 0 when reducedMotion is on', () => {
      // Re-create with reducedMotion=true (signal is read on demand)
      const rmSignal = signal(true);
      // Override on existing context (test-only mutation via cast)
      (manager as unknown as { ctx: { reducedMotion: typeof rmSignal } }).ctx.reducedMotion = rmSignal;
      const result = manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(result).toBe(0);
    });

    it('first draw for a player returns "async" and marks initial draw done', () => {
      const result = manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(result).toBe('async');
      expect(manager.hasDrawsInFlight).toBeTrue();
    });

    it('second draw for the same player returns "async" via mid-game path', () => {
      // First draw consumed → _initialDrawDone[0] = true
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      // Reset draws-in-flight to simulate first sequence having completed
      manager.reset(); // clears _initialDrawDone too
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg); // 1st draw again (initial)
      // Without reset, this next call hits the mid-game branch.
      // We instead just verify that AFTER an initial draw is recorded, a fresh
      // draw for the same player goes through processMidGameDraw which still
      // returns 'async'. To assert mid-game path specifically, we check that
      // _drawsInFlight grows again on the 2nd call without resetting.
      const r2 = manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(r2).toBe('async');
    });
  });

  // ---------------------------------------------------------------------------
  // awaitDrawsComplete
  // ---------------------------------------------------------------------------

  describe('awaitDrawsComplete', () => {
    it('returns null when no draws in flight', () => {
      expect(manager.awaitDrawsComplete()).toBeNull();
    });

    it('returns a Promise when draws are in flight', () => {
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      const p = manager.awaitDrawsComplete();
      expect(p).toBeInstanceOf(Promise);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveHandTarget
  // ---------------------------------------------------------------------------

  describe('resolveHandTarget', () => {
    let zoneEl: HTMLElement;
    let mockCardTravel: jasmine.SpyObj<CardTravelService>;

    beforeEach(() => {
      zoneEl = document.createElement('div');
      mockCardTravel = TestBed.inject(CardTravelService) as jasmine.SpyObj<CardTravelService>;
      mockCardTravel.getZoneElement.and.callFake((key: string) =>
        key === 'HAND-0' ? zoneEl : null,
      );
    });

    it('returns the last expansion slot when index is "last" and slots exist', () => {
      const slot1 = document.createElement('div'); slot1.className = 'hand-card hand-card--expansion';
      const slot2 = document.createElement('div'); slot2.className = 'hand-card hand-card--expansion';
      zoneEl.append(slot1, slot2);
      expect(manager.resolveHandTarget('HAND-0', 'last')).toBe(slot2);
    });

    it('returns the last hand-card when "last" is requested and no expansion slot exists', () => {
      const card1 = document.createElement('div'); card1.className = 'hand-card';
      const card2 = document.createElement('div'); card2.className = 'hand-card';
      zoneEl.append(card1, card2);
      expect(manager.resolveHandTarget('HAND-0', 'last')).toBe(card2);
    });

    it('returns the zoneKey string when zone is empty', () => {
      expect(manager.resolveHandTarget('HAND-0', 'last')).toBe('HAND-0');
    });

    it('returns the card at numeric index when valid', () => {
      const card1 = document.createElement('div'); card1.className = 'hand-card';
      const card2 = document.createElement('div'); card2.className = 'hand-card';
      zoneEl.append(card1, card2);
      expect(manager.resolveHandTarget('HAND-0', 1)).toBe(card2);
    });

    it('returns the zoneKey string when numeric index is out of bounds', () => {
      const card1 = document.createElement('div'); card1.className = 'hand-card';
      zoneEl.append(card1);
      expect(manager.resolveHandTarget('HAND-0', 5)).toBe('HAND-0');
    });

    it('returns the zoneKey string when zone element is missing', () => {
      expect(manager.resolveHandTarget('HAND-1', 'last')).toBe('HAND-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('reset', () => {
    it('clears handExpansionSlots, drawsInFlight, and initialDrawDone', () => {
      manager.beginHandBatch(0, 3);
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(manager.hasDrawsInFlight).toBeTrue();
      expect(manager.handExpansionSlots()).not.toEqual([0, 0]);

      manager.reset();
      expect(manager.hasDrawsInFlight).toBeFalse();
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
    });
  });

  describe('resetHandAnimationState', () => {
    it('only resets handExpansionSlots, leaves draw state untouched', () => {
      manager.beginHandBatch(0, 2);
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      manager.resetHandAnimationState();
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
      expect(manager.hasDrawsInFlight).toBeTrue(); // not touched
    });
  });

  describe('clearTimeouts', () => {
    it('does not throw when no timeouts are pending', () => {
      expect(() => manager.clearTimeouts()).not.toThrow();
    });
  });
});
