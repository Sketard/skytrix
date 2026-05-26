// =============================================================================
// chain-resolution-announce.projection.ts — β.3 Lot 3.2-REDO (2026-05-26)
// -----------------------------------------------------------------------------
// Tracks whether the "Chain Resolution" banner is currently being
// announced — a brief pause before the first link of a multi-link chain
// starts resolving. While true, `pvp-chain-overlay` hides itself
// (Effect D) so the banner is visible against the board.
//
// **Set path**: `AnimationPhaseCompleted({phase: 'banner-announce',
// msgType: 'MSG_CHAIN_SOLVING'})` — emitted by the orchestrator via a
// `setTimeout(pauseMs)` mirror of the manager's
// `scheduleBannerAnnounce`. The two callbacks fire in the same tick
// (same wall-clock pauseMs), so the projection flips reactive at
// approximately the same moment the manager's private
// `_announcePending` flips synchronous.
//
// **Clear path**:
//   · `MSG_CHAIN_END` — chain over, banner no longer relevant.
//   · `applyReset` — §3.6 cascade cleanup (rematch / state-sync /
//     destroy / perspective switch).
//
// **Scope**: `PERSPECTIVE_LIFETIME`. Presentation surface that resets
// on perspective switch (same as the legacy
// `chainManager.chainResolutionAnnounce` signal which lives on a
// `PERSPECTIVE_LIFETIME`-scoped manager).
//
// **Why not boundary `ChainEnded`?** The boundary event fires alongside
// MSG_CHAIN_END (BoundaryProcessor observes MSG_CHAIN_END FIRST and
// emits `ChainEnded` before the message reaches `processEvent`). Either
// would work — MSG_CHAIN_END is chosen because it's the same event the
// manager's `handleEnd → reset` reacts to, keeping the two cleanup
// paths synchronised.
//
// **Dual-purpose state caveat** — the legacy
// `chainManager.chainResolutionAnnounce` signal was DUAL-USE:
//   1. Reactive UI gate (Effect D + templates) → migrated here.
//   2. Sync predicate inside `ChainResolutionManager.handleSolving`
//      (deferred-banner branch at the chainIndex>0 first-link of a
//      multi-link chain) → stays in the manager as a private
//      `_announcePending: boolean`, fed by the same timer.
// Both mechanisms flip on the same `pauseMs` setTimeout pair; the
// invariant is that they agree within a tick. See
// `chain-resolution-manager.ts` for the manager-side state, and
// `animation-orchestrator.service.ts handleChainSolving` for the
// parallel phase emission.
// =============================================================================

import { signal, type Signal } from '@angular/core';

import { BaseProjection } from './base-projection';
import type { CheckpointPayload } from './checkpoint-payload';
import type { FluxEvent } from './flux-event';
import type { ScopeCategory } from './scope';

export class ChainResolutionAnnounceProjection extends BaseProjection<boolean> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _announcing = signal<boolean>(false);
  override readonly value: Signal<boolean> = this._announcing.asReadonly();

  override applyEvent(event: FluxEvent): void {
    const candidate = event as { kind?: string; type?: string; msgType?: string; phase?: string };

    if (candidate.kind === 'animation' && candidate.type === 'AnimationPhaseCompleted'
        && candidate.msgType === 'MSG_CHAIN_SOLVING' && candidate.phase === 'banner-announce') {
      this._announcing.set(true);
      return;
    }

    if (candidate.type === 'MSG_CHAIN_END') {
      this._announcing.set(false);
    }
  }

  override applyReset(
    _invalidatedScopes: ReadonlySet<ScopeCategory>,
    _checkpointPayload?: CheckpointPayload,
  ): void {
    this._announcing.set(false);
  }
}
