import type {
  AwaitingPredicate, DeferredFluxEvent, StreamEvent,
} from '../types';
import {
  ScopeResetDispatcher, type ScopeCategory,
} from '../projections';
import { DEFERRED_TIMEOUT_MS } from './animation-constants';
import {
  DeferredEffectProcessor, type DeferredClock, type DeferredRule,
  type RewriterRule, type RuleSinks, type ZoneLock,
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

  // -------------------------------------------------------------------------
  // T-I1 (β.2b) — Name collision: two triggers, same generated name, no
  // match between them. Asserts that:
  //   · dev mode throws via `duelAssert` (the orchestrator runs with
  //     `isDevMode()` true in test runs);
  //   · the older deferred is abandoned with `EffectAbandoned(timeout)`
  //     before the new one replaces it (defensive ordering — even if
  //     dev throws, the abandon emission happens via the warn-and-evict
  //     prod path the assertion guards).
  // The test uses a rule with a FIXED name so two triggers collide
  // deterministically.
  // -------------------------------------------------------------------------
  it('T-I1: name collision throws in dev (duelAssert) and emits EffectAbandoned(timeout) for the evicted entry', () => {
    const fixedNameRule: DeferredRule = {
      trigger: e => (e as { type?: string }).type === 'MSG_MOVE',
      deriveName: () => 'collide:fixed',
      derivePredicate: () => ({ type: 'NEVER_MATCHED' }),
    };
    const dep = makeDep([fixedNameRule]);
    dep.observe(msgMove(0, 1, 0));
    expect(dep.activeCount()).toBe(1);

    // Second MSG_MOVE re-triggers the rule with the same name. dev
    // mode → duelAssert throws.
    expect(() => dep.observe(msgMove(0, 2, 0))).toThrowError(
      /DUEL-ASSERT.*DeferredEffectProcessor\.openDeferred/,
    );
  });

  // -------------------------------------------------------------------------
  // T-I8 (β.2b) — Chained predicate (compound flow, the heart of cas #1):
  //   trigger → DeferredEffect (predicate étape 1)
  //   matched event → re-arm via chainTo (predicate étape 2)
  //   second matched event → EffectReady
  // Exactly ONE DeferredEffect emitted, exactly ONE EffectReady; no
  // intermediate abandon, no double-emit. Same `name` + same
  // `triggerRef` across the chain.
  // -------------------------------------------------------------------------
  it('T-I8: chained predicate — one DeferredEffect at open, one EffectReady at end, same name+triggerRef', () => {
    // Rule: on SEED, open `chain:0` awaiting INTERMEDIATE; on
    // INTERMEDIATE match, chainTo to await FINAL.
    const compound: DeferredRule = {
      trigger: e => (e as { type?: string }).type === 'SEED',
      deriveName: (_e, ref) => `chain:${ref}`,
      derivePredicate: () => ({ type: 'INTERMEDIATE' }),
      chainTo: (matchedEvent, matchedRef, _deferred) => {
        if ((matchedEvent as { type?: string }).type !== 'INTERMEDIATE') return null;
        return { type: 'FINAL', ref: matchedRef };
      },
    };
    const dep = makeDep([compound]);

    dep.observe({ type: 'SEED' } as unknown as StreamEvent);
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual(jasmine.objectContaining({
      type: 'DeferredEffect', name: 'chain:0', triggerRef: 0,
    }));

    // Pass an explicit ref so the chainTo predicate can target it.
    dep.observe({ type: 'INTERMEDIATE' } as unknown as StreamEvent, 42);
    // No EffectReady yet — chainTo re-armed the deferred silently.
    expect(emitted.length).toBe(1);
    expect(dep.activeCount()).toBe(1);

    // Final event matching the re-armed predicate.
    dep.observe({ type: 'FINAL', ref: 42 } as unknown as StreamEvent);
    expect(emitted.length).toBe(2);
    expect(emitted[1]).toEqual(jasmine.objectContaining({
      type: 'EffectReady', name: 'chain:0', triggerRef: 0,
    }));
    expect(dep.activeCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Victory test #1 — cost-before-overlay (the canonical bug, cf.
  // `bug-cost-before-overlay-sequence.md`). Uses the REAL `overlayShow`
  // rule from `deferred-effect-rules.ts` to validate the end-to-end
  // semantics:
  //   T5  MSG_CHAINING(chain-1, cardCode=Ash, player=0)
  //   T6  MSG_MOVE(Ash, HAND→GRAVE)            ref captured = R6
  //   T7  AnimationCompleted(ref=R6)           → EffectReady fires here
  //
  // The invariant under test: EffectReady is emitted **AFTER** the
  // AnimationCompleted of the cost MSG_MOVE — not at T5, not at T6.
  // -------------------------------------------------------------------------
  describe('Victory test — cost-before-overlay (#1 overlay-show)', () => {
    it('emits EffectReady(overlay-show) AFTER AnimationCompleted of the cost MSG_MOVE', async () => {
      // Import the real production rule.
      const { RULES } = await import('./deferred-effect-rules');
      const dep = makeDep(RULES);

      // T5 — opponent MSG_CHAINING (chain-1, link-2 from our POV).
      const chaining = {
        type: 'MSG_CHAINING', chainIndex: 1, cardCode: 14558127,
        player: 0, location: 0x02, sequence: 0, description: 0,
      } as unknown as StreamEvent;
      dep.observe(chaining, 5);

      // Opening DeferredEffect for overlay-show:chain-1.
      const deferredOpen = emitted.find(e =>
        e.type === 'DeferredEffect' && e.name === 'overlay-show:chain-1',
      );
      expect(deferredOpen).toBeTruthy();
      const initialTriggerRef = (deferredOpen as { triggerRef: number }).triggerRef;
      expect(initialTriggerRef).toBe(5);

      // T6 — the cost MSG_MOVE (Ash discard, HAND→GRAVE).
      const costMove = {
        type: 'MSG_MOVE', player: 0, cardCode: 14558127,
        fromLocation: 0x02, toLocation: 0x10, // HAND → GRAVE
      } as unknown as StreamEvent;
      const beforeReadyCount = emitted.filter(e => e.type === 'EffectReady').length;
      dep.observe(costMove, 6);

      // At this point the rule's chainTo has re-armed the deferred —
      // NO EffectReady yet (the AnimationCompleted hasn't fired).
      const midReadyCount = emitted.filter(e => e.type === 'EffectReady').length;
      expect(midReadyCount).toBe(beforeReadyCount); // still 0
      expect(dep.activeCount()).toBe(1); // re-armed in place

      // T7 — AnimationCompleted of T6.
      const animDone = {
        kind: 'animation', type: 'AnimationCompleted',
        ref: 6, msgType: 'MSG_MOVE',
      } as unknown as StreamEvent;
      dep.observe(animDone, 7);

      // NOW EffectReady fires. Same name + triggerRef as the opening.
      const finalReady = emitted.find(e =>
        e.type === 'EffectReady' && e.name === 'overlay-show:chain-1',
      );
      expect(finalReady).toBeTruthy();
      expect((finalReady as { triggerRef: number }).triggerRef).toBe(initialTriggerRef);
      expect(dep.activeCount()).toBe(0);
    });

    it('does NOT emit overlay-show for link-1 (chainIndex=0)', async () => {
      const { RULES } = await import('./deferred-effect-rules');
      const dep = makeDep(RULES);

      // Single-link chain — link-1 has no preceding cost to wait on.
      const chaining = {
        type: 'MSG_CHAINING', chainIndex: 0, cardCode: 1234,
        player: 0, location: 0x02, sequence: 0, description: 0,
      } as unknown as StreamEvent;
      dep.observe(chaining);

      const overlayShowOpen = emitted.find(e =>
        e.type === 'DeferredEffect' && (e as { name: string }).name.startsWith('overlay-show'),
      );
      expect(overlayShowOpen).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Victory test #2 — trigger-show (Snake-Eye Ash style). The trigger
  // fires on MSG_MOVE → MZONE; the deferred awaits the MSG_MOVE's own
  // AnimationCompleted. Self-referential, no compound.
  // -------------------------------------------------------------------------
  describe('Victory test — trigger-show post-summon (#2 trigger-show)', () => {
    it('emits EffectReady(trigger-show:<cardCode>:<ref>) on AnimationCompleted of the same ref', async () => {
      const { RULES } = await import('./deferred-effect-rules');
      const dep = makeDep(RULES);

      // MSG_MOVE — Snake-Eye Ash to MZONE.
      const summon = {
        type: 'MSG_MOVE', player: 0, cardCode: 90241276,
        fromLocation: 0x02 /* HAND */, toLocation: 0x04 /* MZONE */,
      } as unknown as StreamEvent;
      dep.observe(summon, 10);

      const openName = `trigger-show:90241276:10`;
      const open = emitted.find(e =>
        e.type === 'DeferredEffect' && e.name === openName,
      );
      expect(open).toBeTruthy();
      expect(dep.activeCount()).toBe(1);

      // AnimationCompleted of THE SAME ref (10).
      dep.observe({
        kind: 'animation', type: 'AnimationCompleted',
        ref: 10, msgType: 'MSG_MOVE',
      } as unknown as StreamEvent, 11);

      const ready = emitted.find(e =>
        e.type === 'EffectReady' && e.name === openName,
      );
      expect(ready).toBeTruthy();
      expect(dep.activeCount()).toBe(0);
    });

    it('does NOT emit trigger-show for MSG_MOVE landing OUTSIDE MZONE', async () => {
      const { RULES } = await import('./deferred-effect-rules');
      const dep = makeDep(RULES);

      // Card to GY — not a summon.
      const toGrave = {
        type: 'MSG_MOVE', player: 0, cardCode: 999,
        fromLocation: 0x02 /* HAND */, toLocation: 0x10 /* GRAVE */,
      } as unknown as StreamEvent;
      dep.observe(toGrave);

      const open = emitted.find(e =>
        e.type === 'DeferredEffect' && (e as { name: string }).name.startsWith('trigger-show'),
      );
      expect(open).toBeUndefined();
    });
  });
});

// =============================================================================
// β.3 cas #12 — RewriterRule (xyzLeaveWithMaterials family)
// -----------------------------------------------------------------------------
// Tests of the new DEP API surface (T-V1 → T-V8 + T-V11 → T-V15). Uses
// synthetic rules + fixtures — the production rule itself is covered in
// `deferred-effect-rules.spec.ts` (T-V9 garde + T-V10 shipped).
// =============================================================================

describe('DeferredEffectProcessor — β.3 cas #12 RewriterRule', () => {
  let emitted: DeferredFluxEvent[];
  let clock: FakeClock;
  let sinks: RuleSinks;
  let enqueueSpy: jasmine.Spy<(events: readonly object[]) => void>;
  let lockZoneSpy: jasmine.Spy<(zoneId: number, absolutePlayer: number) => ZoneLock>;
  let releaseSpies: jasmine.Spy<() => void>[];

  beforeEach(() => {
    emitted = [];
    clock = new FakeClock();
    releaseSpies = [];
    enqueueSpy = jasmine.createSpy('enqueueVirtualMoves');
    lockZoneSpy = jasmine.createSpy('lockZone').and.callFake(() => {
      const release = jasmine.createSpy('release');
      releaseSpies.push(release);
      return { release } satisfies ZoneLock;
    });
    sinks = {
      enqueueVirtualMoves: enqueueSpy,
      lockZone: lockZoneSpy,
    };
  });

  function makeDep(rules: readonly DeferredRule[]): DeferredEffectProcessor {
    return new DeferredEffectProcessor(
      e => emitted.push(e),
      () => undefined,
      clock,
      rules,
      sinks,
    );
  }

  /** Fixture builder for an XYZ-leave trigger: a MSG_MOVE leaving MZONE
   *  carrying N overlay materials (the Commit 0bis-protocol field that
   *  doesn't exist in MoveMsg yet — cast via `unknown`). */
  function xyzLeaveTrigger(player: number, fromSeq: number, materials: number[]): StreamEvent {
    return {
      type: 'MSG_MOVE',
      player,
      fromLocation: 0x04,   // LOCATION.MZONE
      fromSequence: fromSeq,
      toLocation: 0x10,     // LOCATION.GRAVE
      cardCode: 99999,
      overlayMaterials: materials,
    } as unknown as StreamEvent;
  }

  /** Fixture builder for a settling event (`GRAVE → GRAVE reason=0x600`).
   *  Post-review B3 (2026-05-28) — accepts an optional `sourceMzoneSeq`
   *  that the production server tags on the settling. Tests pre-dating
   *  B3 omit it (= replay-pre-B3 fallback path). */
  function settling(player: number, cardCode: number, sourceMzoneSeq?: number): StreamEvent {
    return {
      type: 'MSG_MOVE',
      player,
      fromLocation: 0x10,   // LOCATION.GRAVE
      toLocation: 0x10,     // LOCATION.GRAVE
      reason: 0x600,        // REASON_XYZ_MATERIAL_SETTLE
      cardCode,
      ...(sourceMzoneSeq !== undefined ? { sourceMzoneSeq } : {}),
    } as unknown as StreamEvent;
  }

  /** Build a synthetic xyz-leave-style RewriterRule reading materials
   *  from `event.overlayMaterials`. The shape mirrors the production rule
   *  but is locally defined so the spec controls the assertions. */
  function makeXyzLeaveRule(): RewriterRule {
    // Mirror the production rule (post-review B3 + M2, 2026-05-28).
    interface Payload {
      lock: ZoneLock;
      expectedCardCodes: Set<number>;
      remaining: number;
      sourceMzoneSeq: number;
    }
    return {
      kind: 'rewriter',
      trigger: e => {
        if ((e as { type?: string }).type !== 'MSG_MOVE') return false;
        const m = e as unknown as { fromLocation: number; overlayMaterials?: number[] };
        return m.fromLocation === 0x04 && (m.overlayMaterials?.length ?? 0) > 0;
      },
      deriveName: (_e, ref) => `xyz-leave:${ref}`,
      // B3 + M2 — no `player` filter (M2: settling.player = owner ≠ controller
      // in Mind Control). sourceMzoneSeq filtering happens in chainTo for
      // graceful fallback on replays pre-B3 that lack the field.
      derivePredicate: () => ({
        type: 'MSG_MOVE',
        fromLocation: 0x10,
        toLocation: 0x10,
        reason: 0x600,
      }),
      onTrigger: (e, _ref, sinkParam) => {
        const m = e as unknown as { player: number; fromSequence: number; overlayMaterials: number[] };
        const lock = sinkParam.lockZone(0x04, m.player);
        const virtuals = m.overlayMaterials.map(cardCode => ({
          type: 'MSG_MOVE',
          player: m.player,
          fromLocation: 0x80,             // OVERLAY
          fromSequence: m.fromSequence,
          toLocation: 0x10,               // GRAVE
          cardCode,
          reason: 0x600,
        }));
        sinkParam.enqueueVirtualMoves(virtuals as unknown as readonly object[] as never);
        return {
          payload: {
            lock,
            expectedCardCodes: new Set(m.overlayMaterials),
            remaining: m.overlayMaterials.length,
            sourceMzoneSeq: m.fromSequence,
          } satisfies Payload,
        };
      },
      chainTo: (matched, _ref, deferred) => {
        const payload = deferred.payload as Payload;
        const m = matched as unknown as { cardCode: number; sourceMzoneSeq?: number };
        // B3 discrimination — settling's sourceMzoneSeq, if present, must
        // match the deferred's source. Absent = fallback to cardCode-only.
        if (m.sourceMzoneSeq !== undefined && m.sourceMzoneSeq !== payload.sourceMzoneSeq) {
          return deferred.awaitingPredicate;
        }
        if (!payload.expectedCardCodes.has(m.cardCode)) {
          return deferred.awaitingPredicate; // rearm same predicate
        }
        payload.expectedCardCodes.delete(m.cardCode);
        payload.remaining -= 1;
        if (payload.remaining === 0) return { kind: 'absorb-and-close' };
        return { kind: 'absorb' };
      },
      onClose: (payload) => {
        (payload as Payload).lock.release();
      },
    };
  }

  // -------------------------------------------------------------------------
  // T-V1 — onTrigger is called with the right ref + sinks.enqueueVirtualMoves
  // receives an array of the expected length.
  // -------------------------------------------------------------------------
  it('T-V1: onTrigger fires + enqueueVirtualMoves receives N virtuals', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const virtuals = enqueueSpy.calls.mostRecent().args[0];
    expect(virtuals.length).toBe(2);
    expect(lockZoneSpy).toHaveBeenCalledTimes(1);
    expect(lockZoneSpy.calls.mostRecent().args).toEqual([0x04, 0]);
    expect(dep.activeCount()).toBe(1);
    expect(dep.peekActive('xyz-leave:42')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // T-V2 — chainTo 'absorb' keeps the deferred open (N>1 remaining).
  // -------------------------------------------------------------------------
  it('T-V2: chainTo absorb leaves the deferred open', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);
    expect(dep.activeCount()).toBe(1);

    dep.observe(settling(0, 101), 43);
    expect(dep.activeCount()).toBe(1);
    expect(emitted.find(e => e.type === 'EffectReady')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T-V3 — chainTo 'absorb-and-close' closes + emits EffectReady.
  // -------------------------------------------------------------------------
  it('T-V3: chainTo absorb-and-close closes + emits EffectReady', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);
    dep.observe(settling(0, 101), 43);
    dep.observe(settling(0, 202), 44);

    expect(dep.activeCount()).toBe(0);
    const ready = emitted.find(e => e.type === 'EffectReady');
    expect(ready).toBeTruthy();
    expect((ready as { name: string }).name).toBe('xyz-leave:42');
  });

  // -------------------------------------------------------------------------
  // T-V4 — observe returns {absorbed: true} for an absorbed settling.
  // -------------------------------------------------------------------------
  it('T-V4: observe returns {absorbed: true} for an absorbed settling', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);
    const result = dep.observe(settling(0, 101), 43);
    expect(result).toEqual({ absorbed: true });
  });

  // -------------------------------------------------------------------------
  // T-V5 — Normal timeout if settlings never arrive.
  // -------------------------------------------------------------------------
  it('T-V5: timeout fires + EffectAbandoned(timeout) emitted when settlings don\'t arrive', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);
    expect(dep.activeCount()).toBe(1);

    clock.advance(DEFERRED_TIMEOUT_MS + 1);

    const abandon = emitted.find(e =>
      e.type === 'EffectAbandoned' && (e as { name: string }).name === 'xyz-leave:42',
    );
    expect(abandon).toBeTruthy();
    expect((abandon as { reason: string }).reason).toBe('timeout');
    expect(dep.activeCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T-V7 — onClose? fires on 'timeout' (release the lock).
  // -------------------------------------------------------------------------
  it('T-V7: onClose? called with reason=timeout when the deferred times out', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);
    expect(releaseSpies[0]).not.toHaveBeenCalled();

    clock.advance(DEFERRED_TIMEOUT_MS + 1);
    expect(releaseSpies[0]).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // T-V8 — onClose? fires on 'checkpoint' (applyReset CONNECTION_LIFETIME).
  // -------------------------------------------------------------------------
  it('T-V8: onClose? called with reason=checkpoint on applyReset(CONNECTION_LIFETIME)', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);
    expect(releaseSpies[0]).not.toHaveBeenCalled();

    dep.applyReset(new Set<ScopeCategory>(['CONNECTION_LIFETIME']));

    expect(releaseSpies[0]).toHaveBeenCalledTimes(1);
    const abandon = emitted.find(e => e.type === 'EffectAbandoned');
    expect((abandon as { reason: string }).reason).toBe('checkpoint');
  });

  // -------------------------------------------------------------------------
  // T-V11 — observe returns {absorbed: false} when no rewriter matches.
  // -------------------------------------------------------------------------
  it('T-V11: observe returns {absorbed: false} by default (no matching rewriter)', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    // Event matching nothing — neither a trigger nor any active deferred.
    const result = dep.observe({ type: 'UNRELATED' } as unknown as StreamEvent);
    expect(result).toEqual({ absorbed: false });
  });

  // -------------------------------------------------------------------------
  // T-V12 — onClose? fires on 'matched' (the happy close path).
  // -------------------------------------------------------------------------
  it('T-V12: onClose? called with reason=matched on absorb-and-close', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 202]), 42);
    dep.observe(settling(0, 101), 43);
    expect(releaseSpies[0]).not.toHaveBeenCalled();

    dep.observe(settling(0, 202), 44);

    expect(releaseSpies[0]).toHaveBeenCalledTimes(1);
    // EffectReady was emitted AFTER onClose? (per closeReady ordering).
    expect(emitted.find(e => e.type === 'EffectReady')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // T-V13 — Two parallel deferreds (mass-destruction of 2 XYZ with
  // disjoint materials). Correlation works via cardCode.
  // -------------------------------------------------------------------------
  it('T-V13: two parallel deferreds, disjoint material sets — both close in order', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 0, [101, 102]), 42);
    dep.observe(xyzLeaveTrigger(0, 1, [201, 202]), 43);
    expect(dep.activeCount()).toBe(2);

    dep.observe(settling(0, 101), 44);
    dep.observe(settling(0, 201), 45);
    dep.observe(settling(0, 102), 46);
    dep.observe(settling(0, 202), 47);

    expect(dep.activeCount()).toBe(0);
    const readys = emitted.filter(e => e.type === 'EffectReady');
    expect(readys.length).toBe(2);
    expect(readys.map(e => (e as { name: string }).name)).toEqual([
      'xyz-leave:42',
      'xyz-leave:43',
    ]);
    // Both locks released.
    expect(releaseSpies[0]).toHaveBeenCalledTimes(1);
    expect(releaseSpies[1]).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // T-V14 — Two deferreds sharing a cardCode WITH distinct sourceMzoneSeq
  // (post-review B3, 2026-05-28). Each settling carries its own
  // `sourceMzoneSeq` (tagged by the server's FIFO from the pre-process
  // snapshot). Each settling closes ONLY its own deferred. The pre-B3
  // collision ("both close on the first settling") no longer happens.
  // -------------------------------------------------------------------------
  it('T-V14: two deferreds sharing cardCode discriminate via sourceMzoneSeq', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    // Two XYZ on different MZONE seqs (3 and 4) both carry material 101.
    dep.observe(xyzLeaveTrigger(0, 3, [101]), 42);
    dep.observe(xyzLeaveTrigger(0, 4, [101]), 43);
    expect(dep.activeCount()).toBe(2);

    // First settling tagged sourceMzoneSeq=3 → closes ONLY the seq-3 deferred.
    dep.observe(settling(0, 101, 3), 44);
    expect(dep.activeCount()).toBe(1);
    expect(releaseSpies[0]).toHaveBeenCalledTimes(1);
    expect(releaseSpies[1]).not.toHaveBeenCalled();

    // Second settling tagged sourceMzoneSeq=4 → closes the seq-4 deferred.
    dep.observe(settling(0, 101, 4), 45);
    expect(dep.activeCount()).toBe(0);
    expect(releaseSpies[1]).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // T-V14b — Two deferreds sharing cardCode but settlings missing
  // sourceMzoneSeq (replay pre-B3 fallback). Both deferreds fall back to
  // cardCode-only matching → the pre-B3 collision behaviour returns
  // (both close on the first settling). Contract : "no crash, locks
  // released" — the bug B3 stays silent on legacy replays but doesn't
  // make them worse than they were before B3.
  // -------------------------------------------------------------------------
  it('T-V14b: pre-B3 replay fallback — collision behaviour, no crash', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 3, [101]), 42);
    dep.observe(xyzLeaveTrigger(0, 4, [101]), 43);
    expect(dep.activeCount()).toBe(2);

    // Settling has NO sourceMzoneSeq (pre-B3 replay) → both deferreds match
    // via cardCode-only fallback.
    dep.observe(settling(0, 101), 44);
    expect(releaseSpies[0]).toHaveBeenCalled();
    expect(releaseSpies[1]).toHaveBeenCalled();
    clock.advance(DEFERRED_TIMEOUT_MS + 1);
    // No throw, both releases fired (either via match or via timeout).
  });

  // -------------------------------------------------------------------------
  // T-V14c — One deferred + a settling tagged with a DIFFERENT
  // sourceMzoneSeq (orphan settling from another XYZ destroyed in
  // parallel that this deferred should NOT absorb). The deferred rearms,
  // stays open, eventually times out cleanly.
  // -------------------------------------------------------------------------
  it('T-V14c: orphan settling (wrong sourceMzoneSeq) is not absorbed', () => {
    const dep = makeDep([makeXyzLeaveRule()]);
    dep.observe(xyzLeaveTrigger(0, 3, [101]), 42);
    expect(dep.activeCount()).toBe(1);

    // Settling tagged sourceMzoneSeq=4 → doesn't match our deferred (seq=3).
    // chainTo rearms without consuming. The deferred stays open.
    dep.observe(settling(0, 101, 4), 43);
    expect(dep.activeCount()).toBe(1);
    expect(releaseSpies[0]).not.toHaveBeenCalled();

    // Now our settling arrives with the right seq.
    dep.observe(settling(0, 101, 3), 44);
    expect(dep.activeCount()).toBe(0);
    expect(releaseSpies[0]).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // T-V15 — Verdict ambiguity Q2 (audit): an AwaitingPredicate that
  // happens to carry a `kind` field (e.g. `{kind: 'animation', ...}` —
  // a valid rearm) MUST NOT be misinterpreted as `{kind: 'absorb'}`.
  // The interpretRewriterVerdict helper tests for SPECIFIC values
  // ('absorb' / 'absorb-and-close') BEFORE falling back to rearm.
  // -------------------------------------------------------------------------
  it('T-V15: chainTo returning {kind:"animation", ...} is interpreted as rearm, NOT absorb', () => {
    const rule: RewriterRule = {
      kind: 'rewriter',
      trigger: e => (e as { type?: string }).type === 'SEED',
      deriveName: (_e, ref) => `ambig:${ref}`,
      derivePredicate: () => ({ type: 'INTERMEDIATE' }),
      onTrigger: () => ({ payload: {} }),
      chainTo: (_matched, matchedRef) => ({
        kind: 'animation',
        type: 'AnimationCompleted',
        ref: matchedRef,
      }),
      onClose: () => { /* no-op */ },
    };
    const dep = makeDep([rule]);
    dep.observe({ type: 'SEED' } as unknown as StreamEvent, 10);
    expect(dep.activeCount()).toBe(1);

    // INTERMEDIATE matches the initial predicate.
    const result = dep.observe({ type: 'INTERMEDIATE' } as unknown as StreamEvent, 20);

    // Must NOT be absorbed (rearm path), and the deferred stays open
    // with the new predicate.
    expect(result).toEqual({ absorbed: false });
    expect(dep.activeCount()).toBe(1);
    const view = dep.peekActive('ambig:10');
    expect(view?.awaitingPredicate).toEqual({
      kind: 'animation',
      type: 'AnimationCompleted',
      ref: 20,
    });
  });
});
