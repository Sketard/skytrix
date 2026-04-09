// =============================================================================
// card-image-fallback.ts — Shared <img> error handler used by every solver
// component that renders deck card thumbnails. Falls back to a generic card
// back image once, then stops to avoid infinite loops.
// =============================================================================

const FALLBACK_SRC = 'assets/images/card_back.jpg';

export function onCardImgError(event: Event): void {
  const img = event.target as HTMLImageElement;
  if (!img.src.endsWith('card_back.jpg')) {
    img.src = FALLBACK_SRC;
  }
}
