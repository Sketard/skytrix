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
import { AnimatingLpProjection, BaseProjection } from '../projections';
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

class StubDataSource {
  renderedBoardState = {
    commitUnlocked: (): void => undefined,
    lockZone: (): void => undefined,
    attachFloatRegistry: (): void => undefined,
    getSafetyTimeoutMs: (): number => 0,
  };
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
