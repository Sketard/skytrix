/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. (α.7b.1, 2026-05-25) */

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
import type { MoveMsg, DrawMsg, Player, Position } from '../duel-ws.types';
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
  const base: MoveMsg = {
    type: 'MSG_MOVE',
    cardCode: 12345,
    cardName: 'Test Card',
    player: 0 as Player,
    toPlayer: 0 as Player,
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
  // Default: a move stays on the same side — `toPlayer` follows `player`
  // unless the test explicitly overrides it (controlled-card scenarios).
  if (overrides.toPlayer === undefined) base.toPlayer = base.player;
  return base;
}

describe('MoveAnimationRouter', () => {
  let router: MoveAnimationRouter;
  let mockRbs: { lockZone: jasmine.Spy; lockedZoneKeys: jasmine.Spy; logicalState: () => typeof EMPTY_DUEL_STATE };
  let mockDataSource: AnimationDataSource;
  let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;
  let boardActiveSignal: ReturnType<typeof signal<boolean>>;

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
      boardStateView: null as unknown as AnimationDataSource['boardStateView'],
      hasPendingChainEntry: signal(false),
      pendingChainEntry: signal(null),
      attachOutOfBandSink: () => undefined,
      dequeueAnimation: () => null,
      removeAnimationAt: () => undefined,
      prependToQueue: () => undefined,
      enqueueDirective: () => undefined,
      setAnimating: () => undefined,
      applyChainSolving: () => undefined,
      applyChainSolved: () => undefined,
      applyChainEnd: () => undefined,
    };

    mockCardTravel = jasmine.createSpyObj<CardTravelEngine>('CardTravelEngine', [
      'getZoneElement', 'toAbsoluteUrl', 'travel',
    ]);
    mockCardTravel.getZoneElement.and.returnValue(null);
    mockCardTravel.toAbsoluteUrl.and.callFake((s: string) => s);
    mockCardTravel.travel.and.returnValue(Promise.resolve());

    const mockBoardEffects = jasmine.createSpyObj<BoardEffectsService>('BoardEffectsService', [
      'preDestroyEffect',
    ]);
    mockBoardEffects.preDestroyEffect.and.returnValue(Promise.resolve());

    const mockFloatRegistry = jasmine.createSpyObj<FloatRegistryService>('FloatRegistryService', [
      'clearLandedByDstPrefix', 'cancelTravel',
    ]);

    boardActiveSignal = signal(true);
    const mockCtx = {
      relativePlayer: (p: number) => (p === 0 ? 0 : 1) as 0 | 1,
      ownPlayerIndex: () => 0,
      reducedMotion: signal(false),
      cardBaseRotation: () => undefined,
      scaledDuration: (base: number) => base,
      announceEvent: () => undefined,
      isBoardActive: () => boardActiveSignal(),
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
  // Defense rotation — OCGCore combined SZONE position (0x5/0xA)
  // ---------------------------------------------------------------------------

  describe('leaveField* defense rotation', () => {
    /** OCGCore `POS_FACEUP` — the COMBINED form (FACEUP_ATTACK|FACEUP_DEFENSE)
     *  used for any face-up Spell/Trap, including a Pendulum card in a Scale
     *  zone. NOT the same as the discrete monster `FACEUP_DEFENSE` (0x4). The
     *  combined value (0x5) is not a member of the `Position` union — cast it
     *  to mirror what OCGCore actually sends. */
    const POS_FACEUP_ST = (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE) as Position; // 0x5

    /** Last TravelOptions passed to cardTravelEngine.travel. */
    function lastTravelOptions() {
      const calls = mockCardTravel.travel.calls.all();
      return calls[calls.length - 1]?.args[3] ?? {};
    }

    it('SZONE Pendulum card (POS_FACEUP 0x5) → EXTRA — no -90° (the Queen Machinex bug)', async () => {
      // A face-up Pendulum card in a Scale zone carries OCGCore's combined
      // position 0x5. The naive `pos & 0xC` defense test trips on it; the
      // card then travels to the Extra Deck rotated 90° sideways. It is a
      // Spell/Trap, NOT a defense monster — it must land upright.
      await router.processMoveEvent(buildMove({
        fromLocation: LOCATION.SZONE, toLocation: LOCATION.EXTRA, reason: 0x1,
        fromPosition: POS_FACEUP_ST,
      }));
      const opts = lastTravelOptions();
      expect(opts.srcRotateZ).toBeUndefined();
      expect(opts.destRotateZ).toBeUndefined();
    });

    it('SZONE Pendulum card (POS_FACEUP 0x5) → GRAVE — no -90° (S/T is never defense)', async () => {
      await router.processMoveEvent(buildMove({
        fromLocation: LOCATION.SZONE, toLocation: LOCATION.GRAVE, reason: 0x1,
        fromPosition: POS_FACEUP_ST,
      }));
      const opts = lastTravelOptions();
      expect(opts.srcRotateZ).toBeUndefined();
      expect(opts.destRotateZ).toBeUndefined();
    });

    it('MZONE defense MONSTER (FACEUP_DEFENSE 0x4) → GRAVE — keeps -90° rotation', async () => {
      // A genuine defense-position monster (discrete 0x4) still rotates -90°
      // through the travel into a flat pile.
      await router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE, reason: 0x1,
        fromPosition: POSITION.FACEUP_DEFENSE,
      }));
      const opts = lastTravelOptions();
      expect(opts.srcRotateZ).toBe(-90);
      expect(opts.destRotateZ).toBe(-90);
    });

    it('MZONE attack MONSTER (FACEUP_ATTACK 0x1) → BANISHED — no rotation', async () => {
      await router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.BANISHED, reason: 0,
        fromPosition: POSITION.FACEUP_ATTACK,
      }));
      const opts = lastTravelOptions();
      expect(opts.srcRotateZ).toBeUndefined();
      expect(opts.destRotateZ).toBeUndefined();
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

    it('a controlled card destroyed (player=0, toPlayer=1) pre-locks the OWNER\'s GY, not the controller\'s', () => {
      // I stole an opponent monster; it sits on MY field (M1-0) but is OWNED
      // by player 1. When destroyed, OCGCore routes it to player 1's GY, so
      // the destination pre-lock must target GY-1, not GY-0.
      const move = buildMove({
        player: 0 as Player, toPlayer: 1 as Player,
        fromLocation: LOCATION.MZONE, fromSequence: 0,
        toLocation: LOCATION.GRAVE, toSequence: 0,
      });
      router.preLockQueuedSources([move]);
      expect(mockRbs.lockZone).toHaveBeenCalledWith('M1-0');   // source — my field
      expect(mockRbs.lockZone).toHaveBeenCalledWith('GY-1');   // dest — owner's GY
      expect(mockRbs.lockZone).not.toHaveBeenCalledWith('GY-0');
    });

    it('a MSG_MOVE missing toPlayer (pre-toPlayer replay) falls back to player — discard pre-locks GY-0 not GY-1', () => {
      // Regression: replays precomputed before the toPlayer field existed
      // omit it. relativePlayer(undefined) collapses to 1, so a player-0
      // discard (HAND→GY) would pre-lock GY-1, leak the lock and freeze the
      // replay on a lock safety timeout. moveToPlayer() must fall back to
      // `player` so a same-side move stays same-side. Build the message
      // WITHOUT toPlayer (the buildMove helper would otherwise backfill it).
      const move = buildMove({
        player: 0 as Player,
        fromLocation: LOCATION.HAND, fromSequence: 3,
        toLocation: LOCATION.GRAVE, toSequence: 0,
      });
      delete (move as Partial<MoveMsg>).toPlayer;
      router.preLockQueuedSources([move]);
      expect(mockRbs.lockZone).toHaveBeenCalledWith('HAND-0');
      expect(mockRbs.lockZone).toHaveBeenCalledWith('GY-0');
      expect(mockRbs.lockZone).not.toHaveBeenCalledWith('GY-1');
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

    it('skips all locking while !isBoardActive — events will divert into _preActivationBuffer', () => {
      // Regression 2026-06-05 — bug user-facing "initial draw : la main
      // disparaît puis réapparaît". Console log
      // `console-export-2026-6-5_16-3-34.log` :
      //   1. MSG_DRAW arrives during !boardActive (pre-dice / pre-arena).
      //   2. Runner's per-tick `preLockQueuedSources` posed HAND-1 + HAND-0
      //      pre-locks BEFORE the dispatcher diverted the events.
      //   3. Events parked in `_preActivationBuffer` — `'divert'` skips
      //      `releasePreLocksForKeys` → pre-locks stay orphan.
      //   4. ~1500ms later (announcement directive 1000ms + BOARD_BREATHE_MS
      //      500ms drain delay), safety timeout fires → `duelAssert`
      //      "Lock safety timeout for HAND-1 after 1501ms" — log L109/147/188.
      // Fix : skip pre-locking entirely while !isBoardActive. The drain
      // re-injects events AFTER setBoardActive(true), so the runner's next
      // `preLockQueuedSources` pass will pose them fresh.
      boardActiveSignal.set(false);
      const draw: DrawMsg = { type: 'MSG_DRAW', player: 0 as Player, cards: [1] };
      const move = buildMove({
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE,
      });
      router.preLockQueuedSources([draw as unknown as QueueEntry, move]);
      expect(mockRbs.lockZone).not.toHaveBeenCalled();
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
