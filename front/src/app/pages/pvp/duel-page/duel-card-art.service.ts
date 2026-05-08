import { Injectable } from '@angular/core';

const CARD_BACK = 'assets/images/card_back.jpg';

@Injectable()
export class DuelCardArtService {
  private artMap = new Map<number, string>();
  /** Card codes already requested via prefetchCard. Combined with the long-lived
   *  Cache-Control headers on /api/documents (P1), this guarantees each card is
   *  fetched at most once per browser session. */
  private readonly prefetched = new Set<number>();

  setArtMap(map: Map<number, string>): void {
    this.artMap = map;
  }

  resolveUrl(cardCode: number | null | undefined): string {
    if (!cardCode) return CARD_BACK;
    return this.artMap.get(cardCode) ?? `/api/documents/small/code/${cardCode}`;
  }

  /** Fire-and-forget prefetch. Idempotent: each cardCode is requested at most
   *  once per service instance. Safe to call on every message a server sends —
   *  duplicates are filtered cheaply. */
  prefetchCard(cardCode: number | null | undefined): void {
    if (!cardCode || this.prefetched.has(cardCode)) return;
    this.prefetched.add(cardCode);
    const img = new Image();
    img.src = this.resolveUrl(cardCode);
  }

  /** Bulk variant for arrays / board state walks. */
  prefetchCards(codes: ReadonlyArray<number | null | undefined>): void {
    for (const c of codes) this.prefetchCard(c);
  }
}
