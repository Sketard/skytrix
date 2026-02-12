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

  readonly filterText = signal('');

  readonly filteredCards = computed(() => {
    const allCards = this.cards();
    if (!this.isSearchMode()) return allCards;
    const filter = this.filterText().toLowerCase().trim();
    if (!filter) return allCards;
    return allCards.filter(c => c.card.card.name?.toLowerCase().includes(filter));
  });

  readonly displayCards = computed(() => {
    if (this.isRevealMode()) return this.boardState.revealCards();
    if (this.isSearchMode()) return this.filteredCards();
    return this.cards();
  });

  readonly zoneName = computed(() => {
    const zone = this.activeZone();
    return zone !== null ? ZONE_CONFIG[zone].label : '';
  });

  readonly overlayTitle = computed(() => {
    const m = this.mode();
    if (m === 'search') return 'Deck Search';
    if (m === 'reveal') {
      const count = this.boardState.revealCards().length;
      return `Reveal — ${count} card${count !== 1 ? 's' : ''}`;
    }
    return this.zoneName();
  });

  readonly ariaLabel = computed(() => `${this.overlayTitle()} overlay`);

  readonly isEmpty = computed(() => this.displayCards().length === 0);

  readonly emptyMessage = computed(() => {
    if (this.isSearchMode() && this.filterText().trim()) return 'No matching cards';
    if (this.isRevealMode()) return 'All revealed cards moved';
    return `No cards in ${this.zoneName()}`;
  });

  readonly isExtraDeck = computed(() => this.activeZone() === ZoneId.EXTRA_DECK);
  readonly isBanished = computed(() => this.activeZone() === ZoneId.BANISH);
  readonly faceDownCards = computed(() => this.cards().filter(c => c.faceDown));
  readonly faceUpCards = computed(() => this.cards().filter(c => !c.faceDown));

  readonly needsGrouping = computed(
    () => (this.isExtraDeck() || this.isBanished()) && this.faceDownCards().length > 0,
  );

  readonly noDrop = (): boolean => false;

  private readonly searchInputRef = viewChild<ElementRef>('searchInput');

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        if (this.isSearchMode()) {
          requestAnimationFrame(() => {
            this.searchInputRef()?.nativeElement.focus();
          });
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
    if (this.isSearchMode()) {
      this.boardState.shuffleDeckSilent();
    }
    this.filterText.set('');
    this.boardState.closeOverlay();
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

  onCardHovered(card: CardInstance): void {
    this.boardState.setHoveredCard(card);
  }

  onCardUnhovered(): void {
    this.boardState.setHoveredCard(null);
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
