import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { TranslatePipe } from '@ngx-translate/core';

import type { SolverResult, EndBoardCard } from '../../../core/model/solver.model';
import {
  CHIP_COLOR_MAP,
  AMBER_COLOR,
  DISPLAY_LABELS,
  EFFECT_WEIGHT_ORDER,
} from './interruption-display';
import { onCardImgError } from './card-image-fallback';
import { createHoverPopupController } from './hover-popup.controller';

// =============================================================================
// Display Types
// =============================================================================

interface ChipDisplay {
  label: string;
  count: number;
  color: string;
  isAmber: boolean;
}

interface EndBoardCardDisplay {
  cardId: number;
  cardName: string;
  imageUrl: string;
  effects: EndBoardCard['effects'];
  isFallback: boolean;
  badgeLabel: string;
  /** Story 1.8: number of OPT effects this card has consumed during the
   *  recommended combo. Undefined or 0 means the card is fresh on the
   *  end board (no badge shown). */
  consumedUses?: number;
  /** Total OPT budget for the card (sum of effects.usesPerTurn). Used by the
   *  consumed-uses badge tooltip and as the denominator in "X/Y used". */
  totalUses?: number;
}

// =============================================================================
// Component
// =============================================================================

@Component({
  selector: 'app-hero-result-block',
  standalone: true,
  imports: [MatChipsModule, MatIconModule, MatTooltipModule, CdkConnectedOverlay, CdkOverlayOrigin, TranslatePipe],
  templateUrl: './hero-result-block.component.html',
  styleUrl: './hero-result-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroResultBlockComponent {
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  readonly result = input.required<SolverResult>();
  readonly isPartial = input(false);
  readonly cardImageMap = input.required<Map<number, string>>();

  private readonly hoverCtrl = createHoverPopupController<EndBoardCardDisplay>(this.destroyRef);
  readonly hoverCard = this.hoverCtrl.hoverKey;

  readonly totalInterruptions = computed(() => {
    const bd = this.result().scoreBreakdown;
    let count = 0;
    for (const key of EFFECT_WEIGHT_ORDER) {
      count += (bd as unknown as Record<string, number>)[key] ?? 0;
    }
    return count;
  });

  readonly interruptionChips = computed<ChipDisplay[]>(() => {
    const bd = this.result().scoreBreakdown;
    const chips: ChipDisplay[] = [];
    for (const key of EFFECT_WEIGHT_ORDER) {
      const count = (bd as unknown as Record<string, number>)[key];
      if (count > 0) {
        const color = CHIP_COLOR_MAP[key] ?? 'var(--solver-chip-hand)';
        chips.push({
          label: DISPLAY_LABELS[key] ?? key,
          count,
          color,
          isAmber: color === AMBER_COLOR,
        });
      }
    }
    return chips;
  });

  readonly endBoardDisplay = computed<EndBoardCardDisplay[]>(() => {
    const cards = this.result().endBoardCards ?? [];
    const imgMap = this.cardImageMap();
    return cards.map(card => {
      const imageUrl = imgMap.get(card.cardId) ?? 'assets/images/card_back.jpg';
      let badgeLabel = '';
      let totalUses: number | undefined;
      if (card.effects.length > 0) {
        // Pick the highest-weight effect for the badge
        let best = card.effects[0];
        let bestIdx = EFFECT_WEIGHT_ORDER.indexOf(best.type);
        if (bestIdx === -1) bestIdx = 999;
        for (let i = 1; i < card.effects.length; i++) {
          let idx = EFFECT_WEIGHT_ORDER.indexOf(card.effects[i].type);
          if (idx === -1) idx = 999;
          if (idx < bestIdx) {
            bestIdx = idx;
            best = card.effects[i];
          }
        }
        badgeLabel = `${DISPLAY_LABELS[best.type] ?? best.type} ×${best.usesPerTurn}`;
        // Story 1.8: total OPT budget = sum of effects.usesPerTurn. Used as
        // the denominator in the consumed-uses badge.
        totalUses = card.effects.reduce((sum, e) => sum + e.usesPerTurn, 0);
      }
      return {
        cardId: card.cardId,
        cardName: card.cardName,
        imageUrl,
        effects: card.effects,
        isFallback: card.isFallback,
        badgeLabel,
        consumedUses: card.consumedUses,
        totalUses,
      };
    });
  });

  readonly hasFallbackCards = computed(() => this.endBoardDisplay().some(c => c.isFallback));

  readonly isAdversarial = computed(() => this.result().minimax != null);

  readonly showMinimax = computed(() => this.isAdversarial() && this.result().minimax !== this.result().score);

  readonly ariaLabel = computed(() => {
    const count = this.totalInterruptions();
    const label = count === 1
      ? this.translate.instant('solver.result.interruptionSingular')
      : this.translate.instant('solver.result.interruptions');
    let aria = `Score: ${this.result().score}, ${count} ${label}`;
    if (this.showMinimax()) {
      aria += `. ${this.translate.instant('solver.result.worstCaseAria', { minimax: this.result().minimax })}`;
    }
    return aria;
  });

  onCardEnter(card: EndBoardCardDisplay): void {
    this.hoverCtrl.enter(card);
  }

  onCardLeave(): void {
    this.hoverCtrl.leave();
  }

  onPopupEnter(): void {
    this.hoverCtrl.popupEnter();
  }

  onCardImgError = onCardImgError;
}
