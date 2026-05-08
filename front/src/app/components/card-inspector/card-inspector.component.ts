import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, input, model, output, signal, effect } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { CardNamePipe, CardDescPipe } from '../../core/pipes/card-i18n.pipe';
import { SharedCardInspectorData } from '../../core/model/shared-card-data';

const DOT_THRESHOLD = 5;

@Component({
  selector: 'app-card-inspector',
  templateUrl: './card-inspector.component.html',
  styleUrl: './card-inspector.component.scss',
  standalone: true,
  imports: [NgTemplateOutlet, MatIcon, MatIconButton, TranslatePipe, CardNamePipe, CardDescPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'role': 'complementary',
    '[attr.aria-label]': '"Card inspector"',
    'aria-live': 'polite',
    '[class.visible]': 'isVisible()',
    '[class.mode-dismissable]': "mode() === 'dismissable'",
    '[class.mode-click]': "mode() === 'click'",
    '[class.mode-permanent]': "mode() === 'permanent'",
    '[class.position-right]': "position() === 'right'",
    '[class.position-top]': "position() === 'top'",
  },
})
export class CardInspectorComponent {
  private readonly elementRef = inject(ElementRef);

  readonly card = input<SharedCardInspectorData | null>(null);
  readonly mode = input<'dismissable' | 'click' | 'permanent'>('dismissable');
  readonly position = input<'left' | 'right' | 'top'>('left');
  readonly ownedCount = model<number | undefined>(undefined);
  readonly isFavorite = input<boolean>(false);

  readonly dismissed = output<void>();
  readonly favoriteChange = output<boolean>();
  readonly imageChange = output<number | undefined>();

  readonly isVisible = computed(() => this.card() !== null);
  readonly showPersonalMetadata = computed(() => this.ownedCount() !== undefined);
  readonly lightboxOpen = signal(false);
  readonly lightboxZoom = signal(1);

  private static readonly LIGHTBOX_ZOOM_STEP = 0.2;
  private static readonly LIGHTBOX_ZOOM_MIN = 1;
  private static readonly LIGHTBOX_ZOOM_MAX = 4;

  private _pinchStartDist = 0;
  private _pinchStartZoom = 1;

  private readonly _lightboxWheelHandler = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = e.deltaY < 0
      ? CardInspectorComponent.LIGHTBOX_ZOOM_STEP
      : -CardInspectorComponent.LIGHTBOX_ZOOM_STEP;
    const raw = Math.round((this.lightboxZoom() + delta) * 100) / 100;
    this.lightboxZoom.set(Math.min(Math.max(raw, CardInspectorComponent.LIGHTBOX_ZOOM_MIN), CardInspectorComponent.LIGHTBOX_ZOOM_MAX));
  };

  private readonly _pinchStartHandler = (e: TouchEvent): void => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    this._pinchStartDist = Math.hypot(dx, dy);
    this._pinchStartZoom = this.lightboxZoom();
  };

  private readonly _pinchMoveHandler = (e: TouchEvent): void => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const raw = this._pinchStartZoom * (dist / this._pinchStartDist);
    this.lightboxZoom.set(Math.min(Math.max(raw, CardInspectorComponent.LIGHTBOX_ZOOM_MIN), CardInspectorComponent.LIGHTBOX_ZOOM_MAX));
  };

  /** Index of the currently displayed image within card().images */
  readonly currentImageIndex = signal(0);

  readonly imageCount = computed(() => this.card()?.images.length ?? 0);
  protected readonly DOT_THRESHOLD = DOT_THRESHOLD;

  constructor() {
    // Sync currentImageIndex when the card input changes
    effect(() => {
      const c = this.card();
      if (!c || c.images.length <= 1) {
        this.currentImageIndex.set(0);
        return;
      }
      const idx = c.selectedImageId != null
        ? c.images.findIndex(img => img.id === c.selectedImageId)
        : 0;
      this.currentImageIndex.set(idx >= 0 ? idx : 0);
    });
  }

  navigateImage(delta: number): void {
    const images = this.card()?.images;
    if (!images || images.length <= 1) return;
    const len = images.length;
    const next = (this.currentImageIndex() + delta + len) % len;
    this.currentImageIndex.set(next);
    const img = images[next];
    this.imageChange.emit(next === 0 ? undefined : img.id);
  }

  goToImage(index: number): void {
    const images = this.card()?.images;
    if (!images || index < 0 || index >= images.length) return;
    this.currentImageIndex.set(index);
    this.imageChange.emit(index === 0 ? undefined : images[index].id);
  }

  /** Resolved image URLs for the current art index */
  readonly currentImageUrl = computed(() => {
    const c = this.card();
    if (!c) return '';
    const img = c.images[this.currentImageIndex()];
    return img?.smallUrl ?? c.imageUrl;
  });
  readonly currentImageUrlFull = computed(() => {
    const c = this.card();
    if (!c) return '';
    const img = c.images[this.currentImageIndex()];
    return img?.url ?? c.imageUrlFull ?? c.imageUrl;
  });

  openLightbox(): void {
    this.lightboxOpen.set(true);
    document.addEventListener('wheel', this._lightboxWheelHandler, { passive: false });
    document.addEventListener('touchstart', this._pinchStartHandler, { passive: false });
    document.addEventListener('touchmove', this._pinchMoveHandler, { passive: false });
  }

  closeLightbox(): void {
    this.lightboxOpen.set(false);
    this.lightboxZoom.set(1);
    document.removeEventListener('wheel', this._lightboxWheelHandler);
    document.removeEventListener('touchstart', this._pinchStartHandler);
    document.removeEventListener('touchmove', this._pinchMoveHandler);
  }

  onLightboxImgClick(event: MouseEvent): void {
    event.stopPropagation();
    const { LIGHTBOX_ZOOM_MIN: min, LIGHTBOX_ZOOM_MAX: max } = CardInspectorComponent;
    const next = this.lightboxZoom() >= max ? min : Math.min(Math.floor(this.lightboxZoom()) + 1, max);
    this.lightboxZoom.set(next);
  }

  changeOwned(delta: number): void {
    this.ownedCount.set(Math.max(0, (this.ownedCount() ?? 0) + delta));
  }

  toggleFavorite(): void {
    this.favoriteChange.emit(!this.isFavorite());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightboxOpen()) { this.closeLightbox(); return; }
    if (!this.isVisible()) return;
    if (this.mode() === 'permanent') return;
    this.dismissed.emit();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    if (!this.isVisible()) return;
    if (this.mode() !== 'dismissable') return;
    if (this.elementRef.nativeElement.contains(event.target as HTMLElement)) return;
    this.dismissed.emit();
  }
}
