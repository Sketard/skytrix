import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
    '[class.expanded]': 'isExpanded()',
    '[class.position-left]': 'inspectorPosition() === "left"',
  },
})
export class SimCardInspectorComponent {
  private readonly boardState = inject(BoardStateService);

  readonly hoveredCard = this.boardState.hoveredCard;
  readonly isDragging = this.boardState.isDragging;

  readonly isVisible = computed(() =>
    this.hoveredCard() !== null && !this.isDragging()
  );

  readonly isFaceDown = computed(() =>
    this.hoveredCard()?.faceDown ?? false
  );

  readonly inspectorPosition = computed(() =>
    this.boardState.isOverlayOpen() || this.boardState.isMaterialPeekOpen() ? 'left' : 'right'
  );

  readonly isExpanded = signal(false);

  toggleDrawer(): void {
    this.isExpanded.update(v => !v);
  }
}
