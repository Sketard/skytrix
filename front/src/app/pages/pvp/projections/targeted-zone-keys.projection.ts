// =============================================================================
// targeted-zone-keys.projection.ts — β.3 Lot 4.1-REDO (2026-05-26)
// -----------------------------------------------------------------------------
// Tracks the set of FIELD zone keys (`${zoneId}-${relPlayer}`) currently
// targeted by a MSG_BECOME_TARGET cascade. Pile-zone targets (GY/Banished/
// Extra) are NOT in this set — they are surfaced as float overlays by
// `TargetIndicatorManager`, since pile zones only render their top card.
//
// **Set path**: `MSG_BECOME_TARGET` → for each card in `msg.cards` whose
// location is MZONE or SZONE, add `${locationToZoneKey(...)}` to the
// running set. Accumulation (union) is REQUIRED: back-to-back
// MSG_BECOME_TARGET (one per card, common when an effect targets a
// group) must keep all reticles visible together, not replace.
//
// **Clear path** (β.3 Standardisation 1):
//   · `AnimationPhaseCompleted({phase: 'reticle-pulse', msgType:
//     'MSG_BECOME_TARGET'})` — emitted by the handler via
//     `phaseWait('reticle-pulse', holdMs, 'MSG_BECOME_TARGET')` at the
//     end of the pulse hold (before the queue advances to the next
//     prompt). Aligns with the legacy `setTimeout(holdMs)` clear that
//     lived inline.
//   · `applyReset` — §3.6 cascade cleanup.
//
// **Scope**: `PERSPECTIVE_LIFETIME`. Presentation surface that resets
// on perspective switch.
//
// **Why not AnimationCompleted?** Because the handler keeps the queue
// busy past the reticle pulse (for the pile-float fade-out), but the
// reticle on FIELD zones must vanish at the END OF THE PULSE — i.e.
// at the sub-phase boundary, not when the whole handler resolves.
// =============================================================================

import { signal, type Signal } from '@angular/core';

import type { BecomeTargetMsg } from '../duel-ws.types';
import { LOCATION } from '../duel-ws.types';
import { locationToZoneKey } from '../pvp-zone.utils';

import { BaseProjection } from './base-projection';
import type { CheckpointPayload } from './checkpoint-payload';
import type { FluxEvent } from './flux-event';
import type { ScopeCategory } from './scope';

export interface TargetedZoneKeysProjectionDeps {
  /** Maps absolute player index (0|1) → relative (0=viewer, 1=opponent). */
  relativePlayer: (absolute: number) => 0 | 1;
}

export class TargetedZoneKeysProjection extends BaseProjection<ReadonlySet<string>> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _keys = signal<ReadonlySet<string>>(new Set());
  override readonly value: Signal<ReadonlySet<string>> = this._keys.asReadonly();

  constructor(private readonly deps: TargetedZoneKeysProjectionDeps) {
    super();
  }

  override applyEvent(event: FluxEvent): void {
    const candidate = event as { kind?: string; type?: string; msgType?: string; phase?: string };

    if (candidate.kind === 'animation' && candidate.type === 'AnimationPhaseCompleted'
        && candidate.msgType === 'MSG_BECOME_TARGET' && candidate.phase === 'reticle-pulse') {
      this._keys.set(new Set());
      return;
    }

    if (candidate.type === 'MSG_BECOME_TARGET') {
      const msg = event as BecomeTargetMsg;
      const next = new Set<string>(this._keys());
      for (const c of msg.cards) {
        if (c.location === LOCATION.MZONE || c.location === LOCATION.SZONE) {
          const rel = this.deps.relativePlayer(c.player);
          next.add(locationToZoneKey(c.location, c.sequence, rel));
        }
      }
      this._keys.set(next);
    }
  }

  override applyReset(
    _invalidatedScopes: ReadonlySet<ScopeCategory>,
    _checkpointPayload?: CheckpointPayload,
  ): void {
    this._keys.set(new Set());
  }
}
