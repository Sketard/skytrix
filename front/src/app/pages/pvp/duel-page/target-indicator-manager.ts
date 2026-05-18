import { inject, Injectable, OnDestroy } from '@angular/core';
import type { BecomeTargetMsg } from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';
import type { ZoneId } from '../duel-ws-shared.types';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelContext } from './duel-context';
import {
  TARGET_PILE_FLOAT_CASCADE_X_PX,
  TARGET_PILE_FLOAT_CASCADE_Y_PX,
  TARGET_PILE_FLOAT_ENTER_MS,
  TARGET_PILE_FLOAT_FADE_OUT_MS,
} from './animation-constants';

interface TrackedFloat {
  el: HTMLDivElement;
  zoneKey: string;
}

/**
 * Surfaces MSG_BECOME_TARGET feedback for cards inside pile zones (GY, Banished,
 * Extra Deck). Pile zones only render their top card, so the existing
 * `.zone-card--targeted` reticle on `.zone-card` cannot point at sequence > 0
 * cards. This manager creates floating clones above the pile, in cascade.
 *
 * The newest float is "active" (full reticle + crosshair via `pvp-reticle-appear`).
 * Older floats demote to "demoted" (red halo only). All floats fade out at cleanup.
 *
 * Field-zone targets remain handled by the orchestrator's existing
 * `targetedZoneKeys` signal binding on `.zone-card--targeted`.
 */
@Injectable()
export class TargetIndicatorManager implements OnDestroy {
  private readonly cardTravelEngine = inject(CardTravelEngine);
  private readonly boardEffects = inject(BoardEffectsService);
  private readonly artService = inject(DuelCardArtService);
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly ctx = inject(DuelContext);

  private floats: TrackedFloat[] = [];
  private readonly floatsByZone = new Map<string, TrackedFloat[]>();
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Spawns target floats for every pile-located target in `msg.cards`.
   * Field-located targets are ignored (handled by orchestrator's signal).
   */
  spawnPileFloats(msg: BecomeTargetMsg): void {
    const ownIdx = this.ctx.ownPlayerIndex();
    const board = this.dataSource.renderedBoardState.renderedState();

    for (const target of msg.cards) {
      const zoneId = pileZoneIdFromLocation(target.location);
      if (!zoneId) continue; // field zones handled elsewhere
      const relPlayer = target.player === ownIdx ? 0 : 1;
      const zoneKey = `${zoneId}-${relPlayer}`;

      // renderedState().players is swapped to the current perspective
      // (players[0] = self, players[1] = opponent), so we must index by the
      // *relative* player, not the absolute OCGCore index. Otherwise — when
      // the perspective is OCGCore player 1 (toggled in replay or playing as
      // P1 in PvP) — `target.player=1` reads player 0's zones, the card is
      // missed and the float falls back to CARD_BACK.
      const playerZones = board.players[relPlayer]?.zones ?? [];
      const zone = playerZones.find(z => z.zoneId === zoneId);
      const card = zone?.cards[target.sequence];

      // Banished face-down cards exist; show card back. Missing payload (server
      // bug or race) → show card back rather than crash. cardCode null → back.
      const isFaceDown = card
        ? (card.position & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0
        : false;
      const resolvedCode = isFaceDown ? null : (card?.cardCode ?? null);
      const cardImage = this.cardTravelEngine.toAbsoluteUrl(this.artService.resolveUrl(resolvedCode));

      const cascadeIndex = (this.floatsByZone.get(zoneKey)?.length ?? 0);
      const el = this.boardEffects.createTargetFloat(
        zoneKey,
        cardImage,
        cascadeIndex,
        TARGET_PILE_FLOAT_CASCADE_Y_PX,
        TARGET_PILE_FLOAT_CASCADE_X_PX,
        TARGET_PILE_FLOAT_ENTER_MS,
      );
      if (!el) continue;

      // Demote previous active float on this zone, then mark new one active.
      this.demoteAllOnZone(zoneKey);
      el.classList.add('target-float', 'target-float--active');

      const tracked: TrackedFloat = { el, zoneKey };
      this.floats.push(tracked);
      const list = this.floatsByZone.get(zoneKey) ?? [];
      list.push(tracked);
      this.floatsByZone.set(zoneKey, list);
    }
  }

  /**
   * Schedule cleanup `durationMs` from now. Cancels any previous pending cleanup
   * — back-to-back MSG_BECOME_TARGET (same chain, sequenced through the
   * animation queue) accumulate floats in the cascade until the LAST message
   * times out, instead of each timer wiping the previous spawn.
   *
   * `spawnSeq` increments on every spawn; the cleanup callback only fires if
   * the seq it captured still matches at run-time. A new spawn between the
   * timer's expiry and its callback execution (microtask race when MSG arrives
   * exactly at `durationMs`) bumps the seq and the stale callback is skipped.
   */
  private spawnSeq = 0;

  scheduleCleanup(durationMs: number): void {
    if (this.cleanupTimer !== null) clearTimeout(this.cleanupTimer);
    const mySeq = ++this.spawnSeq;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      if (mySeq !== this.spawnSeq) return; // a newer spawn invalidated us
      this.cleanup();
    }, durationMs);
  }

  /** Fade-out + remove all tracked floats. Idempotent. */
  cleanup(): void {
    for (const { el } of this.floats) {
      this.boardEffects.fadeOutAndRemoveTargetFloat(el, TARGET_PILE_FLOAT_FADE_OUT_MS);
    }
    this.floats = [];
    this.floatsByZone.clear();
  }

  /** Immediate cleanup without fade (reset / disconnect / destroy paths). */
  reset(): void {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const { el } of this.floats) {
      this.boardEffects.removeTargetFloat(el);
    }
    this.floats = [];
    this.floatsByZone.clear();
  }

  ngOnDestroy(): void {
    this.reset();
  }

  private demoteAllOnZone(zoneKey: string): void {
    const list = this.floatsByZone.get(zoneKey);
    if (!list) return;
    for (const { el } of list) {
      el.classList.remove('target-float--active');
      el.classList.add('target-float--demoted');
    }
  }
}

function pileZoneIdFromLocation(location: number): ZoneId | null {
  if (location === LOCATION.GRAVE) return 'GY';
  if (location === LOCATION.BANISHED) return 'BANISHED';
  if (location === LOCATION.EXTRA) return 'EXTRA';
  return null;
}
