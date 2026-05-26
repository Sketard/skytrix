// =============================================================================
// is-animating.projection.ts — β.3 Lot 3.1 (2026-05-26)
// -----------------------------------------------------------------------------
// Exposes the QueueRunner's `_isRunning` lifecycle as a read-only signal
// projected from the EventStream. The runner emits
// `InternalTransportEvent{kind:'runner-started'|'runner-stopped'}` which
// the orchestrator absorbs onto `_eventStream` via `pushToStream`
// (β.2a's W1 finding); this projection narrows on those two members and
// flips `value` accordingly.
//
// **Why a projection and not a direct read of the runner's flag?** The
// flag is transport state internal to the runner; the projection makes
// it a §3.5 PERSPECTIVE_LIFETIME projectable surface — uniform with the
// rest of the β.3 family. Consumers (templates, computed, effects) read
// `value()` without reaching into the runner.
//
// **Scope**: `PERSPECTIVE_LIFETIME` (same as the underlying
// `InternalTransportEvent` payload — see queue-runner-events.ts).
// `applyReset` forces `value=false`: any reset event implies the runner
// was (or should be) stopped. A subsequent fresh `runner-started`
// event flips it back to `true` if a new cycle begins.
//
// **Initial value**: `false`. Before the runner emits its first
// `runner-started`, no animation is in flight. Same default as the
// legacy `_isAnimating = signal(false)`.
//
// **Sync vs async timing note**: the legacy `_isAnimating.set(running)`
// was synchronous with the runner's flip (called from the same stack
// as `setRunning`). The projection reads the same flip through an
// Angular `effect()` subscribed to the stream — one micro-task lag.
// Audit during migration confirmed no consumer reads `value()`
// synchronously at the same tick as a `setRunning` call:
//   · PollDropWatchdog getter — fires on poll, not on flip.
//   · chain-resume effect — reactive to chainOverlayReady, not to runner.
//   · prompt-derivation computed — reactive.
//   · animation-bridge effect — reactive to logicalState.
// The two legacy `_isAnimating.set(false)` calls in `destroy()` /
// `resetAllState()` were redundant: the preceding
// `clearTimersAndPolling → runner.requestStop()` already flips via the
// runner callback. Both removed alongside this migration.
// =============================================================================

import { signal, type Signal } from '@angular/core';

import { BaseProjection } from './base-projection';
import type { CheckpointPayload } from './checkpoint-payload';
import type { FluxEvent } from './flux-event';
import type { ScopeCategory } from './scope';

export class IsAnimatingProjection extends BaseProjection<boolean> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _running = signal(false);
  override readonly value: Signal<boolean> = this._running.asReadonly();

  override applyEvent(event: FluxEvent): void {
    const candidate = event as { kind?: string };
    if (candidate.kind === 'runner-started') {
      this._running.set(true);
      return;
    }
    if (candidate.kind === 'runner-stopped') {
      this._running.set(false);
    }
  }

  override applyReset(
    _invalidatedScopes: ReadonlySet<ScopeCategory>,
    _checkpointPayload?: CheckpointPayload,
  ): void {
    this._running.set(false);
  }
}
