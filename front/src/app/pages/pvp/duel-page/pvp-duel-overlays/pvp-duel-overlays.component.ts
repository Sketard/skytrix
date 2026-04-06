import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { PhaseAnnouncement } from '../phase-announcement.service';
import type { DuelToast } from '../duel-toast.service';

@Component({
  selector: 'app-pvp-duel-overlays',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  styleUrls: ['../../_pvp-overlays.scss'],
  template: `
    <!-- Opponent thinking glow -->
    @if (opponentThinking()) {
      <div class="opponent-thinking-glow" aria-hidden="true"></div>
    }

    <!-- Phase announcement overlay -->
    @if (phaseAnnouncement(); as pa) {
      <div class="phase-announcement"
           [class.phase-announcement--opponent]="pa.isOpponent"
           role="status"
           aria-live="polite"
           aria-atomic="true">
        <div class="phase-announcement__band">
          @if (pa.isOpponent) {
            <span class="phase-announcement__prefix">{{ 'duel.rps.opponent' | translate }}</span>
            <span class="phase-announcement__separator">&mdash;</span>
          }
          <span class="phase-announcement__label">{{ pa.label }}</span>
        </div>
      </div>
    }

    <!-- Chain resolution announcement -->
    @if (chainResolutionAnnounce()) {
      <div class="phase-announcement phase-announcement--chain"
           role="status" aria-live="polite" aria-atomic="true">
        <div class="phase-announcement__band">
          <span class="phase-announcement__label">{{ 'duel.misc.chainResolution' | translate }}</span>
        </div>
      </div>
    }

    <!-- Game toast (coin flip, dice roll) -->
    @if (duelToast(); as t) {
      <div class="duel-toast" role="status" aria-live="polite" aria-atomic="true">
        <span class="duel-toast__icon">{{ t.icon }}</span>
        <div class="duel-toast__body">
          @for (line of t.lines; track $index) {
            <span class="duel-toast__line">{{ line }}</span>
          }
        </div>
      </div>
    }
  `,
})
export class PvpDuelOverlaysComponent {
  readonly phaseAnnouncement = input<PhaseAnnouncement | null>(null);
  readonly chainResolutionAnnounce = input(false);
  readonly opponentThinking = input(false);
  readonly duelToast = input<DuelToast | null>(null);
}
