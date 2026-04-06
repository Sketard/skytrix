import { effect, Injectable, inject, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslateService } from '@ngx-translate/core';
import { NotificationService } from '../../../core/services/notification.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import type { ConnectionStatus } from '../types';

@Injectable()
export class DuelConnectionEffectsService {

  private readonly wsService = inject(DuelWebSocketService);
  private readonly notify = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  private previousConnectionStatus: ConnectionStatus | null = null;
  private previousOpponentDisconnected: boolean | null = null;

  initEffects(): void {
    // Story 3.3 — "Connection restored" snackbar on reconnection
    effect(() => {
      const current = this.wsService.connectionStatus();
      const prev = this.previousConnectionStatus;
      untracked(() => {
        if (prev === 'reconnecting' && current === 'connected') {
          this.notify.success('success.CONNECTION_RESTORED');
          this.liveAnnouncer.announce(this.translate.instant('duel.a11y.connectionRestored'));
        }
        this.previousConnectionStatus = current;
      });
    });

    // Story 3.3 — "Opponent reconnected" snackbar
    effect(() => {
      const current = this.wsService.opponentDisconnected();
      const prev = this.previousOpponentDisconnected;
      untracked(() => {
        if (prev === true && current === false && !this.wsService.duelResult()) {
          this.notify.success('success.OPPONENT_RECONNECTED');
        }
        this.previousOpponentDisconnected = current;
      });
    });
  }
}
