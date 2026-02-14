import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SharedCardData } from '../../core/model/shared-card-data';

@Component({
  selector: 'app-card',
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardComponent {
  readonly card = input.required<SharedCardData>();
  readonly faceDown = input(false);
  readonly position = input<'ATK' | 'DEF'>('ATK');
  readonly showOverlayMaterials = input(false);
  readonly overlayMaterialCount = input(0);

  readonly clicked = output<void>();

  readonly isDefPosition = computed(() => this.position() === 'DEF');
  readonly materialPeekSlots = computed(() => {
    if (!this.showOverlayMaterials()) return [];
    const count = Math.min(this.overlayMaterialCount(), 5);
    return Array.from({ length: count });
  });
}
