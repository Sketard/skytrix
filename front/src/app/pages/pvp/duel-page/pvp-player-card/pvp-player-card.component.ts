import { ChangeDetectionStrategy, Component, computed, HostBinding, input } from '@angular/core';
import { Player, TimerStateMsg } from '../../duel-ws.types';
import { AvatarComponent } from '../../../../shared/avatar';
import { LpAnimData, PvpLpBadgeComponent } from '../pvp-lp-badge/pvp-lp-badge.component';
import { PvpTimerBadgeComponent } from '../pvp-timer-badge/pvp-timer-badge.component';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Unified player HUD card — groups avatar + pseudo + timer + LP into a single
 * surface ancrée hors-board (left/right lateral void on wide screens, overlay
 * fallback on narrow). Active-turn glow drives peripheral awareness.
 *
 * Wave 3 follow-up (2026-05-17) — replaces the trio of standalone badges
 * (lp / timer / no pseudo) that felt cramped near the Extra Deck.
 */
@Component({
  selector: 'app-pvp-player-card',
  templateUrl: './pvp-player-card.component.html',
  styleUrl: './pvp-player-card.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent, PvpLpBadgeComponent, PvpTimerBadgeComponent, TranslatePipe],
})
export class PvpPlayerCardComponent {
  readonly side = input.required<'player' | 'opponent'>();
  readonly pseudo = input<string>('');
  readonly lp = input.required<number>();
  readonly animatingLp = input<LpAnimData | null>(null);
  readonly timerState = input<TimerStateMsg | null>(null);
  readonly turnPlayer = input<Player>(0);
  readonly actor = input<'me' | 'opp'>('me');
  readonly opponentDisconnected = input(false);

  /** True when this card's owner is currently the active turn player. */
  readonly isActiveTurn = computed(() => {
    const s = this.side();
    if (s === 'player') return this.actor() === 'me';
    return this.actor() === 'opp';
  });

  /** Variant string consumed by the inner timer-badge (it expects 'player' / 'opp'). */
  readonly timerVariant = computed(() => (this.side() === 'player' ? 'player' : 'opp') as 'player' | 'opp');

  // Host classes — drive the absolute positioning in the parent stacking context.
  @HostBinding('class.host--player')   get cssHostPlayer()   { return this.side() === 'player'; }
  @HostBinding('class.host--opponent') get cssHostOpponent() { return this.side() === 'opponent'; }

  /** Fallback pseudo for the avatar when none is provided (e.g. solo mode). */
  readonly displayPseudo = computed(() => {
    const p = this.pseudo();
    if (p) return p;
    return this.side() === 'player' ? 'You' : 'Opponent';
  });
}
