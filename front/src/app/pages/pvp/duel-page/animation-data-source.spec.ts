import { signal, type Signal } from '@angular/core';
import {
  ANIMATION_DATA_SOURCE,
  isDirective,
  peekAndDequeueMatching,
  syncAfterBoardState,
  type AnimationDataSource,
  type QueueEntry,
} from './animation-data-source';
import type { RenderedBoardStateService } from './rendered-board-state.service';
import type { DuelState, GameEvent } from '../types';

// =============================================================================
// syncAfterBoardState — 4-tier sync decision (PvP/Replay parity)
// =============================================================================

describe('syncAfterBoardState', () => {
  let mockRbs: jasmine.SpyObj<Pick<RenderedBoardStateService,
    'updateLogical' | 'commitAll' | 'syncRendered' | 'syncPileCounts'>>;
  const stubBoardState = {} as DuelState;

  beforeEach(() => {
    mockRbs = jasmine.createSpyObj<RenderedBoardStateService>('RenderedBoardStateService', [
      'updateLogical', 'commitAll', 'syncRendered', 'syncPileCounts',
    ]) as jasmine.SpyObj<Pick<RenderedBoardStateService,
      'updateLogical' | 'commitAll' | 'syncRendered' | 'syncPileCounts'>>;
  });

  // ---------------------------------------------------------------------------
  // Tier invariant: updateLogical(boardState) ALWAYS runs first
  // ---------------------------------------------------------------------------

  it('always calls updateLogical(boardState) — tier 1 (!boardActive)', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'idle', 0, stubBoardState, false);
    expect(mockRbs.updateLogical).toHaveBeenCalledOnceWith(stubBoardState);
  });

  it('always calls updateLogical(boardState) — tier 4 (resolving, no other sync)', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'resolving', 5, stubBoardState, true);
    expect(mockRbs.updateLogical).toHaveBeenCalledOnceWith(stubBoardState);
  });

  // ---------------------------------------------------------------------------
  // Tier 1: !boardActive → syncPileCounts (bootstrap, pre-activation buffer
  //         path — initial MSG_DRAW ×5 parked in orchestrator, must not be
  //         pre-committed by BOARD_STATE or the draw animations play on top
  //         of cards already visible. See CLAUDE.md §syncAfterBoardState).
  // ---------------------------------------------------------------------------

  it('tier 1 (!boardActive): syncPileCounts only — no commitAll/syncRendered', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'idle', 0, stubBoardState, false);
    expect(mockRbs.syncPileCounts).toHaveBeenCalledTimes(1);
    expect(mockRbs.commitAll).not.toHaveBeenCalled();
    expect(mockRbs.syncRendered).not.toHaveBeenCalled();
  });

  it('tier 1 priority: !boardActive overrides idle+queueLen=0 (would normally syncRendered)', () => {
    // Even with the conditions for tier 2, !boardActive forces tier 1 —
    // the zone arrays in BOARD_STATE already reflect post-draw state and
    // must not propagate to rendered until MSG_DRAW animations commit them.
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'idle', 0, stubBoardState, false);
    expect(mockRbs.syncPileCounts).toHaveBeenCalledTimes(1);
    expect(mockRbs.syncRendered).not.toHaveBeenCalled();
    expect(mockRbs.commitAll).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Tier 2: idle + queueLen === 0 → syncRendered (full sync, safe)
  // ---------------------------------------------------------------------------

  it('tier 2 (idle + queueLen=0): syncRendered only', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'idle', 0, stubBoardState, true);
    expect(mockRbs.syncRendered).toHaveBeenCalledTimes(1);
    expect(mockRbs.commitAll).not.toHaveBeenCalled();
    expect(mockRbs.syncPileCounts).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Tier 3: chainPhase !== 'resolving' (idle/building, with queue OR building empty)
  //         → syncPileCounts (counts only, no zones)
  // ---------------------------------------------------------------------------

  it('tier 3 (idle + queueLen=3): syncPileCounts (queue blocks tier 2)', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'idle', 3, stubBoardState, true);
    expect(mockRbs.syncPileCounts).toHaveBeenCalledTimes(1);
    expect(mockRbs.syncRendered).not.toHaveBeenCalled();
  });

  it('tier 3 (building + queueLen=0): syncPileCounts (idle-and-empty predicate is false)', () => {
    // Building phase even with empty queue does NOT trigger syncRendered —
    // tier 2 demands chainPhase==='idle' specifically.
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'building', 0, stubBoardState, true);
    expect(mockRbs.syncPileCounts).toHaveBeenCalledTimes(1);
    expect(mockRbs.syncRendered).not.toHaveBeenCalled();
  });

  it('tier 3 (building + queueLen=5): syncPileCounts', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'building', 5, stubBoardState, true);
    expect(mockRbs.syncPileCounts).toHaveBeenCalledTimes(1);
    expect(mockRbs.syncRendered).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Tier 4: resolving → defer entirely (orchestrator controls commits)
  // ---------------------------------------------------------------------------

  it('tier 4 (resolving + queueLen=0): no sync calls beyond updateLogical', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'resolving', 0, stubBoardState, true);
    expect(mockRbs.commitAll).not.toHaveBeenCalled();
    expect(mockRbs.syncRendered).not.toHaveBeenCalled();
    expect(mockRbs.syncPileCounts).not.toHaveBeenCalled();
  });

  it('tier 4 (resolving + queueLen=10): no sync calls beyond updateLogical', () => {
    syncAfterBoardState(mockRbs as unknown as RenderedBoardStateService,
      'resolving', 10, stubBoardState, true);
    expect(mockRbs.commitAll).not.toHaveBeenCalled();
    expect(mockRbs.syncRendered).not.toHaveBeenCalled();
    expect(mockRbs.syncPileCounts).not.toHaveBeenCalled();
  });
});

// =============================================================================
// peekAndDequeueMatching — find-by-predicate + remove
// =============================================================================

describe('peekAndDequeueMatching', () => {
  // Helpers — minimal QueueEntry stubs.
  const ev = (type: string, marker?: number): GameEvent =>
    ({ type, marker } as unknown as GameEvent);
  const dir = (kind: 'group' | 'barrier' = 'barrier'): QueueEntry =>
    kind === 'group' ? { kind: 'group', events: [] } : { kind: 'barrier' };

  /** Build an AnimationDataSource stub backed by a writable signal. */
  function buildSource(initial: QueueEntry[]): {
    source: AnimationDataSource;
    queueSig: ReturnType<typeof signal<QueueEntry[]>>;
    removeSpy: jasmine.Spy;
  } {
    const queueSig = signal<QueueEntry[]>(initial);
    const removeSpy = jasmine.createSpy('removeAnimationAt').and.callFake((idx: number) => {
      queueSig.update(q => q.filter((_, i) => i !== idx));
    });
    const source = {
      renderedBoardState: null as unknown as RenderedBoardStateService,
      animationQueue: queueSig as Signal<QueueEntry[]>,
      activeChainLinks: signal([]),
      chainPhase: signal('idle' as const),
      pendingPrompt: signal(null),
      dequeueAnimation: () => null,
      removeAnimationAt: removeSpy as (idx: number) => void,
      prependToQueue: () => undefined,
      setAnimating: () => undefined,
      applyChainSolving: () => undefined,
      applyChainSolved: () => undefined,
      applyChainEnd: () => undefined,
    };
    return { source, queueSig, removeSpy };
  }

  it('returns the matching event and calls removeAnimationAt at its index', () => {
    const target = ev('MSG_MOVE', 42);
    const { source, removeSpy } = buildSource([
      ev('MSG_DAMAGE'), target, ev('MSG_DRAW'),
    ]);
    const result = peekAndDequeueMatching(source,
      e => e.type === 'MSG_MOVE' && (e as { marker?: number }).marker === 42);
    expect(result).toBe(target);
    expect(removeSpy).toHaveBeenCalledOnceWith(1);
  });

  it('returns null and does NOT call removeAnimationAt when no match', () => {
    const { source, removeSpy } = buildSource([
      ev('MSG_DAMAGE'), ev('MSG_DRAW'),
    ]);
    const result = peekAndDequeueMatching(source, e => e.type === 'MSG_MOVE');
    expect(result).toBeNull();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('first-match strategy: returns the earliest matching event, not the last', () => {
    const first = ev('MSG_MOVE', 1);
    const second = ev('MSG_MOVE', 2);
    const { source, removeSpy } = buildSource([
      ev('MSG_DAMAGE'), first, ev('MSG_DRAW'), second,
    ]);
    const result = peekAndDequeueMatching(source, e => e.type === 'MSG_MOVE');
    expect(result).toBe(first);
    expect(removeSpy).toHaveBeenCalledOnceWith(1);
  });

  it('skips directives: predicate is never evaluated for QueueDirective entries', () => {
    const groupDir = dir('group');
    const barrierDir = dir('barrier');
    const target = ev('MSG_DRAW');
    const { source } = buildSource([groupDir, barrierDir, target]);
    const predicate = jasmine.createSpy('predicate').and.callFake(
      (e: GameEvent) => e.type === 'MSG_DRAW',
    );
    const result = peekAndDequeueMatching(source, predicate);
    expect(result).toBe(target);
    // Predicate should only have been called for the GameEvent, not the
    // two directives that precede it. findIndex skips them via isDirective.
    expect(predicate).toHaveBeenCalledTimes(1);
    expect(predicate).toHaveBeenCalledWith(target);
  });

  it('returns null on empty queue without crashing', () => {
    const { source, removeSpy } = buildSource([]);
    const result = peekAndDequeueMatching(source, () => true);
    expect(result).toBeNull();
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// isDirective — narrow type guard
// =============================================================================

describe('isDirective', () => {
  it('returns true for QueueDirective entries', () => {
    expect(isDirective({ kind: 'barrier' })).toBeTrue();
    expect(isDirective({ kind: 'group', events: [] })).toBeTrue();
    expect(isDirective({ kind: 'lp', event: { type: 'MSG_DAMAGE' } as GameEvent })).toBeTrue();
  });

  it('returns false for GameEvent entries (no `kind` field)', () => {
    expect(isDirective({ type: 'MSG_MOVE' } as unknown as QueueEntry)).toBeFalse();
    expect(isDirective({ type: 'MSG_DRAW' } as unknown as QueueEntry)).toBeFalse();
  });
});

// =============================================================================
// ANIMATION_DATA_SOURCE token — sanity
// =============================================================================

describe('ANIMATION_DATA_SOURCE token', () => {
  it('is exported as an InjectionToken for AnimationDataSource', () => {
    expect(ANIMATION_DATA_SOURCE).toBeTruthy();
    expect(ANIMATION_DATA_SOURCE.toString()).toContain('AnimationDataSource');
  });
});
