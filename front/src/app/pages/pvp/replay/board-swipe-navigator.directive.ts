import { Directive, HostListener, input, output } from '@angular/core';

// Horizontal-swipe gesture detector for the mobile board area (D6).
// Attached to the **board wrapper element**, NOT to card elements — keeps
// the gesture from conflicting with future per-card zoom.
//
// Thresholds (per spec replay-viewer-rework-2026-05-14.md §F2):
//   - horizontal travel ≥ 60px
//   - vertical drift  <  80px  (otherwise treat as scroll)
//   - duration        <  600ms
//
// Emits `swipeLeft` (finger moved right→left, i.e. user wants next turn)
// and `swipeRight` (finger moved left→right → previous turn).
//
// Set `[appBoardSwipeNavigatorDisabled]="true"` to suspend the gesture while
// a bottom-sheet / overlay / cheat-sheet is open.
//
// Single touchpoint only — multi-touch (pinch) is ignored.
export const SWIPE_THRESHOLD_X = 60;
export const SWIPE_MAX_Y = 80;
export const SWIPE_MAX_DT_MS = 600;

@Directive({
  selector: '[appBoardSwipeNavigator]',
  standalone: true,
})
export class BoardSwipeNavigatorDirective {
  readonly disabled = input<boolean>(false, { alias: 'appBoardSwipeNavigatorDisabled' });

  readonly swipeLeft = output<void>();
  readonly swipeRight = output<void>();

  private startX = 0;
  private startY = 0;
  private startT = 0;
  private tracking = false;

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent): void {
    if (this.disabled()) return;
    if (event.touches.length !== 1) {
      this.tracking = false;
      return;
    }
    const t = event.touches[0];
    this.startX = t.clientX;
    this.startY = t.clientY;
    this.startT = performance.now();
    this.tracking = true;
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent): void {
    if (!this.tracking || this.disabled()) return;
    this.tracking = false;
    if (event.changedTouches.length !== 1) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;
    const dt = performance.now() - this.startT;

    if (Math.abs(dy) >= SWIPE_MAX_Y) return;   // vertical drift → treat as scroll
    if (dt >= SWIPE_MAX_DT_MS) return;          // too slow → not a swipe
    if (Math.abs(dx) < SWIPE_THRESHOLD_X) return;

    if (dx < 0) this.swipeLeft.emit();
    else this.swipeRight.emit();
  }

  @HostListener('touchcancel')
  onTouchCancel(): void {
    this.tracking = false;
  }
}
