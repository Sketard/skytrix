import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { BoardStateService } from './board-state.service';
import { CardInstance } from './simulator.models';

@Component({
  selector: 'app-sim-xyz-material-peek',
  templateUrl: './xyz-material-peek.component.html',
  styleUrl: './xyz-material-peek.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, MatIconModule],
  host: {},
})
export class SimXyzMaterialPeekComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly elementRef = inject(ElementRef);

  readonly peekState = this.boardState.activeMaterialPeek;
  readonly isOpen = computed(() => this.peekState() !== null);

  readonly xyzCard = computed(() => {
    const state = this.peekState();
    if (!state) return null;
    return this.boardState.boardState()[state.zoneId]
      ?.find(c => c.instanceId === state.cardId) ?? null;
  });

  readonly materials = computed(() => this.xyzCard()?.overlayMaterials ?? []);
  readonly materialCount = computed(() => this.materials().length);
  readonly xyzName = computed(() => this.xyzCard()?.card.card.name ?? 'XYZ Monster');

  readonly overlayTitle = computed(() => {
    const count = this.materialCount();
    return `Materials — ${count} card${count !== 1 ? 's' : ''}`;
  });

  readonly noDrop = (): boolean => false;

  constructor() {
    effect(() => {
      if (this.isOpen() && this.materialCount() === 0) {
        untracked(() => this.boardState.closeMaterialPeek());
      }
    });
  }

  close(): void {
    this.boardState.closeMaterialPeek();
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.close();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    if (!this.isOpen()) return;
    if (this.elementRef.nativeElement.contains(event.target as HTMLElement)) return;
    this.close();
  }
}
