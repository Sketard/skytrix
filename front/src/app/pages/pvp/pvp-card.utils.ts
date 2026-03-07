import { POSITION } from './duel-ws.types';

/** Check if card is face-up (FACEUP_ATTACK or FACEUP_DEFENSE) */
export function isFaceUp(pos: number): boolean {
  return (pos & POSITION.FACEUP_ATTACK) !== 0 || (pos & POSITION.FACEUP_DEFENSE) !== 0;
}

/** Check if card is in defense position (FACEUP_DEFENSE or FACEDOWN_DEFENSE) */
export function isDefense(pos: number): boolean {
  return (pos & POSITION.FACEUP_DEFENSE) !== 0 || (pos & POSITION.FACEDOWN_DEFENSE) !== 0;
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
