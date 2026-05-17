import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Player, TimerStateMsg } from '../../duel-ws.types';
import { MatIcon } from '@angular/material/icon';

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

  readonly remainingSec = computed(() => {
    const state = this.timerState();
    if (!state) return null;
    return Math.max(0, Math.floor(state.remainingMs / 1000));
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
    const state = this.timerState();
    if (!state) return 100;
    return Math.max(0, Math.min(100, (state.remainingMs / TOTAL_TURN_MS) * 100));
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
}
