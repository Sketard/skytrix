import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, HostListener, inject, input, model, output, signal, effect, viewChild, TemplateRef, ViewContainerRef } from '@angular/core';
import { NgTemplateOutlet, DecimalPipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { TranslatePipe } from '@ngx-translate/core';
import { CardNamePipe, CardDescPipe } from '../../core/pipes/card-i18n.pipe';
import { SharedCardInspectorData } from '../../core/model/shared-card-data';
import { IconButtonComponent } from '../icon-button/icon-button.component';

const DOT_THRESHOLD = 5;

@Component({
  selector: 'app-card-inspector',
  templateUrl: './card-inspector.component.html',
  styleUrl: './card-inspector.component.scss',
  standalone: true,
  imports: [NgTemplateOutlet, DecimalPipe, MatIcon, MatIconButton, TranslatePipe, CardNamePipe, CardDescPipe, IconButtonComponent],
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
  private readonly overlay = inject(Overlay);
  private readonly viewContainerRef = inject(ViewContainerRef);

  /** Full-screen lightbox markup — rendered through a CDK overlay (attached
   *  to the body) so it escapes any transformed ancestor. A `transform` on
   *  an ancestor turns `position: fixed` into a containing block, which
   *  would trap the lightbox inside the inspector panel and crop the card. */
  private readonly lightboxTpl = viewChild.required<TemplateRef<unknown>>('lightboxTpl');
  private _lightboxOverlayRef: OverlayRef | null = null;

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
  /** Hint pill auto-fades a couple seconds after the lightbox opens. */
  readonly lightboxHintFaded = signal(false);

  /** Pan offset (px) applied to the zoomed image — translate BEFORE scale. */
  readonly lightboxPan = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  /** True while a pan drag is in progress (drives the grabbing cursor). */
  readonly lightboxDragging = signal(false);

  private static readonly LIGHTBOX_ZOOM_STEP = 0.2;
  private static readonly LIGHTBOX_ZOOM_MIN = 1;
  private static readonly LIGHTBOX_ZOOM_MAX = 4;
  private static readonly LIGHTBOX_HINT_FADE_MS = 2200;
  /** Pointer travel (px) below which a pointerup counts as a click, not a drag. */
  private static readonly LIGHTBOX_DRAG_THRESHOLD_PX = 5;

  private _hintFadeTimer: ReturnType<typeof setTimeout> | undefined;

  private _pinchStartDist = 0;
  private _pinchStartZoom = 1;

  // Pan-drag bookkeeping: pointer position at drag start, pan offset at drag
  // start, and the running total travel used to tell a click from a drag.
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartPanX = 0;
  private _dragStartPanY = 0;
  private _dragTravel = 0;
  /** The lightbox <img>, captured on pointerdown — used to clamp the pan. */
  private _lightboxImgEl: HTMLImageElement | null = null;
  /** pointerId of the in-progress drag, or null when no drag is active. */
  private _dragPointerId: number | null = null;

  // `wheel` and `touchmove` need passive: false to call e.preventDefault()
  // (Chrome ignores it on default-passive listeners). @HostListener doesn't
  // expose the passive option, so listeners are attached manually and torn
  // down via DestroyRef.
  private readonly _lightboxWheelHandler = (e: WheelEvent): void => {
    if (!this.lightboxOpen()) return;
    e.preventDefault();
    const delta = e.deltaY < 0
      ? CardInspectorComponent.LIGHTBOX_ZOOM_STEP
      : -CardInspectorComponent.LIGHTBOX_ZOOM_STEP;
    const raw = Math.round((this.lightboxZoom() + delta) * 100) / 100;
    this.setLightboxZoom(raw);
  };

  private readonly _pinchStartHandler = (e: TouchEvent): void => {
    if (!this.lightboxOpen() || e.touches.length !== 2) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    this._pinchStartDist = Math.hypot(dx, dy);
    this._pinchStartZoom = this.lightboxZoom();
  };

  private readonly _pinchMoveHandler = (e: TouchEvent): void => {
    if (!this.lightboxOpen() || e.touches.length !== 2 || this._pinchStartDist === 0) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    this.setLightboxZoom(this._pinchStartZoom * (dist / this._pinchStartDist));
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

    // Attach lightbox zoom listeners once. Handlers self-guard on
    // `lightboxOpen()`, so they no-op when the lightbox is closed.
    document.addEventListener('wheel', this._lightboxWheelHandler, { passive: false });
    document.addEventListener('touchstart', this._pinchStartHandler, { passive: false });
    document.addEventListener('touchmove', this._pinchMoveHandler, { passive: false });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('wheel', this._lightboxWheelHandler);
      document.removeEventListener('touchstart', this._pinchStartHandler);
      document.removeEventListener('touchmove', this._pinchMoveHandler);
      // Drag listeners are normally torn down on pointerup; clean up here
      // too in case the component is destroyed mid-drag.
      document.removeEventListener('pointermove', this._dragMoveHandler);
      document.removeEventListener('pointerup', this._dragUpHandler);
      document.removeEventListener('pointercancel', this._dragUpHandler);
      clearTimeout(this._hintFadeTimer);
      this._lightboxOverlayRef?.dispose();
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

  /** CSS transform for the lightbox image: pan THEN zoom. Translate is
   *  applied before scale so the offset stays in screen pixels. */
  readonly lightboxTransform = computed(() => {
    const { x, y } = this.lightboxPan();
    return `translate(${x}px, ${y}px) scale(${this.lightboxZoom()})`;
  });

  /** Cursor for the lightbox image: grab/grabbing when the zoomed card can
   *  be panned, zoom-in otherwise. */
  readonly lightboxCursor = computed(() => {
    if (this.lightboxDragging()) return 'grabbing';
    return this.lightboxZoom() > 1 ? 'grab' : 'zoom-in';
  });

  openLightbox(): void {
    this.lightboxOpen.set(true);
    this.lightboxHintFaded.set(false);
    clearTimeout(this._hintFadeTimer);
    this._hintFadeTimer = setTimeout(
      () => this.lightboxHintFaded.set(true),
      CardInspectorComponent.LIGHTBOX_HINT_FADE_MS,
    );

    // Mount the lightbox in a body-anchored CDK overlay so it covers the
    // real viewport regardless of transformed ancestors.
    if (!this._lightboxOverlayRef) {
      this._lightboxOverlayRef = this.overlay.create({
        positionStrategy: this.overlay.position().global(),
        scrollStrategy: this.overlay.scrollStrategies.block(),
        hasBackdrop: false,
        panelClass: 'card-inspector-lightbox-pane',
      });
    }
    if (!this._lightboxOverlayRef.hasAttached()) {
      this._lightboxOverlayRef.attach(
        new TemplatePortal(this.lightboxTpl(), this.viewContainerRef),
      );
    }
  }

  closeLightbox(): void {
    this.lightboxOpen.set(false);
    this.lightboxZoom.set(1);
    this.lightboxPan.set({ x: 0, y: 0 });
    clearTimeout(this._hintFadeTimer);
    this._lightboxOverlayRef?.detach();
  }

  /** Single source of truth for setting the lightbox zoom. Clamps the value
   *  and re-clamps (or resets) the pan offset so the card never strays past
   *  its overflow bounds when the zoom shrinks. */
  private setLightboxZoom(value: number): void {
    const { LIGHTBOX_ZOOM_MIN: min, LIGHTBOX_ZOOM_MAX: max } = CardInspectorComponent;
    const z = Math.min(Math.max(value, min), max);
    this.lightboxZoom.set(z);
    this.lightboxPan.set(z <= 1 ? { x: 0, y: 0 } : this.clampPan(this.lightboxPan(), z));
  }

  /** Clamp a pan offset so the zoomed image cannot be dragged past the point
   *  where empty space would show. Max travel per axis is half the overflow
   *  (zoomed size − viewport size). Reads the image's intrinsic on-screen
   *  box from `_lightboxImgEl` (pre-transform layout rect). */
  private clampPan(pan: { x: number; y: number }, zoom: number): { x: number; y: number } {
    const el = this._lightboxImgEl;
    if (!el) return pan;
    // getBoundingClientRect reflects the current transform — divide it back
    // out to recover the untransformed layout size.
    const rect = el.getBoundingClientRect();
    const baseW = rect.width / this.lightboxZoom();
    const baseH = rect.height / this.lightboxZoom();
    const maxX = Math.max(0, (baseW * zoom - window.innerWidth) / 2);
    const maxY = Math.max(0, (baseH * zoom - window.innerHeight) / 2);
    return {
      x: Math.min(Math.max(pan.x, -maxX), maxX),
      y: Math.min(Math.max(pan.y, -maxY), maxY),
    };
  }

  // ── Pan drag (pointer events) ──────────────────────────────────────────
  // A pointerdown on the image starts a potential drag. While dragging,
  // move/up are tracked on `document` (not via setPointerCapture, which
  // proved unreliable inside the CDK overlay) so the gesture keeps working
  // when the pointer leaves the image. Travel under the threshold at
  // pointerup is a click (cycles zoom); above it, it was a pan.

  onLightboxPointerDown(event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault(); // suppress the browser's native image drag-ghost
    this._lightboxImgEl = event.currentTarget as HTMLImageElement;
    this._dragPointerId = event.pointerId;
    this._dragStartX = event.clientX;
    this._dragStartY = event.clientY;
    const pan = this.lightboxPan();
    this._dragStartPanX = pan.x;
    this._dragStartPanY = pan.y;
    this._dragTravel = 0;
    document.addEventListener('pointermove', this._dragMoveHandler);
    document.addEventListener('pointerup', this._dragUpHandler);
    document.addEventListener('pointercancel', this._dragUpHandler);
  }

  private readonly _dragMoveHandler = (event: PointerEvent): void => {
    if (this._dragPointerId !== event.pointerId) return;
    const dx = event.clientX - this._dragStartX;
    const dy = event.clientY - this._dragStartY;
    this._dragTravel = Math.hypot(dx, dy);
    if (this._dragTravel >= CardInspectorComponent.LIGHTBOX_DRAG_THRESHOLD_PX) {
      this.lightboxDragging.set(true);
    }
    // Panning only matters when the card overflows the viewport.
    if (this.lightboxZoom() <= 1) return;
    this.lightboxPan.set(this.clampPan(
      { x: this._dragStartPanX + dx, y: this._dragStartPanY + dy },
      this.lightboxZoom(),
    ));
  };

  private readonly _dragUpHandler = (event: PointerEvent): void => {
    if (this._dragPointerId !== event.pointerId) return;
    document.removeEventListener('pointermove', this._dragMoveHandler);
    document.removeEventListener('pointerup', this._dragUpHandler);
    document.removeEventListener('pointercancel', this._dragUpHandler);
    const wasDrag = this._dragTravel >= CardInspectorComponent.LIGHTBOX_DRAG_THRESHOLD_PX;
    this._dragPointerId = null;
    this.lightboxDragging.set(false);
    // A genuine click (no meaningful travel) cycles the zoom. `pointercancel`
    // is never a click — only a clean pointerup with no travel is.
    if (event.type === 'pointerup' && !wasDrag) {
      const { LIGHTBOX_ZOOM_MAX: max } = CardInspectorComponent;
      const next = this.lightboxZoom() >= max ? 1 : Math.min(Math.floor(this.lightboxZoom()) + 1, max);
      this.setLightboxZoom(next);
    }
  };

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
    if (this.mode() === 'permanent') return;
    // While the lightbox is open it owns the topmost layer — it lives in a
    // body-anchored CDK overlay, OUTSIDE this component's DOM, so a click on
    // it would otherwise read as "outside" and dismiss the inspector
    // underneath. The lightbox handles its own dismissal (scrim / Escape).
    if (this.lightboxOpen()) return;
    if (this.elementRef.nativeElement.contains(event.target as HTMLElement)) return;
    this.dismissed.emit();
  }
}
