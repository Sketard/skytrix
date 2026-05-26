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
import { Injector, runInInjectionContext } from '@angular/core';
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
    it('LpAnimationTracker registers with scope DUEL_LIFETIME', () => {
      const lp = TestBed.inject(LpAnimationTracker);
      expect(dispatcher.size).toBeGreaterThanOrEqual(1);
      expect((lp as unknown as ResetTarget).scope).toBe('DUEL_LIFETIME');
    });

    it('BattleAnimationTracker registers with scope PERSPECTIVE_LIFETIME', () => {
      const battle = TestBed.inject(BattleAnimationTracker);
      expect((battle as unknown as ResetTarget).scope).toBe('PERSPECTIVE_LIFETIME');
    });

    it('ChainResolutionManager registers with scope PERSPECTIVE_LIFETIME (most volatile slice)', () => {
      const chain = TestBed.inject(ChainResolutionManager);
      expect((chain as unknown as ResetTarget).scope).toBe('PERSPECTIVE_LIFETIME');
    });

    it('DuelGameLogService registers with scope DUEL_LIFETIME', () => {
      const log = TestBed.inject(DuelGameLogService);
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

  describe('back-compat — managers work without dispatcher', () => {
    it('LpAnimationTracker instantiates standalone (no ScopeResetDispatcher in providers)', () => {
      // Fresh TestBed without ScopeResetDispatcher — proves the
      // `{ optional: true }` injection skips registration silently and
      // the manager remains functional for isolated unit specs.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          LpAnimationTracker, DuelLogger, DuelContext,
          { provide: LiveAnnouncer, useValue: liveAnnouncerStub },
          { provide: ANIMATION_DATA_SOURCE, useValue: dataSourceStub },
        ],
      });

      const injector = TestBed.inject(Injector);
      runInInjectionContext(injector, () => {
        const lp = TestBed.inject(LpAnimationTracker);
        expect(lp).toBeTruthy();
        expect((lp as unknown as ResetTarget).scope).toBe('DUEL_LIFETIME');
      });
    });
  });
});
