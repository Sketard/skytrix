import { Injectable } from '@angular/core';

import { duelAssert } from '../../../core/utilities/duel-assert';

import type { CheckpointPayload } from './checkpoint-payload';
import type { ResetTarget } from './reset-target';
import {
  expandInvalidatedScopes,
  SCOPE_HIERARCHY,
  type ScopeCategory,
} from './scope';

/**
 * Central registry + dispatcher for {@link ResetTarget} resets.
 *
 * Cf. `_bmad-output/planning-artifacts/duel-session-chantier.md §3.5`.
 *
 * Responsibilities:
 *   1. Hold the set of targets instanciated for the current duel.
 *   2. On each reset event, fan-out `applyReset` to every target
 *      whose declared {@link ResetTarget.scope} lies in the
 *      *expanded* invalidated-scope set (see
 *      {@link expandInvalidatedScopes} — invalidating a scope implicitly
 *      invalidates every scope below it in {@link SCOPE_HIERARCHY}).
 *   3. Refuse — in dev mode — to register a target that did not
 *     declare a valid scope. `duelAssert` lets the lint α.1 stay the
 *     compile-time guard while the dispatcher stays the runtime guard.
 *
 * The dispatcher accepts any {@link ResetTarget} — both the lightweight
 * managers that implement only the slim interface AND the future
 * `BaseProjection<T>` subclasses (which `implements ResetTarget`).
 *
 * Angular service: provided at the duel-page component level so each
 * duel-page mount gets a fresh dispatcher (and the registered targets
 * are garbage-collected with the page).
 */
@Injectable()
export class ScopeResetDispatcher {
  // _transport_*: internal registry — never read by UI templates, never
  // exposed as a projection / @Environment input.
  private readonly _transport_targets = new Set<ResetTarget>();

  /**
   * Register a target. Idempotent: re-registering the same target
   * instance is a no-op (set semantics).
   *
   * Throws (dev) / logs (prod) if the target's scope is not a known
   * {@link ScopeCategory}.
   */
  register(target: ResetTarget): void {
    duelAssert(
      SCOPE_HIERARCHY.includes(target.scope),
      'ScopeResetDispatcher.register',
      `target ${target.constructor.name} declared invalid scope ${String(target.scope)}`,
    );
    this._transport_targets.add(target);
  }

  /**
   * Drop a target from the registry. Used when its host (typically a
   * component / service scoped to a duel page) tears down. Calling
   * unregister on an unknown target is a silent no-op.
   */
  unregister(target: ResetTarget): void {
    this._transport_targets.delete(target);
  }

  /**
   * Dispatch a reset to every target whose scope is in the (expanded)
   * invalidated set.
   *
   * - `invalidatedScopes` is the *top-most* set the caller wants to
   *   invalidate. The dispatcher expands it down the hierarchy before
   *   fan-out so callers can pass `{ DUEL_LIFETIME }` and have
   *   `CONNECTION_LIFETIME` + `PERSPECTIVE_LIFETIME` invalidated
   *   automatically (cf. §3.5 expected invalidation matrix).
   * - `payload` is forwarded as-is to every target. Pass it only for
   *   §3.6 checkpoint events (`STATE_SYNC`, `RematchStarted`).
   */
  dispatch(
    invalidatedScopes: ReadonlySet<ScopeCategory>,
    payload?: CheckpointPayload,
  ): void {
    if (invalidatedScopes.size === 0) return;
    const expanded = expandInvalidatedScopes(invalidatedScopes);
    for (const target of this._transport_targets) {
      if (!expanded.has(target.scope)) continue;
      target.applyReset(expanded, payload);
    }
  }

  /**
   * Test-only inspection: how many targets are currently registered.
   * Not exposed for runtime consumers — target lookup by scope is
   * intentionally NOT provided (the dispatcher is dispatch-only).
   */
  get size(): number {
    return this._transport_targets.size;
  }
}
