import { effect, type EffectRef, type Injector, type Signal } from '@angular/core';

import type { CheckpointPayload } from './checkpoint-payload';
import type { FluxEvent } from './flux-event';
import type { ResetTarget } from './reset-target';
import type { ScopeCategory } from './scope';

/**
 * Base class every projection (in the §3.2 sense) MUST extend.
 *
 * A projection is a deterministic, read-only view of the flux + the
 * current perspective + environment. It exposes a single {@link value}
 * signal that downstream components / templates can observe; it never
 * accepts external writes. Mutation happens through {@link applyEvent}
 * (fed by the flux) and {@link applyReset} (fed by the
 * {@link ScopeResetDispatcher} when a reset event invalidates this
 * projection's scope).
 *
 * Cf. `_bmad-output/planning-artifacts/duel-session-chantier.md
 * §3.2 + §3.5`.
 *
 * `BaseProjection<T>` is a **strict superset** of {@link ResetTarget}: a
 * `BaseProjection` is automatically a valid {@link ResetTarget} for the
 * dispatcher's purposes, but adds `value` (the exposed signal) and
 * `applyEvent` (the per-event mutation entry point). Managers that do
 * not yet satisfy the projection purity (mixed business + transport +
 * exposed signals) implement the slimmer {@link ResetTarget} instead;
 * the read-only signal extraction happens later (β.3).
 *
 * @typeParam T  type of the value exposed to consumers via {@link value}.
 */
export abstract class BaseProjection<T> implements ResetTarget {
  /**
   * The persistence scope this projection lives in. Declared
   * **abstract readonly** so a subclass that forgets to declare it does
   * not compile — this is the structural guard that prevents the
   * regression of commit `853e3374` (warning comment that did not hold).
   */
  abstract readonly scope: ScopeCategory;

  /**
   * The single read-only output of the projection. Subclasses implement
   * this with a `signal()` (or `computed()`) backing store and expose
   * its `.asReadonly()` here. Per the pipeline-signal-tagged lint
   * convention (§3.2 case c), any signal owned by a `BaseProjection`
   * subclass is implicitly tagged — no `_transport_*` prefix needed.
   */
  abstract readonly value: Signal<T>;

  /**
   * Consume one event from the flux. Called synchronously by the
   * dispatch layer (in `flux` order). MUST be a pure function of the
   * event + current projection state — no side-effects observable from
   * the outside, no I/O, no DOM reads.
   */
  abstract applyEvent(event: FluxEvent): void;

  /**
   * Re-initialise the projection because the {@link scope} it belongs
   * to has been invalidated.
   *
   * - {@link invalidatedScopes} is the *expanded* set produced by
   *   {@link expandInvalidatedScopes}. This projection's `scope` is
   *   guaranteed to be in it (the {@link ScopeResetDispatcher} filters
   *   before calling).
   * - {@link checkpointPayload} is `undefined` for non-checkpoint
   *   resets (`PerspectiveSwitched`, `ServerKicked`, …). When defined,
   *   it carries the server-provided initial state from §3.6
   *   (`STATE_SYNC` or `RematchStarted`); the projection re-seeds from
   *   the payload instead of from its zero state.
   */
  abstract applyReset(
    invalidatedScopes: ReadonlySet<ScopeCategory>,
    checkpointPayload?: CheckpointPayload,
  ): void;

  /**
   * Index of the last event consumed from the attached `eventStream`.
   * `_transport_*` per pipeline-signal-tagged convention — internal
   * state, never read by templates.
   *
   * Reset to 0 when the stream signal observes a length REGRESSION
   * (orchestrator wipe via `_eventStream.set([])` on rematch / seek);
   * the projection's own `applyReset` is fired in parallel by the
   * scope dispatcher, so the cursor + the value start fresh together.
   */
  private _transport_streamConsumedLength = 0;

  /** Effect ref installed by `attachEventStream`. Held so a subsequent
   *  `attachEventStream` call (defensive — should not happen in
   *  production) or a manual `detachEventStream` can tear down the
   *  previous subscription explicitly. */
  private _transport_streamEffect: EffectRef | null = null;

  /**
   * β.3 Lot 1 — subscribe to the orchestrator's `eventStream` signal.
   * Installs an Angular `effect()` that drains newly-pushed events
   * through `applyEvent` exactly once each, in arrival order.
   *
   * The effect is idempotent across signal re-emits (signal may
   * publish the same array reference when an unrelated dependency
   * changes — defensive in practice). The `_transport_streamConsumedLength`
   * cursor tracks the prefix already consumed.
   *
   * Stream-wipe path: when `events.length < cursor`, the orchestrator
   * called `_eventStream.set([])` (resetAllState — rematch / seek).
   * Sync the cursor back to 0 so the next push restarts from index 0;
   * the projection's `applyReset` is fired in parallel by the scope
   * dispatcher and is responsible for clearing the projection's
   * `value` state.
   *
   * Required `injector` because `BaseProjection` is a plain class
   * (constructable outside an injection context — e.g. in tests),
   * so the `effect()` factory needs an explicit injector to attach
   * its lifetime.
   */
  attachEventStream(
    stream: Signal<readonly FluxEvent[]>,
    injector: Injector,
  ): void {
    this._transport_streamEffect?.destroy();
    this._transport_streamEffect = effect(() => {
      const events = stream();
      if (events.length < this._transport_streamConsumedLength) {
        // Stream was cleared — sync the cursor back.
        this._transport_streamConsumedLength = events.length;
        return;
      }
      while (this._transport_streamConsumedLength < events.length) {
        this.applyEvent(events[this._transport_streamConsumedLength]);
        this._transport_streamConsumedLength++;
      }
    }, { injector });
  }

  /** Tear down the `attachEventStream` subscription. Angular's
   *  `DestroyRef` would handle this on injector teardown, but holding
   *  the ref lets specs opt into explicit teardown and lets the
   *  orchestrator detach + re-attach if it ever needs to. */
  detachEventStream(): void {
    this._transport_streamEffect?.destroy();
    this._transport_streamEffect = null;
    this._transport_streamConsumedLength = 0;
  }
}
