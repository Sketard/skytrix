import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Player, TimerStateMsg } from '../../duel-ws.types';
import { MatIcon } from '@angular/material/icon';
import { TranslateService } from '@ngx-translate/core';
import { DuelDevStateService } from '../duel-dev-hub/duel-dev-state.service';

type TimerVariant = 'player' | 'opp';
type TimerUrgency = 'normal' | 'soon' | 'urgent';

const SOON_SECONDS = 120;   // ≤ 2 min  → yellow
const URGENT_SECONDS = 30;  // ≤ 30 sec → red
const TOTAL_TURN_MS = 300_000; // 5 min — used for bar-fill progress fallback.

@Component({
  selector: 'app-pvp-timer-badge',
  templateUrl: './pvp-timer-badge.component.html',
  styleUrl: './pvp-timer-badge.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinner, MatIcon],
})
export class PvpTimerBadgeComponent {
  readonly timerState = input<TimerStateMsg | null>(null);
  readonly turnPlayer = input<Player>(0);
  readonly opponentDisconnected = input(false);
  /** Visual variant — 'player' (bottom-left, readable) or 'opp' (top-right, blurred). */
  readonly variant = input<TimerVariant>('player');
  /** Current actor — drives dimming when this side is inactive. */
  readonly actor = input<'me' | 'opp'>('me');
  /** Embedded mode — flows inline inside pvp-player-card (no floating chrome,
   *  no absolute positioning) instead of being a standalone board badge. */
  readonly embedded = input(false);

  /** Dev override — only honoured on the player variant (opp is brouillé anyway). */
  private readonly devState = inject(DuelDevStateService);

  /** Effective remainingMs after applying the dev-only `forcedTimerMs` override
   *  on the player variant. Production-safe: the forced signal is a `_signal()`
   *  whose setters are no-op in prod, so `forced()` always reads null and
   *  `override()` short-circuits to the real timerState. */
  readonly effectiveRemainingMs = computed<number | null>(() => {
    const forced = this.variant() === 'player' ? this.devState.forcedTimerMs() : null;
    if (forced != null) return forced;
    return this.timerState()?.remainingMs ?? null;
  });

  readonly remainingSec = computed(() => {
    const ms = this.effectiveRemainingMs();
    if (ms == null) return null;
    return Math.max(0, Math.floor(ms / 1000));
  });

  readonly timeFormatted = computed(() => {
    const sec = this.remainingSec();
    if (sec == null) return '--:--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  });

  readonly urgency = computed<TimerUrgency>(() => {
    const sec = this.remainingSec();
    if (sec == null) return 'normal';
    if (sec <= URGENT_SECONDS) return 'urgent';
    if (sec <= SOON_SECONDS) return 'soon';
    return 'normal';
  });

  /** Bar-fill width 0..100 (% of TOTAL_TURN_MS). Bound as CSS custom property `--p`. */
  readonly progressPercent = computed(() => {
    const ms = this.effectiveRemainingMs();
    if (ms == null) return 100;
    return Math.max(0, Math.min(100, (ms / TOTAL_TURN_MS) * 100));
  });

  /** True when this badge represents the active turn player. */
  readonly isActive = computed(() => {
    const v = this.variant();
    if (v === 'player') return this.actor() === 'me';
    return this.actor() === 'opp';
  });

  /** Replace the timer body with a connecting spinner — opp variant only. */
  readonly showDisconnect = computed(
    () => this.variant() === 'opp' && this.opponentDisconnected()
  );

  private readonly translate = inject(TranslateService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  /** A11y label — `Your timer: {{value}}` (player, dynamic) or `Opponent timer
   *  (hidden by design)` (opp, fixed). Used as the only label read by screen
   *  readers; the row + bar are aria-hidden behind it. */
  readonly ariaLabel = computed(() => {
    if (this.variant() === 'opp') {
      return this.translate.instant('duel.a11y.timerOppHidden');
    }
    return this.translate.instant('duel.a11y.timerPlayer', { value: this.timeFormatted() });
  });

  constructor() {
    // Announce urgency transitions only — green→yellow→red on the player timer.
    // Avoid `aria-live` on the element itself (would read every tick).
    let lastUrgency: TimerUrgency = 'normal';
    effect(() => {
      const u = this.urgency();
      if (this.variant() !== 'player') return;
      if (u === lastUrgency) return;
      untracked(() => {
        const sec = this.remainingSec();
        if (sec != null && (u === 'soon' || u === 'urgent')) {
          this.liveAnnouncer.announce(
            this.translate.instant('duel.a11y.secondsRemaining', { t: sec }),
            u === 'urgent' ? 'assertive' : 'polite',
          );
        }
      });
      lastUrgency = u;
    });
  }
}
