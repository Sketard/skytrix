// =============================================================================
// swap-grave-deck.projection.ts — β.3 Lot 2.4-REDO (2026-05-26)
// -----------------------------------------------------------------------------
// Tracks the GY + DECK zone keys pulsing during a `MSG_SWAP_GRAVE_DECK`
// glow sub-phase. The swap handler has TWO phases:
//   1. **glow** (SWAP_GRAVE_DECK_GLOW_MS) — both zones light up.
//   2. **travel** (SWAP_GRAVE_DECK_TRAVEL_MS) — a card-back travels
//      DECK → GY.
// The pulse must clear AT THE END OF PHASE 1 (before phase 2 starts),
// not at the end of the whole animation — otherwise the pulse keeps
// flashing while the travel plays.
//
// **Set path**: `MSG_SWAP_GRAVE_DECK` → compute `{GY-rel, DECK-rel}`
// keys (with `reducedMotion` gate — handler returns 0, projection
// ignores).
//
// **Clear path** (β.3 Standardisation 1):
//   · `AnimationPhaseCompleted({phase: 'glow', msgType:
//     'MSG_SWAP_GRAVE_DECK'})` — emitted by the handler via
//     `phaseWait('glow', glowMs, 'MSG_SWAP_GRAVE_DECK')` at the
//     boundary between phase 1 and phase 2. Aligns with the legacy
//     setTimeout(holdMs) clear that lived inline.
//   · `applyReset` — §3.6 cascade cleanup.
//
// **Scope**: `PERSPECTIVE_LIFETIME`. Presentation surface that resets
// on perspective switch.
//
// **Why not AnimationCompleted?** Because `AnimationCompleted` fires
// at the end of the WHOLE handler (after the travel resolves). The
// pulse is supposed to vanish before the travel starts. The
// `AnimationPhaseCompleted` event is the standardised mechanism for
// such sub-phase boundaries (β.3 Standardisation 1).
// =============================================================================

import { signal, type Signal } from '@angular/core';

import type { SwapGraveDeckMsg } from '../duel-ws.types';

import { BaseProjection } from './base-projection';
import type { CheckpointPayload } from './checkpoint-payload';
import type { FluxEvent } from './flux-event';
import type { ScopeCategory } from './scope';

export interface SwapGraveDeckProjectionDeps {
  /** Maps absolute player index (0|1) → relative (0=viewer, 1=opponent). */
  relativePlayer: (absolute: number) => 0 | 1;
  /** Reduced-motion gate. When true, the projection ignores
   *  MSG_SWAP_GRAVE_DECK entirely (the handler also short-circuits
   *  with return 0, so no AnimationPhaseCompleted will fire either). */
  reducedMotion: () => boolean;
}

export class SwapGraveDeckProjection extends BaseProjection<ReadonlySet<string>> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _keys = signal<ReadonlySet<string>>(new Set());
  override readonly value: Signal<ReadonlySet<string>> = this._keys.asReadonly();

  constructor(private readonly deps: SwapGraveDeckProjectionDeps) {
    super();
  }

  override applyEvent(event: FluxEvent): void {
    const candidate = event as { kind?: string; type?: string; msgType?: string; phase?: string };

    if (candidate.kind === 'animation' && candidate.type === 'AnimationPhaseCompleted'
        && candidate.msgType === 'MSG_SWAP_GRAVE_DECK' && candidate.phase === 'glow') {
      this._keys.set(new Set());
      return;
    }

    if (candidate.type === 'MSG_SWAP_GRAVE_DECK') {
      if (this.deps.reducedMotion()) return;
      const msg = event as SwapGraveDeckMsg;
      const rel = this.deps.relativePlayer(msg.player);
      // Force re-emit even when the same keys fire twice in a row
      // (defensive, mirrors the legacy double-set pattern at the
      // orchestrator handler).
      this._keys.set(new Set());
      this._keys.set(new Set([`GY-${rel}`, `DECK-${rel}`]));
    }
  }

  override applyReset(
    _invalidatedScopes: ReadonlySet<ScopeCategory>,
    _checkpointPayload?: CheckpointPayload,
  ): void {
    this._keys.set(new Set());
  }
}
