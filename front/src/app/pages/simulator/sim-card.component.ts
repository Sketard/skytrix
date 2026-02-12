import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CardInstance } from './simulator.models';

@Component({
  selector: 'app-sim-card',
  templateUrl: './sim-card.component.html',
  styleUrl: './sim-card.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimCardComponent {
  readonly cardInstance = input.required<CardInstance>();
  readonly size = input<'board' | 'hand'>('board');
  readonly forceFaceDown = input(false);

  readonly hovered = output<CardInstance>();
  readonly unhovered = output<void>();

  readonly isFaceDown = computed(() => this.forceFaceDown() || this.cardInstance().faceDown);
  readonly isDefPosition = computed(() => this.cardInstance().position === 'DEF');
  readonly imageUrl = computed(() => this.cardInstance().image.smallUrl);

  readonly hasMaterials = computed(() => (this.cardInstance().overlayMaterials?.length ?? 0) > 0);
  readonly materialCount = computed(() => this.cardInstance().overlayMaterials?.length ?? 0);
  readonly materialPeekSlots = computed(() => {
    const count = Math.min(this.materialCount(), 5);
    return Array.from({ length: count });
  });
  readonly materialPeekClicked = output<CardInstance>();

  onCardClick(): void {
    if (this.hasMaterials()) {
      this.materialPeekClicked.emit(this.cardInstance());
    }
  }
}
