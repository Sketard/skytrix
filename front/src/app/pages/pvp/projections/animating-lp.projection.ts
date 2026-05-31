// =============================================================================
// animating-lp.projection.ts — β.3 Lot 2.2-REDO (2026-05-26)
// -----------------------------------------------------------------------------
// Tracks the LP counter animation triggered by `MSG_DAMAGE`,
// `MSG_RECOVER`, or `MSG_PAY_LPCOST`. The legacy
// `LpAnimationTracker.animatingLpPlayer` signal was the only obstacle
// preventing a pure projection: its content (`{ fromLp, toLp, type,
// durationMs }`) depended on `trackedLp` (manager state). β.3
// Standardisation 2 fixed this: the orchestrator decorates the LP
// event with `lpDelta: { fromLp, toLp, durationMs }` at push time
// (via `lpTracker.peekLpDelta`), so the projection reads everything
// it needs from the event itself.
//
// **Set paths**: MSG_DAMAGE / MSG_PAY_LPCOST → damage anim;
// MSG_RECOVER → recover anim. Each event carries `lpDelta` injected
// by `decorateLpEventForStream` on the orchestrator's push tap.
//
// **Clear paths**:
//   · `AnimationCompleted({msgType ∈ {MSG_DAMAGE, MSG_RECOVER,
//     MSG_PAY_LPCOST}})` — runner emits this when the handler's
//     `baseLpDuration` hold elapses (handler returns `baseLpDuration`).
//   · `applyReset` — §3.6 cascade cleanup.
//
// **Scope**: `PERSPECTIVE_LIFETIME`. Cleared on perspective switch
// (mirror of the legacy `LpAnimationTracker.applyReset` branch on the
// `animatingLpPlayer` slice).
//
// **Why `player` stays ABSOLUTE in the output**: the legacy `LpAnimData`
// surface forwarded `msg.player` unchanged (absolute index 0|1 from
// the server). The `pvp-lp-badge` component then computes side
// internally via its `[side]` input. The projection preserves the
// same contract — no `relativePlayer` mapping needed.
// =============================================================================

import { signal, type Signal } from '@angular/core';

import type { DamageMsg, PayLpCostMsg, RecoverMsg } from '../duel-ws.types';

import { BaseProjection } from './base-projection';
import type { FluxEvent } from './flux-event';
import type { ScopeCategory } from './scope';

/** Output shape — kept identical to the legacy
 *  `pvp-lp-badge.LpAnimData` so templates don't need to change. */
export interface LpAnimData {
  player: number;
  fromLp: number;
  toLp: number;
  type: 'damage' | 'recover';
  durationMs: number;
}

const LP_MSG_TYPES = new Set([
  'MSG_DAMAGE',
  'MSG_RECOVER',
  'MSG_PAY_LPCOST',
]);

/** Event decorated by `decorateLpEventForStream` (orchestrator side-tap). */
type DecoratedLpEvent =
  | (DamageMsg & { lpDelta: { fromLp: number; toLp: number; durationMs: number } })
  | (RecoverMsg & { lpDelta: { fromLp: number; toLp: number; durationMs: number } })
  | (PayLpCostMsg & { lpDelta: { fromLp: number; toLp: number; durationMs: number } });

export class AnimatingLpProjection extends BaseProjection<LpAnimData | null> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _data = signal<LpAnimData | null>(null);
  override readonly value: Signal<LpAnimData | null> = this._data.asReadonly();

  override applyEvent(event: FluxEvent): void {
    const candidate = event as { kind?: string; type?: string; msgType?: string };

    // AnimationCompleted on an LP msg → clear.
    if (candidate.kind === 'animation' && candidate.type === 'AnimationCompleted'
        && candidate.msgType && LP_MSG_TYPES.has(candidate.msgType)) {
      this._data.set(null);
      return;
    }

    // MSG_DAMAGE / MSG_PAY_LPCOST → damage anim; MSG_RECOVER → recover anim.
    if (candidate.type === 'MSG_DAMAGE' || candidate.type === 'MSG_PAY_LPCOST') {
      const msg = event as DecoratedLpEvent;
      if (!msg.lpDelta) return; // not decorated (defensive — should never happen for real LP msgs)
      this._data.set({
        player: msg.player,
        fromLp: msg.lpDelta.fromLp,
        toLp: msg.lpDelta.toLp,
        type: 'damage',
        durationMs: msg.lpDelta.durationMs,
      });
      return;
    }
    if (candidate.type === 'MSG_RECOVER') {
      const msg = event as DecoratedLpEvent;
      if (!msg.lpDelta) return;
      this._data.set({
        player: msg.player,
        fromLp: msg.lpDelta.fromLp,
        toLp: msg.lpDelta.toLp,
        type: 'recover',
        durationMs: msg.lpDelta.durationMs,
      });
    }
  }

  override applyReset(_invalidatedScopes: ReadonlySet<ScopeCategory>): void {
    this._data.set(null);
  }
}
