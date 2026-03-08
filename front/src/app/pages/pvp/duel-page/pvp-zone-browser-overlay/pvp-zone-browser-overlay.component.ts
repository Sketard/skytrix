import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal } from '@angular/core';
import { CardOnField, ZoneId } from '../../duel-ws.types';
import { getCardImageUrlByCode } from '../../pvp-card.utils';
import { setupClickOutsideListener } from '../click-outside.utils';

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
  /** When true, cards array is reversed for display — sequence must be remapped */
  readonly reversed = input<boolean>(false);

  readonly inspectCard = output<number>();
  readonly actionSelected = output<{ cardCode: number; sequence: number; element: HTMLElement }>();
  readonly closed = output<void>();

  readonly visible = signal(true);
  readonly isClosing = signal(false);

  readonly getCardImageUrlByCode = getCardImageUrlByCode;

  private readonly removeOutsideListener: () => void;
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.closeTimeout) clearTimeout(this.closeTimeout);
    });
    this.removeOutsideListener = setupClickOutsideListener(this.el, this.destroyRef, () => this.close());
  }

  isOpponentExtra(): boolean {
    return this.zoneId() === 'EXTRA' && this.playerIndex() === 1;
  }

  isCardActionable(card: CardOnField): boolean {
    return this.mode() === 'action' && card.cardCode !== null && this.actionableCardCodes().has(card.cardCode);
  }

  onCardClick(card: CardOnField, index: number, event: MouseEvent): void {
    if (!card.cardCode) return;

    if (this.mode() === 'action' && this.isCardActionable(card)) {
      // When reversed, remap display index back to original OCGCore sequence
      const sequence = this.reversed() ? this.cards().length - 1 - index : index;
      this.actionSelected.emit({ cardCode: card.cardCode, sequence, element: event.currentTarget as HTMLElement });
    } else {
      this.inspectCard.emit(card.cardCode);
    }
  }

  // [L1 fix] Fade-out animation before removal
  close(): void {
    if (this.isClosing()) return;
    this.isClosing.set(true);
    this.removeOutsideListener();
    this.closeTimeout = setTimeout(() => {
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
}
