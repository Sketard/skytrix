import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject } from '@angular/core';
import { BoardStateService } from './board-state.service';

@Component({
  selector: 'app-sim-card-inspector',
  templateUrl: './card-inspector.component.html',
  styleUrl: './card-inspector.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'role': 'complementary',
    '[attr.aria-label]': '"Card inspector"',
    'aria-live': 'polite',
    '[class.visible]': 'isVisible()',
  },
})
export class SimCardInspectorComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly elementRef = inject(ElementRef);

  readonly selectedCard = this.boardState.selectedCard;

  readonly isVisible = computed(() => this.selectedCard() !== null);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isVisible()) {
      this.boardState.clearSelection();
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    if (!this.isVisible()) return;
    if (this.elementRef.nativeElement.contains(event.target as HTMLElement)) return;
    this.boardState.clearSelection();
  }
}
