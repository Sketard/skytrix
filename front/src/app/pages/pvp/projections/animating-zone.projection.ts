// =============================================================================
// animating-zone.projection.ts — β.3 Lot 2.6 (2026-05-26)
// -----------------------------------------------------------------------------
// Tracks the field zone whose card is currently playing a `flip` or
// `activate` animation. Consumed by `pvp-board-container` to apply the
// `.pvp-anim-flip` / `.pvp-anim-activate` CSS classes on the matching
// zone for the duration of the animation.
//
// **Source events**:
//   · `MSG_FLIP_SUMMONING` → flip animation on the summoned card's zone.
//   · `MSG_CHANGE_POS` (face-down → face-up) → flip animation.
//   · `MSG_CHAINING` (with a zoneId) → activate animation on the chained
//     card's zone (spell/trap activation glow).
//
// **Clear path**: `AnimationCompleted({msgType ∈ {MSG_FLIP_SUMMONING,
// MSG_CHANGE_POS, MSG_CHAINING}})` — runner emits this at the
// wall-clock end of the handler's hold duration (POSITION_FLIP_MS,
// CHAIN_ACTIVATE_MS + hold). Aligns with the legacy defensive `set(null)`
// at runner onStepSettled / onFinalize / group end.
//
// **Scope**: `PERSPECTIVE_LIFETIME`. The animation is a presentation
// surface and resets on perspective switch.
//
// **MSG_CHANGE_POS narrowing**: only the face-down → face-up case
// triggers the flip animation; other position changes (atk → def, def →
// atk) play a CSS rotation handled elsewhere. The projection narrows
// on `previousPosition` + `currentPosition` to match the legacy
// `handleChangePos` branch.
//
// **MSG_CHAINING narrowing**: the legacy handler only set the
// animatingZone when `locationToZoneId(msg.location, msg.sequence)`
// returned a non-empty key — i.e. cards activated from FIELD zones, not
// from HAND. The projection re-evaluates the same key resolution and
// skips if it returns null/empty (HAND-activated cards already show via
// `boardEffects.activateEffect` on the hand element).
// =============================================================================

import { signal, type Signal } from '@angular/core';

import type {
  ChainingMsg,
  ChangePosMsg,
  FlipSummoningMsg,
} from '../duel-ws.types';
import { POSITION } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';

import { BaseProjection } from './base-projection';
import type { FluxEvent } from './flux-event';
import type { ScopeCategory } from './scope';

export interface AnimatingZoneData {
  zoneId: string;
  animationType: 'flip' | 'activate';
  relativePlayerIndex: number;
}

const CLEAR_MSG_TYPES = new Set([
  'MSG_FLIP_SUMMONING',
  'MSG_CHANGE_POS',
  'MSG_CHAINING',
]);

export interface AnimatingZoneProjectionDeps {
  /** Maps absolute player index (0|1) → relative (0=viewer, 1=opponent). */
  relativePlayer: (absolute: number) => 0 | 1;
}

export class AnimatingZoneProjection extends BaseProjection<AnimatingZoneData | null> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _zone = signal<AnimatingZoneData | null>(null);
  override readonly value: Signal<AnimatingZoneData | null> = this._zone.asReadonly();

  constructor(private readonly deps: AnimatingZoneProjectionDeps) {
    super();
  }

  override applyEvent(event: FluxEvent): void {
    const candidate = event as { kind?: string; type?: string; msgType?: string };

    // AnimationCompleted on one of the 3 source msgType → clear.
    if (candidate.kind === 'animation' && candidate.type === 'AnimationCompleted'
        && candidate.msgType && CLEAR_MSG_TYPES.has(candidate.msgType)) {
      this._zone.set(null);
      return;
    }

    if (candidate.type === 'MSG_FLIP_SUMMONING') {
      const msg = event as FlipSummoningMsg;
      const zoneId = locationToZoneId(msg.location, msg.sequence);
      if (!zoneId) return;
      this._zone.set({
        zoneId,
        animationType: 'flip',
        relativePlayerIndex: this.deps.relativePlayer(msg.player),
      });
      return;
    }

    if (candidate.type === 'MSG_CHANGE_POS') {
      const msg = event as ChangePosMsg;
      // Narrow on face-down → face-up; the only branch that triggers a flip.
      const wasFaceDown = (msg.previousPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
      const nowFaceUp = (msg.currentPosition & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
      if (!(wasFaceDown && nowFaceUp)) return;
      const zoneId = locationToZoneId(msg.location, msg.sequence);
      if (!zoneId) return;
      this._zone.set({
        zoneId,
        animationType: 'flip',
        relativePlayerIndex: this.deps.relativePlayer(msg.player),
      });
      return;
    }

    if (candidate.type === 'MSG_CHAINING') {
      const msg = event as ChainingMsg;
      const zoneId = locationToZoneId(msg.location, msg.sequence);
      if (!zoneId) return;
      this._zone.set({
        zoneId,
        animationType: 'activate',
        relativePlayerIndex: this.deps.relativePlayer(msg.player),
      });
    }
  }

  override applyReset(_invalidatedScopes: ReadonlySet<ScopeCategory>): void {
    this._zone.set(null);
  }
}
