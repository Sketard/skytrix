import { Injectable, signal } from '@angular/core';
import type { SharedCardInspectorData } from '../../../core/model/shared-card-data';
import { CardDataCacheService, CARD_BACK_PLACEHOLDER, UNKNOWN_CARD_PLACEHOLDER } from './card-data-cache.service';
import { getCardImageUrlByCode } from '../pvp-card.utils';

/**
 * Manages card inspection state: loading card data with generation-based
 * race protection, and exposing the inspected card signal.
 *
 * Provided at component level (NOT root).
 */
@Injectable()
export class CardInspectionService {
  // Injected via init()
  private cardDataCache!: CardDataCacheService;

  readonly inspectedCard = signal<SharedCardInspectorData | null>(null);
  // H3 fix: Force full mode when opening from long-press inspect
  readonly inspectorForceExpanded = signal(false);

  // L3 fix: Generation counter to prevent race conditions on rapid inspection
  private inspectGeneration = 0;

  /**
   * Must be called once to inject component-scoped CardDataCacheService.
   */
  init(cardDataCache: CardDataCacheService): void {
    this.cardDataCache = cardDataCache;
  }

  async inspectByCode(cardCode: number, forceExpanded = false): Promise<void> {
    this.inspectorForceExpanded.set(forceExpanded);
    const gen = ++this.inspectGeneration;

    if (!cardCode) {
      this.inspectedCard.set(CARD_BACK_PLACEHOLDER);
      return;
    }

    // Show image immediately while loading text details
    this.inspectedCard.set({
      name: '',
      imageUrl: getCardImageUrlByCode(cardCode),
      isMonster: false,
      isLink: false,
      hasDefense: false,
      displayAtk: '',
      displayDef: '',
      description: '',
    });

    const data = await this.cardDataCache.getCardData(cardCode);
    // L3 fix: Discard stale response if a newer inspection was triggered
    if (this.inspectGeneration === gen) {
      this.inspectedCard.set(data);
    }
  }

  showUnknownCard(): void {
    this.inspectorForceExpanded.set(false);
    this.inspectedCard.set(UNKNOWN_CARD_PLACEHOLDER);
  }

  close(): void {
    this.inspectedCard.set(null);
  }
}
