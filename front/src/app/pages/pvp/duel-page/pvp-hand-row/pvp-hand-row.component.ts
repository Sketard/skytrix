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

  readonly needsOverlap = computed(() => this.cards().length >= 6);

  readonly overlapMargin = computed(() => {
    const count = this.cards().length;
    if (count < 6) return 0;
    // -16px base overlap, increasing by -4px per additional card beyond 6
    return -16 - (count - 6) * 4;
  });

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
