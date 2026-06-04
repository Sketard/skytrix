// =============================================================================
// reset-target-integration.spec.ts — α.4b
// -----------------------------------------------------------------------------
// Verifies the 4 managers auto-register with the `ScopeResetDispatcher` at
// construction and receive `applyReset` when their scope is dispatched.
// Each manager has its own unit spec for behaviour; this file is the seam
// between them and the dispatcher infrastructure.
//
// Co-located in `duel-page/` (not in `projections/`) because the test
// configures a real Angular DI container with the manager constructors —
// the dispatcher remains pure-class but the managers carry Angular
// `@Injectable` decorators.
// =============================================================================

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';

import { ScopeResetDispatcher } from '../projections';
import type { ResetTarget, ScopeCategory } from '../projections';

import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { BattleAnimationTracker } from './battle-animation-tracker';
import { CardTravelEngine } from './card-travel-engine.service';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DuelContext } from './duel-context';
import { DuelGameLogService } from './duel-game-log.service';
import { DuelLogger } from './duel-logger';
import { LpAnimationTracker } from './lp-animation-tracker';

// Minimal stubs — the managers' specs already cover their behaviour;
// here we only need them to instantiate so the constructor runs.
const liveAnnouncerStub = { announce: () => undefined };
const dataSourceStub = {
  renderedBoardState: {},
  // not consumed by constructors
};
const cardTravelEngineStub = {};

describe('α.4b — managers as ResetTarget (integration)', () => {
  let dispatcher: ScopeResetDispatcher;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ScopeResetDispatcher,
        DuelLogger,
        DuelContext,
        LpAnimationTracker,
        BattleAnimationTracker,
        ChainResolutionManager,
        DuelGameLogService,
        { provide: LiveAnnouncer, useValue: liveAnnouncerStub },
        { provide: ANIMATION_DATA_SOURCE, useValue: dataSourceStub },
        { provide: CardTravelEngine, useValue: cardTravelEngineStub },
      ],
    });
    dispatcher = TestBed.inject(ScopeResetDispatcher);
  });

  describe('auto-registration at construction', () => {
    // Each manager test spies on `dispatcher.register` BEFORE the manager
    // is instantiated, then asserts the spy received that exact instance.
    // This catches a constructor that forgets `this.dispatcher?.register(this)`
    // — a `size >= 1` check would pass coincidentally if any other manager
    // (or a previous test's leftover) had registered first.
    it('LpAnimationTracker calls register with itself and declares DUEL_LIFETIME', () => {
      const registerSpy = spyOn(dispatcher, 'register').and.callThrough();
      const lp = TestBed.inject(LpAnimationTracker);
      expect(registerSpy).toHaveBeenCalledWith(lp as unknown as ResetTarget);
      expect((lp as unknown as ResetTarget).scope).toBe('DUEL_LIFETIME');
    });

    it('BattleAnimationTracker calls register with itself and declares PERSPECTIVE_LIFETIME', () => {
      const registerSpy = spyOn(dispatcher, 'register').and.callThrough();
      const battle = TestBed.inject(BattleAnimationTracker);
      expect(registerSpy).toHaveBeenCalledWith(battle as unknown as ResetTarget);
      expect((battle as unknown as ResetTarget).scope).toBe('PERSPECTIVE_LIFETIME');
    });

    it('ChainResolutionManager calls register with itself and declares PERSPECTIVE_LIFETIME (most volatile slice)', () => {
      const registerSpy = spyOn(dispatcher, 'register').and.callThrough();
      const chain = TestBed.inject(ChainResolutionManager);
      expect(registerSpy).toHaveBeenCalledWith(chain as unknown as ResetTarget);
      expect((chain as unknown as ResetTarget).scope).toBe('PERSPECTIVE_LIFETIME');
    });

    it('DuelGameLogService calls register with itself and declares DUEL_LIFETIME', () => {
      const registerSpy = spyOn(dispatcher, 'register').and.callThrough();
      const log = TestBed.inject(DuelGameLogService);
      expect(registerSpy).toHaveBeenCalledWith(log as unknown as ResetTarget);
      expect((log as unknown as ResetTarget).scope).toBe('DUEL_LIFETIME');
    });

    it('4 managers instantiated → dispatcher holds 4 targets', () => {
      TestBed.inject(LpAnimationTracker);
      TestBed.inject(BattleAnimationTracker);
      TestBed.inject(ChainResolutionManager);
      TestBed.inject(DuelGameLogService);
      expect(dispatcher.size).toBe(4);
    });
  });

  describe('dispatch fan-out', () => {
    it('PerspectiveSwitched (PERSPECTIVE_LIFETIME) reaches Battle + Chain only', () => {
      const lp = TestBed.inject(LpAnimationTracker);
      const battle = TestBed.inject(BattleAnimationTracker);
      const chain = TestBed.inject(ChainResolutionManager);
      const log = TestBed.inject(DuelGameLogService);

      const lpReset = spyOn(lp, 'applyReset').and.callThrough();
      const battleReset = spyOn(battle, 'applyReset').and.callThrough();
      const chainReset = spyOn(chain, 'applyReset').and.callThrough();
      const logReset = spyOn(log, 'applyReset').and.callThrough();

      dispatcher.dispatch(new Set<ScopeCategory>(['PERSPECTIVE_LIFETIME']));

      // Scope PERSPECTIVE_LIFETIME hits projections whose declared scope IS
      // PERSPECTIVE_LIFETIME. Battle + Chain match, Lp + Log don't.
      expect(battleReset).toHaveBeenCalledTimes(1);
      expect(chainReset).toHaveBeenCalledTimes(1);
      expect(lpReset).not.toHaveBeenCalled();
      expect(logReset).not.toHaveBeenCalled();
    });

    it('DUEL_LIFETIME reset cascades to all 4 managers (DUEL ⊃ CONNECTION ⊃ PERSPECTIVE)', () => {
      const lp = TestBed.inject(LpAnimationTracker);
      const battle = TestBed.inject(BattleAnimationTracker);
      const chain = TestBed.inject(ChainResolutionManager);
      const log = TestBed.inject(DuelGameLogService);

      const lpReset = spyOn(lp, 'applyReset').and.callThrough();
      const battleReset = spyOn(battle, 'applyReset').and.callThrough();
      const chainReset = spyOn(chain, 'applyReset').and.callThrough();
      const logReset = spyOn(log, 'applyReset').and.callThrough();

      dispatcher.dispatch(new Set<ScopeCategory>(['DUEL_LIFETIME']));

      // DUEL_LIFETIME expands to {DUEL, CONNECTION, PERSPECTIVE}. All 4
      // managers' declared scopes are in that set.
      expect(lpReset).toHaveBeenCalledTimes(1);
      expect(battleReset).toHaveBeenCalledTimes(1);
      expect(chainReset).toHaveBeenCalledTimes(1);
      expect(logReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('perspective-survival contract (party-mode 2026-05-26)', () => {
    // Per §3.5 the invalidation matrix has LP + Log declared DUEL_LIFETIME.
    // PERSPECTIVE expansion = {PERSPECTIVE} alone (PERSPECTIVE is the most
    // volatile rung; nothing strictly below). So a `notifyPerspectiveSwitch`
    // dispatch ({PERSPECTIVE_LIFETIME}) does NOT reach `applyReset` on LP
    // or Log — they survive the switch by virtue of NOT being notified, not
    // by their `applyReset` no-oping.
    //
    // The journal's re-relativisation ("Vous" vs "Adversaire" labels) is
    // carried elsewhere: page-component effects call `gameLog.setPerspective(...)`
    // on `ownPlayerIndex` / `perspectiveIndex` change (duel-page.component.ts:575,
    // replay-page.component.ts:552), which triggers an internal rebuild from
    // retained `tappedEvents`. The dispatcher contract and the perspective
    // wiring are two orthogonal mechanisms; this spec guards the dispatcher
    // half (Mary finding #3).
    it('PERSPECTIVE-only dispatch does NOT reach LP or Log applyReset', () => {
      const lp = TestBed.inject(LpAnimationTracker);
      const log = TestBed.inject(DuelGameLogService);
      const lpReset = spyOn(lp, 'applyReset').and.callThrough();
      const logReset = spyOn(log, 'applyReset').and.callThrough();

      dispatcher.dispatch(new Set<ScopeCategory>(['PERSPECTIVE_LIFETIME']));

      expect(lpReset).not.toHaveBeenCalled();
      expect(logReset).not.toHaveBeenCalled();
    });
  });

});
