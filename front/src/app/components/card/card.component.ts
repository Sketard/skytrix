import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { SharedCardData } from '../../core/model/shared-card-data';
import { CardNamePipe } from '../../core/pipes/card-i18n.pipe';

@Component({
  selector: 'app-card',
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
  standalone: true,
  imports: [CardNamePipe],
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

  readonly imageLoaded = signal(false);

  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    // Cached-image fallback: when <img> sources are already in the HTTP cache,
    // the browser may have completed the load before Angular attaches the
    // (load) listener. Probe `complete` once after the first render.
    afterNextRender(() => {
      const img = this.host.nativeElement.querySelector('img.card-image') as HTMLImageElement | null;
      if (img?.complete && img.naturalWidth > 0) {
        this.imageLoaded.set(true);
      }
    });
  }

  onImageLoad(): void {
    this.imageLoaded.set(true);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = 'assets/images/card_back.jpg';
    this.imageLoaded.set(true);
  }
}
