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
    // β.3 cas #13 (2026-05-26) — DRAW announce is gated by the
    // `onDrawNewTurn` callback fired from `DuelConnection` right BEFORE
    // each MSG_DRAW that starts a new turn (turn hash delta). Calling
    // `phaseService.show('DRAW', …)` here enqueues the directive on the
    // animation queue just before the triggering MSG_DRAW lands, so the
    // banner is visible BEFORE the card-draw animation. The bridge's
    // logicalState/phase effect below skips 'DRAW' for the same reason
    // (already covered here).
    this.wsService.attachDrawNewTurnSink((turnPlayer, _turnCount) => {
      const isOpponent = turnPlayer !== 0;
      const label = this.phaseService.phaseDisplayName('DRAW');
      this.phaseService.show(label, isOpponent, 'DRAW', turnPlayer as 0 | 1, _turnCount);
    });

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

    // Phase announcement overlay — show on every phase change.
    // β.3 cas #13 fix (2026-05-26) — `roomState` MUST be tracked reactively
    // alongside `logicalState`. The legacy `untracked(() => roomState())`
    // missed the `connecting → duel-loading → active` transition when it
    // happened BETWEEN two phase changes : the effect last re-fired on the
    // bootstrap BOARD_STATE (roomState=connecting → skipped), then no
    // logicalState change preceded the user's first MAIN1 → the effect
    // never re-fired post-active, and the opening DRAW + MAIN1 announces
    // were silently dropped. Tracking roomState forces a re-fire on the
    // active flip, which then sees the current phase and announces it.
    effect(() => {
      const state = config.logicalState();
      const rs = config.roomState();
      const phase = state.phase;
      const turnPlayer = state.turnPlayer;
      const turnCount = state.turnCount;
      untracked(() => {
        const key = `${turnPlayer}-${phase}`;
        // Skip if board not active yet (init, connecting, duel-loading) — prevents
        // EMPTY_DUEL_STATE (phase='DRAW') and STATE_SYNC restore from triggering announcements
        if (rs !== 'active') return;
        if (!phase || key === this.lastAnnouncedPhase) return;
        // β.3 cas #13 — DRAW is handled by the `onDrawNewTurn` sink (mid-game)
        // and by DuelLoadingEffects (boot), so the banner enqueues BEFORE
        // the triggering MSG_DRAW (the WS order is MSG_DRAW → BOARD_STATE
        // (phase=DRAW), so this effect would otherwise enqueue the banner
        // AFTER the draw animation).
        if (phase === 'DRAW') {
          this.lastAnnouncedPhase = key;
          return;
        }
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
