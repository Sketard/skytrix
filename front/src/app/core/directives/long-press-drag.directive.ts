import { Directive, DestroyRef, ElementRef, NgZone, inject, input } from '@angular/core';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Subscription, take } from 'rxjs';

@Directive({
  selector: '[appLongPressDrag]',
  standalone: true,
})
export class LongPressDragDirective {
  readonly longPressDelay = input(400);
  readonly longPressDragDisabled = input(false);

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly cdkDrag = inject(CdkDrag, { optional: true });

  private pressing = false;
  private longPressCompleted = false;
  private destroyed = false;
  private activePointerId: number | null = null;
  private activeTouchIdentifier: number | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private suppressContextMenu = false;
  private suppressContextMenuTimer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private lastMoveTime = 0;
  private lastMoveX = 0;
  private lastMoveY = 0;
  private prevMoveTime = 0;
  private prevMoveX = 0;
  private prevMoveY = 0;
  private donutEl: HTMLElement | null = null;
  private fadingDonutEl: HTMLElement | null = null;
  private endedSub: Subscription | null = null;
  private reducedMotion: boolean;
  private reducedMotionMql: MediaQueryList;

  // Block CDK from seeing real touchstart (CDK listens on touchstart, not pointerdown).
  // NOTE: longPressDragDisabled MUST stay in sync with cdkDragDisabled — when this directive
  // is active, ALL trusted touchstart events are blocked from reaching CDK or sibling handlers.
  private readonly onTouchStart = (e: TouchEvent): void => {
    if (!e.isTrusted) return; // Let synthetic touchstart through to CDK
    if (this.destroyed || this.longPressDragDisabled()) return;
    if (e.changedTouches.length > 0) {
      this.activeTouchIdentifier = e.changedTouches[0].identifier;
    }
    e.stopImmediatePropagation();
  };

  // Block derived mousedown during touch gesture (CDK also listens on mousedown)
  private readonly onMouseDownCapture = (e: MouseEvent): void => {
    if (!e.isTrusted) return; // Let synthetic mousedown through to CDK (fallback path)
    if (this.destroyed || this.longPressDragDisabled()) return;
    if (this.pressing || this.longPressCompleted) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };

  // Block native contextmenu fired by mobile long press
  private readonly onContextMenu = (e: Event): void => {
    if (this.destroyed || this.longPressDragDisabled()) return;
    if (this.suppressContextMenu) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.destroyed || this.longPressDragDisabled()) return;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') return;
    if (this.activePointerId !== null) return;

    this.activePointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    const now = Date.now();
    this.lastMoveTime = now;
    this.lastMoveX = e.clientX;
    this.lastMoveY = e.clientY;
    this.prevMoveTime = now;
    this.prevMoveX = e.clientX;
    this.prevMoveY = e.clientY;
    this.pressing = true;
    this.setSuppressContextMenu();

    this.createDonutOverlay(e.clientX, e.clientY);
    this.timerId = setTimeout(() => this.onLongPressComplete(), this.longPressDelay());
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.destroyed || e.pointerId !== this.activePointerId) return;

    if (this.pressing) {
      this.prevMoveTime = this.lastMoveTime;
      this.prevMoveX = this.lastMoveX;
      this.prevMoveY = this.lastMoveY;
      this.lastMoveTime = Date.now();
      this.lastMoveX = e.clientX;
      this.lastMoveY = e.clientY;

      const distance = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
      if (distance > 15) {
        this.cancelPress();
      }
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.destroyed || e.pointerId !== this.activePointerId) return;

    if (this.pressing) {
      this.cancelPress();
    } else if (this.longPressCompleted) {
      this.resetLongPressState();
    }

    this.clearSuppressContextMenuDeferred();
    this.activePointerId = null;
    this.activeTouchIdentifier = null;
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    if (this.pressing) {
      this.cancelPress();
    } else if (this.longPressCompleted) {
      this.resetLongPressState();
    }
    this.clearSuppressContextMenuDeferred();
    this.activePointerId = null;
    this.activeTouchIdentifier = null;
  };

  private readonly onReducedMotionChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
  };

  constructor() {
    this.reducedMotionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.reducedMotionMql.matches;
    this.reducedMotionMql.addEventListener('change', this.onReducedMotionChange);

    this.ngZone.runOutsideAngular(() => {
      const host = this.el.nativeElement;
      host.addEventListener('touchstart', this.onTouchStart, { capture: true, passive: false });
      host.addEventListener('mousedown', this.onMouseDownCapture, { capture: true, passive: false });
      host.addEventListener('contextmenu', this.onContextMenu, { capture: true, passive: false });
      host.addEventListener('pointerdown', this.onPointerDown, { passive: true } as AddEventListenerOptions);
      host.addEventListener('pointermove', this.onPointerMove, { passive: true } as AddEventListenerOptions);
      host.addEventListener('pointerup', this.onPointerUp, { passive: true } as AddEventListenerOptions);
      host.addEventListener('pointercancel', this.onPointerCancel, { passive: true } as AddEventListenerOptions);
    });

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private onLongPressComplete(): void {
    if (this.destroyed) return;
    this.timerId = null;

    // Velocity check BEFORE changing state — uses instantaneous velocity between
    // the last two pointermove events, not cumulative displacement from start.
    const recentMove = Date.now() - this.lastMoveTime < 100;
    if (recentMove) {
      const dt = this.lastMoveTime - this.prevMoveTime;
      if (dt > 0) {
        const dist = Math.hypot(this.lastMoveX - this.prevMoveX, this.lastMoveY - this.prevMoveY);
        if (dist / dt > 0.3) {
          this.cancelPress();
          return;
        }
      }
    }

    this.pressing = false;
    this.longPressCompleted = true;
    this.removeDonutOverlay(false);

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }

    this.liveAnnouncer.announce('Drag activated', 'assertive');

    // Dispatch synthetic TouchEvent — CDK listens on touchstart, not pointerdown.
    // Uses the real touch identifier captured in onTouchStart so CDK can correlate
    // subsequent real touchmove/touchend events with this drag session.
    const host = this.el.nativeElement;
    try {
      const touch = new Touch({
        identifier: this.activeTouchIdentifier ?? 0,
        target: host,
        clientX: this.startX,
        clientY: this.startY,
        pageX: this.startX + window.scrollX,
        pageY: this.startY + window.scrollY,
      });
      const syntheticTouch = new TouchEvent('touchstart', {
        touches: [touch],
        targetTouches: [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      });
      host.dispatchEvent(syntheticTouch);
    } catch {
      // Fallback: dispatch mousedown if TouchEvent constructor unavailable (e.g. Firefox desktop)
      const syntheticMouse = new MouseEvent('mousedown', {
        clientX: this.startX,
        clientY: this.startY,
        bubbles: true,
        cancelable: true,
      });
      host.dispatchEvent(syntheticMouse);
    }

    // Visual feedback AFTER synthetic dispatch so CDK reads the correct bounding rect
    // at scale 1.0 before the 1.05 transition kicks in.
    this.el.nativeElement.classList.add('long-press-active');

    const drag = this.cdkDrag;
    if (drag) {
      this.endedSub = drag.ended.pipe(take(1)).subscribe(() => {
        this.el.nativeElement.classList.remove('long-press-active');
        this.longPressCompleted = false;
      });
    }
  }

  private setSuppressContextMenu(): void {
    if (this.suppressContextMenuTimer !== null) {
      clearTimeout(this.suppressContextMenuTimer);
      this.suppressContextMenuTimer = null;
    }
    this.suppressContextMenu = true;
  }

  private clearSuppressContextMenuDeferred(): void {
    if (this.suppressContextMenuTimer !== null) {
      clearTimeout(this.suppressContextMenuTimer);
    }
    // 500ms grace period — contextmenu fires well after pointerup on most mobile browsers
    this.suppressContextMenuTimer = setTimeout(() => {
      this.suppressContextMenu = false;
      this.suppressContextMenuTimer = null;
    }, 500);
  }

  private resetLongPressState(): void {
    this.endedSub?.unsubscribe();
    this.endedSub = null;
    this.el.nativeElement.classList.remove('long-press-active');
    this.longPressCompleted = false;
  }

  private cancelPress(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.pressing = false;
    this.removeDonutOverlay(true);
    this.el.nativeElement.classList.remove('long-press-active');
  }

  private createDonutOverlay(x: number, y: number): void {
    const size = 40;
    const half = size / 2;
    const radius = 17;
    const circumference = 2 * Math.PI * radius;
    const clampedX = Math.max(half, Math.min(window.innerWidth - half, x));
    const clampedY = Math.max(half, Math.min(window.innerHeight - half, y));

    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      left: ${clampedX - half}px;
      top: ${clampedY - half}px;
      width: ${size}px;
      height: ${size}px;
      pointer-events: none;
      z-index: var(--z-donut-overlay, 500);
    `;

    if (this.reducedMotion) {
      el.innerHTML = `
        <div style="
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 2px solid var(--accent-primary, #C9A84C);
          opacity: 0.7;
          box-sizing: border-box;
        "></div>
      `;
    } else {
      const duration = this.longPressDelay();
      el.innerHTML = `
        <svg viewBox="0 0 40 40" style="width:100%;height:100%;filter:drop-shadow(0 0 6px rgba(201,168,76,0.8)) drop-shadow(0 0 12px rgba(201,168,76,0.35));">
          <circle cx="20" cy="20" r="${radius}" fill="none" stroke="rgba(201,168,76,0.25)" stroke-width="4"/>
          <circle cx="20" cy="20" r="${radius}" fill="none" stroke="var(--accent-primary, #C9A84C)" stroke-width="4"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-dashoffset="${circumference.toFixed(2)}"
            stroke-linecap="round"
            transform="rotate(-90 20 20)"
            class="donut-fill-circle"
            style="animation-duration: ${duration}ms;"/>
        </svg>
      `;
    }

    document.body.appendChild(el);
    this.donutEl = el;
  }

  private removeDonutOverlay(fade: boolean): void {
    const el = this.donutEl;
    if (!el) return;
    this.donutEl = null;

    if (fade) {
      this.fadingDonutEl = el;
      el.style.opacity = '0';
      el.style.transition = 'opacity 100ms';
      setTimeout(() => {
        el.remove();
        if (this.fadingDonutEl === el) this.fadingDonutEl = null;
      }, 100);
    } else {
      el.remove();
    }
  }

  private cleanup(): void {
    this.destroyed = true;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.donutEl?.remove();
    this.donutEl = null;

    this.fadingDonutEl?.remove();
    this.fadingDonutEl = null;

    if (this.suppressContextMenuTimer !== null) {
      clearTimeout(this.suppressContextMenuTimer);
      this.suppressContextMenuTimer = null;
    }

    this.endedSub?.unsubscribe();
    this.endedSub = null;

    this.reducedMotionMql.removeEventListener('change', this.onReducedMotionChange);

    const host = this.el.nativeElement;
    host.removeEventListener('touchstart', this.onTouchStart, { capture: true });
    host.removeEventListener('mousedown', this.onMouseDownCapture, { capture: true });
    host.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    host.removeEventListener('pointerdown', this.onPointerDown);
    host.removeEventListener('pointermove', this.onPointerMove);
    host.removeEventListener('pointerup', this.onPointerUp);
    host.removeEventListener('pointercancel', this.onPointerCancel);

    this.el.nativeElement.classList.remove('long-press-active');
  }
}
