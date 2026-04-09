import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { TranslatePipe } from '@ngx-translate/core';

import type { SolverResult, EndBoardCard } from '../../../core/model/solver.model';

// =============================================================================
// Chip Color Mapping
// =============================================================================

const CHIP_COLOR_MAP: Record<string, string> = {
  omniNegate: 'var(--solver-chip-negate)',
  typedNegate: 'var(--solver-chip-negate)',
  targetedNegate: 'var(--solver-chip-negate)',
  destruction: 'var(--solver-chip-removal)',
  banish: 'var(--solver-chip-removal)',
  banishFacedown: 'var(--solver-chip-removal)',
  sendToGy: 'var(--solver-chip-removal)',
  bounce: 'var(--solver-chip-control)',
  spin: 'var(--solver-chip-control)',
  controlChange: 'var(--solver-chip-control)',
  attach: 'var(--solver-chip-control)',
  moveToSt: 'var(--solver-chip-control)',
  floodgate: 'var(--solver-chip-disable)',
  flipFacedown: 'var(--solver-chip-disable)',
  handRip: 'var(--solver-chip-hand)',
};

const AMBER_COLOR = 'var(--solver-chip-disable)';

const DISPLAY_LABELS: Record<string, string> = {
  omniNegate: 'omni-negate',
  typedNegate: 'typed-negate',
  targetedNegate: 'targeted-negate',
  floodgate: 'floodgate',
  controlChange: 'control-change',
  banish: 'banish',
  banishFacedown: 'banish-fd',
  attach: 'attach',
  spin: 'spin',
  flipFacedown: 'flip-fd',
  destruction: 'destruction',
  moveToSt: 'move-to-st',
  bounce: 'bounce',
  handRip: 'hand-rip',
  sendToGy: 'send-to-gy',
};

// Weight order for badge: highest-weight effect shown on card badge
const EFFECT_WEIGHT_ORDER: readonly string[] = [
  'omniNegate', 'typedNegate', 'targetedNegate', 'floodgate',
  'controlChange', 'banish', 'banishFacedown', 'attach',
  'spin', 'flipFacedown', 'destruction', 'moveToSt',
  'bounce', 'handRip', 'sendToGy',
];

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
  readonly result = input.required<SolverResult>();
  readonly isPartial = input(false);
  readonly cardImageMap = input.required<Map<number, string>>();

  readonly hoverCard = signal<EndBoardCardDisplay | null>(null);
  private hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null;

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

  readonly ariaLabel = computed(() => {
    const count = this.totalInterruptions();
    const label = count === 1
      ? this.translate.instant('solver.result.interruptionSingular')
      : this.translate.instant('solver.result.interruptions');
    return `Score: ${this.result().score}, ${count} ${label}`;
  });

  onCardEnter(card: EndBoardCardDisplay): void {
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
    this.hoverCard.set(card);
  }

  onCardLeave(): void {
    this.hoverLeaveTimer = setTimeout(() => {
      this.hoverCard.set(null);
      this.hoverLeaveTimer = null;
    }, 80);
  }

  onPopupEnter(): void {
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
  }

  onCardImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith('card_back.jpg')) {
      img.src = 'assets/images/card_back.jpg';
    }
  }
}
