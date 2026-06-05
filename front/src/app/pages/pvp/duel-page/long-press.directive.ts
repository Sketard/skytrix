import {
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Long-press detector for the inspector gesture redesign (Direction B,
 * Master Duel-style). Mouse pointers are ignored — the desktop inspect
 * path uses `contextmenu` instead. Touch / pen pointers arm a timer on
 * `pointerdown`; the timer is cleared if the pointer moves beyond the
 * tolerance, releases early, or the OS cancels it. On firing, the
 * synthetic `click` that follows the `pointerup` is suppressed so the
 * host component's tap handler doesn't run too.
 *
 * Not a replacement for `LongPressDragDirective` — that one synthesizes
 * CDK drag handoffs and renders a donut overlay; this one is a plain
 * "fire once after N ms" emitter.
 */
@Directive({
  selector: '[appLongPress]',
  standalone: true,
})
export class LongPressDirective {
  readonly appLongPress = output<PointerEvent>();
  readonly appLongPressDuration = input(500);
  readonly appLongPressTolerance = input(12);

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private activePointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private firedPointerId: number | null = null;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    const duration = this.appLongPressDuration();
    this.timerId = setTimeout(() => this.fire(e), duration);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    if (this.timerId === null) return;
    const distance = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
    if (distance > this.appLongPressTolerance()) this.cancel();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.cancel();
    this.activePointerId = null;
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.cancel();
    this.activePointerId = null;
  };

  // Trailing click suppression — when long-press fires, the OS still
  // dispatches a `click` after `pointerup`. We catch it on the host in
  // capture phase and call `preventDefault()` + `stopImmediatePropagation()`.
  private readonly onClickCapture = (e: MouseEvent): void => {
    if (this.firedPointerId === null) return;
    this.firedPointerId = null;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  constructor() {
    this.ngZone.runOutsideAngular(() => {
      const host = this.el.nativeElement;
      host.addEventListener('pointerdown', this.onPointerDown, { passive: true });
      host.addEventListener('pointermove', this.onPointerMove, { passive: true });
      host.addEventListener('pointerup', this.onPointerUp, { passive: true });
      host.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
      host.addEventListener('click', this.onClickCapture, { capture: true });
    });

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private fire(e: PointerEvent): void {
    this.timerId = null;
    this.firedPointerId = e.pointerId;
    this.ngZone.run(() => this.appLongPress.emit(e));
  }

  private cancel(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private cleanup(): void {
    this.cancel();
    this.activePointerId = null;
    this.firedPointerId = null;
    const host = this.el.nativeElement;
    host.removeEventListener('pointerdown', this.onPointerDown);
    host.removeEventListener('pointermove', this.onPointerMove);
    host.removeEventListener('pointerup', this.onPointerUp);
    host.removeEventListener('pointercancel', this.onPointerCancel);
    host.removeEventListener('click', this.onClickCapture, { capture: true });
  }
}
