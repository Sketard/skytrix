import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BufferReplayBuilder } from './buffer-replay-builder';
import { DrawSequenceManager } from './draw-sequence-manager';
import { LpAnimationTracker } from './lp-animation-tracker';
import { MoveAnimationRouter } from './move-animation-router';
import { CardTravelEngine } from './card-travel-engine.service';
import { DuelContext } from './duel-context';
import { DuelLogger } from './duel-logger';
import { ANIMATION_DATA_SOURCE, type AnimationDataSource, type QueueEntry } from './animation-data-source';
import { LOCATION, POSITION } from '../duel-ws.types';
import type { ConfirmCardsMsg, MoveMsg, Player } from '../duel-ws.types';
import type { GameEvent } from '../types';

function move(overrides: Partial<MoveMsg>): MoveMsg {
  return {
    type: 'MSG_MOVE',
    cardCode: 1,
    cardName: '',
    player: 0 as Player,
    fromLocation: LOCATION.DECK,
    fromSequence: 0,
    fromPosition: POSITION.FACEUP_ATTACK,
    toLocation: LOCATION.HAND,
    toSequence: 0,
    toPosition: POSITION.FACEUP_ATTACK,
    isToken: false,
    reason: 0,
    ...overrides,
  };
}

function confirmCards(cards: Array<{ cardCode: number; player: Player }>): ConfirmCardsMsg {
  return {
    type: 'MSG_CONFIRM_CARDS',
    player: 0 as Player,
    cards: cards.map(c => ({
      cardCode: c.cardCode,
      name: '',
      player: c.player,
      location: LOCATION.HAND,
      sequence: 0,
    })),
  };
}

describe('BufferReplayBuilder', () => {
  let builder: BufferReplayBuilder;
  let mockRbs: {
    lockZone: jasmine.Spy;
    commitAll: jasmine.Spy;
    lockedZoneKeys: jasmine.Spy;
  };
  let mockMoveRouter: jasmine.SpyObj<MoveAnimationRouter>;
  let mockDrawManager: jasmine.SpyObj<DrawSequenceManager>;
  let mockLpTracker: jasmine.SpyObj<LpAnimationTracker>;
  let releaseSpy: jasmine.Spy;

  beforeEach(() => {
    releaseSpy = jasmine.createSpy('release');
    mockRbs = {
      lockZone: jasmine.createSpy('lockZone').and.callFake(() => ({
        commit: () => undefined,
        release: releaseSpy,
      })),
      commitAll: jasmine.createSpy('commitAll'),
      lockedZoneKeys: jasmine.createSpy('lockedZoneKeys').and.returnValue([]),
    };

    const mockDataSource: AnimationDataSource = {
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

    mockMoveRouter = jasmine.createSpyObj<MoveAnimationRouter>('MoveAnimationRouter', [
      'preLockQueuedSources', 'processMoveEvent', 'releaseAllPreLocks',
      'releasePreLocksForKeys', 'clearTimeouts',
    ]);
    mockMoveRouter.processMoveEvent.and.returnValue(0);

    mockDrawManager = jasmine.createSpyObj<DrawSequenceManager>('DrawSequenceManager', [
      'beginHandBatch', 'endHandBatch', 'processDrawEvent', 'consumeHandBatchSlot',
      'travelToHand', 'resolveHandTarget',
    ]);
    mockDrawManager.processDrawEvent.and.returnValue(0);

    mockLpTracker = jasmine.createSpyObj<LpAnimationTracker>('LpAnimationTracker', [
      'fireLpReplayEvent', 'processLpEvent', 'commitIfPending', 'discardPending',
      'applyInstant', 'syncFromBoardState', 'getTrackedLp', 'reset',
    ]);

    const mockCardTravel = jasmine.createSpyObj<CardTravelEngine>('CardTravelEngine', ['getZoneElement']);

    const mockCtx = {
      relativePlayer: (p: number) => (p === 0 ? 0 : 1) as 0 | 1,
      ownPlayerIndex: () => 0,
      reducedMotion: signal(false),
      scaledDuration: (base: number) => base,
      announceEvent: () => undefined,
      isBoardActive: () => true,
    };

    const mockLogger = jasmine.createSpyObj<DuelLogger>('DuelLogger', ['log', 'warn']);

    TestBed.configureTestingModule({
      providers: [
        BufferReplayBuilder,
        { provide: ANIMATION_DATA_SOURCE, useValue: mockDataSource },
        { provide: CardTravelEngine, useValue: mockCardTravel },
        { provide: DuelContext, useValue: mockCtx as unknown as DuelContext },
        { provide: DuelLogger, useValue: mockLogger },
        { provide: DrawSequenceManager, useValue: mockDrawManager },
        { provide: MoveAnimationRouter, useValue: mockMoveRouter },
        { provide: LpAnimationTracker, useValue: mockLpTracker },
      ],
    });
    builder = TestBed.inject(BufferReplayBuilder);
  });

  // ---------------------------------------------------------------------------
  // applyReducedMotion
  // ---------------------------------------------------------------------------

  describe('applyReducedMotion', () => {
    it('applies MSG_MOVE via moveRouter and commits', () => {
      const m = move({ cardCode: 42 });
      builder.applyReducedMotion([m]);
      expect(mockMoveRouter.processMoveEvent).toHaveBeenCalledWith(m);
      expect(mockRbs.commitAll).toHaveBeenCalled();
    });

    it('applies MSG_DRAW via drawManager', () => {
      const draw = { type: 'MSG_DRAW', player: 0 as Player, cards: [1] } as GameEvent;
      builder.applyReducedMotion([draw]);
      expect(mockDrawManager.processDrawEvent).toHaveBeenCalledWith(draw as never);
    });

    it('fires LP events via lpTracker AFTER commitAll', () => {
      const damage = { type: 'MSG_DAMAGE', player: 0, amount: 1000 } as GameEvent;
      const calls: string[] = [];
      mockRbs.commitAll.and.callFake(() => calls.push('commitAll'));
      mockLpTracker.fireLpReplayEvent.and.callFake(() => calls.push('lp'));
      builder.applyReducedMotion([damage]);
      expect(calls).toEqual(['commitAll', 'lp']);
    });
  });

  // ---------------------------------------------------------------------------
  // build — session locks + hand batch
  // ---------------------------------------------------------------------------

  describe('build — session HAND locks', () => {
    it('locks HAND-0 once when buffer has MOVE→HAND for player 0', () => {
      builder.build([move({ player: 0 as Player, fromLocation: LOCATION.DECK, toLocation: LOCATION.HAND })]);
      const handLockCalls = mockRbs.lockZone.calls.allArgs().filter(args => args[0] === 'HAND-0');
      expect(handLockCalls.length).toBe(1);
    });

    it('locks both HAND-0 and HAND-1 when buffer has MOVE→HAND for both players', () => {
      builder.build([
        move({ player: 0 as Player, toLocation: LOCATION.HAND }),
        move({ player: 1 as Player, toLocation: LOCATION.HAND }),
      ]);
      const keys = mockRbs.lockZone.calls.allArgs().map(args => args[0] as string);
      expect(keys).toContain('HAND-0');
      expect(keys).toContain('HAND-1');
    });

    it('locks HAND when source is HAND (discard) — fromLocation === HAND', () => {
      builder.build([move({
        player: 0 as Player, fromLocation: LOCATION.HAND, toLocation: LOCATION.GRAVE,
      })]);
      const keys = mockRbs.lockZone.calls.allArgs().map(args => args[0] as string);
      expect(keys).toContain('HAND-0');
    });

    it('does not lock HAND when no event touches HAND', () => {
      builder.build([move({
        player: 0 as Player, fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE,
      })]);
      const keys = mockRbs.lockZone.calls.allArgs().map(args => args[0] as string);
      expect(keys).not.toContain('HAND-0');
    });
  });

  describe('build — beginHandBatch reservation', () => {
    it('reserves N slots when N tutors arrive for the same player', () => {
      builder.build([
        move({ player: 0 as Player, cardCode: 11, toLocation: LOCATION.HAND }),
        move({ player: 0 as Player, cardCode: 12, toLocation: LOCATION.HAND }),
        move({ player: 0 as Player, cardCode: 13, toLocation: LOCATION.HAND }),
      ]);
      expect(mockDrawManager.beginHandBatch).toHaveBeenCalledWith(0, 3);
    });

    it('reserves slots per-player independently', () => {
      builder.build([
        move({ player: 0 as Player, cardCode: 1, toLocation: LOCATION.HAND }),
        move({ player: 1 as Player, cardCode: 2, toLocation: LOCATION.HAND }),
        move({ player: 1 as Player, cardCode: 3, toLocation: LOCATION.HAND }),
      ]);
      expect(mockDrawManager.beginHandBatch).toHaveBeenCalledWith(0, 1);
      expect(mockDrawManager.beginHandBatch).toHaveBeenCalledWith(1, 2);
    });

    it('does NOT reserve a slot when MOVE goes from HAND (discard)', () => {
      builder.build([move({
        player: 0 as Player, fromLocation: LOCATION.HAND, toLocation: LOCATION.GRAVE,
      })]);
      // Discard touches HAND (source) but doesn't add a card → no batch slot
      expect(mockDrawManager.beginHandBatch).not.toHaveBeenCalled();
    });
  });

  describe('build — releaseSessionLocks', () => {
    it('releases all session HAND locks and ends the hand batch', () => {
      const { releaseSessionLocks } = builder.build([
        move({ player: 0 as Player, toLocation: LOCATION.HAND }),
      ]);
      releaseSessionLocks();
      expect(releaseSpy).toHaveBeenCalled();
      expect(mockDrawManager.endHandBatch).toHaveBeenCalledWith(0);
    });

    it('releases nothing on a buffer with no HAND-touching events', () => {
      const { releaseSessionLocks } = builder.build([move({
        player: 0 as Player, fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE,
      })]);
      releaseSpy.calls.reset();
      releaseSessionLocks();
      expect(mockDrawManager.endHandBatch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // build — pre-lock + batch grouping
  // ---------------------------------------------------------------------------

  describe('build — preLockQueuedSources', () => {
    it('forwards only zone events (MSG_MOVE / MSG_DRAW)', () => {
      const m = move({ player: 0 as Player });
      const damage = { type: 'MSG_DAMAGE', player: 0, amount: 100 } as GameEvent;
      builder.build([m, damage]);
      const forwarded = mockMoveRouter.preLockQueuedSources.calls.mostRecent().args[0] as readonly GameEvent[];
      expect(forwarded.length).toBe(1);
      expect(forwarded[0]).toBe(m);
    });
  });

  describe('build — group / barrier directives', () => {
    it('groups consecutive zone events with stagger and adds a barrier', () => {
      const m1 = move({ cardCode: 1 });
      const m2 = move({ cardCode: 2 });
      const { batch } = builder.build([m1, m2]);
      // Expect: [{group}, {barrier}]
      const dirs = batch.filter(b => 'kind' in b);
      const kinds = dirs.map(d => (d as { kind: string }).kind);
      expect(kinds).toEqual(['group', 'barrier']);
      expect((batch[0] as { events: GameEvent[] }).events.length).toBe(2);
    });

    it('flushes group when a non-zone event arrives between zone events', () => {
      const m1 = move({ cardCode: 1 });
      const damage = { type: 'MSG_DAMAGE', player: 0, amount: 100 } as GameEvent;
      const m2 = move({ cardCode: 2 });
      const { batch } = builder.build([m1, damage, m2]);
      // Expect: [{group:[m1]},{barrier}, {lp:damage}, {group:[m2]},{barrier}]
      const dirs = batch.filter(b => 'kind' in b).map(b => (b as { kind: string }).kind);
      expect(dirs).toEqual(['group', 'barrier', 'lp', 'group', 'barrier']);
    });

    it('wraps LP events in {kind:"lp", event}', () => {
      const damage = { type: 'MSG_DAMAGE', player: 0, amount: 500 } as GameEvent;
      const { batch } = builder.build([damage]);
      expect(batch.length).toBe(1);
      expect(batch[0]).toEqual({ kind: 'lp', event: damage });
    });

    it('splits group at overlay→non-overlay category boundary (XYZ destroy)', () => {
      // Two overlay detaches, then destroy monster — expect a flush between them.
      const detach1 = move({ fromLocation: LOCATION.OVERLAY, toLocation: LOCATION.GRAVE, fromSequence: 0 });
      const detach2 = move({ fromLocation: LOCATION.OVERLAY, toLocation: LOCATION.GRAVE, fromSequence: 1 });
      const destroy = move({ fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE, reason: 0x1 });
      const { batch } = builder.build([detach1, detach2, destroy]);
      const dirs = batch.filter(b => 'kind' in b).map(b => (b as { kind: string }).kind);
      // Expect: [group(detach1+detach2), barrier, group(destroy), barrier]
      expect(dirs).toEqual(['group', 'barrier', 'group', 'barrier']);
      expect((batch[0] as { events: GameEvent[] }).events.length).toBe(2); // 2 detaches together
      expect((batch[2] as { events: GameEvent[] }).events.length).toBe(1); // destroy alone
    });
  });

  // ---------------------------------------------------------------------------
  // interleaveConfirmsWithMoves
  // ---------------------------------------------------------------------------

  describe('interleaveConfirmsWithMoves', () => {
    it('inlines a single-card CONFIRM right after its matching MOVE→HAND', () => {
      const tutor = move({ cardCode: 100, player: 0 as Player, toLocation: LOCATION.HAND });
      const reveal = confirmCards([{ cardCode: 100, player: 0 as Player }]);
      const out = builder.interleaveConfirmsWithMoves([tutor, reveal]);
      expect(out.length).toBe(2);
      expect(out[0]).toBe(tutor);
      expect((out[1] as ConfirmCardsMsg).cards.length).toBe(1);
      expect((out[1] as ConfirmCardsMsg).cards[0].cardCode).toBe(100);
    });

    it('produces tutor→reveal→tutor→reveal flow for multi-tutor batches', () => {
      const tutor1 = move({ cardCode: 11, player: 0 as Player, toLocation: LOCATION.HAND });
      const tutor2 = move({ cardCode: 22, player: 0 as Player, toLocation: LOCATION.HAND });
      const reveals = confirmCards([
        { cardCode: 11, player: 0 as Player },
        { cardCode: 22, player: 0 as Player },
      ]);
      const out = builder.interleaveConfirmsWithMoves([tutor1, tutor2, reveals]);
      // Expect: [tutor1, reveal11, tutor2, reveal22]
      expect(out.length).toBe(4);
      expect(out[0]).toBe(tutor1);
      expect((out[1] as ConfirmCardsMsg).cards[0].cardCode).toBe(11);
      expect(out[2]).toBe(tutor2);
      expect((out[3] as ConfirmCardsMsg).cards[0].cardCode).toBe(22);
    });

    it('keeps unmatched cards in a remaining CONFIRM at the original position', () => {
      const tutor = move({ cardCode: 100, player: 0 as Player, toLocation: LOCATION.HAND });
      const reveal = confirmCards([
        { cardCode: 100, player: 0 as Player },
        { cardCode: 999, player: 0 as Player }, // no matching MOVE
      ]);
      const out = builder.interleaveConfirmsWithMoves([tutor, reveal]);
      // Expect: [tutor, reveal100, remaining(999)]
      expect(out.length).toBe(3);
      expect(out[0]).toBe(tutor);
      expect((out[1] as ConfirmCardsMsg).cards[0].cardCode).toBe(100);
      expect((out[2] as ConfirmCardsMsg).cards.length).toBe(1);
      expect((out[2] as ConfirmCardsMsg).cards[0].cardCode).toBe(999);
    });

    it('does not match a MOVE→GY (only MOVE→HAND counts)', () => {
      const sendToGy = move({ cardCode: 100, player: 0 as Player, toLocation: LOCATION.GRAVE });
      const reveal = confirmCards([{ cardCode: 100, player: 0 as Player }]);
      const out = builder.interleaveConfirmsWithMoves([sendToGy, reveal]);
      // No matching MOVE→HAND → reveal stays as remaining at original position
      expect(out.length).toBe(2);
      expect(out[0]).toBe(sendToGy);
      expect((out[1] as ConfirmCardsMsg).cards.length).toBe(1);
    });

    it('matches by player — two tutors on different players match their respective CONFIRM cards', () => {
      const tutorA = move({ cardCode: 10, player: 0 as Player, toLocation: LOCATION.HAND });
      const tutorB = move({ cardCode: 10, player: 1 as Player, toLocation: LOCATION.HAND });
      const reveals = confirmCards([
        { cardCode: 10, player: 1 as Player }, // matches tutorB
        { cardCode: 10, player: 0 as Player }, // matches tutorA
      ]);
      const out = builder.interleaveConfirmsWithMoves([tutorA, tutorB, reveals]);
      // Each tutor consumed exactly once → 4 items total
      expect(out.length).toBe(4);
      // tutorA gets reveal player=0, tutorB gets reveal player=1
      const insertedA = out[1] as ConfirmCardsMsg;
      const insertedB = out[3] as ConfirmCardsMsg;
      expect(insertedA.cards[0].player).toBe(0);
      expect(insertedB.cards[0].player).toBe(1);
    });

    it('passes through buffers with no CONFIRM events unchanged', () => {
      const m1 = move({ cardCode: 1 });
      const m2 = move({ cardCode: 2 });
      const out = builder.interleaveConfirmsWithMoves([m1, m2]);
      expect(out).toEqual([m1, m2]);
    });

    it('returns empty array on empty buffer', () => {
      expect(builder.interleaveConfirmsWithMoves([])).toEqual([]);
    });
  });
});
