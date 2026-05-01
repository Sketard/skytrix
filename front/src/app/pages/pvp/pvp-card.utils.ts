import { POSITION, type PlayerBoardState } from './duel-ws.types';

/** Check if card is face-up (FACEUP_ATTACK or FACEUP_DEFENSE) */
export function isFaceUp(pos: number): boolean {
  return (pos & POSITION.FACEUP_ATTACK) !== 0 || (pos & POSITION.FACEUP_DEFENSE) !== 0;
}

/** Check if card is in defense position (FACEUP_DEFENSE or FACEDOWN_DEFENSE) */
export function isDefense(pos: number): boolean {
  return (pos & POSITION.FACEUP_DEFENSE) !== 0 || (pos & POSITION.FACEDOWN_DEFENSE) !== 0;
}

/** Build zone keys for face-down cards across the given player indices. */
export function buildFaceDownZoneKeys(players: PlayerBoardState[], indices: number[]): Set<string> {
  const keys = new Set<string>();
  for (const p of indices) {
    const player = players[p];
    if (!player) continue;
    for (const zone of player.zones) {
      for (const card of zone.cards) {
        if (card && (card.position === POSITION.FACEDOWN_ATTACK || card.position === POSITION.FACEDOWN_DEFENSE)) {
          keys.add(`${zone.zoneId}-${p}`);
        }
      }
    }
  }
  return keys;
}

/** Get card image URL — card back for hidden/null codes */
export function getCardImageUrl(card: { cardCode: number | null }): string {
  return getCardImageUrlByCode(card.cardCode);
}

/** Get card image URL by code number — card back for 0/null/falsy codes */
export function getCardImageUrlByCode(cardCode: number | null): string {
  if (!cardCode) {
    return 'assets/images/card_back.jpg';
  }
  return `/api/documents/small/code/${cardCode}`;
}

/**
 * Preload card images into the browser cache so subsequent `<img [src]>`
 * bindings display instantly. Returns a promise that resolves when all
 * images have loaded (or failed). Shared between PvP and replay.
 *
 * @param artMap Optional map of cardCode → smallUrl for custom art selections.
 *   When provided, the mapped URL is used instead of the default API URL.
 */
export function preloadCardImages(codes: readonly number[], artMap?: Map<number, string>): Promise<void[]> {
  const promises = codes.map(code => new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = artMap?.get(code) ?? getCardImageUrlByCode(code);
  }));
  return Promise.all(promises);
}
