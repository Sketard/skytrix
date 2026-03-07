import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CardOnField } from '../../duel-ws.types';
import { getCardImageUrl } from '../../pvp-card.utils';

@Component({
  selector: 'app-pvp-hand-row',
  templateUrl: './pvp-hand-row.component.html',
  styleUrl: './pvp-hand-row.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpHandRowComponent {
  readonly side = input.required<'player' | 'opponent'>();
  readonly cards = input<CardOnField[]>([]);
  readonly actionableCardIndices = input<Set<number>>(new Set());

  readonly handCardAction = output<{ index: number; element: HTMLElement }>();
  readonly cardInspectRequest = output<{ cardCode: number }>();

  readonly needsOverlap = computed(() => this.cards().length >= 2);

  readonly overlapMargin = computed(() => {
    const count = this.cards().length;
    if (count < 2) return null;
    // Ratio of card height (card width ≈ height × 59/86)
    // Overlap scales proportionally with card size across all viewports
    let ratio: number;
    if (count <= 4) ratio = -0.33;
    else if (count <= 7) ratio = -0.41;
    else ratio = -0.41 - (count - 7) * 0.04;
    return `calc(var(--pvp-hand-card-height) * ${ratio})`;
  });

  private readonly FAN_MAX_ANGLE = 4;
  private readonly FAN_MAX_Y = 8;

  fanTransform(index: number): string {
    const count = this.cards().length;
    if (count <= 1) return '';
    const t = (index - (count - 1) / 2) / ((count - 1) / 2);
    const angle = t * this.FAN_MAX_ANGLE;
    const yOffset = Math.abs(t) * this.FAN_MAX_Y;
    const isPlayer = this.side() === 'player';
    const y = isPlayer ? yOffset : -yOffset;
    return `rotate(${angle}deg) translateY(${y}px)`;
  }

  readonly getCardImageUrl = getCardImageUrl;

  isPlayerSide(): boolean {
    return this.side() === 'player';
  }

  onCardTap(index: number, event: MouseEvent): void {
    const card = this.cards()[index];
    if (this.side() === 'player') {
      if (this.actionableCardIndices().has(index)) {
        this.handCardAction.emit({ index, element: event.currentTarget as HTMLElement });
      } else if (card?.cardCode) {
        this.cardInspectRequest.emit({ cardCode: card.cardCode });
      }
    } else {
      // Opponent hand: emit inspect (cardCode 0 → card back placeholder)
      this.cardInspectRequest.emit({ cardCode: card?.cardCode ?? 0 });
    }
  }
}
