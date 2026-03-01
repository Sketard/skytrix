import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CardDetail } from '../../../core/model/card-detail';
import type { CardDetailDTO } from '../../../core/model/dto/card-detail-dto';
import { SharedCardInspectorData, toSharedCardInspectorData } from '../../../core/model/shared-card-data';
import { getCardImageUrlByCode } from '../pvp-card.utils';

export const CARD_BACK_PLACEHOLDER: SharedCardInspectorData = {
  name: 'Face-down card',
  imageUrl: 'assets/images/card_back.jpg',
  isMonster: false,
  isLink: false,
  hasDefense: false,
  displayAtk: '',
  displayDef: '',
  description: '',
};

export const UNKNOWN_CARD_PLACEHOLDER: SharedCardInspectorData = {
  name: 'Unknown card',
  imageUrl: 'assets/images/card_back.jpg',
  isMonster: false,
  isLink: false,
  hasDefense: false,
  displayAtk: '',
  displayDef: '',
  description: '',
};

@Injectable()
export class CardDataCacheService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<number, SharedCardInspectorData>();

  async getCardData(cardCode: number): Promise<SharedCardInspectorData> {
    if (!cardCode) {
      return CARD_BACK_PLACEHOLDER;
    }

    const cached = this.cache.get(cardCode);
    if (cached) {
      return cached;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<CardDetailDTO>(`/api/cards/code/${cardCode}`)
      );
      const cardDetail = new CardDetail(response);
      const data = toSharedCardInspectorData(cardDetail);
      this.cache.set(cardCode, data);
      return data;
    } catch {
      // Don't cache errors — allow retry on next inspection
      return {
        ...CARD_BACK_PLACEHOLDER,
        name: `Card #${cardCode}`,
        imageUrl: getCardImageUrlByCode(cardCode),
      };
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}
