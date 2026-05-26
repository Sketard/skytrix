/**
 * β.2 — deferred-effect events emitted by `DeferredEffectProcessor` (cf.
 * `_bmad-output/planning-artifacts/duel-session-chantier.md §3.7` +
 * `beta-2-deferred-effect-processor-spec.md`).
 *
 * The DEP materialises cross-event temporal correlations as **explicit
 * events on the duel's EventStream** instead of leaving each consumer to
 * track them ad-hoc. A trigger event (`MSG_CHAINING`, `MSG_MOVE`, …)
 * opens a `DeferredEffect(name, triggerRef, awaitingPredicate)`; the
 * matching future event closes it with `EffectReady(name, triggerRef)`.
 * If no match arrives within `DEFERRED_TIMEOUT_MS`, an
 * `EffectAbandoned(reason='timeout')` is emitted; a checkpoint
 * (§3.6 STATE_SYNC / RematchStarted) emits `reason='checkpoint'`
 * for every active deferred.
 *
 * Projections (β.3+) read these markers and never reason about the
 * dependency itself — the YGO knowledge of "what waits on what" lives
 * inside the DEP's `RULES` table only.
 *
 * Discriminator: every member carries `kind: 'deferred'` so the widened
 * `StreamEvent` union can route them past `MSG_*` consumers (boundary
 * events use `kind: 'boundary'`, runner events use `kind: 'runner-*'`).
 */

/**
 * Literal-equality matcher for `EffectReady` resolution. Each defined
 * field is compared with strict equality against the candidate flux
 * event; undefined fields are wildcards (they don't constrain).
 *
 * NOT a closure, NOT a JSONPath, NOT a regex. β.2a ships an empty
 * `RULES` table — the field set is allowed to grow at β.2b/c as new
 * rules need narrower matchers. Keep it data, not code: a rule that
 * needs richer matching belongs to a different processor.
 */
export interface AwaitingPredicate {
  /** Narrows the StreamEvent variant (e.g. `'boundary'`, `'deferred'`,
   *  or a runner kind). Omitted matches every kind. */
  kind?: string;
  /** Matches the `type` discriminant (`'MSG_MOVE'`, `'ChainEnded'`,
   *  `'runner-started'`, …). */
  type?: string;
  /** Matches a `ref` payload field (e.g. an `AnimationCompleted` ref). */
  ref?: number;
  /** Matches the carrying player (absolute, server convention). */
  player?: number;
  /** Matches `cardCode` (the OCG card id). */
  cardCode?: number;
  /** Matches a source `LOCATION` enum value. */
  location?: number;
  /** Matches a destination `LOCATION` enum value (MSG_MOVE.toLocation). */
  destination?: number;
  /** Matches a chain id (for `ChainStarted/Ended` boundary events). */
  chainId?: number;
}

export interface DeferredEffectEvent {
  kind: 'deferred';
  type: 'DeferredEffect';
  /** Stable identifier — typically `<family>:<chainIndex>` or
   *  `<family>:<cardCode>:<ref>`. Collisions are an invariant violation
   *  (cf. `duel-session-chantier.md §3.7bis`). */
  name: string;
  /** Monotonic counter assigned by the DEP at observation time. Lets a
   *  projection correlate `DeferredEffect`/`EffectReady`/`EffectAbandoned`
   *  triplets without name dependency. */
  triggerRef: number;
  /** The literal matcher this deferred is waiting for. The DEP itself
   *  also keeps the predicate in its `_active` map; it's mirrored on the
   *  event payload so projections can introspect it without poking into
   *  the processor. */
  awaitingPredicate: AwaitingPredicate;
}

export interface EffectReadyEvent {
  kind: 'deferred';
  type: 'EffectReady';
  name: string;
  triggerRef: number;
}

export interface EffectAbandonedEvent {
  kind: 'deferred';
  type: 'EffectAbandoned';
  name: string;
  triggerRef: number;
  /**
   * `'timeout'` — the awaiting event did not arrive within
   * `DEFERRED_TIMEOUT_MS` (or the predicate's collision-eviction path
   * fired); `'checkpoint'` — a §3.6 reset (`STATE_SYNC` /
   * `RematchStarted`) cleared every pending deferred. Projections
   * treat both as "forget this deferred" (functionally equivalent to
   * never having seen the matching `DeferredEffect`).
   */
  reason: 'timeout' | 'checkpoint';
}

export type DeferredFluxEvent =
  | DeferredEffectEvent
  | EffectReadyEvent
  | EffectAbandonedEvent;

/** Guard: discriminate a `DeferredFluxEvent` from any `StreamEvent`
 *  member. Accepts `unknown` because most `StreamEvent` members do not
 *  declare a `kind` property at the type level — TS would otherwise
 *  refuse the call on a union that doesn't share the guard's
 *  parameter shape. */
export function isDeferredFluxEvent(e: unknown): e is DeferredFluxEvent {
  return typeof e === 'object' && e !== null
    && (e as { kind?: unknown }).kind === 'deferred';
}
