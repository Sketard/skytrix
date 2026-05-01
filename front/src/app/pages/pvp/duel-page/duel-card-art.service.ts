import { Injectable } from '@angular/core';

const CARD_BACK = 'assets/images/card_back.jpg';

@Injectable()
export class DuelCardArtService {
  private artMap = new Map<number, string>();

  setArtMap(map: Map<number, string>): void {
    this.artMap = map;
  }

  resolveUrl(cardCode: number | null | undefined): string {
    if (!cardCode) return CARD_BACK;
    return this.artMap.get(cardCode) ?? `/api/documents/small/code/${cardCode}`;
  }
}
