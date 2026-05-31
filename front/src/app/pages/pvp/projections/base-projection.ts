import { type EffectRef, type Injector, type Signal } from '@angular/core';

import { drainStream, type StreamCursor } from './drain-stream';
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
   * {@link invalidatedScopes} is the *expanded* set produced by
   * {@link expandInvalidatedScopes}. This projection's `scope` is
   * guaranteed to be in it (the {@link ScopeResetDispatcher} filters
   * before calling).
   */
  abstract applyReset(invalidatedScopes: ReadonlySet<ScopeCategory>): void;

  /**
   * Cursor tracking the prefix of the attached `eventStream` already
   * consumed by `applyEvent`. `_transport_*` per pipeline-signal-tagged
   * convention — internal state, never read by templates.
   *
   * Synced to the stream's length when the orchestrator wipes the
   * stream (`_eventStream.set([])` on rematch / state-sync / seek);
   * the projection's own `applyReset` is fired in parallel by the
   * scope dispatcher, so the cursor + the value start fresh together.
   */
  private readonly _transport_streamCursor: StreamCursor = { value: 0 };

  /** Effect ref installed by `attachEventStream`. Held so a subsequent
   *  `attachEventStream` call (defensive — should not happen in
   *  production) or a manual `detachEventStream` can tear down the
   *  previous subscription explicitly. */
  private _transport_streamEffect: EffectRef | null = null;

  /**
   * β.3 Lot 1 — subscribe to the orchestrator's `eventStream` signal.
   * Delegates to `drainStream` (F11, 2026-05-31) — the same harness
   * used by `DuelGameLogService.attachEventStream`. See `drain-stream.ts`
   * for the idempotency + stream-wipe contract.
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
    this._transport_streamEffect = drainStream(
      stream,
      this._transport_streamCursor,
      event => this.applyEvent(event),
      injector,
    );
  }

  /** Tear down the `attachEventStream` subscription. Angular's
   *  `DestroyRef` would handle this on injector teardown, but holding
   *  the ref lets specs opt into explicit teardown and lets the
   *  orchestrator detach + re-attach if it ever needs to. */
  detachEventStream(): void {
    this._transport_streamEffect?.destroy();
    this._transport_streamEffect = null;
    this._transport_streamCursor.value = 0;
  }
}
