import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, input, isDevMode, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';

import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';
import { createGlowEffect } from './glow-effect';
import { CardInstance, ZoneId, ZONE_CONFIG, toSharedCardData } from './simulator.models';
import { CardComponent } from '../../components/card/card.component';

@Component({
  selector: 'app-sim-stacked-zone',
  templateUrl: './stacked-zone.component.html',
  styleUrl: './stacked-zone.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, MatIconModule, MatMenuModule, CardComponent],
})
export class SimStackedZoneComponent {
  readonly zoneId = input.required<ZoneId>();

  @ViewChild('deckMenuTrigger') deckMenuTrigger?: MatMenuTrigger;
  @ViewChild('menuAnchor') menuAnchor?: ElementRef<HTMLElement>;

  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);

  readonly cards = computed(() => this.boardState.boardState()[this.zoneId()]);
  readonly cardCount = computed(() => this.cards().length);
  readonly topCard = computed(() => {
    const c = this.cards();
    return c.length > 0 ? c[c.length - 1] : null;
  });
  readonly showFaceDown = computed<boolean | null>(() =>
    this.zoneId() === ZoneId.MAIN_DECK || this.zoneId() === ZoneId.EXTRA_DECK ? true : null
  );
  readonly zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()]);
  readonly isDeckZone = computed(() => this.zoneId() === ZoneId.MAIN_DECK);
  readonly isReceiving = signal(false);
  readonly deckShake = signal(false);
  private shakeTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly glow = createGlowEffect();
  readonly justDropped = this.glow.justDropped;

  protected readonly toSharedCardData = toSharedCardData;

  onDragEntered(): void {
    this.isReceiving.set(true);
  }

  onDragExited(): void {
    this.isReceiving.set(false);
  }

  onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
    this.isReceiving.set(false);
    if (event.previousContainer === event.container) return;
    const cardInstanceId = event.item.data.instanceId;
    const fromZone = event.previousContainer.data;
    const toZone = event.container.data;
    try {
      this.commandStack.moveCard(cardInstanceId, fromZone, toZone);
      this.glow.triggerGlow();
    } catch {
      // Invalid drop — silently ignored, card returns to origin via CDK
    }
  }

  onAnimationEnd(event: AnimationEvent): void {
    if (event.animationName === 'gold-glow') {
      this.glow.onGlowAnimationEnd();
    } else if (event.animationName === 'deck-shake') {
      if (this.shakeTimeout) {
        clearTimeout(this.shakeTimeout);
        this.shakeTimeout = undefined;
      }
      this.deckShake.set(false);
    }
  }

  triggerDeckShake(): void {
    if (this.shakeTimeout) {
      clearTimeout(this.shakeTimeout);
      this.deckShake.set(false);
    }
    requestAnimationFrame(() => {
      this.deckShake.set(true);
      this.shakeTimeout = setTimeout(() => {
        this.deckShake.set(false);
        this.shakeTimeout = undefined;
      }, 300);
    });
  }

  onZoneClick(): void {
    if (this.isDeckZone() && this.cardCount() === 0) {
      this.triggerDeckShake();
      return;
    }
    this.boardState.openOverlay(this.zoneId());
  }

  // preventDefault handled by board-level @HostListener('contextmenu')
  onContextMenu(event: MouseEvent): void {
    if (this.isDeckZone()) {
      if (this.boardState.isDragging()) return;
      if (this.menuAnchor) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        this.menuAnchor.nativeElement.style.left = `${event.clientX - rect.left}px`;
        this.menuAnchor.nativeElement.style.top = `${event.clientY - rect.top}px`;
      }
      this.deckMenuTrigger?.openMenu();
    }
  }

  onShuffle(): void {
    try {
      this.commandStack.shuffleDeck();
      this.glow.triggerGlow();
    } catch (e) {
      if (isDevMode()) console.warn('Shuffle failed:', e);
    }
  }

  onSearch(): void {
    this.boardState.openDeckSearch();
  }

  onMill(): void {
    const input = window.prompt('Mill how many cards?');
    if (input === null) return;
    const count = parseInt(input, 10);
    if (isNaN(count) || count <= 0) return;
    try {
      this.commandStack.mill(count);
    } catch (e) {
      if (isDevMode()) console.warn('Mill failed', e);
    }
  }

  onReveal(): void {
    const input = window.prompt('Reveal how many cards?');
    if (input === null) return;
    const count = parseInt(input, 10);
    if (isNaN(count) || count <= 0) return;
    try {
      this.boardState.openDeckReveal(count);
    } catch (e) {
      if (isDevMode()) console.warn('Reveal failed', e);
    }
  }

  onDragStarted(): void {
    this.boardState.isDragging.set(true);
  }

  onDragEnded(): void {
    this.boardState.isDragging.set(false);
  }
}
