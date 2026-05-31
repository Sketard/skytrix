import { effect, type EffectRef, type Injector, type Signal } from '@angular/core';

/**
 * Mutable cursor tracking the prefix of an event stream already consumed
 * by a `drainStream` subscription. The harness advances `value` as events
 * are drained; the consumer holds a reference (typically via a private
 * field) so it can read or reset the cursor independently of the effect's
 * lifecycle.
 *
 * Carried as an object instead of a primitive because TypeScript has no
 * by-reference primitives; the wrapper mirrors what callers already did
 * by mutating `this._streamConsumedLength` in their own classes.
 */
export interface StreamCursor {
  /** Index of the last event consumed. Advances monotonically until the
   *  stream's length regresses (orchestrator wipe via `_eventStream.set([])`),
   *  at which point `drainStream` syncs it back to the new (smaller)
   *  length. */
  value: number;
}

/**
 * F11 (2026-05-31) — shared drain harness for the EventStream consumers
 * (`BaseProjection.attachEventStream` + `DuelGameLogService.attachEventStream`).
 * Subscribes to `stream` via an Angular `effect()` and feeds every
 * newly-pushed entry to `consume`, exactly once, in arrival order.
 *
 * The effect is idempotent across signal re-emits (the orchestrator may
 * publish the same array reference when an unrelated dependency changes
 * — defensive in practice). The `cursor` tracks the prefix already
 * consumed.
 *
 * **Stream-wipe path** : when `events.length < cursor.value` the
 * orchestrator called `_eventStream.set([])` (`resetAllState` —
 * rematch / state-sync / replay seek). Sync the cursor back to the
 * new length so the next push restarts from index 0. The consumer's
 * own external reset path (e.g. `BaseProjection.applyReset` for
 * projections, `DuelGameLogService.reset` for the journal) is
 * responsible for clearing the consumer-side state in parallel —
 * fired by the scope dispatcher or the orchestrator's reset chain.
 *
 * `injector` is required because the helper is callable outside an
 * injection context (`BaseProjection` is a plain class, instantiable
 * from tests). The returned `EffectRef` lets the caller destroy the
 * subscription explicitly (defensive re-attach or test teardown);
 * Angular's `DestroyRef` would handle it on injector teardown anyway.
 */
export function drainStream<E>(
  stream: Signal<readonly E[]>,
  cursor: StreamCursor,
  consume: (event: E) => void,
  injector: Injector,
): EffectRef {
  return effect(() => {
    const events = stream();
    if (events.length < cursor.value) {
      // Stream was wiped — sync the cursor back to the new length so the
      // next push restarts from the appropriate index. The consumer's
      // own reset path is fired in parallel by the scope dispatcher.
      cursor.value = events.length;
      return;
    }
    while (cursor.value < events.length) {
      consume(events[cursor.value]);
      cursor.value++;
    }
  }, { injector });
}
