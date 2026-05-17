import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';

import { MoveAnimationRouter } from './move-animation-router';
import { RenderedBoardStateService } from './rendered-board-state.service';
import { DrawSequenceManager } from './draw-sequence-manager';
import { DuelCardArtService } from './duel-card-art.service';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import { DuelContext } from './duel-context';
import { DuelLogger } from './duel-logger';
import { ANIMATION_DATA_SOURCE, type AnimationDataSource, type QueueEntry } from './animation-data-source';
import { LOCK_SAFETY_TIMEOUT_MS } from './animation-constants';
import { LOCATION, POSITION } from '../duel-ws.types';
import type { MoveMsg, Player } from '../duel-ws.types';

/**
 * Lock-leak integration spec — narrow but real.
 *
 * Goal: catch handlers in MoveAnimationRouter that hold a ZoneLock past
 * their travel resolution. Most spec files mock RenderedBoardStateService,
 * so a handler that forgets `lock.commit()` / `lock.release()` would only
 * surface in production when the safety timeout fires. Here we wire a
 * REAL RBS into a REAL MoveAnimationRouter with a controllable travel mock,
 * then assert `rbs.lockedZoneKeys().length === 0` after every branch
 * completes (both success and failure paths).
 *
 * Scope deliberately narrow: covers MSG_MOVE branches only. Chain-end
 * cascade and draw-sequence leaks live in their own specs.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err?: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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

describe('lock-leak integration — MoveAnimationRouter handlers must not orphan locks', () => {
  let router: MoveAnimationRouter;
  let rbs: RenderedBoardStateService;
  let travelDeferred: Deferred<void>;
  let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;

  beforeEach(() => {
    travelDeferred = defer<void>();

    mockCardTravel = jasmine.createSpyObj<CardTravelEngine>('CardTravelEngine', [
      'getZoneElement', 'toAbsoluteUrl', 'travel',
    ]);
    mockCardTravel.getZoneElement.and.returnValue(null);
    mockCardTravel.toAbsoluteUrl.and.callFake((s: string) => s);
    mockCardTravel.travel.and.callFake(() => travelDeferred.promise);

    const mockBoardEffects = jasmine.createSpyObj<BoardEffectsService>('BoardEffectsService', [
      'preDestroyEffect',
    ]);
    mockBoardEffects.preDestroyEffect.and.returnValue(Promise.resolve());

    const mockFloatRegistry = jasmine.createSpyObj<FloatRegistryService>('FloatRegistryService', [
      'clearLandedByDstPrefix', 'cancelTravel',
    ]);

    // The router reads `dataSource.renderedBoardState` lazily via a getter,
    // so we expose RBS through a property whose getter resolves the real
    // instance after TestBed configures it. Defined as a getter via
    // Object.defineProperty so the readonly type on AnimationDataSource is
    // satisfied without mutating after-the-fact.
    const mockDataSource: AnimationDataSource = {
      get renderedBoardState(): RenderedBoardStateService { return rbs; },
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
    // travelToHand is invoked for HAND-destination branches. We forward to
    // the same deferred so HAND-bound moves participate in the same cycle.
    mockDrawManager.travelToHand.and.callFake(() => travelDeferred.promise);

    const mockArtService = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArtService.resolveUrl.and.returnValue('/img/card.jpg');

    TestBed.configureTestingModule({
      providers: [
        RenderedBoardStateService,
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

    rbs = TestBed.inject(RenderedBoardStateService);
    router = TestBed.inject(MoveAnimationRouter);
  });

  /**
   * After every test: any lock still held past this point would fire the
   * safety timeout. Asserting `lockedZoneKeys` here surfaces the leak
   * deterministically (no need to wait 7.5s of fakeAsync).
   */
  afterEach(() => {
    expect(rbs.lockedZoneKeys()).toEqual([], 'orphan locks after handler completion');
  });

  // ---------------------------------------------------------------------------
  // Branches that travel + commit on success
  // ---------------------------------------------------------------------------

  describe('summonToField (HAND → MZONE)', () => {
    it('releases locks on travel success', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.MZONE,
      })) as Promise<void>;
      expect(rbs.lockedZoneKeys()).toContain('M1-0', 'dst locked during travel');
      travelDeferred.resolve();
      tick();
      result.then(() => undefined); // silence unused
      tick();
      // afterEach asserts cleanup.
    }));

    it('releases locks on travel reject', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.MZONE,
      })) as Promise<void>;
      travelDeferred.reject(new Error('travel cancelled'));
      tick();
      result.catch(() => undefined);
      tick();
    }));
  });

  describe('leaveFieldDestroy (MZONE → GRAVE, reason=destroy)', () => {
    it('releases locks on travel success', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.GRAVE, reason: 0x1,
      })) as Promise<void>;
      travelDeferred.resolve();
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('releases locks on travel reject', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.GRAVE, reason: 0x1,
      })) as Promise<void>;
      travelDeferred.reject(new Error('travel cancelled'));
      tick();
      result.catch(() => undefined);
      tick();
    }));
  });

  describe('leaveFieldNonDestroy (MZONE → GRAVE, reason=0)', () => {
    it('releases locks on travel success', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.GRAVE, reason: 0,
      })) as Promise<void>;
      travelDeferred.resolve();
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('releases locks on travel reject', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.GRAVE, reason: 0,
      })) as Promise<void>;
      travelDeferred.reject(new Error('travel cancelled'));
      tick();
      result.catch(() => undefined);
      tick();
    }));
  });

  describe('fieldToField (MZONE → MZONE)', () => {
    it('releases locks on travel success', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.MZONE, toSequence: 2,
      })) as Promise<void>;
      travelDeferred.resolve();
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('releases locks on travel reject', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.MZONE, toSequence: 2,
      })) as Promise<void>;
      travelDeferred.reject(new Error('travel cancelled'));
      tick();
      result.catch(() => undefined);
      tick();
    }));
  });

  describe('deckOrExtraToPile (DECK → GRAVE)', () => {
    it('releases locks on travel success', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.DECK, toLocation: LOCATION.GRAVE,
      })) as Promise<void>;
      travelDeferred.resolve();
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('releases locks on travel reject', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.DECK, toLocation: LOCATION.GRAVE,
      })) as Promise<void>;
      travelDeferred.reject(new Error('travel cancelled'));
      tick();
      result.catch(() => undefined);
      tick();
    }));
  });

  describe('pileToPile (GRAVE → BANISHED)', () => {
    it('releases locks on travel success', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.GRAVE, toLocation: LOCATION.BANISHED,
      })) as Promise<void>;
      travelDeferred.resolve();
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('releases locks on travel reject', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.GRAVE, toLocation: LOCATION.BANISHED,
      })) as Promise<void>;
      travelDeferred.reject(new Error('travel cancelled'));
      tick();
      result.catch(() => undefined);
      tick();
    }));
  });

  describe('discardFromHand (HAND → GRAVE)', () => {
    it('releases locks on travel success', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.GRAVE,
      })) as Promise<void>;
      travelDeferred.resolve();
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('releases locks on travel reject', fakeAsync(() => {
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.GRAVE,
      })) as Promise<void>;
      travelDeferred.reject(new Error('travel cancelled'));
      tick();
      result.catch(() => undefined);
      tick();
    }));
  });

  // ---------------------------------------------------------------------------
  // releaseAllPreLocks — the safety net invoked on MSG_CHAIN_END / reset
  // ---------------------------------------------------------------------------

  describe('releaseAllPreLocks (chain-end safety net)', () => {
    it('releases all pre-locks armed by preLockQueuedSources', () => {
      const queue: QueueEntry[] = [
        buildMove({ fromLocation: LOCATION.MZONE, fromSequence: 1, toLocation: LOCATION.GRAVE }),
        buildMove({ fromLocation: LOCATION.SZONE, fromSequence: 2, toLocation: LOCATION.BANISHED }),
        buildMove({ fromLocation: LOCATION.HAND, toLocation: LOCATION.GRAVE }),
      ];
      router.preLockQueuedSources(queue);
      expect(rbs.lockedZoneKeys().length).toBeGreaterThan(0, 'pre-locks armed');
      router.releaseAllPreLocks();
      // afterEach catches a leak if releaseAllPreLocks misses anything.
    });

    it('chain-end-missed: pre-locks armed then NEVER consumed → releaseAllPreLocks must still clean', () => {
      // Simulates the worst-case PvP path: server pre-emits MSG_CHAINING which
      // triggers preLockQueuedSources for the queued MSG_MOVEs; ocgcore crashes
      // before emitting any MOVE or CHAIN_END. The orchestrator's reset path
      // (resetAllState → moveRouter.releaseAllPreLocks) is the safety net.
      const queue: QueueEntry[] = [
        buildMove({ fromLocation: LOCATION.MZONE, fromSequence: 0, toLocation: LOCATION.GRAVE }),
        buildMove({ fromLocation: LOCATION.MZONE, fromSequence: 1, toLocation: LOCATION.GRAVE }),
        buildMove({ fromLocation: LOCATION.MZONE, fromSequence: 2, toLocation: LOCATION.GRAVE }),
        // MSG_DRAW also gets pre-locked (HAND-N).
        { type: 'MSG_DRAW', player: 0, cards: [] } as unknown as QueueEntry,
      ];
      router.preLockQueuedSources(queue);
      const lockedBefore = rbs.lockedZoneKeys().length;
      expect(lockedBefore).toBeGreaterThan(0, 'pre-locks armed for queue');

      // No event is ever dispatched — emulate the server stall. The reset path
      // calls releaseAllPreLocks directly (no per-key bookkeeping needed).
      router.releaseAllPreLocks();
    });

    it('partial consumption: 1 MSG_MOVE dispatched, others stay pre-locked → releaseAllPreLocks cleans the rest', fakeAsync(() => {
      const queue: QueueEntry[] = [
        buildMove({ fromLocation: LOCATION.MZONE, fromSequence: 0, toLocation: LOCATION.GRAVE }),
        buildMove({ fromLocation: LOCATION.SZONE, fromSequence: 2, toLocation: LOCATION.BANISHED }),
      ];
      router.preLockQueuedSources(queue);
      expect(rbs.lockedZoneKeys().length).toBeGreaterThan(0);

      // Dispatch the first MOVE (consumes its pre-locks via buildMoveContext).
      const result = router.processMoveEvent(queue[0] as MoveMsg) as Promise<void>;
      travelDeferred.resolve();
      tick();
      result.then(() => undefined);
      tick();

      // Second MOVE never arrives — releaseAllPreLocks is the cleanup.
      expect(rbs.lockedZoneKeys().length).toBeGreaterThan(0, 'second MOVE pre-locks still held');
      router.releaseAllPreLocks();
    }));
  });

  // ---------------------------------------------------------------------------
  // Travel resolves immediately (dstEl null / reducedMotion) — commit path
  // must still clean its lock instead of leaking.
  // ---------------------------------------------------------------------------

  describe('travel resolves synchronously (dstEl null / reducedMotion fast-path)', () => {
    it('summonToField with travel = Promise.resolve() → no lock leak', fakeAsync(() => {
      // Real CardTravelEngine.travel() returns Promise.resolve() when zone
      // resolver returns null or reducedMotion is set. Handlers must NOT
      // assume travel was animated — the commit/release pair must still run.
      mockCardTravel.travel.and.returnValue(Promise.resolve());
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.HAND, toLocation: LOCATION.MZONE,
      })) as Promise<void>;
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('leaveFieldDestroy with travel = Promise.resolve() → no lock leak', fakeAsync(() => {
      mockCardTravel.travel.and.returnValue(Promise.resolve());
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.MZONE, fromSequence: 1,
        toLocation: LOCATION.GRAVE, reason: 0x1,
      })) as Promise<void>;
      tick();
      result.then(() => undefined);
      tick();
    }));

    it('pileToPile with travel = Promise.resolve() → no lock leak', fakeAsync(() => {
      mockCardTravel.travel.and.returnValue(Promise.resolve());
      const result = router.processMoveEvent(buildMove({
        fromLocation: LOCATION.GRAVE, toLocation: LOCATION.BANISHED,
      })) as Promise<void>;
      tick();
      result.then(() => undefined);
      tick();
    }));
  });

  // ---------------------------------------------------------------------------
  // Safety timeout regression: lock without commit/release MUST fire assert
  // ---------------------------------------------------------------------------

  describe('lockZone safety timeout (regression net)', () => {
    it('throws duelAssert after LOCK_SAFETY_TIMEOUT_MS when handler forgets to commit', fakeAsync(() => {
      // Simulates a buggy handler that locks then awaits a promise that never resolves.
      rbs.lockZone('GY-0', 'integration:fake-buggy-handler');
      expect(() => tick(LOCK_SAFETY_TIMEOUT_MS + 50))
        .toThrowError(/DUEL-ASSERT.*lockZone.*GY-0.*integration:fake-buggy-handler/);
      // Lock was auto-released so the afterEach hook is clean.
    }));
  });
});
