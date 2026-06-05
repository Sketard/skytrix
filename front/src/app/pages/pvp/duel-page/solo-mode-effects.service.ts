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
    roomService: RoomStateMachineService;
    thumbnailsReady: WritableSignal<boolean>;
  }): void {
    this.initConnectionLoss();

    // Persist active player index so refresh restores the same view.
    // c6a — SOLO multiplex passe à 1 token (PR1 A6) ; wsToken2 disparaît
    // du sessionStorage. Le `restorePerspectiveFromStorage` reste dans
    // l'orchestrator (c6c) côté localStorage A5.
    effect(() => {
      const activePlayer = this.orchestrator.perspectiveIndex();
      untracked(() => {
        try { sessionStorage.setItem(config.soloTokensKey, JSON.stringify({ wsToken1: config.wsToken1, activePlayer })); } catch {}
      });
    });

    // Handle rematch reset in solo mode — re-set roomState only.
    //
    // F11 review (animations-ready-protocol-2026-06-05) — DO NOT set
    // `thumbnailsReady=true` here. The previous code was a registration-
    // order trap : `DuelLoadingEffectsService`'s rematch effect (which
    // sets `thumbnailsReady=false` and clears `_animationsReadySent`)
    // runs AFTER this one by current registration order, so the final
    // value was correct. But a future refactor that swaps registration
    // order would emit ANIMATIONS_READY before the prefetch completes —
    // pop-in on the rematch's initial draws.
    //
    // The chain (`cardCodes` carried over) + (`prefetchStarted` reset by
    // loading effects) already re-runs the prefetch on rematch and flips
    // `thumbnailsReady=true` via the canonical path. The loading service
    // is the single owner of that signal.
    effect(() => {
      const count = this.orchestrator.rematchReset();
      if (count > 0) {
        untracked(() => {
          config.roomService.forceState('active');
        });
      }
    });
  }
}
