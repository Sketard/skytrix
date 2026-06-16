import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { CardOnField, ZoneId } from '../../duel-ws.types';
import { DuelCardArtService } from '../duel-card-art.service';
import { TranslatePipe } from '@ngx-translate/core';
import { setupClickOutsideListener } from '../click-outside.utils';
import { LongPressDirective } from '../long-press.directive';

const ZONE_SHORT_LABELS: Partial<Record<ZoneId, string>> = {
  GY: 'GY',
  BANISHED: 'BAN',
  EXTRA: 'ED',
  XYZ: 'XYZ',
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
  imports: [TranslatePipe, LongPressDirective],
})
export class PvpZoneBrowserOverlayComponent {
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly artService = inject(DuelCardArtService);

  readonly zoneId = input.required<ZoneId>();
  readonly cards = input<CardOnField[]>([]);
  /** Relative owner of the browsed zone (0 = viewer, 1 = opponent). Kept for
   *  callers; the browser renders every zone uniformly (face-down cards show
   *  a card back) so it no longer branches on it. */
  readonly playerIndex = input<number>(0);
  readonly openId = input<number>(0);

  // Direction B (Master Duel-style, 2026-06-05) — split into two outputs :
  // `cardClick` = primary affordance (parent decides: action menu or B2 inspect) ;
  // `inspectCard` = explicit inspect gesture (long-press / right-click).
  // The parent (`duel-page.onZoneBrowserAction`) holds the B2 dispatch.
  readonly cardClick = output<{ cardCode: number; sequence: number; element: HTMLElement }>();
  readonly inspectCard = output<number>();
  readonly closed = output<number>();

  readonly visible = signal(true);
  readonly isClosing = signal(false);
  readonly expanded = signal(false);

  readonly getCardImageUrlByCode = (code: number | null) => this.artService.resolveUrl(code);

  private removeOutsideListener: () => void;
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.closeTimeout) clearTimeout(this.closeTimeout);
    });
    this.removeOutsideListener = setupClickOutsideListener(this.el, this.destroyRef, () => this.close());

    // When the parent switches zone (new openId) on the same component instance,
    // cancel any pending close and reset state so the overlay stays visible.
    // Only `openId` is tracked — `isClosing` is read untracked, otherwise
    // `close()` setting `isClosing = true` would re-trigger this effect and
    // cancel the very close it just started (the overlay would never close).
    let seenOpenId = untracked(() => this.openId());
    effect(() => {
      const id = this.openId();
      if (id === seenOpenId) return; // first run, or no real zone switch
      seenOpenId = id;
      if (!untracked(() => this.isClosing())) return; // already visible, nothing to revive
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
    });
  }

  get zoneLabel(): string {
    return ZONE_SHORT_LABELS[this.zoneId()] ?? this.zoneId();
  }

  get zoneIconPath(): string | null {
    return ZONE_ICON_PATHS[this.zoneId()] ?? null;
  }

  onCardClick(card: CardOnField, index: number, event: MouseEvent): void {
    if (!card.cardCode) return;
    // `index` is the card's position inside the browsed zone's `cards[]`
    // array — equivalent to its OCGCore sequence for piles (GY / Banished
    // / Extra Deck) since `BoardZone.cards` is ordered by sequence.
    this.cardClick.emit({
      cardCode: card.cardCode,
      sequence: index,
      element: event.currentTarget as HTMLElement,
    });
  }

  onCardContextMenu(card: CardOnField, event: MouseEvent): void {
    // Don't preventDefault here — the host `<div>` already wires
    // `(contextmenu)="close(); $event.preventDefault()"` to close the
    // overlay on right-click. We stop propagation so the host's handler
    // doesn't fire (we want inspect, not close), and we preventDefault
    // ourselves to suppress the browser context menu.
    event.preventDefault();
    event.stopPropagation();
    if (!card.cardCode) return;
    this.inspectCard.emit(card.cardCode);
  }

  onCardLongPress(card: CardOnField): void {
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
