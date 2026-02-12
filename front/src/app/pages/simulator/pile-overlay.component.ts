import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { BoardStateService } from './board-state.service';
import { CardInstance, ZoneId, ZONE_CONFIG } from './simulator.models';
import { SimCardComponent } from './sim-card.component';

@Component({
  selector: 'app-sim-pile-overlay',
  templateUrl: './pile-overlay.component.html',
  styleUrl: './pile-overlay.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, MatIconModule, SimCardComponent],
  host: {
    'role': 'dialog',
    '[attr.aria-modal]': 'isOpen()',
    '[attr.aria-label]': 'ariaLabel()',
    '[class.open]': 'isOpen()',
  },
})
export class SimPileOverlayComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly elementRef = inject(ElementRef);

  readonly activeZone = this.boardState.activeOverlayZone;
  readonly isOpen = this.boardState.isOverlayOpen;
  readonly cards = this.boardState.activeOverlayCards;
  readonly isDragging = this.boardState.isDragging;
  readonly mode = this.boardState.activeOverlayMode;

  readonly isSearchMode = computed(() => this.mode() === 'search');
  readonly isRevealMode = computed(() => this.mode() === 'reveal');
  readonly isBrowseMode = computed(() => this.mode() === 'browse');

  readonly searchExpanded = signal(false);
  readonly isSearchActive = computed(() => this.isSearchMode() || this.searchExpanded());

  readonly filterText = signal('');

  readonly zoneIcon = computed(() => {
    const zone = this.activeZone();
    switch (zone) {
      case ZoneId.GRAVEYARD: return 'whatshot';
      case ZoneId.BANISH: return 'block';
      case ZoneId.EXTRA_DECK: return 'auto_awesome';
      case ZoneId.MAIN_DECK: return 'style';
      default: return 'layers';
    }
  });

  readonly displayCards = computed(() => {
    if (this.isRevealMode()) return this.boardState.revealCards();
    const allCards = this.cards();
    if (!this.isSearchActive()) return allCards;
    const filter = this.filterText().toLowerCase().trim();
    if (!filter) return allCards;
    return allCards.filter(c => c.card.card.name?.toLowerCase().includes(filter));
  });

  readonly cardForceFaceDown = computed<boolean | null>(() => {
    if (!this.isBrowseMode()) return false;
    return this.activeZone() === ZoneId.EXTRA_DECK ? false : null;
  });

  readonly zoneName = computed(() => {
    const zone = this.activeZone();
    return zone !== null ? ZONE_CONFIG[zone].label : '';
  });

  readonly ariaLabel = computed(() => {
    const m = this.mode();
    if (m === 'search') return 'Deck search overlay';
    if (m === 'reveal') return 'Deck reveal overlay';
    return `${this.zoneName()} overlay`;
  });

  readonly isEmpty = computed(() => this.displayCards().length === 0);

  readonly emptyMessage = computed(() => {
    if (this.isSearchActive() && this.filterText().trim()) return 'No matching cards';
    if (this.isRevealMode()) return 'All revealed cards moved';
    return `No cards in ${this.zoneName()}`;
  });

  readonly noDrop = (): boolean => false;

  private readonly searchInputRef = viewChild<ElementRef>('searchInput');

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        if (this.isSearchMode()) {
          requestAnimationFrame(() => this.searchInputRef()?.nativeElement.focus());
        } else {
          setTimeout(() => {
            const panel = this.elementRef.nativeElement.querySelector('.overlay-panel');
            panel?.focus();
          });
        }
      }
    });
  }

  close(): void {
    this.filterText.set('');
    this.searchExpanded.set(false);
    this.boardState.closeOverlay();
  }

  toggleSearch(): void {
    const expanding = !this.searchExpanded();
    this.searchExpanded.set(expanding);
    if (expanding) {
      requestAnimationFrame(() => this.searchInputRef()?.nativeElement.focus());
    } else {
      this.filterText.set('');
    }
  }

  onFilterInput(event: Event): void {
    this.filterText.set((event.target as HTMLInputElement).value);
  }

  onDragStarted(): void {
    this.boardState.isDragging.set(true);
  }

  onDragEnded(): void {
    this.boardState.isDragging.set(false);
  }

  onCardClicked(card: CardInstance): void {
    this.boardState.selectCard(card);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.isOpen()) return;
    if (event.defaultPrevented) return;
    this.close();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: Event): void {
    if (!this.isOpen()) return;
    if (this.elementRef.nativeElement.contains(event.target as HTMLElement)) return;
    this.close();
  }
}
