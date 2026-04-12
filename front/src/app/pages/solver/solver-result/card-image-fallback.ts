// =============================================================================
// card-image-fallback.ts — Shared <img> helpers for solver components that
// render card thumbnails. Owns the external CDN URL convention so it can be
// swapped (proxy, local cache, alt CDN) in one place.
// =============================================================================

const FALLBACK_SRC = 'assets/images/card_back.jpg';
const CARD_ART_CDN = 'https://images.ygoprodeck.com/images/cards_cropped';

export function cardArtUrl(cardId: number): string {
  return `${CARD_ART_CDN}/${cardId}.jpg`;
}

export function onCardImgError(event: Event): void {
  const img = event.target as HTMLImageElement;
  if (!img.src.endsWith('card_back.jpg')) {
    img.src = FALLBACK_SRC;
  }
}
