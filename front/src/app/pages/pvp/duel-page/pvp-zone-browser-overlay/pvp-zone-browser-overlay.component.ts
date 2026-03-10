import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, signal } from '@angular/core';
import { CardOnField, ZoneId } from '../../duel-ws.types';
import { getCardImageUrlByCode } from '../../pvp-card.utils';
import { setupClickOutsideListener } from '../click-outside.utils';

const ZONE_SHORT_LABELS: Partial<Record<ZoneId, string>> = {
  GY: 'GY',
  BANISHED: 'BAN',
  EXTRA: 'ED',
};

const ZONE_ICON_PATHS: Partial<Record<ZoneId, string>> = {
  GY: 'assets/images/zones/gy.svg',
  BANISHED: 'assets/images/zones/banished.svg',
  EXTRA: 'assets/images/zones/extra.svg',
  DECK: 'assets/images/zones/deck.svg',
  HAND: 'assets/images/zones/hand.svg',
};


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
  readonly openId = input<number>(0);

  readonly inspectCard = output<number>();
  readonly closed = output<number>();

  readonly visible = signal(true);
  readonly isClosing = signal(false);
  readonly expanded = signal(false);

  readonly getCardImageUrlByCode = getCardImageUrlByCode;

  private removeOutsideListener: () => void;
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.closeTimeout) clearTimeout(this.closeTimeout);
    });
    this.removeOutsideListener = setupClickOutsideListener(this.el, this.destroyRef, () => this.close());

    // When the parent switches zone (new openId) on the same component instance,
    // cancel any pending close and reset state so the overlay stays visible.
    effect(() => {
      this.openId(); // track
      if (this.isClosing()) {
        if (this.closeTimeout) {
          clearTimeout(this.closeTimeout);
          this.closeTimeout = null;
        }
        this.isClosing.set(false);
        this.visible.set(true);
        this.expanded.set(false);
        // Re-register click-outside since the old one was torn down by close()
        this.removeOutsideListener();
        this.removeOutsideListener = setupClickOutsideListener(this.el, this.destroyRef, () => this.close());
      }
    });
  }

  get zoneLabel(): string {
    return ZONE_SHORT_LABELS[this.zoneId()] ?? this.zoneId();
  }

  get zoneIconPath(): string | null {
    return ZONE_ICON_PATHS[this.zoneId()] ?? null;
  }

  isOpponentExtra(): boolean {
    return this.zoneId() === 'EXTRA' && this.playerIndex() === 1;
  }

  onCardClick(card: CardOnField): void {
    if (!card.cardCode) return;
    this.inspectCard.emit(card.cardCode);
  }

  toggleExpanded(event: MouseEvent): void {
    event.stopPropagation();
    this.expanded.update(v => !v);
  }

  close(): void {
    if (this.isClosing()) return;
    const capturedOpenId = this.openId();
    this.isClosing.set(true);
    this.removeOutsideListener();
    this.closeTimeout = setTimeout(() => {
      this.visible.set(false);
      this.closed.emit(capturedOpenId);
    }, 150);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      event.preventDefault();
    }
  }
}
