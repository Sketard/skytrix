// =============================================================================
// hover-popup.controller.ts — Tiny stateful helper for the "hover with grace
// period" popup pattern shared by hero-result-block, breadcrumb-path, and
// decision-tree. Each component opens a CDK Overlay on mouseenter and keeps
// it open while the cursor is over the trigger OR the popup itself; the
// 80ms leave delay lets users cross the gap between the two without flicker.
// =============================================================================

import { signal, Signal, DestroyRef } from '@angular/core';

const LEAVE_DELAY_MS = 80;

export interface HoverPopupController<K> {
  /** Currently-hovered key (null when nothing is hovered). */
  readonly hoverKey: Signal<K | null>;
  /** Call from the trigger's mouseenter — opens (or keeps open) the popup. */
  enter(key: K): void;
  /** Call from the trigger's mouseleave — schedules a delayed close. */
  leave(): void;
  /** Call from the popup's mouseenter — cancels the pending close. */
  popupEnter(): void;
}

export function createHoverPopupController<K>(destroyRef: DestroyRef): HoverPopupController<K> {
  const hoverKey = signal<K | null>(null);
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelLeaveTimer = (): void => {
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  };

  destroyRef.onDestroy(cancelLeaveTimer);

  return {
    hoverKey,
    enter(key) {
      cancelLeaveTimer();
      hoverKey.set(key);
    },
    leave() {
      cancelLeaveTimer();
      leaveTimer = setTimeout(() => {
        hoverKey.set(null);
        leaveTimer = null;
      }, LEAVE_DELAY_MS);
    },
    popupEnter() {
      cancelLeaveTimer();
    },
  };
}
