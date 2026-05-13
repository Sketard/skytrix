import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
} from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { i18nAttr } from '../i18n';

/** Bottom-sheet drag handle — mobile-only gesture to dismiss a MatDialog by
 *  swiping it down. Visible <768px (mockup convention), hidden on desktop.
 *
 *  Spec source: `_mockups/mockup-1-holo-arena.html` `.modal-handle` (ll. 2005-2027)
 *  + JS drag behavior referenced at l. 3391.
 *
 *  Usage — drop at the top of any MatDialog template, before its header:
 *
 *    <app-bottom-sheet-handle />
 *    <h2 mat-dialog-title>...</h2>
 *
 *  Threshold: drag past 30% of the dialog surface height OR release with
 *  velocity > 0.5 px/ms (downward) → dialog closes. Otherwise snap-back.
 *  Honors `prefers-reduced-motion` by disabling the snap-back transition.
 *
 *  A11y: rendered as `role=button` because the activation effect is "close
 *  the dialog" — `role=slider` (the mockup's choice) would require
 *  aria-valuenow/min/max which don't make sense for a binary close gesture.
 */
@Component({
  selector: 'app-bottom-sheet-handle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'button',
    tabindex: '0',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `<div class="bottom-sheet-handle-bar" aria-hidden="true"></div>`,
  styleUrl: './bottom-sheet-handle.component.scss',
})
export class BottomSheetHandleComponent {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly dialogRef = inject(MatDialogRef, { optional: true });

  // Resolved via i18nAttr (TranslateService.instant + onLangChange) because
  // host bindings can't run the `| translate` pipe — pipes only work in the
  // component's view template, not on the host element.
  protected readonly ariaLabel = i18nAttr('a11y.dragToClose');

  private surface: HTMLElement | null = null;
  private dragStartY = 0;
  // Last move sample — used to compute the release velocity (px/ms) over the
  // most recent frame, not since drag start. Sampling per-move keeps the
  // signal "what the finger was doing right before lift" instead of an
  // average over the whole drag.
  private prevY = 0;
  private prevTime = 0;
  private lastVelocityPxPerMs = 0;
  private dragging = false;
  private pointerId: number | null = null;

  private readonly closeThresholdRatio = 0.3;
  private readonly closeVelocityPxPerMs = 0.5;

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (!this.dialogRef || event.button !== 0) return;
    if (window.matchMedia('(min-width: 768px)').matches) return;

    this.surface = this.host.nativeElement.closest<HTMLElement>('.mat-mdc-dialog-surface');
    if (!this.surface) return;

    this.dragging = true;
    this.pointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.prevY = event.clientY;
    this.prevTime = performance.now();
    this.lastVelocityPxPerMs = 0;
    this.surface.style.transition = 'none';
    this.host.nativeElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  @HostListener('pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.pointerId || !this.surface) return;
    const dy = Math.max(0, event.clientY - this.dragStartY);
    this.surface.style.transform = `translateY(${dy}px)`;

    const now = performance.now();
    const dt = now - this.prevTime;
    if (dt > 0) this.lastVelocityPxPerMs = (event.clientY - this.prevY) / dt;
    this.prevY = event.clientY;
    this.prevTime = now;
  }

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
  onPointerUp(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.pointerId || !this.surface) return;
    const dy = Math.max(0, event.clientY - this.dragStartY);
    const heightThreshold = this.surface.offsetHeight * this.closeThresholdRatio;
    const flickedDown = this.lastVelocityPxPerMs >= this.closeVelocityPxPerMs;

    this.dragging = false;
    this.pointerId = null;
    this.host.nativeElement.releasePointerCapture(event.pointerId);

    if (dy >= heightThreshold || flickedDown) {
      this.dialogRef!.close();
      return;
    }
    this.snapBack();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.dialogRef) return;
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.dialogRef.close();
    }
  }

  private snapBack(): void {
    const surface = this.surface;
    this.surface = null;
    if (!surface) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    surface.style.transition = reduced ? 'none' : 'transform 200ms ease-out';
    surface.style.transform = 'translateY(0)';
    // Drop the inline styles once the animation completes so the next drag
    // starts from a clean slate (MatDialog reuses the surface across opens).
    const cleanup = () => {
      surface.style.transition = '';
      surface.style.transform = '';
      surface.removeEventListener('transitionend', cleanup);
    };
    if (reduced) cleanup();
    else surface.addEventListener('transitionend', cleanup);
  }
}
