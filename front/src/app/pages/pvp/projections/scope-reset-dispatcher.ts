import { duelAssert } from '../../../core/utilities/duel-assert';

import type { BaseProjection } from './base-projection';
import type { CheckpointPayload } from './checkpoint-payload';
import {
  expandInvalidatedScopes,
  SCOPE_HIERARCHY,
  type ScopeCategory,
} from './scope';

/**
 * Central registry + dispatcher for {@link BaseProjection} resets.
 *
 * Cf. `_bmad-output/planning-artifacts/duel-session-chantier.md §3.5`.
 *
 * Responsibilities:
 *   1. Hold the set of projections instanciated for the current duel.
 *   2. On each reset event, fan-out `applyReset` to every projection
 *      whose declared {@link BaseProjection.scope} lies in the
 *      *expanded* invalidated-scope set (see
 *      {@link expandInvalidatedScopes} — invalidating a scope implicitly
 *      invalidates every scope below it in {@link SCOPE_HIERARCHY}).
 *   3. Refuse — in dev mode — to register a projection that did not
 *     declare a valid scope. `duelAssert` lets the lint α.1 stay the
 *     compile-time guard while the dispatcher stays the runtime guard.
 */
export class ScopeResetDispatcher {
  // _transport_*: internal registry — never read by UI templates, never
  // exposed as a projection / @Environment input.
  private readonly _transport_projections = new Set<BaseProjection<unknown>>();

  /**
   * Register a projection. Idempotent: re-registering the same
   * projection instance is a no-op (set semantics).
   *
   * Throws (dev) / logs (prod) if the projection's scope is not a
   * known {@link ScopeCategory}.
   */
  register(p: BaseProjection<unknown>): void {
    duelAssert(
      SCOPE_HIERARCHY.includes(p.scope),
      'ScopeResetDispatcher.register',
      `projection ${p.constructor.name} declared invalid scope ${String(p.scope)}`,
    );
    this._transport_projections.add(p);
  }

  /**
   * Drop a projection from the registry. Used when a projection's host
   * (typically a component / service scoped to a duel page) tears down.
   * Calling unregister on an unknown projection is a silent no-op.
   */
  unregister(p: BaseProjection<unknown>): void {
    this._transport_projections.delete(p);
  }

  /**
   * Dispatch a reset to every projection whose scope is in the
   * (expanded) invalidated set.
   *
   * - `invalidatedScopes` is the *top-most* set the caller wants to
   *   invalidate. The dispatcher expands it down the hierarchy before
   *   fan-out so callers can pass `{ DUEL_LIFETIME }` and have
   *   `CONNECTION_LIFETIME` + `PERSPECTIVE_LIFETIME` invalidated
   *   automatically (cf. §3.5 expected invalidation matrix).
   * - `payload` is forwarded as-is to every projection. Pass it only
   *   for §3.6 checkpoint events (`STATE_SYNC`, `RematchStarted`).
   */
  dispatch(
    invalidatedScopes: ReadonlySet<ScopeCategory>,
    payload?: CheckpointPayload,
  ): void {
    if (invalidatedScopes.size === 0) return;
    const expanded = expandInvalidatedScopes(invalidatedScopes);
    for (const p of this._transport_projections) {
      if (!expanded.has(p.scope)) continue;
      p.applyReset(expanded, payload);
    }
  }

  /**
   * Test-only inspection: how many projections are currently registered.
   * Not exposed for runtime consumers — projections lookup by scope is
   * intentionally NOT provided (the dispatcher is dispatch-only).
   */
  get size(): number {
    return this._transport_projections.size;
  }
}
