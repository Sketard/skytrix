import { effect, Injectable, inject, untracked, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { NotificationService } from '../../../core/services/notification.service';
import { SoloDuelOrchestratorService } from './solo-duel-orchestrator.service';
import { RoomStateMachineService } from './room-state-machine.service';

@Injectable()
export class SoloModeEffectsService {

  private readonly orchestrator = inject(SoloDuelOrchestratorService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Shared connection-loss effect used by both fork and solo modes. */
  private initConnectionLoss(): void {
    effect(() => {
      if (this.orchestrator.connectionLost()) {
        untracked(() => {
          this.notify.error('error.CONNECTION_LOST_LOBBY');
          this.router.navigate(['/pvp']);
        });
      }
    });
  }

  /** Fork mode — connection loss only. */
  initFork(): void {
    this.initConnectionLoss();
  }

  /** Solo mode — connection loss, player persistence, rematch reset. */
  initSolo(config: {
    soloTokensKey: string;
    wsToken1: string;
    wsToken2: string;
    roomService: RoomStateMachineService;
    thumbnailsReady: WritableSignal<boolean>;
  }): void {
    this.initConnectionLoss();

    // Persist active player index so refresh restores the same view
    effect(() => {
      const activePlayer = this.orchestrator.activePlayerIndex();
      untracked(() => {
        try { sessionStorage.setItem(config.soloTokensKey, JSON.stringify({ wsToken1: config.wsToken1, wsToken2: config.wsToken2, activePlayer })); } catch {}
      });
    });

    // Handle rematch reset in solo mode — re-set roomState and thumbnailsReady
    effect(() => {
      const count = this.orchestrator.rematchReset();
      if (count > 0) {
        untracked(() => {
          config.roomService.forceState('active');
          config.thumbnailsReady.set(true);
        });
      }
    });
  }
}
