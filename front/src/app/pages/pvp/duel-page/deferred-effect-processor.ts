// =============================================================================
// deferred-effect-processor.ts — β.2a (2026-05-26)
// -----------------------------------------------------------------------------
// Materialises cross-event temporal correlations as explicit `DeferredEffect` /
// `EffectReady` / `EffectAbandoned` markers on the duel's EventStream. The
// projections (β.3+) consume the markers; the YGO knowledge of "what waits on
// what" lives here, in the `RULES` table, and nowhere else. Cf.
// `_bmad-output/planning-artifacts/duel-session-chantier.md §3.7` +
// `_bmad-output/planning-artifacts/beta-2-deferred-effect-processor-spec.md`.
//
// β.2a ships the INFRASTRUCTURE only: the observe loop, the timer / collision
// / checkpoint / silentReset mechanics, the `ResetTarget` integration, and an
// EMPTY `RULES` table. The DEP receives every flux event the orchestrator
// pushes (via `pushToStream`), but emits nothing because no rule matches.
// β.2b populates `RULES` with the 10 catalogue cases; β.2c adds case #11 +
// the `TargetIndicatorManager` wiring.
//
// **Plain class**, NOT `@Injectable`. Owned + constructed privately by the
// `AnimationOrchestratorService` so the DEP observes the SAME `pushToStream`
// convergence point boundary events / runner transport events / MSG_*
// in-queue tap all flow through. This is the only way to observe transport
// (runner) events alongside the WS messages in the order they appear on
// the stream; placing the DEP under `DuelEventProcessor` (the BP's host)
// would only see the WS slice.
//
// **Scope**: `CONNECTION_LIFETIME`. PerspectiveSwitched does NOT abandon
// open deferreds (cf. §3.7bis lifecycle bullet); STATE_SYNC / RematchStarted
// (which cascade DUEL → CONNECTION) do. The scope hierarchy filter inside
// `ScopeResetDispatcher` enforces this — a PERSPECTIVE-only dispatch
// reaches no target whose scope is CONNECTION or deeper.
//
// **Timing model (β.2a)**: a deferred is opened by a rule's `trigger`,
// optionally re-armed by `chainTo` (for compound predicates per §3.1),
// closed by a matching flux event (`EffectReady`), evicted by collision
// (`EffectAbandoned(timeout)` on the displaced entry), aged out by
// `DEFERRED_TIMEOUT_MS` (`EffectAbandoned(timeout)`), or wiped en masse
// by `applyReset` (`EffectAbandoned(checkpoint)`). The internal `_active`
// map is keyed by `name` — collisions are an INVARIANT VIOLATION
// (duelAssert in dev, warn-and-evict in prod, never silent overlap).
// =============================================================================

import type {
  CheckpointPayload,
  ResetTarget,
  ScopeCategory,
} from '../projections';
import type {
  AwaitingPredicate,
  DeferredEffectEvent, DeferredFluxEvent,
  EffectAbandonedEvent, EffectReadyEvent, StreamEvent,
} from '../types';
import { DEFERRED_TIMEOUT_MS } from './animation-constants';
import { duelAssert } from '../../../core/utilities/duel-assert';
import type { DuelLogger } from './duel-logger';

// Re-export the FluxEvent alias the DEP works with — the wider StreamEvent
// union from `types/` (palier 0 + β.1 boundary + β.2 deferred + α.3
// transport, all merged at β.2a). The DEP itself never narrows to MSG_*
// because rules legitimately match boundary or transport events.
type FluxEvent = StreamEvent;

/** Minimal clock interface — lets specs inject a fake-timer instead of
 *  reaching for global `setTimeout`. Mirrors the pattern used by other
 *  DEP-adjacent classes (cf. `PollDropWatchdog`). */
export interface DeferredClock {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}

const REAL_CLOCK: DeferredClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
};

/**
 * A rule in the DEP's metier table. β.2a ships `RULES = []`; β.2b adds
 * the 10 catalogue cases. The shape is exposed so β.2b drops into this
 * file (or a sibling `deferred-effect-rules.ts`) without rewiring the
 * processor. See spec §3 for the full table.
 *
 * - `trigger` decides whether the current `observe` event opens a new
 *   deferred. The rule is responsible for being narrow enough that
 *   unrelated events don't trip it.
 * - `deriveName` produces a stable identifier — typically
 *   `'<family>:<chainIndex>'` or `'<family>:<cardCode>:<ref>'`. Names
 *   MUST be unique across simultaneously-open deferreds; collisions are
 *   an invariant violation surfaced via `duelAssert`.
 * - `derivePredicate` describes the matcher that, when satisfied by a
 *   later flux event, closes the deferred.
 * - `chainTo` (optional) re-arms the deferred with a new predicate when
 *   the first match resolves — supports the compound flows
 *   (cost-then-animationCompleted, etc.) of §3.1.
 */
export interface DeferredRule {
  trigger: (event: FluxEvent) => boolean;
  deriveName: (event: FluxEvent, triggerRef: number) => string;
  derivePredicate: (event: FluxEvent, triggerRef: number) => AwaitingPredicate;
  chainTo?: (
    matchedEvent: FluxEvent,
    deferred: ActiveDeferredView,
  ) => AwaitingPredicate | null;
}

/** Read-only view passed to `chainTo` — lets a rule peek at the
 *  deferred without mutating the DEP's internal state. */
export interface ActiveDeferredView {
  readonly name: string;
  readonly triggerRef: number;
  readonly awaitingPredicate: AwaitingPredicate;
}

interface ActiveDeferred extends ActiveDeferredView {
  awaitingPredicate: AwaitingPredicate;
  timerId: ReturnType<typeof setTimeout>;
}

/**
 * β.2a metier table — INTENTIONALLY EMPTY. β.2b populates with the 10
 * catalogue cases (`overlay-show`, `trigger-show`, `search-reveal`,
 * `flip-summon-trigger`, `banish-seq`, `attack-impact`, `equip-stat`,
 * `xyz-attach`, `lp-cost`, `counter-pulse`). Case #11
 * (`pile-float-cleanup`) needs `TargetIndicatorManager` to emit on the
 * stream first — see spec §3.2.
 */
export const RULES: readonly DeferredRule[] = [];

export class DeferredEffectProcessor implements ResetTarget {
  readonly scope: ScopeCategory = 'CONNECTION_LIFETIME';

  /** Active deferreds keyed by `name`. Size N ≤ 11 in steady-state, so
   *  the per-event O(N) matcher pass is negligible. */
  private readonly _active = new Map<string, ActiveDeferred>();
  /** Monotonic counter — assigned at each `observe` call. β.2a uses it
   *  as the `triggerRef` for emitted `DeferredEffect`s; a projection
   *  can correlate the triplet without name dependency. */
  private _nextRef = 0;

  /**
   * @param emit  Sink for emitted `DeferredFluxEvent`s. Same contract as
   *              `BoundaryProcessor.emit` — fire-and-forget, the DEP
   *              does not handle sink failures.
   * @param getLogger  Lazy accessor so the orchestrator can assign its
   *              `DuelLogger` AFTER constructing the DEP without binding
   *              `undefined` at field-init time (mirror of the BP pattern).
   * @param clock Optional fake-timer hook for specs. Defaults to real
   *              `setTimeout`/`clearTimeout`.
   * @param rules Optional rule table override (test injection). Production
   *              uses the module-level `RULES` constant.
   */
  constructor(
    private readonly emit: (event: DeferredFluxEvent) => void,
    private readonly getLogger: () => DuelLogger | undefined = () => undefined,
    private readonly clock: DeferredClock = REAL_CLOCK,
    private readonly rules: readonly DeferredRule[] = RULES,
  ) {}

  /**
   * Observe a flux event in arrival order. Two phases, strict order:
   *  (a) Drain — match the event against every active deferred's
   *      `awaitingPredicate`. Each match either re-arms the deferred
   *      (via `chainTo`) or emits `EffectReady` + drops the entry.
   *  (b) Open — match the event against every rule's `trigger`. Each
   *      match opens a new deferred + emits `DeferredEffect`.
   *
   * (a) runs BEFORE (b) so a single event can both fulfill an existing
   * deferred AND trigger a new one of the same name without collision.
   */
  observe(event: FluxEvent): void {
    const ref = this._nextRef++;
    this.drainMatchingDeferreds(event);
    this.openDeferredsForRules(event, ref);
  }

  // ---------------------------------------------------------------------------
  // ResetTarget contract — scope-driven fan-out
  // ---------------------------------------------------------------------------

  /**
   * α.4b/β.2a `ResetTarget` entry. Routes the reset by scope membership:
   *   - `CONNECTION_LIFETIME` present (STATE_SYNC / RematchStarted) →
   *     emit `EffectAbandoned(reason='checkpoint')` for every active
   *     deferred (in insertion order), then clear `_active` + timers.
   *   - Otherwise (e.g. PERSPECTIVE_LIFETIME) → no-op. The dispatcher's
   *     own scope filter already prevents the call in PERSPECTIVE-only
   *     dispatches, but the guard is kept for clarity + defense in
   *     depth.
   * Payload is forwarded by the dispatcher but the DEP does not consume
   * it at β.2a — the checkpoint shape pins at β.3 when the first
   * consumer needs it.
   */
  applyReset(
    invalidatedScopes: ReadonlySet<ScopeCategory>,
    _payload?: CheckpointPayload,
  ): void {
    if (!invalidatedScopes.has('CONNECTION_LIFETIME')) return;
    this.abandonAllActive('checkpoint');
  }

  /**
   * Silent reset — drops every active deferred + clears every timer
   * WITHOUT emitting `EffectAbandoned`. Mirror of
   * `BoundaryProcessor.silentReset()`: called by
   * `DuelEventProcessor.reset()` on hard teardown (duel destroy / fresh
   * start) where the stream subscriber dies with the same scope, so
   * emitting closures would only pollute a stream nobody reads.
   *
   * Use `applyReset({CONNECTION_LIFETIME})` from a §3.6 checkpoint when
   * the journal SHOULD see the closures.
   */
  silentReset(): void {
    for (const deferred of this._active.values()) {
      this.clock.clearTimeout(deferred.timerId);
    }
    this._active.clear();
  }

  // ---------------------------------------------------------------------------
  // Test-only inspection — used by `deferred-effect-processor.spec.ts`
  // ---------------------------------------------------------------------------

  /** Number of currently active deferreds. Test-only — projections MUST
   *  derive their state from `EffectReady`/`EffectAbandoned` events on
   *  the flux (DP-4: no `activeNames` signal exposed). */
  activeCount(): number { return this._active.size; }

  /** Return the active deferred's view by name, or `undefined`.
   *  Test-only — same DP-4 reasoning as `activeCount`. */
  peekActive(name: string): ActiveDeferredView | undefined {
    return this._active.get(name);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private drainMatchingDeferreds(event: FluxEvent): void {
    // Iterate over a snapshot so mid-iteration `_active.delete` + reopen
    // by `chainTo` are safe. Map insertion order is preserved by JS
    // semantics, so collisions later evict the older entry deterministically.
    for (const [name, deferred] of [...this._active]) {
      if (!this.matches(event, deferred.awaitingPredicate)) continue;
      const rearmed = this.tryRearm(event, deferred);
      if (rearmed) continue;
      this.closeReady(name, deferred);
    }
  }

  private openDeferredsForRules(event: FluxEvent, ref: number): void {
    for (const rule of this.rules) {
      if (!rule.trigger(event)) continue;
      this.openDeferred(rule, event, ref);
    }
  }

  /** Test the literal-equality matcher (Z2). `undefined` fields in the
   *  predicate are wildcards; defined fields require strict equality. */
  private matches(event: FluxEvent, predicate: AwaitingPredicate): boolean {
    const candidate = event as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(predicate)) {
      if (expected === undefined) continue;
      if (candidate[key] !== expected) return false;
    }
    return true;
  }

  private openDeferred(rule: DeferredRule, event: FluxEvent, ref: number): void {
    const name = rule.deriveName(event, ref);
    if (this._active.has(name)) {
      // Z6 — collisions of `name` are an invariant violation. duelAssert
      // throws in dev; in prod we abandon the older entry with
      // `EffectAbandoned(timeout)` so the stream stays consistent + warn
      // for DevHub visibility.
      duelAssert(
        false,
        'DeferredEffectProcessor.openDeferred',
        `name "${name}" already active (existing triggerRef=${this._active.get(name)!.triggerRef})`,
      );
      this.getLogger()?.warn(
        '[DEFERRED] collision on name "%s" — abandoning previous', name);
      this.abandonByName(name, 'timeout');
    }
    const predicate = rule.derivePredicate(event, ref);
    const timerId = this.clock.setTimeout(
      () => this.timeoutAbandon(name),
      DEFERRED_TIMEOUT_MS,
    );
    this._active.set(name, {
      name, triggerRef: ref, awaitingPredicate: predicate, timerId,
    });
    this.emit({
      kind: 'deferred', type: 'DeferredEffect',
      name, triggerRef: ref, awaitingPredicate: predicate,
    } satisfies DeferredEffectEvent);
  }

  /** If the deferred's rule declares `chainTo` and the callback returns
   *  a fresh predicate, re-arm the deferred in place (same name + same
   *  `triggerRef`, fresh timer, no `EffectReady` emitted). Returns true
   *  iff the deferred was re-armed. */
  private tryRearm(event: FluxEvent, deferred: ActiveDeferred): boolean {
    // β.2a has no rules, so chainTo lookup is structurally impossible
    // (the deferred would have to have been opened by a rule, and there
    // are none). Wire is in place for β.2b to populate.
    const rule = this.findRuleForDeferred(deferred);
    if (!rule?.chainTo) return false;
    const nextPredicate = rule.chainTo(event, deferred);
    if (nextPredicate === null) return false;
    this.clock.clearTimeout(deferred.timerId);
    deferred.awaitingPredicate = nextPredicate;
    deferred.timerId = this.clock.setTimeout(
      () => this.timeoutAbandon(deferred.name),
      DEFERRED_TIMEOUT_MS,
    );
    return true;
  }

  /** Find the rule that opened `deferred` — used only by `tryRearm` to
   *  reach the `chainTo` callback. β.2a returns undefined for every
   *  deferred (no rules); β.2b will key rules by family/name so the
   *  lookup is O(1) instead of O(rules). */
  private findRuleForDeferred(_deferred: ActiveDeferred): DeferredRule | undefined {
    // β.2a: no rules, no lookup possible. β.2b TODO: rule.matchesName?
    // or store the rule reference on the ActiveDeferred at open time.
    return undefined;
  }

  private closeReady(name: string, deferred: ActiveDeferred): void {
    this.clock.clearTimeout(deferred.timerId);
    this._active.delete(name);
    this.emit({
      kind: 'deferred', type: 'EffectReady',
      name, triggerRef: deferred.triggerRef,
    } satisfies EffectReadyEvent);
  }

  private abandonByName(name: string, reason: 'timeout' | 'checkpoint'): void {
    const deferred = this._active.get(name);
    if (!deferred) return;
    this.clock.clearTimeout(deferred.timerId);
    this._active.delete(name);
    this.emit({
      kind: 'deferred', type: 'EffectAbandoned',
      name, triggerRef: deferred.triggerRef, reason,
    } satisfies EffectAbandonedEvent);
  }

  private abandonAllActive(reason: 'timeout' | 'checkpoint'): void {
    // Snapshot insertion order — `Map` preserves it, so checkpoint
    // emission order matches the order the deferreds were opened. The
    // T-I3 spec asserts this.
    const names = [...this._active.keys()];
    for (const name of names) this.abandonByName(name, reason);
  }

  private timeoutAbandon(name: string): void {
    // Race-safe: if the deferred was matched between the timer arm and
    // the timer fire, `_active.get(name)` is already gone — silent return.
    if (!this._active.has(name)) return;
    this.getLogger()?.warn('[DEFERRED] "%s" timed out after %dms',
      name, DEFERRED_TIMEOUT_MS);
    this.abandonByName(name, 'timeout');
  }
}
