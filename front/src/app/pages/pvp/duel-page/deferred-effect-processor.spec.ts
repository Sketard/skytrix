import type {
  AwaitingPredicate, DeferredFluxEvent, StreamEvent,
} from '../types';
import {
  ScopeResetDispatcher, type ScopeCategory,
} from '../projections';
import { DEFERRED_TIMEOUT_MS } from './animation-constants';
import {
  DeferredEffectProcessor, type DeferredClock, type DeferredRule,
} from './deferred-effect-processor';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Fake clock: lets the spec deterministically advance time without
 *  jasmine.clock(), which interacts badly with the global setTimeout that
 *  other DEP-adjacent specs rely on (the BP for instance). */
class FakeClock implements DeferredClock {
  private nextId = 1;
  private readonly pending = new Map<number, { fn: () => void; due: number }>();
  private now = 0;
  setTimeout = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.pending.set(id, { fn, due: this.now + ms });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimeout = (id: ReturnType<typeof setTimeout>): void => {
    this.pending.delete(id as unknown as number);
  };
  /** Advance `ms` milliseconds, firing every timer whose due time is reached. */
  advance(ms: number): void {
    this.now += ms;
    const fired: Array<() => void> = [];
    for (const [id, t] of this.pending) {
      if (t.due <= this.now) {
        fired.push(t.fn);
        this.pending.delete(id);
      }
    }
    for (const fn of fired) fn();
  }
  pendingCount(): number { return this.pending.size; }
}

/** A minimal MSG_MOVE-like event for predicate matching. Cast to
 *  StreamEvent at the call site — we only need the keys the matcher reads. */
function msgMove(player: number, cardCode: number, destination: number): StreamEvent {
  return { type: 'MSG_MOVE', player, cardCode, destination } as unknown as StreamEvent;
}

/** Build a rule that opens a deferred named `<prefix>:<n>` whenever the
 *  trigger predicate matches. Predicate is also data — lets each test
 *  tailor what the deferred awaits. */
function makeRule(
  prefix: string,
  triggerPredicate: AwaitingPredicate,
  awaitPredicate: AwaitingPredicate,
): DeferredRule {
  let counter = 0;
  const matchesTrigger = (event: StreamEvent) => {
    const cand = event as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(triggerPredicate)) {
      if (v === undefined) continue;
      if (cand[k] !== v) return false;
    }
    return true;
  };
  return {
    trigger: matchesTrigger,
    deriveName: () => `${prefix}:${counter++}`,
    derivePredicate: () => awaitPredicate,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeferredEffectProcessor', () => {
  let emitted: DeferredFluxEvent[];
  let clock: FakeClock;

  beforeEach(() => {
    emitted = [];
    clock = new FakeClock();
  });

  function makeDep(rules: readonly DeferredRule[] = []) {
    return new DeferredEffectProcessor(
      e => emitted.push(e),
      () => undefined,
      clock,
      rules,
    );
  }

  // -------------------------------------------------------------------------
  // T-I2 — Timeout = EffectAbandoned(reason='timeout')
  // -------------------------------------------------------------------------
  it('T-I2: emits EffectAbandoned(timeout) after DEFERRED_TIMEOUT_MS', () => {
    // Open one deferred via a rule that always fires on the first event and
    // never matches again.
    const rule = makeRule(
      'tmo',
      { type: 'MSG_MOVE' },        // trigger
      { type: 'NEVER_MATCHED' },   // await predicate that no event satisfies
    );
    const dep = makeDep([rule]);
    dep.observe(msgMove(0, 100, 0));
    expect(dep.activeCount()).toBe(1);
    expect(emitted.find(e => e.type === 'DeferredEffect')).toBeTruthy();

    clock.advance(DEFERRED_TIMEOUT_MS - 1);
    expect(emitted.filter(e => e.type === 'EffectAbandoned').length).toBe(0);

    clock.advance(2); // crosses the threshold
    const abandons = emitted.filter(e => e.type === 'EffectAbandoned');
    expect(abandons.length).toBe(1);
    expect(abandons[0]).toEqual(jasmine.objectContaining({
      type: 'EffectAbandoned', name: 'tmo:0', reason: 'timeout',
    }));
    expect(dep.activeCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T-I3 — Checkpoint = EffectAbandoned(reason='checkpoint') for each, in
  // insertion order; timers cleared; dispatch via ScopeResetDispatcher.
  // -------------------------------------------------------------------------
  it('T-I3: dispatcher CONNECTION_LIFETIME → EffectAbandoned(checkpoint) for every active, insertion order', () => {
    const dispatcher = new ScopeResetDispatcher();
    const rule = makeRule(
      'cp',
      { type: 'MSG_MOVE' },
      { type: 'NEVER' },
    );
    const dep = makeDep([rule]);
    dispatcher.register(dep);

    // Open 3 deferreds.
    dep.observe(msgMove(0, 1, 0));
    dep.observe(msgMove(0, 2, 0));
    dep.observe(msgMove(0, 3, 0));
    expect(dep.activeCount()).toBe(3);
    const pendingBefore = clock.pendingCount();
    expect(pendingBefore).toBe(3);

    dispatcher.dispatch(new Set<ScopeCategory>(['CONNECTION_LIFETIME']));

    const abandons = emitted.filter(e => e.type === 'EffectAbandoned');
    expect(abandons.length).toBe(3);
    expect(abandons.every(e => e.reason === 'checkpoint')).toBeTrue();
    expect(abandons.map(e => e.name)).toEqual(['cp:0', 'cp:1', 'cp:2']);
    expect(dep.activeCount()).toBe(0);
    expect(clock.pendingCount()).toBe(0);

    // And no late timer fires after dispatch.
    clock.advance(DEFERRED_TIMEOUT_MS * 2);
    expect(emitted.filter(e => e.type === 'EffectAbandoned').length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // T-I4 — No-leak: registry size is bounded; unregister + GC contract OK.
  // (Pattern mirrors scope-reset-dispatcher.spec.ts §unregister.)
  // -------------------------------------------------------------------------
  it('T-I4: ResetTarget unregister drops the DEP cleanly (no future dispatch reaches it)', () => {
    const dispatcher = new ScopeResetDispatcher();
    const rule = makeRule(
      'leak',
      { type: 'MSG_MOVE' },
      { type: 'NEVER' },
    );
    const dep = makeDep([rule]);
    dispatcher.register(dep);
    dep.observe(msgMove(0, 1, 0));
    expect(dep.activeCount()).toBe(1);

    dispatcher.unregister(dep);
    dispatcher.dispatch(new Set<ScopeCategory>(['CONNECTION_LIFETIME']));

    // No EffectAbandoned was emitted (dispatch did not reach the DEP).
    expect(emitted.filter(e => e.type === 'EffectAbandoned').length).toBe(0);
    // Deferred is still active — the DEP was untouched.
    expect(dep.activeCount()).toBe(1);
    expect(dispatcher.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T-I5 — silentReset() emits NOTHING and clears timers.
  // -------------------------------------------------------------------------
  it('T-I5: silentReset() drops state without emitting EffectAbandoned and clears timers', () => {
    const rule = makeRule(
      'silent',
      { type: 'MSG_MOVE' },
      { type: 'NEVER' },
    );
    const dep = makeDep([rule]);
    dep.observe(msgMove(0, 1, 0));
    dep.observe(msgMove(0, 2, 0));
    expect(dep.activeCount()).toBe(2);
    const emittedBefore = emitted.length;

    dep.silentReset();

    expect(dep.activeCount()).toBe(0);
    expect(clock.pendingCount()).toBe(0);
    // Nothing new emitted by silentReset itself.
    expect(emitted.length).toBe(emittedBefore);
    expect(emitted.filter(e => e.type === 'EffectAbandoned').length).toBe(0);

    // And no late timer fires either.
    clock.advance(DEFERRED_TIMEOUT_MS * 2);
    expect(emitted.filter(e => e.type === 'EffectAbandoned').length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T-I6 — PerspectiveSwitched (PERSPECTIVE_LIFETIME alone) does NOT touch
  // the DEP because its declared scope is CONNECTION_LIFETIME (deeper).
  // -------------------------------------------------------------------------
  it('T-I6: PERSPECTIVE_LIFETIME dispatch leaves the DEP alone (scope CONNECTION is deeper)', () => {
    const dispatcher = new ScopeResetDispatcher();
    const rule = makeRule(
      'persp',
      { type: 'MSG_MOVE' },
      { type: 'NEVER' },
    );
    const dep = makeDep([rule]);
    dispatcher.register(dep);
    dep.observe(msgMove(0, 1, 0));
    expect(dep.activeCount()).toBe(1);

    dispatcher.dispatch(new Set<ScopeCategory>(['PERSPECTIVE_LIFETIME']));

    expect(emitted.filter(e => e.type === 'EffectAbandoned').length).toBe(0);
    expect(dep.activeCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // T-I7 — Ordering: drain (a) BEFORE open (b). A single event that BOTH
  // satisfies an existing deferred AND triggers a new one must emit
  // EffectReady BEFORE the new DeferredEffect.
  // -------------------------------------------------------------------------
  it('T-I7: a single event fulfills an active deferred BEFORE opening a new one', () => {
    // Rule A opens 'a:0' awaiting MSG_MOVE(player=0,cardCode=42).
    const ruleA = makeRule(
      'a',
      { type: 'SEED' },
      { type: 'MSG_MOVE', player: 0, cardCode: 42 },
    );
    // Rule B opens 'b:0' on the same MSG_MOVE(player=0,cardCode=42). The
    // invariant under test is the **order of emission**:
    // EffectReady('a:0') must come BEFORE DeferredEffect('b:0') in the
    // single observe() that satisfies A and triggers B. Distinct
    // prefixes — collision invariant (T-I1) is β.2b's concern.
    const ruleB = makeRule(
      'b',
      { type: 'MSG_MOVE', player: 0, cardCode: 42 },
      { type: 'NEVER' },
    );
    const dep = makeDep([ruleA, ruleB]);

    // Seed event opens A's deferred.
    dep.observe({ type: 'SEED' } as unknown as StreamEvent);
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual(jasmine.objectContaining({
      type: 'DeferredEffect', name: 'a:0',
    }));

    // Now fire the matching event — must trigger drain BEFORE open.
    emitted.length = 0;
    dep.observe(msgMove(0, 42, 0));

    expect(emitted.length).toBe(2);
    expect(emitted[0]).toEqual(jasmine.objectContaining({
      type: 'EffectReady', name: 'a:0',
    }));
    expect(emitted[1]).toEqual(jasmine.objectContaining({
      type: 'DeferredEffect', name: 'b:0',
    }));
  });

  // -------------------------------------------------------------------------
  // Sanity: with empty RULES (the β.2a production state), observe emits
  // nothing and active stays at 0. Locks in the "infrastructure exists,
  // but no metier rules yet" contract.
  // -------------------------------------------------------------------------
  it('with empty RULES table (β.2a production state), observe emits nothing', () => {
    const dep = makeDep([]);
    dep.observe(msgMove(0, 1, 0));
    dep.observe({ type: 'MSG_DRAW' } as unknown as StreamEvent);
    dep.observe({ kind: 'boundary', type: 'ChainStarted', chainId: 1 } as unknown as StreamEvent);
    expect(emitted).toEqual([]);
    expect(dep.activeCount()).toBe(0);
  });
});
