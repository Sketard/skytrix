/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. (α.7b.1, 2026-05-25) */

import { signal, WritableSignal } from '@angular/core';
import { TestBed, fakeAsync, flush } from '@angular/core/testing';
import { DrawSequenceManager } from './draw-sequence-manager';
import { ChainResolutionManager } from './chain-resolution-manager';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import { DuelContext } from './duel-context';
import { DuelLogger } from './duel-logger';
import { MoveAnimationRouter } from './move-animation-router';
import { ANIMATION_DATA_SOURCE, type AnimationDataSource, type QueueEntry } from './animation-data-source';
import { EMPTY_DUEL_STATE, type DuelState } from '../types';
import type { DrawMsg, ConfirmCardsMsg } from '../duel-ws.types';
import { LOCATION } from '../duel-ws.types';

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
  let mockBoardEffects: jasmine.SpyObj<BoardEffectsService>;

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
      boardStateView: null as unknown as AnimationDataSource['boardStateView'],
      hasPendingChainEntry: signal(false),
      pendingChainEntry: signal(null),
      attachOutOfBandSink: () => undefined,
      dequeueAnimation: () => null,
      removeAnimationAt: (i: number) => queue.update(q => q.filter((_, idx) => idx !== i)),
      prependToQueue: (entries: QueueEntry[]) => queue.update(q => [...entries, ...q]),
      enqueueDirective: () => undefined,
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

    const mockCardTravel = jasmine.createSpyObj<CardTravelEngine>('CardTravelEngine', [
      'getZoneElement', 'toAbsoluteUrl', 'travel',
    ]);
    mockCardTravel.getZoneElement.and.returnValue(null);
    mockCardTravel.toAbsoluteUrl.and.callFake((s: string) => s);
    // travel is reached when fakeAsync flush() drains a fire-and-forget
    // draw coroutine to completion — stub it so the drained run resolves
    // cleanly instead of throwing "travel is not a function".
    mockCardTravel.travel.and.returnValue(Promise.resolve());

    const mockFloatRegistry = jasmine.createSpyObj<FloatRegistryService>('FloatRegistryService', [
      'clearLandedTravels', 'clearLandedByDstPrefix', 'getLandedFloatsByDstPrefix',
      'popLandedFloat', 'stabilizeFloat', 'returnToLanded',
    ]);
    mockFloatRegistry.getLandedFloatsByDstPrefix.and.returnValue([]);

    // revealCardOnDeck — reveal-on-deck draws; revealCardOnField — confirm of
    // a card Set face-down on the field from the deck (deck→field reveal).
    mockBoardEffects = jasmine.createSpyObj<BoardEffectsService>('BoardEffectsService', [
      'revealCardOnDeck', 'revealCardOnField',
    ]);
    mockBoardEffects.revealCardOnDeck.and.returnValue(Promise.resolve());
    mockBoardEffects.revealCardOnField.and.returnValue(Promise.resolve());

    const mockLogger = jasmine.createSpyObj<DuelLogger>('DuelLogger', ['log', 'warn']);

    TestBed.configureTestingModule({
      providers: [
        DrawSequenceManager,
        { provide: ANIMATION_DATA_SOURCE, useValue: mockDataSource },
        { provide: CardTravelEngine, useValue: mockCardTravel },
        { provide: BoardEffectsService, useValue: mockBoardEffects },
        { provide: FloatRegistryService, useValue: mockFloatRegistry },
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

    it('beginHandBatch throws (duelAssert) when an initial draw is in flight', fakeAsync(() => {
      // Trigger an initial draw to populate _drawsInFlight without awaiting it.
      // launchInitialDraw is fire-and-forget from processDrawEvent.
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(() => manager.beginHandBatch(0, 1)).toThrowError(/handExpansionSlots would double-book/);
      // Drain the fire-and-forget launchInitialDraw coroutine inside virtual
      // time so its parked setTimeout/afterNextRender don't fire against the
      // destroyed injector at teardown (NG0205 leak).
      flush();
    }));
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

    it('first draw for a player returns "async" and marks initial draw done', fakeAsync(() => {
      const result = manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(result).toBe('async');
      expect(manager.hasDrawsInFlight).toBeTrue();
      flush(); // drain the fire-and-forget launchInitialDraw coroutine
    }));

    it('second draw for the same player returns "async" via mid-game path', fakeAsync(() => {
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
      flush(); // drain both fire-and-forget draw coroutines
    }));
  });

  // ---------------------------------------------------------------------------
  // awaitDrawsComplete
  // ---------------------------------------------------------------------------

  describe('awaitDrawsComplete', () => {
    it('returns null when no draws in flight', () => {
      expect(manager.awaitDrawsComplete()).toBeNull();
    });

    it('returns a Promise when draws are in flight', fakeAsync(() => {
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      const p = manager.awaitDrawsComplete();
      expect(p).toBeInstanceOf(Promise);
      flush(); // drain the fire-and-forget launchInitialDraw coroutine
    }));
  });

  // ---------------------------------------------------------------------------
  // resolveHandTarget
  // ---------------------------------------------------------------------------

  describe('resolveHandTarget', () => {
    let zoneEl: HTMLElement;
    let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;

    beforeEach(() => {
      zoneEl = document.createElement('div');
      mockCardTravel = TestBed.inject(CardTravelEngine) as jasmine.SpyObj<CardTravelEngine>;
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
  // processConfirmCardsEvent — routing by card location
  // ---------------------------------------------------------------------------

  describe('processConfirmCardsEvent', () => {
    const card = (location: number, cardCode = 100) => ({
      cardCode, name: 'Card', player: 0, location, sequence: 0,
    });
    const confirm = (cards: ReturnType<typeof card>[]): ConfirmCardsMsg =>
      ({ type: 'MSG_CONFIRM_CARDS', player: 0, cards } as unknown as ConfirmCardsMsg);

    it('routes a FIELD-zone confirm (deck→field Set reveal) to revealCardOnField', async () => {
      await Promise.resolve(manager.processConfirmCardsEvent(confirm([card(LOCATION.SZONE)])));
      expect(mockBoardEffects.revealCardOnField).toHaveBeenCalled();
      expect(mockBoardEffects.revealCardOnDeck).not.toHaveBeenCalled();
    });

    it('routes a MZONE confirm to revealCardOnField too', async () => {
      await Promise.resolve(manager.processConfirmCardsEvent(confirm([card(LOCATION.MZONE)])));
      expect(mockBoardEffects.revealCardOnField).toHaveBeenCalled();
    });

    it('routes a DECK-only confirm to revealCardOnDeck, not revealCardOnField', async () => {
      await Promise.resolve(manager.processConfirmCardsEvent(confirm([card(LOCATION.DECK)])));
      expect(mockBoardEffects.revealCardOnDeck).toHaveBeenCalled();
      expect(mockBoardEffects.revealCardOnField).not.toHaveBeenCalled();
    });

    it('routes a GRAVE confirm to the pile reveal (revealCardOnDeck overlay)', async () => {
      await Promise.resolve(manager.processConfirmCardsEvent(confirm([card(LOCATION.GRAVE)])));
      expect(mockBoardEffects.revealCardOnDeck).toHaveBeenCalled();
      expect(mockBoardEffects.revealCardOnField).not.toHaveBeenCalled();
    });

    it('routes a BANISHED confirm to the pile reveal', async () => {
      await Promise.resolve(manager.processConfirmCardsEvent(confirm([card(LOCATION.BANISHED)])));
      expect(mockBoardEffects.revealCardOnDeck).toHaveBeenCalled();
    });

    it('returns 0 (no-op) for an empty confirm', () => {
      expect(manager.processConfirmCardsEvent(confirm([]))).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('reset', () => {
    it('clears handExpansionSlots, drawsInFlight, and initialDrawDone', fakeAsync(() => {
      manager.beginHandBatch(0, 3);
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      expect(manager.hasDrawsInFlight).toBeTrue();
      expect(manager.handExpansionSlots()).not.toEqual([0, 0]);

      manager.reset();
      expect(manager.hasDrawsInFlight).toBeFalse();
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
      flush(); // drain the fire-and-forget launchInitialDraw coroutine
    }));
  });

  describe('resetHandAnimationState', () => {
    it('only resets handExpansionSlots, leaves draw state untouched', fakeAsync(() => {
      manager.beginHandBatch(0, 2);
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [1] } as DrawMsg);
      manager.resetHandAnimationState();
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
      expect(manager.hasDrawsInFlight).toBeTrue(); // not touched
      flush(); // drain the fire-and-forget launchInitialDraw coroutine
    }));
  });

  describe('clearTimeouts', () => {
    it('does not throw when no timeouts are pending', () => {
      expect(() => manager.clearTimeouts()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // runDrawSequence — multi-card batch contract (post-2026-06-04 fix)
  //
  // Pre-fix: `runDrawSequence` for a `MSG_DRAW` with `cards.length > 1`
  // incremented `handExpansionSlots` per card via `travelToHand`'s
  // `manageSlotsLocally=true` path, then called `clearLandedTravels()`
  // between every card. Two regressions:
  //   1. Each card landed on the same "last" slot then was immediately
  //      destroyed by `clearLandedTravels` when the next card arrived
  //      → "1st card disappears when 2nd arrives" (PvP) and "draws drift
  //      to the wrong side" (replay) symptoms.
  //   2. `clearLandedTravels` clears the ENTIRE `_landed` set — it was
  //      not filtered by zone prefix — so a discard `MOVE→GY` happening
  //      concurrently (chain replay where the same effect draws AND
  //      discards) would lose its landed float → "discard disappears
  //      from GY" + the GY lock left dangling → 7.5s safety timeout.
  //
  // Post-fix:
  //   - All N expansion slots reserved upfront (matches the initial-draw
  //     path and the tutor batch path in `BufferReplayBuilder`).
  //   - Each card targets slot `i` explicitly via `travelToHand(..., i)`.
  //   - NO `clearLandedTravels()` between cards.
  //   - After the final commit, `clearLandedByDstPrefix(dstKey)` removes
  //     only the floats landed in THIS player's HAND — anything in flight
  //     for GY / BANISHED / the other player stays put.
  // ---------------------------------------------------------------------------

  describe('runDrawSequence — multi-card batch (2026-06-04 fix)', () => {
    let mockFloatRegistry: jasmine.SpyObj<FloatRegistryService>;
    let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;
    let travelCalls: Array<{ src: string; dst: HTMLElement | string }>;

    /** Flip both `_initialDrawDone` slots so the next `processDrawEvent`
     *  goes through `processMidGameDraw` (which is where the multi-card
     *  batch contract lives). The initial-draw path uses `keepFloats=true`
     *  and is covered by separate specs above. */
    function markInitialDrawDone() {
      (manager as unknown as { _initialDrawDone: [boolean, boolean] })
        ._initialDrawDone = [true, true];
    }

    beforeEach(() => {
      mockFloatRegistry = TestBed.inject(FloatRegistryService) as jasmine.SpyObj<FloatRegistryService>;
      mockCardTravel = TestBed.inject(CardTravelEngine) as jasmine.SpyObj<CardTravelEngine>;

      // Provide a real HAND-0 zone element so `resolveHandTarget` can
      // query for `.hand-card--expansion` slots. The pre-fix bug would
      // have all draws targeting the same DOM node — the post-fix
      // contract is one slot per card index. We record what travel() was
      // called with to assert distinct slots.
      const zoneEl = document.createElement('div');
      // Pre-populate the expansion DOM with N slots so `resolveHandTarget`
      // (numeric index) finds distinct targets. Since the manager's signal
      // and the DOM are wired separately in production but mocked here,
      // we manually add slots so `querySelectorAll('.hand-card')[i]`
      // returns a distinct element per index.
      for (let i = 0; i < 4; i++) {
        const slot = document.createElement('div');
        slot.className = 'hand-card hand-card--expansion';
        slot.dataset['idx'] = String(i);
        zoneEl.appendChild(slot);
      }
      mockCardTravel.getZoneElement.and.callFake((key: string) =>
        key === 'HAND-0' ? zoneEl : null,
      );

      travelCalls = [];
      mockCardTravel.travel.and.callFake((src, dst) => {
        travelCalls.push({ src: src as string, dst: dst as HTMLElement | string });
        return Promise.resolve();
      });
    });

    it('reserves N expansion slots upfront, each travel targets a distinct slot offset by existing hand count', fakeAsync(() => {
      // Build a HAND-0 zone with N real cards then N expansion slots so
      // we can assert that travel destinations correspond to the
      // expansion slots (indices `existingHandCount + i`), NOT the
      // first N real cards (which was the pre-fix "draws drift left"
      // regression — `targetIndex=0..N-1` was hitting the leftmost
      // real cards instead of the freshly rendered expansion slots).
      const zone = document.createElement('div');
      const realCards: HTMLDivElement[] = [];
      const expansionSlots: HTMLDivElement[] = [];
      for (let i = 0; i < 2; i++) {
        const c = document.createElement('div');
        c.className = 'hand-card';
        c.dataset['kind'] = 'real';
        c.dataset['idx'] = String(i);
        zone.appendChild(c);
        realCards.push(c);
      }
      for (let i = 0; i < 3; i++) {
        const s = document.createElement('div');
        s.className = 'hand-card hand-card--expansion';
        s.dataset['kind'] = 'expansion';
        s.dataset['idx'] = String(2 + i);
        zone.appendChild(s);
        expansionSlots.push(s);
      }
      mockCardTravel.getZoneElement.and.callFake((key: string) => key === 'HAND-0' ? zone : null);

      renderedState.set(stateWithHandCount(2));
      markInitialDrawDone();
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [101, 102, 103] } as DrawMsg);

      flush();

      expect(travelCalls.length).toBe(3);

      // Every travel must land on an expansion slot — the post-fix
      // contract. Hitting a real card here = the regression returned.
      for (let i = 0; i < 3; i++) {
        const dst = travelCalls[i].dst;
        expect(dst).toBe(expansionSlots[i],
          `travel ${i} should hit expansion slot ${i}, got: ${(dst as HTMLElement)?.dataset?.['kind']}=${(dst as HTMLElement)?.dataset?.['idx']}`);
      }
      // And in particular, the real cards must NEVER be travel destinations.
      for (const real of realCards) {
        expect(travelCalls.some(c => c.dst === real)).toBe(false,
          `real card ${real.dataset['idx']} must NOT be a travel destination (that is the "draws drift left" regression)`);
      }
    }));

    it('clearLandedByDstPrefix(HAND-0) runs once after the final commit; clearLandedTravels NEVER fires', fakeAsync(() => {
      markInitialDrawDone();
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [101, 102] } as DrawMsg);
      flush();

      // The fix replaces the global `clearLandedTravels()` (which
      // wipes landed floats for ALL zones — the discard MOVE→GY
      // regression) with a filtered `clearLandedByDstPrefix('HAND-0')`.
      // Pin both halves of the contract:
      expect(mockFloatRegistry.clearLandedTravels).not.toHaveBeenCalled();
      expect(mockFloatRegistry.clearLandedByDstPrefix).toHaveBeenCalledWith('HAND-0');
    }));

    it('handExpansionSlots returns to 0 after the multi-card draw completes', fakeAsync(() => {
      markInitialDrawDone();
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 0, cards: [101, 102, 103] } as DrawMsg);
      flush();

      // Reserved upfront → 3 slots; released after commit → 0 slots.
      // No lingering reservation that would leave the fan layout
      // permanently expanded.
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
    }));

    it('opponent draw (player=1) reserves slots on relPlayer=1, clears HAND-1', fakeAsync(() => {
      // From own-player=0 perspective, opponent draws → relPlayer=1
      // → expansion slots increment on index 1 of the tuple, and the
      // cleanup targets HAND-1, not HAND-0.
      const hand1El = document.createElement('div');
      for (let i = 0; i < 3; i++) {
        const slot = document.createElement('div');
        slot.className = 'hand-card hand-card--expansion';
        hand1El.appendChild(slot);
      }
      mockCardTravel.getZoneElement.and.callFake((key: string) =>
        key === 'HAND-1' ? hand1El : null,
      );

      markInitialDrawDone();
      manager.processDrawEvent({ type: 'MSG_DRAW', player: 1, cards: [201, 202] } as DrawMsg);
      flush();

      expect(mockFloatRegistry.clearLandedByDstPrefix).toHaveBeenCalledWith('HAND-1');
      expect(mockFloatRegistry.clearLandedByDstPrefix).not.toHaveBeenCalledWith('HAND-0');
      expect(manager.handExpansionSlots()).toEqual([0, 0]);
    }));
  });
});
