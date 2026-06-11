/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';

import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { DuelLogger } from './duel-logger';
import { DuelContext } from './duel-context';
import { LpAnimationTracker } from './lp-animation-tracker';
import { BattleAnimationTracker } from './battle-animation-tracker';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DrawSequenceManager } from './draw-sequence-manager';
import { MoveAnimationRouter } from './move-animation-router';
import { TargetIndicatorManager } from './target-indicator-manager';
import { BufferReplayBuilder } from './buffer-replay-builder';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import { DuelToastService } from './duel-toast.service';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelGameLogService } from './duel-game-log.service';
import { AnimatingLpProjection, BaseProjection, ScopeResetDispatcher } from '../projections';
import { EMPTY_DUEL_STATE } from '../types';

// =============================================================================
// C3 + C5 (2026-06-01) — Smoke spec for the projection registry invariant.
// -----------------------------------------------------------------------------
// Verifies that every `BaseProjection` field on `AnimationOrchestratorService`
// is registered in the internal `_streamProjections` array — the manifest the
// `destroy()` path iterates. A future projection added via `new XxxProjection()`
// but forgotten in the `attachProjection` wiring block surfaces as a red test
// instead of a silent effect-leak (the C5 latent leak this refactor closes
// for `targetedZoneKeys`).
//
// Uses the lightest possible TestBed harness: 100% stubbed dependencies. The
// orchestrator's constructor is fully synchronous and the only thing under
// test is the post-constructor field state. No animation pipeline runs.
// =============================================================================

class StubLogger {
  log = (): void => undefined;
  warn = (): void => undefined;
  isEnabled = (): boolean => false;
  resolve = <T>(_m: string, _i: unknown, r: T): T => r;
}

class StubManager {
  reset = (): void => undefined;
  initResumeEffect = (): void => undefined;
  initQueueResumeCallback = (): void => undefined;
  hasDrawsInFlight = false;
  isResolving = false;
  shouldBufferDuringChain = false;
  bufferIfResolving = (): boolean => false;
  drainBuffer = (): [] => [];
  attachChainPhaseSource = (): void => undefined;
  clearTimeouts = (): void => undefined;
  releaseAllPreLocks = (): void => undefined;
  preLockQueuedSources = (): void => undefined;
}

class StubLpTracker extends StubManager {
  // β.3 projection owned by the real LpAnimationTracker — instantiated on
  // the stub so the orchestrator's `attachProjection` call finds it.
  readonly animatingLpPlayerProjection = new AnimatingLpProjection();
}

// Builds a fresh RBS-shaped stub. Each call returns a NEW object so the
// orchestrator can detect a connection swap (mirror of `DuelConnection` ctor
// creating `new RenderedBoardStateService()` for every conn — PvP default
// + SOLO multiplex bound via `bindSoloConnection`).
//
// Patch H (2026-06-05 code review) — `attachFloatRegistryCallOrder` +
// `getSafetyTimeoutMsAssignOrder` capture the monotonic order in which
// the orchestrator's effect body calls `attachFloatRegistry` then assigns
// the override. The ordering contract is "registry first, override
// second" : a future refactor that inverts them could land a
// `getSafetyTimeoutMs` consumer reading `_floatRegistry` before it is
// attached (NPE in some debug path). The H spec below pins this.
type StubRbs = {
  commitUnlocked: () => void;
  lockZone: () => void;
  attachFloatRegistry: () => void;
  getSafetyTimeoutMs: () => number;
  dropOrphanedLocks: (reason: string) => number;
  setPostRequestStopWindow: (v: boolean) => void;
  attachFloatRegistryCallOrder: number | null;
  getSafetyTimeoutMsAssignOrder: number | null;
};

function makeStubRbs(dropOrphanedLocksCalls: { reason: string; order: number }[],
                    setPostRequestStopWindowCalls: { value: boolean; order: number }[],
                    nextOrder: () => number): StubRbs {
  const rbs: StubRbs = {
    commitUnlocked: (): void => undefined,
    lockZone: (): void => undefined,
    attachFloatRegistry: (): void => { rbs.attachFloatRegistryCallOrder = nextOrder(); },
    // Default value mirroring the real `RenderedBoardStateService` field
    // assignment (`= () => LOCK_SAFETY_TIMEOUT_MS`). The orchestrator's
    // ctor effect MUST override this to `ctx.safetyTimeout(...)`.
    getSafetyTimeoutMs: ((): number => 1000) as () => number,
    dropOrphanedLocks: (reason: string): number => {
      dropOrphanedLocksCalls.push({ reason, order: nextOrder() });
      return 0;
    },
    setPostRequestStopWindow: (v: boolean): void => {
      setPostRequestStopWindowCalls.push({ value: v, order: nextOrder() });
    },
    attachFloatRegistryCallOrder: null,
    getSafetyTimeoutMsAssignOrder: null,
  };
  // Intercept the `getSafetyTimeoutMs = ...` re-assignment by the
  // orchestrator's effect so we can capture WHEN it lands relative to
  // `attachFloatRegistry`. A property setter cannot be defined on a
  // plain object property and re-assigned later via simple `=`, so we
  // use a defineProperty descriptor with a custom setter.
  let backing = rbs.getSafetyTimeoutMs;
  Object.defineProperty(rbs, 'getSafetyTimeoutMs', {
    configurable: true,
    enumerable: true,
    get: () => backing,
    set: (v: () => number) => {
      backing = v;
      rbs.getSafetyTimeoutMsAssignOrder = nextOrder();
    },
  });
  return rbs;
}

class StubDataSource {
  // v3 Phase 5 — `dropOrphanedLocks` is the Phase 3 transition-cleanup
  // called by `QueueRunner.requestStop`. The orchestrator's new
  // `notifyPerspectiveSwitch` head-call `clearTimersAndPolling()` reaches
  // this method via the runner ; spec accounting tracks call count + arg.
  //
  // v3 Phase 5-bis P5 follow-up (2026-06-05) — `callOrder` is a shared
  // monotonic counter incremented on every observable side-effect.
  // Tests use it to assert ORDERING ("clear before push") instead of just
  // "both happened" (which a regression that inverts the order would
  // silently pass).
  dropOrphanedLocksCalls: { reason: string; order: number }[] = [];
  setPostRequestStopWindowCalls: { value: boolean; order: number }[] = [];
  private _nextOrder = 0;
  nextOrder(): number { return this._nextOrder++; }

  // 2026-06-05 (fix #2) — RBS held in a signal so a swap (mirror of SOLO
  // `bindSoloConnection` replacing the PvP-normal conn with a fresh
  // multiplex conn — and its fresh `RenderedBoardStateService`) is
  // observable via the `dataSource.renderedBoardState` getter. The
  // orchestrator's ctor effect tracks this signal and re-applies its
  // overrides on the new RBS.
  readonly _rbsSignal = signal(makeStubRbs(this.dropOrphanedLocksCalls, this.setPostRequestStopWindowCalls, () => this.nextOrder()));
  get renderedBoardState() { return this._rbsSignal(); }
  swapRbs(): ReturnType<typeof makeStubRbs> {
    const fresh = makeStubRbs(this.dropOrphanedLocksCalls, this.setPostRequestStopWindowCalls, () => this.nextOrder());
    this._rbsSignal.set(fresh);
    return fresh;
  }

  chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  activeChainLinks = signal<readonly unknown[]>([]);
  animationQueue = signal<readonly unknown[]>([]);
  logicalState = signal(EMPTY_DUEL_STATE);
  prependToQueue = (): void => undefined;
  enqueueDirective = (): void => undefined;
}

class StubCtx {
  ownPlayerIndex = (): 0 | 1 => 0;
  speedMultiplier = (): number => 1;
  isBoardActive = (): boolean => true;
  reducedMotion = (): boolean => false;
  relativePlayer = (a: number): 0 | 1 => (a === 0 ? 0 : 1);
  perspectiveSource = signal<0 | 1>(0);
  scaledDuration = (b: number): number => b;
  safetyTimeout = (b: number): number => b;
  announceEvent = (): void => undefined;
}

class StubFloatRegistry {
  inFlightCount = (): number => 0;
  landedCount = (): number => 0;
  inFlightByZone = (): ReadonlyMap<string, number> => new Map();
  clearAllTravels = (): void => undefined;
}

describe('AnimationOrchestratorService — C3 + C5 projection registry invariant', () => {
  function makeOrchestrator(): AnimationOrchestratorService {
    TestBed.configureTestingModule({
      providers: [
        AnimationOrchestratorService,
        ScopeResetDispatcher,
        DuelGameLogService,
        { provide: DuelLogger, useClass: StubLogger },
        { provide: ANIMATION_DATA_SOURCE, useClass: StubDataSource },
        { provide: DuelContext, useClass: StubCtx },
        { provide: LpAnimationTracker, useClass: StubLpTracker },
        { provide: ChainResolutionManager, useClass: StubManager },
        { provide: DrawSequenceManager, useClass: StubManager },
        { provide: MoveAnimationRouter, useClass: StubManager },
        { provide: BattleAnimationTracker, useClass: StubManager },
        { provide: TargetIndicatorManager, useClass: StubManager },
        { provide: BufferReplayBuilder, useValue: { build: (): unknown => ({ batch: [], releaseSessionLocks: () => undefined }) } },
        { provide: CardTravelEngine, useValue: {} },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useClass: StubFloatRegistry },
        { provide: DuelToastService, useValue: { show: () => undefined } },
        { provide: DuelCardArtService, useValue: { getArtUrl: () => '' } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    return TestBed.inject(AnimationOrchestratorService);
  }

  it('every BaseProjection field on the orchestrator is in _streamProjections (C5 anti-leak)', () => {
    const orch = makeOrchestrator();
    const registry = (orch as unknown as { _streamProjections: BaseProjection<unknown>[] })._streamProjections;

    // Walk the instance for own + prototype-visible properties.
    const visited = new Set<unknown>();
    const projectionFields: { name: string; value: BaseProjection<unknown> }[] = [];
    const inspect = (target: object, prefix = ''): void => {
      for (const key of Object.keys(target)) {
        const v = (target as Record<string, unknown>)[key];
        if (v === null || typeof v !== 'object' || visited.has(v)) continue;
        visited.add(v);
        if (v instanceof BaseProjection) {
          projectionFields.push({ name: `${prefix}${key}`, value: v });
          continue;
        }
        // One level deep — covers `lpTracker.animatingLpPlayerProjection`
        // (a manager-owned projection wired by the orchestrator).
        if (prefix === '') inspect(v, `${key}.`);
      }
    };
    inspect(orch);

    // Every discovered BaseProjection MUST be in the registry. Forgetting an
    // `attachProjection` call leaves the field defined but unattached → red.
    for (const { name, value } of projectionFields) {
      expect(registry).withContext(`projection field ${name} missing from _streamProjections`).toContain(value);
    }
    // Defensive lower bound — the 7 projections shipped at β.3 must all be
    // registered. A future drop is expected to update this number, not
    // silently shrink the registry.
    expect(registry.length).toBeGreaterThanOrEqual(7);
    expect(projectionFields.length).toBeGreaterThanOrEqual(7);
  });
});

// =============================================================================
// (2026-06-02) — `isBoardStableForSwitch` reduced to `!isAnimating`. The
// `chainPhase` clause was dropped because mid-resolving pauses (e.g. Faimena
// requires SELECT_CARD on the controller side) leave the runner stopped
// (isAnimating=false) even though phase==='resolving' — a SOLO viewer must
// still be able to switch to answer for the other slot. Without this fix the
// switch is gated, POLL-DROP REGRESSION fires after 10s.
//
// The `!isAnimating` floor remains load-bearing : the runner's
// `finalizeAndCommit` commits every lock BEFORE flipping `_isRunning` off
// (CLAUDE.md invariant), so any phase + `!isAnimating` implies no held locks.
// =============================================================================
describe('AnimationOrchestratorService — isBoardStableForSwitch (2026-06-02)', () => {
  function makeOrchestrator(): AnimationOrchestratorService {
    TestBed.configureTestingModule({
      providers: [
        AnimationOrchestratorService,
        ScopeResetDispatcher,
        DuelGameLogService,
        { provide: DuelLogger, useClass: StubLogger },
        { provide: ANIMATION_DATA_SOURCE, useClass: StubDataSource },
        { provide: DuelContext, useClass: StubCtx },
        { provide: LpAnimationTracker, useClass: StubLpTracker },
        { provide: ChainResolutionManager, useClass: StubManager },
        { provide: DrawSequenceManager, useClass: StubManager },
        { provide: MoveAnimationRouter, useClass: StubManager },
        { provide: BattleAnimationTracker, useClass: StubManager },
        { provide: TargetIndicatorManager, useClass: StubManager },
        { provide: BufferReplayBuilder, useValue: { build: (): unknown => ({ batch: [], releaseSessionLocks: () => undefined }) } },
        { provide: CardTravelEngine, useValue: {} },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useClass: StubFloatRegistry },
        { provide: DuelToastService, useValue: { show: () => undefined } },
        { provide: DuelCardArtService, useValue: { getArtUrl: () => '' } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    return TestBed.inject(AnimationOrchestratorService);
  }

  function setAnimating(orch: AnimationOrchestratorService, value: boolean): void {
    // `IsAnimatingProjection` self-tracks via the `runner-started` / `runner-stopped`
    // flux events. Booting the runner here is overkill — flip the underlying
    // `_running` signal directly as the minimal mutation for a guard-condition
    // spec. Field name pinned by `is-animating.projection.ts`.
    const projection = (orch as unknown as {
      isAnimating: { _running: { set: (v: boolean) => void } };
    }).isAnimating;
    projection._running.set(value);
  }

  it('returns true when chainPhase=idle AND !isAnimating (baseline)', () => {
    const orch = makeOrchestrator();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as { chainPhase: { set: (p: 'idle' | 'building' | 'resolving') => void } };
    ds.chainPhase.set('idle');
    setAnimating(orch, false);
    expect(orch.isBoardStableForSwitch).toBeTrue();
  });

  it('returns true when chainPhase=building AND !isAnimating', () => {
    const orch = makeOrchestrator();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as { chainPhase: { set: (p: 'idle' | 'building' | 'resolving') => void } };
    ds.chainPhase.set('building');
    setAnimating(orch, false);
    expect(orch.isBoardStableForSwitch).toBeTrue();
  });

  it('returns true when chainPhase=resolving AND !isAnimating (2026-06-02 SOLO mid-resolve fix)', () => {
    // Faimena scenario: chain resolving, runner paused on SELECT_CARD for the
    // other slot. The viewer MUST be able to switch to answer.
    const orch = makeOrchestrator();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as { chainPhase: { set: (p: 'idle' | 'building' | 'resolving') => void } };
    ds.chainPhase.set('resolving');
    setAnimating(orch, false);
    expect(orch.isBoardStableForSwitch).toBeTrue();
  });

  it('returns false whenever isAnimating=true (regardless of phase)', () => {
    const orch = makeOrchestrator();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as { chainPhase: { set: (p: 'idle' | 'building' | 'resolving') => void } };
    setAnimating(orch, true);
    for (const phase of ['idle', 'building', 'resolving'] as const) {
      ds.chainPhase.set(phase);
      expect(orch.isBoardStableForSwitch)
        .withContext(`phase=${phase} isAnimating=true → must block`)
        .toBeFalse();
    }
  });
});

// =============================================================================
// v3 Phase 5 (2026-06-05) — notifyPerspectiveSwitch drops orphaned locks
// -----------------------------------------------------------------------------
// The Phase 5 wire adds `clearTimersAndPolling()` in the head of
// `notifyPerspectiveSwitch`, which cascades through `runner.requestStop` →
// `dropOrphanedLocks('runner-requestStop')` + `setPostRequestStopWindow(true)`.
// Pins the orchestrator-side contract that a SOLO mid-anim switch is safe
// by construction — the gate doctrine of v3 Phase 5.
//
// Sister contract on the SOLO orchestrator side (`canSwitchPerspective`
// always true post-Phase-5-bis) is pinned in
// `phase-gamma-victory.spec.ts:"v3 Phase 5-bis — canSwitchPerspective always
// true (prompt no longer blocks)"`.
// =============================================================================
describe('AnimationOrchestratorService — notifyPerspectiveSwitch v3 Phase 5 wire', () => {
  function makeOrchestrator(): AnimationOrchestratorService {
    TestBed.configureTestingModule({
      providers: [
        AnimationOrchestratorService,
        ScopeResetDispatcher,
        DuelGameLogService,
        { provide: DuelLogger, useClass: StubLogger },
        { provide: ANIMATION_DATA_SOURCE, useClass: StubDataSource },
        { provide: DuelContext, useClass: StubCtx },
        { provide: LpAnimationTracker, useClass: StubLpTracker },
        { provide: ChainResolutionManager, useClass: StubManager },
        { provide: DrawSequenceManager, useClass: StubManager },
        { provide: MoveAnimationRouter, useClass: StubManager },
        { provide: BattleAnimationTracker, useClass: StubManager },
        { provide: TargetIndicatorManager, useClass: StubManager },
        { provide: BufferReplayBuilder, useValue: { build: (): unknown => ({ batch: [], releaseSessionLocks: () => undefined }) } },
        { provide: CardTravelEngine, useValue: {} },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useClass: StubFloatRegistry },
        { provide: DuelToastService, useValue: { show: () => undefined } },
        { provide: DuelCardArtService, useValue: { getArtUrl: () => '' } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    return TestBed.inject(AnimationOrchestratorService);
  }

  it('calls dropOrphanedLocks("runner-requestStop") on the RBS', () => {
    const orch = makeOrchestrator();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as StubDataSource;
    expect(ds.dropOrphanedLocksCalls).toEqual([]);

    orch.notifyPerspectiveSwitch(0, 1);

    // The runner.requestStop path called from clearTimersAndPolling MUST
    // fire dropOrphanedLocks with the canonical reason tag. A regression
    // that splits or renames the call breaks this assert visibly.
    expect(ds.dropOrphanedLocksCalls.map(c => c.reason)).toContain('runner-requestStop');
  });

  it('opens the postRequestStopWindow (Phase 1 instrumentation) on every switch', () => {
    const orch = makeOrchestrator();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as StubDataSource;
    expect(ds.setPostRequestStopWindowCalls).toEqual([]);

    orch.notifyPerspectiveSwitch(0, 1);

    // setPostRequestStopWindow(true) is the v3 Phase 1 instrumentation that
    // tracks any handler bailing past its await on the abort signal. It MUST
    // be opened on every requestStop — perspective switch included.
    expect(ds.setPostRequestStopWindowCalls.map(c => c.value)).toContain(true);
  });

  it('emits PerspectiveSwitched on the EventStream AFTER the lock clear (ORDER pinned)', () => {
    // v3 Phase 5-bis P5 follow-up (2026-06-05) — pin the call ORDER, not
    // just the set of side-effects. A regression that pushes
    // `PerspectiveSwitched` BEFORE `dropOrphanedLocks` (reverting the
    // head-call to a tail-call) would silently corrupt the cardinal
    // invariant "the dispatch sees a clean lock map". Spy on
    // `pushToStream` to capture the `dropOrphanedLocksCalls.length` AT
    // PUSH TIME — if the clear had fired by then, the length is >= 1.
    const orch = makeOrchestrator();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as StubDataSource;
    let dropCountAtPush: number | null = null;
    let postWindowOpenAtPush = false;
    const originalPush = orch.pushToStream.bind(orch);
    const pushSpy = spyOn(orch, 'pushToStream').and.callFake((event: Parameters<typeof originalPush>[0]) => {
      // Capture state at FIRST push only (the PerspectiveSwitched event).
      if (dropCountAtPush === null) {
        dropCountAtPush = ds.dropOrphanedLocksCalls.length;
        postWindowOpenAtPush = ds.setPostRequestStopWindowCalls.some(c => c.value === true);
      }
      return originalPush(event);
    });

    const before = orch.eventStream();
    orch.notifyPerspectiveSwitch(0, 1);
    const after = orch.eventStream();
    const newEvents = after.slice(before.length);

    // Ordering invariant : clear ran BEFORE the push.
    expect(dropCountAtPush).withContext('dropOrphanedLocks must have fired before pushToStream').toBeGreaterThanOrEqual(1);
    expect(postWindowOpenAtPush).withContext('setPostRequestStopWindow(true) must have fired before pushToStream').toBeTrue();
    expect(pushSpy).toHaveBeenCalled();

    // P2 follow-up : the window is closed eagerly at the tail of
    // notifyPerspectiveSwitch — last `setPostRequestStopWindow` call must
    // be `false` so the Phase 1 instrumentation doesn't stay armed during
    // WAITING_RESPONSE.
    const windowCalls = ds.setPostRequestStopWindowCalls;
    expect(windowCalls.length).withContext('window must be both opened AND closed').toBeGreaterThanOrEqual(2);
    expect(windowCalls[windowCalls.length - 1].value)
      .withContext('window must be closed (false) as the LAST call').toBeFalse();

    // Existing assertion : the event WAS pushed.
    const perspectiveEvents = newEvents.filter(
      (e): e is { kind: 'perspective'; type: 'PerspectiveSwitched'; from: 0 | 1; to: 0 | 1 } =>
        (e as { kind?: string }).kind === 'perspective'
        && (e as { type?: string }).type === 'PerspectiveSwitched',
    );
    expect(perspectiveEvents.length).toBe(1);
    expect(perspectiveEvents[0]).toEqual(
      jasmine.objectContaining({ kind: 'perspective', type: 'PerspectiveSwitched', from: 0, to: 1 }),
    );
  });
});

// =============================================================================
// 2026-06-05 (fix #2) — RBS config re-applied on connection swap (SOLO)
// -----------------------------------------------------------------------------
// Each `DuelConnection` creates its own `RenderedBoardStateService`. The
// orchestrator overrides `getSafetyTimeoutMs` to `ctx.safetyTimeout(...)` and
// attaches the float-registry for the [LOCK-ASSERT] dev assertion. Pre-fix
// these overrides ran ONCE in the constructor body, against the PvP-normal
// default conn's RBS. In SOLO, `SoloDuelOrchestratorService.bindSoloConnection`
// swaps the conn (and its RBS) — the new RBS kept its default 1000ms safety
// timeout, racing the inner handLock commit at the 1500ms initial-draw
// worst case. Console-log repro `console-export-2026-6-5_16-14-25.log`.
//
// The fix wraps the override in an `effect()` that tracks
// `this.dataSource.renderedBoardState` — a getter on the wsService's
// `_transport_connection` signal. A swap re-runs the body against the
// new RBS. This spec pins the behavior with a mutable RBS-signal stub.
// =============================================================================
describe('AnimationOrchestratorService — RBS config re-applied on swap (2026-06-05 fix #2)', () => {
  function makeOrchestrator(): AnimationOrchestratorService {
    TestBed.configureTestingModule({
      providers: [
        AnimationOrchestratorService,
        ScopeResetDispatcher,
        DuelGameLogService,
        { provide: DuelLogger, useClass: StubLogger },
        { provide: ANIMATION_DATA_SOURCE, useClass: StubDataSource },
        { provide: DuelContext, useClass: StubCtx },
        { provide: LpAnimationTracker, useClass: StubLpTracker },
        { provide: ChainResolutionManager, useClass: StubManager },
        { provide: DrawSequenceManager, useClass: StubManager },
        { provide: MoveAnimationRouter, useClass: StubManager },
        { provide: BattleAnimationTracker, useClass: StubManager },
        { provide: TargetIndicatorManager, useClass: StubManager },
        { provide: BufferReplayBuilder, useValue: { build: (): unknown => ({ batch: [], releaseSessionLocks: () => undefined }) } },
        { provide: CardTravelEngine, useValue: {} },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useClass: StubFloatRegistry },
        { provide: DuelToastService, useValue: { show: () => undefined } },
        { provide: DuelCardArtService, useValue: { getArtUrl: () => '' } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    return TestBed.inject(AnimationOrchestratorService);
  }

  it('overrides getSafetyTimeoutMs on the initial RBS at orchestrator construction', () => {
    const orch = makeOrchestrator();
    void orch; // construction is the side-effect we test
    TestBed.flushEffects();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as StubDataSource;
    // Default stub value is 1000 ; the orchestrator overrides to
    // `ctx.safetyTimeout(LOCK_SAFETY_TIMEOUT_MS)`. The StubCtx returns the
    // input unchanged (`safetyTimeout = b => b`), so the override yields
    // `LOCK_SAFETY_TIMEOUT_MS = 2000` (post-2026-06-05 bump).
    expect(ds.renderedBoardState.getSafetyTimeoutMs()).toBe(2000);
  });

  it('re-applies getSafetyTimeoutMs on a fresh RBS after the conn is swapped (SOLO bindSoloConnection mirror)', () => {
    const orch = makeOrchestrator();
    void orch;
    TestBed.flushEffects();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as StubDataSource;

    // Mirror of `SoloDuelOrchestratorService.bindSoloConnection` : the
    // wsService's `_transport_connection` signal flips to a new
    // DuelConnection — which carries a NEW `RenderedBoardStateService`
    // with the default `getSafetyTimeoutMs = () => 1000`.
    const fresh = ds.swapRbs();
    expect(fresh.getSafetyTimeoutMs()).toBe(1000); // baseline : default before effect re-runs

    // The orchestrator's tracking effect MUST re-fire and override the
    // fresh RBS. Without the fix, this returns 1000 — the SOLO bug.
    TestBed.flushEffects();
    expect(ds.renderedBoardState.getSafetyTimeoutMs()).toBe(2000);
    expect(fresh.getSafetyTimeoutMs()).toBe(2000); // verifies the SAME object is re-configured
  });

  it('configures the RBS in the order : attachFloatRegistry BEFORE getSafetyTimeoutMs override (patch H)', () => {
    // Order contract pinned post-2026-06-05 code review : the orchestrator's
    // ctor effect body MUST call `rbs.attachFloatRegistry(...)` BEFORE
    // re-assigning `rbs.getSafetyTimeoutMs`. A future refactor that
    // inverts the two could land a `getSafetyTimeoutMs` consumer reading
    // `_floatRegistry` (e.g. a debug counter wrapped into the timeout
    // computation) before it is attached — NPE in some boot path that
    // is not currently exercised by other specs.
    const orch = makeOrchestrator();
    void orch;
    TestBed.flushEffects();
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as StubDataSource;
    const rbs = ds.renderedBoardState as unknown as { attachFloatRegistryCallOrder: number | null; getSafetyTimeoutMsAssignOrder: number | null };

    expect(rbs.attachFloatRegistryCallOrder).withContext('attachFloatRegistry must have fired').not.toBeNull();
    expect(rbs.getSafetyTimeoutMsAssignOrder).withContext('getSafetyTimeoutMs must have been overridden').not.toBeNull();
    expect(rbs.attachFloatRegistryCallOrder!)
      .withContext('attachFloatRegistry must run BEFORE getSafetyTimeoutMs override')
      .toBeLessThan(rbs.getSafetyTimeoutMsAssignOrder!);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit 2026-06-11 finding #1 — the inline `replayBuffer(true)` latch.
// `_isReplayingBuffer` MUST be cleared when the inline batch settles
// (batch-end resolve) AND by the `clearTimersAndPolling` safety net when a
// hard reset drops the batch-end directive before it can run. A stuck-true
// latch silently disables chain buffering (`bufferIfResolving` short-circuit)
// and the pre-activation divert for the rest of the session.
// ─────────────────────────────────────────────────────────────────────────────
describe('AnimationOrchestratorService — inline replayBuffer latch reset (audit #1)', () => {
  type BatchEntry = { kind?: string; resolve?: () => void };

  function makeOrchestratorWithBuffer(): { orch: AnimationOrchestratorService; prepended: BatchEntry[][] } {
    TestBed.configureTestingModule({
      providers: [
        AnimationOrchestratorService,
        ScopeResetDispatcher,
        DuelGameLogService,
        { provide: DuelLogger, useClass: StubLogger },
        { provide: ANIMATION_DATA_SOURCE, useClass: StubDataSource },
        { provide: DuelContext, useClass: StubCtx },
        { provide: LpAnimationTracker, useClass: StubLpTracker },
        { provide: ChainResolutionManager, useClass: StubManager },
        { provide: DrawSequenceManager, useClass: StubManager },
        { provide: MoveAnimationRouter, useClass: StubManager },
        { provide: BattleAnimationTracker, useClass: StubManager },
        { provide: TargetIndicatorManager, useClass: StubManager },
        { provide: BufferReplayBuilder, useValue: { build: (): unknown => ({ batch: [], releaseSessionLocks: () => undefined }) } },
        { provide: CardTravelEngine, useValue: {} },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useClass: StubFloatRegistry },
        { provide: DuelToastService, useValue: { show: () => undefined } },
        { provide: DuelCardArtService, useValue: { getArtUrl: () => '' } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    const orch = TestBed.inject(AnimationOrchestratorService);

    // The shared StubManager has no buffer/drain surface — patch the chain
    // manager instance so `replayBuffer` runs its real inline path.
    const chain = TestBed.inject(ChainResolutionManager) as unknown as {
      drainBuffer: () => unknown[]; beginDrain: () => void; endDrain: () => void; clearWaiting: () => void;
    };
    chain.drainBuffer = () => [{ type: 'MSG_MOVE' }];
    chain.beginDrain = () => undefined;
    chain.endDrain = () => undefined;
    chain.clearWaiting = () => undefined;

    // Capture what the inline path prepends so the test can invoke the
    // batch-end resolve exactly like the runner would.
    const prepended: BatchEntry[][] = [];
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as {
      prependToQueue: (e: BatchEntry[]) => void;
      renderedBoardState: Record<string, unknown>;
    };
    ds.prependToQueue = e => prepended.push(e);
    // `trace()` reads `rbs.lockedZoneKeys()` — absent from the shared StubRbs.
    ds.renderedBoardState['lockedZoneKeys'] = () => [];

    return { orch, prepended };
  }

  function latch(orch: AnimationOrchestratorService): boolean {
    return (orch as unknown as { _isReplayingBuffer: boolean })._isReplayingBuffer;
  }

  it('resets the latch when the inline batch-end resolves', () => {
    const { orch, prepended } = makeOrchestratorWithBuffer();

    void orch.replayBuffer(true);
    expect(latch(orch)).withContext('latch set while the inline batch is in flight').toBe(true);

    const batchEnd = prepended[0]?.find(e => e.kind === 'batch-end');
    expect(batchEnd).withContext('inline batch must carry a batch-end directive').toBeDefined();
    batchEnd!.resolve!();

    expect(latch(orch)).withContext('batch-end cleanup must clear the latch').toBe(false);
  });

  it('clears the latch on a hard reset that drops the batch-end before it runs', () => {
    const { orch } = makeOrchestratorWithBuffer();

    void orch.replayBuffer(true);
    expect(latch(orch)).toBe(true);

    // A requestStop mid-batch (seek / switch / rematch) wipes the queue —
    // the batch-end directive never dispatches, so the safety net in
    // `clearTimersAndPolling` must clear the latch.
    (orch as unknown as { clearTimersAndPolling: () => void }).clearTimersAndPolling();

    expect(latch(orch)).withContext('clearTimersAndPolling is the latch safety net').toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit 2026-06-11 finding #15 — AbortSignal propagation into processDirective
// (the v3 "Phase 2" wire). The runner only checks its abort signal at the top
// of each loop turn; a requestStop (seek / switch / STATE_SYNC) landing inside
// a directive's internal awaits used to keep dispatching events onto a board
// `dropOrphanedLocks` had just vacated (group stagger), or leave a loop
// permanently suspended when `clearTimersAndPolling` cut the blocking
// announcement's timer without resolving its promise.
// ─────────────────────────────────────────────────────────────────────────────
describe('AnimationOrchestratorService — processDirective abort propagation (audit #15)', () => {
  function makeOrchestrator(): AnimationOrchestratorService {
    TestBed.configureTestingModule({
      providers: [
        AnimationOrchestratorService,
        ScopeResetDispatcher,
        DuelGameLogService,
        { provide: DuelLogger, useClass: StubLogger },
        { provide: ANIMATION_DATA_SOURCE, useClass: StubDataSource },
        { provide: DuelContext, useClass: StubCtx },
        { provide: LpAnimationTracker, useClass: StubLpTracker },
        { provide: ChainResolutionManager, useClass: StubManager },
        { provide: DrawSequenceManager, useClass: StubManager },
        { provide: MoveAnimationRouter, useClass: StubManager },
        { provide: BattleAnimationTracker, useClass: StubManager },
        { provide: TargetIndicatorManager, useClass: StubManager },
        { provide: BufferReplayBuilder, useValue: { build: (): unknown => ({ batch: [], releaseSessionLocks: () => undefined }) } },
        { provide: CardTravelEngine, useValue: {} },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useClass: StubFloatRegistry },
        { provide: DuelToastService, useValue: { show: () => undefined } },
        { provide: DuelCardArtService, useValue: { getArtUrl: () => '' } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    const orch = TestBed.inject(AnimationOrchestratorService);
    // `trace()` reads `rbs.lockedZoneKeys()` — absent from the shared StubRbs.
    const ds = TestBed.inject(ANIMATION_DATA_SOURCE) as unknown as { renderedBoardState: Record<string, unknown> };
    ds.renderedBoardState['lockedZoneKeys'] = () => [];
    return orch;
  }

  // Private-surface access: the runner normally forwards its own inner-loop
  // signal; the specs drive `processDirective` directly with a controller
  // they abort mid-await — the exact state a `requestStop` produces.
  type Dispatchable = {
    processDirective: (entry: unknown, abortSignal: AbortSignal) => Promise<'continue' | 'pause'>;
    processEvent: (e: { type: string }) => unknown;
  };

  it('a requestStop (abort) mid-stagger stops dispatching the remaining group events', async () => {
    const orch = makeOrchestrator();
    const inner = orch as unknown as Dispatchable;
    const dispatched: string[] = [];
    inner.processEvent = e => { dispatched.push(e.type); return 0; };

    const ctrl = new AbortController();
    // staggerMs deliberately huge: if the abort stops resolving the wait
    // early (abortableWait regression), the spec times out instead of
    // passing after the real timer fires.
    const entry = { kind: 'group', staggerMs: 60_000, events: [{ type: 'MSG_MOVE' }, { type: 'MSG_DRAW' }, { type: 'MSG_MOVE' }] };
    const done = inner.processDirective(entry, ctrl.signal);

    expect(dispatched).withContext('first event dispatches synchronously before the stagger').toEqual(['MSG_MOVE']);
    ctrl.abort(); // mirror of runner.requestStop() while suspended on the stagger
    await done;
    expect(dispatched)
      .withContext('post-abort events must NOT dispatch — they would lock a board dropOrphanedLocks just vacated')
      .toEqual(['MSG_MOVE']);
  });

  it('an abort during a blocking announcement resolves the await and runs onClear', async () => {
    const orch = makeOrchestrator();
    const inner = orch as unknown as Dispatchable;
    let cleared = false;
    const ctrl = new AbortController();
    const entry = {
      kind: 'announcement', source: 'spec', durationMs: 60_000,
      onShow: (): void => undefined, onClear: (): void => { cleared = true; },
    };

    const done = inner.processDirective(entry, ctrl.signal);
    expect(cleared).toBe(false);

    // Pre-fix, `clearTimersAndPolling` cut the showMs timer WITHOUT
    // resolving the await — the inner loop stayed suspended forever and
    // onClear never ran. The abort race must resolve + run the finally.
    ctrl.abort();
    const result = await done;
    expect(result).toBe('continue');
    expect(cleared).withContext('the finally must run onClear on abort').toBe(true);
  });
});
