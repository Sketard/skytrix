import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
} from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

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
 */
@Component({
  selector: 'app-bottom-sheet-handle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'slider',
    tabindex: '0',
    'aria-orientation': 'vertical',
    'aria-label': 'Faire glisser pour fermer',
  },
  template: `<div class="bottom-sheet-handle-bar" aria-hidden="true"></div>`,
  styleUrl: './bottom-sheet-handle.component.scss',
})
export class BottomSheetHandleComponent {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly dialogRef = inject(MatDialogRef, { optional: true });

  private surface: HTMLElement | null = null;
  private dragStartY = 0;
  private dragStartTime = 0;
  private lastY = 0;
  private lastTime = 0;
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
    this.lastY = event.clientY;
    this.dragStartTime = performance.now();
    this.lastTime = this.dragStartTime;
    this.surface.style.transition = 'none';
    this.host.nativeElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  @HostListener('pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.pointerId || !this.surface) return;
    const dy = Math.max(0, event.clientY - this.dragStartY);
    this.surface.style.transform = `translateY(${dy}px)`;
    this.lastY = event.clientY;
    this.lastTime = performance.now();
  }

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
  onPointerUp(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.pointerId || !this.surface) return;
    const dy = Math.max(0, event.clientY - this.dragStartY);
    const elapsed = Math.max(1, performance.now() - this.lastTime);
    const velocity = (event.clientY - this.lastY) / elapsed;
    const heightThreshold = this.surface.offsetHeight * this.closeThresholdRatio;

    this.dragging = false;
    this.pointerId = null;
    this.host.nativeElement.releasePointerCapture(event.pointerId);

    if (dy >= heightThreshold || velocity >= this.closeVelocityPxPerMs) {
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
    if (!this.surface) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.surface.style.transition = reduced ? 'none' : 'transform 200ms ease-out';
    this.surface.style.transform = 'translateY(0)';
    this.surface = null;
  }
}
