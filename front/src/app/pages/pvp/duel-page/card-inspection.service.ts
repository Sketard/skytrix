import { Injectable, signal } from '@angular/core';
import type { CardLiveOverlay, SharedCardInspectorData } from '../../../core/model/shared-card-data';
import type { CardOnField } from '../duel-ws.types';
import { diffTypeBitmask } from '../pvp-alteration.utils';
import { CardDataCacheService, CARD_BACK_PLACEHOLDER, UNKNOWN_CARD_PLACEHOLDER } from './card-data-cache.service';

function buildLiveOverlay(card: CardOnField | null | undefined): CardLiveOverlay | undefined {
  if (!card) return undefined;
  const typeDiff = diffTypeBitmask(card.currentType, card.baseType);
  if (typeDiff.added.length === 0 && typeDiff.removed.length === 0) return undefined;
  return {
    addedTypeLabels: typeDiff.added,
    removedTypeLabels: typeDiff.removed,
  };
}

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

  async inspectByCode(
    cardCode: number,
    forceExpanded = false,
    liveCard?: CardOnField | null,
  ): Promise<void> {
    this.inspectorForceExpanded.set(forceExpanded);
    const gen = ++this.inspectGeneration;

    if (!cardCode) {
      this.inspectedCard.set(CARD_BACK_PLACEHOLDER);
      return;
    }

    const data = await this.cardDataCache.getCardData(cardCode);
    if (this.inspectGeneration !== gen || !data) return;
    const liveOverlay = buildLiveOverlay(liveCard);
    this.inspectedCard.set(liveOverlay ? { ...data, liveOverlay } : data);
  }

  showUnknownCard(): void {
    this.inspectorForceExpanded.set(false);
    this.inspectedCard.set(UNKNOWN_CARD_PLACEHOLDER);
  }

  close(): void {
    this.inspectedCard.set(null);
  }
}
