import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MoveAnimationRouter } from './move-animation-router';
import { DrawSequenceManager } from './draw-sequence-manager';
import { DuelCardArtService } from './duel-card-art.service';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import { DuelContext } from './duel-context';
import { DuelLogger } from './duel-logger';
import { ANIMATION_DATA_SOURCE, type AnimationDataSource, type QueueEntry } from './animation-data-source';
import { LOCATION, POSITION } from '../duel-ws.types';
import type { MoveMsg, DrawMsg, Player } from '../duel-ws.types';
import { EMPTY_DUEL_STATE } from '../types';

/**
 * Branch dispatch focus: each `processMoveEvent` call is asserted by which
 * private branch method receives the call. Branch internals (DOM animations,
 * lock semantics) are out of scope — they are visual paths covered by
 * Playwright. The dispatch table is the load-bearing routing logic and is
 * what would silently break under a from/to/reason refactor.
 */

const ALL_BRANCHES = [
  'overlayDetach', 'summonToField', 'tokenDissolve', 'leaveFieldDestroy',
  'leaveFieldNonDestroy', 'bounceToHand', 'returnToDeck', 'fieldToField',
  'discardFromHand', 'handToDeck', 'deckOrExtraToPile', 'pileToHand',
  'pileToDeck', 'pileToPile', 'fallback',
] as const;

function buildMove(overrides: Partial<MoveMsg>): MoveMsg {
  return {
    type: 'MSG_MOVE',
    cardCode: 12345,
    cardName: 'Test Card',
    player: 0 as Player,
    fromLocation: LOCATION.HAND,
    fromSequence: 0,
    fromPosition: POSITION.FACEUP_ATTACK,
    toLocation: LOCATION.MZONE,
    toSequence: 0,
    toPosition: POSITION.FACEUP_ATTACK,
    isToken: false,
    reason: 0,
    ...overrides,
  };
}

describe('MoveAnimationRouter', () => {
  let router: MoveAnimationRouter;
  let mockRbs: { lockZone: jasmine.Spy; lockedZoneKeys: jasmine.Spy; logicalState: () => typeof EMPTY_DUEL_STATE };
  let mockDataSource: AnimationDataSource;
  let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;

  /** Stub all private branch methods to no-op promises so we can assert dispatch. */
  function stubAllBranches() {
    const spies: Record<string, jasmine.Spy> = {};
    for (const name of ALL_BRANCHES) {
      spies[name] = spyOn(router as unknown as Record<string, () => Promise<void>>, name)
        .and.returnValue(Promise.resolve());
    }
    return spies;
  }

  beforeEach(() => {
    mockRbs = {
      lockZone: jasmine.createSpy('lockZone').and.returnValue({ commit: () => undefined, release: () => undefined }),
      lockedZoneKeys: jasmine.createSpy('lockedZoneKeys').and.returnValue([]),
      logicalState: () => EMPTY_DUEL_STATE,
    };

    mockDataSource = {
      renderedBoardState: mockRbs as unknown as AnimationDataSource['renderedBoardState'],
      animationQueue: signal<QueueEntry[]>([]),
      activeChainLinks: signal([]),
      chainPhase: signal('idle'),
      pendingPrompt: signal(null),
      dequeueAnimation: () => null,
      removeAnimationAt: () => undefined,
      prependToQueue: () => undefined,
      setAnimating: () => undefined,
      applyChainSolving: () => undefined,
      applyChainSolved: () => undefined,
      applyChainEnd: () => undefined,
    };

    mockCardTravel = jasmine.createSpyObj<CardTravelEngine>('CardTravelEngine', [
      'getZoneElement', 'toAbsoluteUrl',
    ]);
    mockCardTravel.getZoneElement.and.returnValue(null);
    mockCardTravel.toAbsoluteUrl.and.callFake((s: string) => s);

    const mockBoardEffects = jasmine.createSpyObj<BoardEffectsService>('BoardEffectsService', [
      'preDestroyEffect',
    ]);
    mockBoardEffects.preDestroyEffect.and.returnValue(Promise.resolve());

    const mockFloatRegistry = jasmine.createSpyObj<FloatRegistryService>('FloatRegistryService', [
      'clearLandedByDstPrefix', 'cancelTravel',
    ]);

    const mockCtx = {
      relativePlayer: (p: number) => (p === 0 ? 0 : 1) as 0 | 1,
      ownPlayerIndex: () => 0,
      reducedMotion: signal(false),
      cardBaseRotation: () => undefined,
      scaledDuration: (base: number) => base,
      announceEvent: () => undefined,
      isBoardActive: () => true,
    };

    const mockLogger = jasmine.createSpyObj<DuelLogger>('DuelLogger', ['log', 'warn']);
    const mockDrawManager = jasmine.createSpyObj<DrawSequenceManager>('DrawSequenceManager', [
      'resolveHandTarget', 'consumeHandBatchSlot', 'travelToHand',
    ]);
    mockDrawManager.resolveHandTarget.and.callFake((key: string) => key);
    mockDrawManager.consumeHandBatchSlot.and.returnValue(undefined);
    mockDrawManager.travelToHand.and.returnValue(Promise.resolve());

    const mockArtService = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArtService.resolveUrl.and.returnValue('/img/card.jpg');

    TestBed.configureTestingModule({
      providers: [
        MoveAnimationRouter,
        { provide: ANIMATION_DATA_SOURCE, useValue: mockDataSource },
        { provide: CardTravelEngine, useValue: mockCardTravel },
        { provide: BoardEffectsService, useValue: mockBoardEffects },
        { provide: FloatRegistryService, useValue: mockFloatRegistry },
        { provide: DuelContext, useValue: mockCtx as unknown as DuelContext },
        { provide: DuelLogger, useValue: mockLogger },
        { provide: DrawSequenceManager, useValue: mockDrawManager },
        { provide: DuelCardArtService, useValue: mockArtService },
      ],
    });
    router = TestBed.inject(MoveAnimationRouter);
  });

  // ---------------------------------------------------------------------------
  // Dispatch table
  // ---------------------------------------------------------------------------

  describe('processMoveEvent dispatch', () => {
    it('to OVERLAY → returns 0 without calling any branch', () => {
      const spies = stubAllBranches();
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.OVERLAY,
      }));
      expect(result).toBe(0);
      for (const name of ALL_BRANCHES) expect(spies[name]).not.toHaveBeenCalled();
    });

    it('OVERLAY → GRAVE → overlayDetach', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.OVERLAY, toLocation: LOCATION.GRAVE,
      }));
      expect(spies['overlayDetach']).toHaveBeenCalled();
    });

    it('OVERLAY → BANISHED → overlayDetach', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.OVERLAY, toLocation: LOCATION.BANISHED,
      }));
      expect(spies['overlayDetach']).toHaveBeenCalled();
    });

    it('HAND → MZONE → summonToField', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.MZONE,
      }));
      expect(spies['summonToField']).toHaveBeenCalled();
    });

    it('HAND → SZONE → summonToField', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.SZONE,
      }));
      expect(spies['summonToField']).toHaveBeenCalled();
    });

    it('DECK → MZONE → summonToField (special summon from deck)', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.DECK, toLocation: LOCATION.MZONE,
      }));
      expect(spies['summonToField']).toHaveBeenCalled();
    });

    it('EXTRA → MZONE → summonToField (extra deck summon)', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.EXTRA, toLocation: LOCATION.MZONE,
      }));
      expect(spies['summonToField']).toHaveBeenCalled();
    });

    it('token MZONE → GRAVE → tokenDissolve (precedence over leaveField)', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE,
        isToken: true, reason: 0x1, // would otherwise be leaveFieldDestroy
      }));
      expect(spies['tokenDissolve']).toHaveBeenCalled();
      expect(spies['leaveFieldDestroy']).not.toHaveBeenCalled();
    });

    it('MZONE → GRAVE with reason 0x1 → leaveFieldDestroy', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE, reason: 0x1,
      }));
      expect(spies['leaveFieldDestroy']).toHaveBeenCalled();
    });

    it('MZONE → GRAVE with reason 0 → leaveFieldNonDestroy', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE, reason: 0,
      }));
      expect(spies['leaveFieldNonDestroy']).toHaveBeenCalled();
    });

    it('SZONE → BANISHED with reason 0x1 → leaveFieldDestroy', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.SZONE, toLocation: LOCATION.BANISHED, reason: 0x1,
      }));
      expect(spies['leaveFieldDestroy']).toHaveBeenCalled();
    });

    it('MZONE → HAND → bounceToHand', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.HAND,
      }));
      expect(spies['bounceToHand']).toHaveBeenCalled();
    });

    it('MZONE → DECK → returnToDeck', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.DECK,
      }));
      expect(spies['returnToDeck']).toHaveBeenCalled();
    });

    it('MZONE → SZONE → fieldToField', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.SZONE,
      }));
      expect(spies['fieldToField']).toHaveBeenCalled();
    });

    it('HAND → GRAVE → discardFromHand', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.GRAVE,
      }));
      expect(spies['discardFromHand']).toHaveBeenCalled();
    });

    it('HAND → BANISHED → discardFromHand', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.BANISHED,
      }));
      expect(spies['discardFromHand']).toHaveBeenCalled();
    });

    it('HAND → DECK → handToDeck', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.DECK,
      }));
      expect(spies['handToDeck']).toHaveBeenCalled();
    });

    it('DECK → GRAVE → deckOrExtraToPile (mill)', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.DECK, toLocation: LOCATION.GRAVE,
      }));
      expect(spies['deckOrExtraToPile']).toHaveBeenCalled();
    });

    it('GRAVE → HAND → pileToHand (recursion)', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.GRAVE, toLocation: LOCATION.HAND,
      }));
      expect(spies['pileToHand']).toHaveBeenCalled();
    });

    it('GRAVE → DECK → pileToDeck', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.GRAVE, toLocation: LOCATION.DECK,
      }));
      expect(spies['pileToDeck']).toHaveBeenCalled();
    });

    it('GRAVE → BANISHED → pileToPile', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.GRAVE, toLocation: LOCATION.BANISHED,
      }));
      expect(spies['pileToPile']).toHaveBeenCalled();
    });

    it('uncovered combo (DECK → DECK) → fallback', () => {
      const spies = stubAllBranches();
      router.processMoveEvent(buildMove({
        fromLocation: LOCATION.DECK, toLocation: LOCATION.DECK,
      }));
      expect(spies['fallback']).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // preLockQueuedSources
  // ---------------------------------------------------------------------------

  describe('preLockQueuedSources', () => {
    it('locks HAND only for MSG_DRAW (DECK is intentionally not locked)', () => {
      const draw: DrawMsg = { type: 'MSG_DRAW', player: 0 as Player, cards: [1] };
      router.preLockQueuedSources([draw as unknown as QueueEntry]);
      expect(mockRbs.lockZone).toHaveBeenCalledWith('HAND-0');
      expect(mockRbs.lockZone).not.toHaveBeenCalledWith('DECK-0');
    });

    it('locks both src and dst zones for MSG_MOVE', () => {
      const move = buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.GRAVE, toSequence: 0,
      });
      router.preLockQueuedSources([move]);
      expect(mockRbs.lockZone).toHaveBeenCalledWith('M2-0');
      expect(mockRbs.lockZone).toHaveBeenCalledWith('GY-0');
    });

    it('skips queue directives', () => {
      const directive: QueueEntry = { kind: 'barrier' };
      router.preLockQueuedSources([directive]);
      expect(mockRbs.lockZone).not.toHaveBeenCalled();
    });

    it('is idempotent — same zone is not locked twice across two events', () => {
      const move1 = buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 0,
        toLocation: LOCATION.GRAVE, toSequence: 0,
      });
      const move2 = buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.GRAVE, toSequence: 0, // same destination
      });
      router.preLockQueuedSources([move1, move2]);
      const gyCalls = mockRbs.lockZone.calls.allArgs().filter(args => args[0] === 'GY-0');
      expect(gyCalls.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('releaseAllPreLocks', () => {
    it('releases every pre-acquired lock and clears the map', () => {
      const releaseSpy = jasmine.createSpy('release');
      mockRbs.lockZone.and.returnValue({ commit: () => undefined, release: releaseSpy });
      const move = buildMove({ fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE });
      router.preLockQueuedSources([move]);

      router.releaseAllPreLocks();
      expect(releaseSpy).toHaveBeenCalledTimes(2); // src + dst

      // After release, calling again must not re-release the same locks.
      releaseSpy.calls.reset();
      router.releaseAllPreLocks();
      expect(releaseSpy).not.toHaveBeenCalled();
    });
  });

  describe('releasePreLocksForKeys', () => {
    it('releases only the specified keys and removes them from the map', () => {
      const releaseSpyA = jasmine.createSpy('releaseA');
      const releaseSpyB = jasmine.createSpy('releaseB');
      mockRbs.lockZone.and.callFake((key: string) => ({
        commit: () => undefined,
        release: key === 'M1-0' ? releaseSpyA : releaseSpyB,
      }));
      const move = buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 0,
        toLocation: LOCATION.GRAVE, toSequence: 0,
      });
      router.preLockQueuedSources([move]);

      router.releasePreLocksForKeys(new Set(['M1-0']));
      expect(releaseSpyA).toHaveBeenCalled();
      expect(releaseSpyB).not.toHaveBeenCalled();
    });
  });

  describe('clearTimeouts', () => {
    it('does not throw when no timeouts are pending', () => {
      expect(() => router.clearTimeouts()).not.toThrow();
    });
  });
});
