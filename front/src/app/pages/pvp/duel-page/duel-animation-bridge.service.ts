import { effect, Injectable, inject, Signal, untracked } from '@angular/core';
import { DuelWebSocketService } from './duel-web-socket.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { PhaseAnnouncementService } from './phase-announcement.service';
import { CardDataCacheService } from './card-data-cache.service';
import { DebugLogService } from './debug-log.service';
import type { DuelState } from '../types';
import type { RoomState } from './room-state-machine.service';

@Injectable()
export class DuelAnimationBridgeService {

  private readonly wsService = inject(DuelWebSocketService);
  private readonly animationService = inject(AnimationOrchestratorService);
  private readonly phaseService = inject(PhaseAnnouncementService);
  private readonly cardDataCache = inject(CardDataCacheService);
  private readonly debugLog = inject(DebugLogService);

  private lastAnnouncedPhase: string | null = null;

  /** Called by component's onStateSync callback to suppress phase announcement on reconnect. */
  silenceCurrentPhase(phase: string | undefined, turnPlayer: number): void {
    if (phase) this.lastAnnouncedPhase = `${turnPlayer}-${phase}`;
  }

  initEffects(config: {
    logicalState: Signal<DuelState>;
    isAnimating: Signal<boolean>;
    roomState: Signal<RoomState>;
  }): void {
    // Story 5.1 — Clear card data cache and animation state on rematch
    effect(() => {
      const starting = this.wsService.rematchStarting();
      if (starting) {
        untracked(() => {
          this.cardDataCache.clearCache();
          this.debugLog.clearLogs();
          this.animationService.onStateSync();
        });
      }
    });

    // Phase announcement overlay — show on every phase change
    effect(() => {
      const state = config.logicalState();
      const phase = state.phase;
      const turnPlayer = state.turnPlayer;
      const turnCount = state.turnCount;
      untracked(() => {
        // Skip if board not active yet (init, connecting, duel-loading) — prevents
        // EMPTY_DUEL_STATE (phase='DRAW') and STATE_SYNC restore from triggering announcements
        if (config.roomState() !== 'active') return;
        const key = `${turnPlayer}-${phase}`;
        if (!phase || key === this.lastAnnouncedPhase) return;
        this.lastAnnouncedPhase = key;

        const isOpponent = turnPlayer !== 0;
        const label = this.phaseService.phaseDisplayName(phase);
        this.phaseService.show(label, isOpponent, phase, turnPlayer, turnCount);
      });
    });

    // Story 4.2 — Animation queue watcher: delegate to animation service
    effect(() => {
      const queue = this.wsService.animationQueue();
      untracked(() => {
        if (queue.length > 0) {
          this.animationService.startProcessingIfIdle();
        }
      });
    });

    // Story 4.2 — Reset tracked LP when BOARD_STATE arrives (authoritative sync)
    effect(() => {
      const state = config.logicalState();
      untracked(() => {
        if (state.players.length === 2 && !config.isAnimating()) {
          this.animationService.syncTrackedLp(state.players[0].lp, state.players[1].lp);
        }
      });
    });
  }
}
