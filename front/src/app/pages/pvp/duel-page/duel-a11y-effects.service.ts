import { effect, Injectable, inject, Signal, untracked } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TranslateService } from '@ngx-translate/core';
import { NotificationService } from '../../../core/services/notification.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import type { DuelState } from '../types';
import type { TimerStateMsg } from '../duel-ws.types';

@Injectable()
export class DuelA11yEffectsService {

  private readonly wsService = inject(DuelWebSocketService);
  private readonly tabGuard = inject(DuelTabGuardService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly notify = inject(NotificationService);

  private announcedThresholds = new Set<number>();
  private lastAnnouncedTurnPlayer: number | null = null;
  private previousChainLinksCount = 0;
  private awaitingStateSyncAfterBackground = false;
  private lastKnownTurnCount = 0;

  /** Called by component's visibilitychange listener when tab goes hidden. */
  markAwaitingStateSync(turnCount: number): void {
    this.lastKnownTurnCount = turnCount;
    this.awaitingStateSyncAfterBackground = true;
  }

  initEffects(config: {
    logicalState: Signal<DuelState>;
    resultOutcome: Signal<{ outcome: string; reason: string; cause: string } | null>;
    displayedTimerState: Signal<TimerStateMsg | null>;
    ownPlayerIndex: Signal<number>;
  }): void {
    // Story 5.2 — STATE_SYNC auto-resolved snackbar + "Board state refreshed" announcer
    effect(() => {
      const state = config.logicalState();
      untracked(() => {
        if (!this.awaitingStateSyncAfterBackground) return;
        this.awaitingStateSyncAfterBackground = false;
        if (this.lastKnownTurnCount > 0 && state.turnCount > this.lastKnownTurnCount) {
          const turns = state.turnCount - this.lastKnownTurnCount;
          const msg = turns > 1
            ? this.translate.instant('duel.a11y.autoResolvedPlural', { count: turns })
            : this.translate.instant('duel.a11y.autoResolvedSingle');
          this.notify.success(msg, undefined, 5000);
          this.liveAnnouncer.announce(msg);
        }
        this.liveAnnouncer.announce(this.translate.instant('duel.a11y.boardRefreshed'));
        this.lastKnownTurnCount = state.turnCount;
      });
    });

    // Story 5.2 — Tab guard blocked state announcement + auto-focus button
    effect(() => {
      const blocked = this.tabGuard.isBlocked();
      if (blocked) {
        untracked(() => {
          this.liveAnnouncer.announce(this.translate.instant('duel.a11y.activeOtherTab'));
          setTimeout(() => {
            const btn = document.querySelector<HTMLButtonElement>('.blocked-tab-overlay__btn');
            btn?.focus();
          });
        });
      }
    });

    // Story 3.4 — LiveAnnouncer announces duel result
    effect(() => {
      const result = config.resultOutcome();
      if (!result) return;
      untracked(() => {
        const outcomeKey = `duel.result.${result.outcome}`;
        this.liveAnnouncer.announce(`${this.translate.instant(outcomeKey)} — ${result.reason}`);
      });
    });

    // Story 3.2 — LiveAnnouncer timer warnings at 60s, 30s, 10s (own timer only)
    effect(() => {
      const ts = config.displayedTimerState();
      if (!ts) return;
      untracked(() => {
        if (ts.player !== config.ownPlayerIndex()) return;

        const totalSec = Math.floor(ts.remainingMs / 1000);
        const thresholds = [60, 30, 10];
        for (const t of thresholds) {
          if (totalSec < t && !this.announcedThresholds.has(t)) {
            this.announcedThresholds.add(t);
          }
        }
        for (const t of thresholds) {
          if (totalSec <= t && !this.announcedThresholds.has(t)) {
            this.announcedThresholds.add(t);
            this.liveAnnouncer.announce(this.translate.instant('duel.a11y.secondsRemaining', { t }));
            break;
          }
        }
      });
    });

    // Story 3.2 — Announce turn changes
    effect(() => {
      const turnPlayer = config.logicalState().turnPlayer;
      untracked(() => {
        if (this.lastAnnouncedTurnPlayer === null) {
          this.lastAnnouncedTurnPlayer = turnPlayer;
          return;
        }
        if (turnPlayer !== this.lastAnnouncedTurnPlayer) {
          this.lastAnnouncedTurnPlayer = turnPlayer;
          this.announcedThresholds.clear();
          const msg = this.translate.instant(turnPlayer === 0 ? 'duel.a11y.yourTurn' : 'duel.a11y.opponentTurn');
          this.liveAnnouncer.announce(msg);
        }
      });
    });

    // Story 4.1 — LiveAnnouncer: "Chain resolved" when chain links go from non-empty -> empty
    effect(() => {
      const links = this.wsService.activeChainLinks();
      untracked(() => {
        if (links.length === 0 && this.previousChainLinksCount > 0) {
          this.liveAnnouncer.announce(this.translate.instant('duel.a11y.chainResolved'));
        }
        this.previousChainLinksCount = links.length;
      });
    });
  }
}
