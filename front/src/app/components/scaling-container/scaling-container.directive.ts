import {
  Directive,
  ElementRef,
  NgZone,
  Renderer2,
  afterNextRender,
  inject,
  input,
  output,
  DestroyRef,
} from '@angular/core';

// ScalingContainerDirective — canvas scaling for Track A pages
// Measures PARENT container dimensions, computes scale factor, applies transform: scale()
//
// CONSTRAINTS:
// - Parent container MUST have explicit height (not auto) — ResizeObserver won't detect viewport changes otherwise
// - referenceWidth default (1920) is per architecture spec. Consumers pass their own value
//   (e.g., simulator uses 1060, deck builder may differ)
// - Inputs are read reactively in resize callback, but host dimensions are set once at init.
//   Dynamic input changes after init will update scale computation but NOT host width/height in px.
//   Acceptable for MVP — these inputs are static per page.
// - Scale capped at 1.0 — no upscaling beyond native resolution
// - If parent has 0×0 dimensions (e.g. display:none), scale computes to 0 — host becomes invisible.
//   This is expected; scaling resumes when the parent becomes visible and ResizeObserver fires again.

@Directive({
  selector: '[appScalingContainer]',
  standalone: true,
})
export class ScalingContainerDirective {
  aspectRatio = input<number>(16 / 9);
  referenceWidth = input<number>(1920);

  scale = output<number>();

  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      this.initScaling();
    });
  }

  private initScaling(): void {
    const hostEl = this.el.nativeElement as HTMLElement;
    const parentEl = hostEl.parentElement;

    if (!parentEl) {
      console.warn('[ScalingContainerDirective] No parent element found — scaling disabled');
      return;
    }

    // Set initial host dimensions
    this.updateHostDimensions(hostEl);

    // Create ResizeObserver on parent — callback runs outside Angular zone,
    // so we explicitly re-enter the zone to ensure change detection for consumers
    this.resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      this.ngZone.run(() => {
        this.computeAndApplyScale(hostEl, width, height);
      });
    });

    this.resizeObserver.observe(parentEl);

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  private updateHostDimensions(hostEl: HTMLElement): void {
    const refWidth = this.referenceWidth();
    const ratio = this.aspectRatio();
    if (refWidth <= 0 || ratio <= 0) return;

    const refHeight = refWidth / ratio;
    this.renderer.setStyle(hostEl, 'width', `${refWidth}px`);
    this.renderer.setStyle(hostEl, 'height', `${refHeight}px`);
    this.renderer.setStyle(hostEl, 'transformOrigin', 'top center');
  }

  private computeAndApplyScale(hostEl: HTMLElement, parentWidth: number, parentHeight: number): void {
    const refWidth = this.referenceWidth();
    const ratio = this.aspectRatio();
    if (refWidth <= 0 || ratio <= 0) return;

    const refHeight = refWidth / ratio;
    const scaleFactor = Math.min(parentWidth / refWidth, parentHeight / refHeight, 1);

    this.renderer.setStyle(hostEl, 'transform', `scale(${scaleFactor})`);
    this.scale.emit(scaleFactor);
  }
}
