import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal } from '@angular/core';
import { CardOnField, ZoneId } from '../../duel-ws.types';
import { getCardImageUrlByCode } from '../../pvp-card.utils';

@Component({
  selector: 'app-pvp-zone-browser-overlay',
  templateUrl: './pvp-zone-browser-overlay.component.html',
  styleUrl: './pvp-zone-browser-overlay.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpZoneBrowserOverlayComponent {
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly zoneId = input.required<ZoneId>();
  readonly cards = input<CardOnField[]>([]);
  readonly playerIndex = input<number>(0);
  readonly actionableCardCodes = input<Set<number>>(new Set());
  readonly mode = input<'browse' | 'action'>('browse');

  readonly inspectCard = output<number>();
  readonly actionSelected = output<{ cardCode: number; element: HTMLElement }>();
  readonly closed = output<void>();

  readonly visible = signal(true);
  readonly isClosing = signal(false);

  readonly getCardImageUrlByCode = getCardImageUrlByCode;

  private outsideClickListener: ((e: MouseEvent) => void) | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.removeOutsideListener());
    setTimeout(() => {
      this.outsideClickListener = (event: MouseEvent) => {
        if (!this.el.nativeElement.contains(event.target as Node)) {
          this.close();
        }
      };
      document.addEventListener('click', this.outsideClickListener);
    });
  }

  isOpponentExtra(): boolean {
    return this.zoneId() === 'EXTRA' && this.playerIndex() === 1;
  }

  isCardActionable(card: CardOnField): boolean {
    return this.mode() === 'action' && card.cardCode !== null && this.actionableCardCodes().has(card.cardCode);
  }

  onCardClick(card: CardOnField, event: MouseEvent): void {
    if (!card.cardCode) return;

    if (this.mode() === 'action' && this.isCardActionable(card)) {
      this.actionSelected.emit({ cardCode: card.cardCode, element: event.currentTarget as HTMLElement });
    } else {
      this.inspectCard.emit(card.cardCode);
    }
  }

  // [L1 fix] Fade-out animation before removal
  close(): void {
    if (this.isClosing()) return;
    this.isClosing.set(true);
    this.removeOutsideListener();
    setTimeout(() => {
      this.visible.set(false);
      this.closed.emit();
    }, 150);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      event.preventDefault();
    }
  }

  private removeOutsideListener(): void {
    if (this.outsideClickListener) {
      document.removeEventListener('click', this.outsideClickListener);
      this.outsideClickListener = null;
    }
  }
}
