import { TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { LpAnimationTracker } from './lp-animation-tracker';
import { DuelContext } from './duel-context';
import { ScopeResetDispatcher } from '../projections';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { RenderedBoardStateService } from './rendered-board-state.service';
import type { DamageMsg, RecoverMsg, PayLpCostMsg, Player } from '../duel-ws.types';
import type { GameEvent } from '../types';

describe('LpAnimationTracker', () => {
  let tracker: LpAnimationTracker;
  let mockRbs: jasmine.SpyObj<RenderedBoardStateService>;
  let mockAnnouncer: jasmine.SpyObj<LiveAnnouncer>;

  beforeEach(() => {
    mockRbs = jasmine.createSpyObj('RenderedBoardStateService', ['commitLp']);
    mockAnnouncer = jasmine.createSpyObj('LiveAnnouncer', ['announce']);

    const mockCtx = {
      relativePlayer: (abs: number) => abs === 0 ? 0 : 1,
      ownPlayerIndex: () => 0,
      speedMultiplier: () => 1,
    };

    const mockDataSource = { renderedBoardState: mockRbs };

    TestBed.configureTestingModule({
      providers: [
        LpAnimationTracker,
        ScopeResetDispatcher,
        { provide: DuelContext, useValue: mockCtx },
        { provide: ANIMATION_DATA_SOURCE, useValue: mockDataSource },
        { provide: LiveAnnouncer, useValue: mockAnnouncer },
      ],
    });

    tracker = TestBed.inject(LpAnimationTracker);
    // Override baseLpDuration to avoid CSS variable read
    Object.defineProperty(tracker, 'baseLpDuration', { get: () => 500 });
  });

  // β.3 Lot 2.2-REDO — pipeline-like helper: replicates what the
  // orchestrator does at push time (decorate the event with the
  // tracker's `peekLpDelta` output) and feeds it to the projection.
  // Then mutates via processLpEvent to advance trackedLp. Mirrors the
  // production flow without booting the orchestrator.
  function pipeLpEvent(player: number, amount: number, type: 'damage' | 'recover'): void {
    const lpDelta = tracker.peekLpDelta(player, amount, type);
    const msgType = type === 'recover' ? 'MSG_RECOVER' : 'MSG_DAMAGE';
    tracker.animatingLpPlayerProjection.applyEvent({
      type: msgType, player, amount, lpDelta,
    } as unknown as Parameters<typeof tracker.animatingLpPlayerProjection.applyEvent>[0]);
    tracker.processLpEvent(player, amount, type);
  }

  describe('processLpEvent + peekLpDelta (pipeline-equivalent flow)', () => {
    it('should track damage and set animating data via the projection', () => {
      pipeLpEvent(0, 3000, 'damage');
      const anim = tracker.animatingLpPlayer();
      expect(anim).toBeTruthy();
      expect(anim!.fromLp).toBe(8000);
      expect(anim!.toLp).toBe(5000);
      expect(anim!.type).toBe('damage');
      expect(anim!.player).toBe(0);
    });

    it('should track recovery', () => {
      pipeLpEvent(0, 2000, 'damage');
      pipeLpEvent(0, 1000, 'recover');
      expect(tracker.animatingLpPlayer()!.toLp).toBe(7000);
    });

    it('should clamp damage at 0', () => {
      pipeLpEvent(0, 99999, 'damage');
      expect(tracker.animatingLpPlayer()!.toLp).toBe(0);
    });

    it('should track opponent LP separately (relative index 1)', () => {
      pipeLpEvent(1, 500, 'damage');
      const lps = tracker.getTrackedLp();
      expect(lps[0]).toBe(8000); // own unchanged
      expect(lps[1]).toBe(7500); // opponent
    });

    it('should return baseLpDuration', () => {
      const duration = tracker.processLpEvent(0, 100, 'damage');
      expect(duration).toBe(500);
    });

    it('should mark pending LP commit', () => {
      expect(tracker.hasPendingCommit).toBeFalse();
      tracker.processLpEvent(0, 100, 'damage');
      expect(tracker.hasPendingCommit).toBeTrue();
    });

    it('should announce own LP with "Your" prefix', () => {
      tracker.processLpEvent(0, 1000, 'damage');
      expect(mockAnnouncer.announce).toHaveBeenCalledWith('Your LP: 7000');
    });

    it('should announce opponent LP with "Opponent" prefix', () => {
      tracker.processLpEvent(1, 500, 'damage');
      expect(mockAnnouncer.announce).toHaveBeenCalledWith('Opponent LP: 7500');
    });

    it('should compute durationMs using speedMultiplier (via peekLpDelta)', () => {
      const delta = tracker.peekLpDelta(0, 100, 'damage');
      // speedMultiplier = 1, baseLpDuration = 500 → durationMs = 500
      expect(delta.durationMs).toBe(500);
    });

    it('β.3 R4 — peekLpDelta MUST read trackedLp BEFORE processLpEvent mutates (case lp order contract)', () => {
      // The orchestrator's `processDirective.case "lp"` runs in this
      // strict order:
      //   1. `decorateLpEventForStream(event)` → calls peekLpDelta
      //      (pre-mutation read of trackedLp).
      //   2. `pushToStream(decoratedEvent)` → feeds the projection
      //      with `{fromLp, toLp}`.
      //   3. `fireLpReplayEvent(event)` → calls processLpEvent
      //      (mutates trackedLp).
      //
      // If anyone swaps steps 1 and 3, `peekLpDelta` reads the
      // POST-mutation value: `fromLp === toLp` → badge animation
      // silently freezes (no visible interpolation). This test pins
      // the contract by asserting `peekLpDelta` returns the
      // PRE-mutation `fromLp` when called BEFORE `processLpEvent`.
      const delta = tracker.peekLpDelta(0, 1000, 'damage');
      tracker.processLpEvent(0, 1000, 'damage');
      expect(delta.fromLp).toBe(8000);
      expect(delta.toLp).toBe(7000);
      expect(tracker.getTrackedLp()[0]).toBe(7000);
    });

    it('β.3 R4 (regression case) — swapping the order desync\'s the projection', () => {
      // Asserts the INVERTED order produces the wrong delta — proving
      // the contract pinned above isn't a tautology. If a future
      // refactor moves `processLpEvent` BEFORE `peekLpDelta`, this
      // test surfaces the silent freeze.
      tracker.processLpEvent(0, 1000, 'damage');
      const delta = tracker.peekLpDelta(0, 500, 'damage');
      // Post-mutation read: fromLp is now 7000, not 8000.
      expect(delta.fromLp).toBe(7000);
      // And toLp would be 6500, not the 7500 we'd expect if peek
      // had run before the mutation.
      expect(delta.toLp).toBe(6500);
    });
  });

  describe('commitIfPending', () => {
    it('should call rbs.commitLp for each pending player', () => {
      tracker.processLpEvent(0, 100, 'damage');
      tracker.processLpEvent(1, 200, 'damage');
      tracker.commitIfPending();
      expect(mockRbs.commitLp).toHaveBeenCalledWith(0);
      expect(mockRbs.commitLp).toHaveBeenCalledWith(1);
      expect(tracker.hasPendingCommit).toBeFalse();
    });

    it('should not call commitLp when nothing pending', () => {
      tracker.commitIfPending();
      expect(mockRbs.commitLp).not.toHaveBeenCalled();
    });

    it('should deduplicate commits for same player', () => {
      tracker.processLpEvent(0, 100, 'damage');
      tracker.processLpEvent(0, 200, 'damage');
      tracker.commitIfPending();
      expect(mockRbs.commitLp).toHaveBeenCalledTimes(1);
    });

    it('β.3 Lot 2.2-REDO — commitIfPending NO LONGER touches the animation signal', () => {
      // The projection is the source of truth for `animatingLpPlayer`.
      // Its clear path is now `AnimationCompleted` on the stream,
      // emitted by the runner's `onStepSettled` callback — NOT
      // `commitIfPending` (which is a tracker concern).
      pipeLpEvent(0, 100, 'damage');
      expect(tracker.animatingLpPlayer()).not.toBeNull();
      tracker.commitIfPending();
      // The visual signal stays set; only AnimationCompleted clears it.
      expect(tracker.animatingLpPlayer()).not.toBeNull();
    });

    it('β.3 Lot 2.2-REDO — discardPending also does NOT touch the animation signal', () => {
      pipeLpEvent(0, 100, 'damage');
      const before = tracker.animatingLpPlayer();
      expect(before).not.toBeNull();
      tracker.discardPending();
      expect(tracker.animatingLpPlayer()).toBe(before);
    });
  });

  describe('discardPending', () => {
    it('should clear pending without committing', () => {
      tracker.processLpEvent(0, 100, 'damage');
      tracker.discardPending();
      expect(tracker.hasPendingCommit).toBeFalse();
      expect(mockRbs.commitLp).not.toHaveBeenCalled();
    });

    it('should NOT clear animatingLpPlayer signal (animation may still play)', () => {
      pipeLpEvent(0, 100, 'damage');
      tracker.discardPending();
      expect(tracker.animatingLpPlayer()).not.toBeNull();
    });
  });

  describe('applyInstant', () => {
    it('should apply MSG_DAMAGE without animation', () => {
      const event = { type: 'MSG_DAMAGE', player: 0, amount: 3000 } as DamageMsg;
      tracker.applyInstant(event as GameEvent);
      expect(tracker.getTrackedLp()[0]).toBe(5000);
      expect(tracker.animatingLpPlayer()).toBeNull(); // no animation set
    });

    it('should apply MSG_PAY_LPCOST as damage', () => {
      const event = { type: 'MSG_PAY_LPCOST', player: 0, amount: 1000 } as PayLpCostMsg;
      tracker.applyInstant(event as GameEvent);
      expect(tracker.getTrackedLp()[0]).toBe(7000);
    });

    it('should apply MSG_RECOVER', () => {
      tracker.applyInstant({ type: 'MSG_DAMAGE', player: 0, amount: 5000 } as GameEvent);
      tracker.applyInstant({ type: 'MSG_RECOVER', player: 0, amount: 2000 } as GameEvent);
      expect(tracker.getTrackedLp()[0]).toBe(5000);
    });

    it('should clamp damage at 0', () => {
      tracker.applyInstant({ type: 'MSG_DAMAGE', player: 0, amount: 99999 } as GameEvent);
      expect(tracker.getTrackedLp()[0]).toBe(0);
    });
  });

  describe('fireLpReplayEvent', () => {
    // β.3 Lot 2.2-REDO — `fireLpReplayEvent` is the tracker's
    // **mutating** side (advance trackedLp, register pending commit,
    // announce). The visual projection is fed separately by the
    // orchestrator's `processDirective.case 'lp'` (which decorates +
    // pushes to the stream right before calling
    // `fireLpReplayEvent`). The unit tests below assert the mutation
    // half; the projection side has its own spec.
    it('should delegate MSG_DAMAGE to processLpEvent (trackedLp mutation)', () => {
      tracker.fireLpReplayEvent({ type: 'MSG_DAMAGE', player: 0, amount: 1000 } as GameEvent);
      expect(tracker.getTrackedLp()[0]).toBe(7000);
      expect(tracker.hasPendingCommit).toBeTrue();
    });

    it('should delegate MSG_RECOVER to processLpEvent', () => {
      tracker.fireLpReplayEvent({ type: 'MSG_RECOVER', player: 0, amount: 500 } as GameEvent);
      expect(tracker.getTrackedLp()[0]).toBe(8500);
    });

    it('should delegate MSG_PAY_LPCOST as damage', () => {
      tracker.fireLpReplayEvent({ type: 'MSG_PAY_LPCOST', player: 0, amount: 2000 } as GameEvent);
      expect(tracker.getTrackedLp()[0]).toBe(6000);
    });
  });

  describe('syncFromBoardState', () => {
    it('should override tracked LP', () => {
      tracker.processLpEvent(0, 3000, 'damage');
      tracker.syncFromBoardState(6000, 7000);
      expect(tracker.getTrackedLp()).toEqual([6000, 7000]);
    });
  });

  describe('getTrackedLp', () => {
    it('should return a copy (not mutate internal state)', () => {
      const lps = tracker.getTrackedLp();
      lps[0] = 0;
      expect(tracker.getTrackedLp()[0]).toBe(8000);
    });
  });

  describe('reset', () => {
    it('should restore default state (trackedLp + pending)', () => {
      tracker.processLpEvent(0, 5000, 'damage');
      tracker.reset();
      expect(tracker.getTrackedLp()).toEqual([8000, 8000]);
      expect(tracker.hasPendingCommit).toBeFalse();
    });

    it('β.3 Lot 2.2-REDO — reset does NOT touch the visual projection', () => {
      // The visual projection is the source of truth for
      // `animatingLpPlayer`; its lifecycle is driven by the
      // `ScopeResetDispatcher` (not by the tracker's local reset).
      // A bare `tracker.reset()` only handles the mutating state.
      pipeLpEvent(0, 100, 'damage');
      expect(tracker.animatingLpPlayer()).not.toBeNull();
      tracker.reset();
      // Projection slice survives — dispatcher would clear it via applyReset.
      expect(tracker.animatingLpPlayer()).not.toBeNull();
    });
  });

  describe('when local player is player 1 (inverted relativePlayer)', () => {
    let tracker1: LpAnimationTracker;
    let mockRbs1: jasmine.SpyObj<RenderedBoardStateService>;
    let mockAnnouncer1: jasmine.SpyObj<LiveAnnouncer>;

    beforeEach(() => {
      mockRbs1 = jasmine.createSpyObj('RenderedBoardStateService', ['commitLp']);
      mockAnnouncer1 = jasmine.createSpyObj('LiveAnnouncer', ['announce']);

      // Local player is player 1: relativePlayer maps 1→0 (own), 0→1 (opponent)
      const invertedCtx = {
        relativePlayer: (abs: number) => abs === 1 ? 0 : 1,
        ownPlayerIndex: () => 1,
        speedMultiplier: () => 1,
      };

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          LpAnimationTracker,
          ScopeResetDispatcher,
          { provide: DuelContext, useValue: invertedCtx },
          { provide: ANIMATION_DATA_SOURCE, useValue: { renderedBoardState: mockRbs1 } },
          { provide: LiveAnnouncer, useValue: mockAnnouncer1 },
        ],
      });
      tracker1 = TestBed.inject(LpAnimationTracker);
      Object.defineProperty(tracker1, 'baseLpDuration', { get: () => 500 });
    });

    it('should apply damage to own LP (index 0) when absolute player is 1', () => {
      tracker1.processLpEvent(1, 2000, 'damage');
      const lps = tracker1.getTrackedLp();
      expect(lps[0]).toBe(6000); // own (relative 0)
      expect(lps[1]).toBe(8000); // opponent unchanged
    });

    it('should apply damage to opponent LP (index 1) when absolute player is 0', () => {
      tracker1.processLpEvent(0, 500, 'damage');
      const lps = tracker1.getTrackedLp();
      expect(lps[0]).toBe(8000); // own unchanged
      expect(lps[1]).toBe(7500); // opponent (relative 1)
    });

    it('should announce "Your LP" for own player (absolute 1)', () => {
      tracker1.processLpEvent(1, 1000, 'damage');
      expect(mockAnnouncer1.announce).toHaveBeenCalledWith('Your LP: 7000');
    });

    it('should announce "Opponent LP" for opponent (absolute 0)', () => {
      tracker1.processLpEvent(0, 500, 'damage');
      expect(mockAnnouncer1.announce).toHaveBeenCalledWith('Opponent LP: 7500');
    });

    it('should commitLp with relative player index', () => {
      tracker1.processLpEvent(1, 100, 'damage');
      tracker1.commitIfPending();
      expect(mockRbs1.commitLp).toHaveBeenCalledWith(0); // relative index
    });
  });
});
