import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Player, TimerStateMsg } from '../../duel-ws.types';

@Component({
  selector: 'app-pvp-timer-badge',
  templateUrl: './pvp-timer-badge.component.html',
  styleUrl: './pvp-timer-badge.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinner],
})
export class PvpTimerBadgeComponent {
  readonly timerState = input<TimerStateMsg | null>(null);
  readonly turnPlayer = input<Player>(0);
  readonly opponentDisconnected = input(false);

  readonly display = computed(() => {
    const state = this.timerState();
    if (!state) return '--';
    const totalSec = Math.max(0, Math.floor(state.remainingMs / 1000));
    return `${totalSec}s`;
  });

  readonly colorClass = computed(() => {
    const state = this.timerState();
    if (!state) return '';
    const totalSec = Math.floor(state.remainingMs / 1000);
    if (totalSec <= 30) return 'timer--red';
    if (totalSec <= 120) return 'timer--yellow';
    return 'timer--green';
  });

  readonly isActive = computed(() => {
    const state = this.timerState();
    return state?.player === this.turnPlayer();
  });

  readonly disconnectDisplay = computed(() =>
    this.opponentDisconnected() ? 'Opponent connecting...' : null
  );
}
