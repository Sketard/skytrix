import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';

export interface LpAnimData {
  player: number;
  fromLp: number;
  toLp: number;
  type: 'damage' | 'recover';
  durationMs: number;
}

@Component({
  selector: 'app-pvp-lp-badge',
  templateUrl: './pvp-lp-badge.component.html',
  styleUrl: './pvp-lp-badge.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpLpBadgeComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly lp = input.required<number>();
  readonly side = input.required<'player' | 'opponent'>();
  readonly animatingLp = input<LpAnimData | null>(null);

  private readonly _displayedLp = signal<number | null>(null);
  readonly flashType = signal<'damage' | 'recover' | null>(null);
  private rafId: number | null = null;

  readonly formattedLp = computed(() => {
    const displayed = this._displayedLp();
    const value = displayed ?? this.lp();
    if (value >= 10000) {
      return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return String(Math.round(value));
  });

  constructor() {
    effect(() => {
      const anim = this.animatingLp();
      if (anim) {
        this.startLpInterpolation(anim);
      } else {
        this.stopInterpolation();
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    });
  }

  private startLpInterpolation(anim: LpAnimData): void {
    this.stopInterpolation();
    this.flashType.set(anim.type);

    // [Review C1 fix] Use token-driven duration from parent — 0ms under prefers-reduced-motion
    const duration = anim.durationMs;
    if (duration <= 0) {
      // Reduced motion: snap to final value immediately (AC9 / Task 6.8)
      this._displayedLp.set(anim.toLp);
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.stopInterpolation();
      });
      return;
    }

    this._displayedLp.set(anim.fromLp);
    const start = performance.now();
    const from = anim.fromLp;
    const delta = anim.toLp - from;

    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      this._displayedLp.set(from + delta * t);
      if (t < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.stopInterpolation();
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private stopInterpolation(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._displayedLp.set(null);
    this.flashType.set(null);
  }
}
