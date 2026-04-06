import { Injectable, OnDestroy, signal } from '@angular/core';

export interface DuelToast {
  icon: string;
  lines: string[];
}

/**
 * Lightweight toast service for transient game feedback (coin flips, dice rolls).
 * Component-scoped — same pattern as PhaseAnnouncementService.
 */
@Injectable()
export class DuelToastService implements OnDestroy {
  private readonly _toast = signal<DuelToast | null>(null);
  readonly toast = this._toast.asReadonly();

  private _timer: ReturnType<typeof setTimeout> | null = null;

  show(toast: DuelToast, durationMs: number): void {
    this.clear();
    this._toast.set(toast);
    this._timer = setTimeout(() => {
      this._toast.set(null);
      this._timer = null;
    }, durationMs);
  }

  clear(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._toast.set(null);
  }

  ngOnDestroy(): void {
    this.clear();
  }
}
