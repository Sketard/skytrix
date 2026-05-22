import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { DuelDevStateService } from '../duel-dev-hub/duel-dev-state.service';

export interface LpAnimData {
  player: number;
  fromLp: number;
  toLp: number;
  type: 'damage' | 'recover';
  durationMs: number;
}

/** Floating "-XXX / +XXX" delta shown beside the LP value on every change.
 *  `seq` lets two identical deltas re-trigger the animation. */
interface LpDeltaState {
  text: string;
  kind: 'damage' | 'recover';
  seq: number;
}

@Component({
  selector: 'app-pvp-lp-badge',
  templateUrl: './pvp-lp-badge.component.html',
  styleUrl: './pvp-lp-badge.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.embedded]': 'embedded()' },
})
export class PvpLpBadgeComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly lp = input.required<number>();
  readonly side = input.required<'player' | 'opponent'>();
  readonly animatingLp = input<LpAnimData | null>(null);
  /** Embedded mode — flows inline inside pvp-player-card (no floating badge
   *  chrome) instead of being a standalone board badge. */
  readonly embedded = input(false);

  private readonly _displayedLp = signal<number | null>(null);
  readonly flashType = signal<'damage' | 'recover' | null>(null);
  /** Floating delta indicator state — null = hidden. */
  readonly deltaState = signal<LpDeltaState | null>(null);
  private rafId: number | null = null;
  private deltaSeq = 0;

  /** Dev hub override — `forcedLowLp = true` forces the player badge into
   *  danger state regardless of the actual LP value. Production-safe via the
   *  canonical `override()` helper (the forced signal is no-op in prod
   *  through `DuelDevStateService._signal`). */
  private readonly devState = inject(DuelDevStateService);

  /** Opponent badge is anchored top-right of the board — the delta must
   *  float on the LEFT of the LP value so it doesn't run off-screen. */
  readonly deltaOnLeft = computed(() => this.side() === 'opponent');

  readonly isDanger = computed(() => {
    // Opp side never honours the dev override — pass through the real value.
    if (this.side() !== 'player') {
      const value = this._displayedLp() ?? this.lp();
      return value <= 2000;
    }
    return this.devState.override(this.devState.forcedLowLp, () => {
      const value = this._displayedLp() ?? this.lp();
      return value <= 2000;
    });
  });

  readonly formattedLp = computed(() => {
    const displayed = this._displayedLp();
    const value = displayed ?? this.lp();
    return String(Math.round(value));
  });

  constructor() {
    effect(() => {
      const anim = this.animatingLp();
      if (anim) {
        this.startLpInterpolation(anim);
        this.showDelta(anim.toLp - anim.fromLp);
      } else {
        this.stopInterpolation();
      }
    });

    // Dev hub LP delta test — replay the full animation (counter + delta)
    // on a synthetic damage/recover. Only ever fires in dev mode (the pulse
    // signal stays null in prod since the hub is isDevMode()-gated).
    // The body reads/writes `_displayedLp`; it MUST stay untracked or the
    // effect would re-trigger itself on every counter frame → infinite loop.
    effect(() => {
      const pulse = this.devState.devLpPulse();
      if (!pulse) return;
      untracked(() => {
        const from = this._displayedLp() ?? this.lp();
        const to = Math.max(0, from + pulse.amount);
        this.startLpInterpolation({
          player: 0,
          fromLp: from,
          toLp: to,
          type: pulse.amount < 0 ? 'damage' : 'recover',
          durationMs: this.lpCounterDuration(),
        });
        this.showDelta(to - from);
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    });
  }

  /** Token-driven counter duration (× nothing — caller already scaled it
   *  for real events; the dev pulse reads the raw token). */
  private lpCounterDuration(): number {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--pvp-transition-lp-counter').trim();
    return parseFloat(raw) || 0;
  }

  /** Show the floating "-XXX / +XXX". Skipped when delta is 0 or under
   *  prefers-reduced-motion (the keyframes are disabled there, so the
   *  `animationend` cleanup would never fire). */
  private showDelta(delta: number): void {
    if (delta === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.deltaState.set({
      text: (delta > 0 ? '+' : '−') + Math.abs(delta),
      kind: delta < 0 ? 'damage' : 'recover',
      seq: ++this.deltaSeq,
    });
  }

  /** Called from the template on the delta's `move` animation end — the
   *  delta's own duration is decoupled from (and longer than) the counter. */
  protected onDeltaAnimationEnd(): void {
    this.deltaState.set(null);
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
