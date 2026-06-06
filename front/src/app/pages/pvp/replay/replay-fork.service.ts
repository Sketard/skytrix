import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';

import { ReplayConnectionService } from './replay-connection.service';
import { NotificationService } from '../../../core/services/notification.service';
import { duelAssert } from '../../../core/utilities/duel-assert';
import type { ReplayStreamNavEntry } from '../replay-ws.types';
import { PHASE_TO_NUM, type Phase } from '../duel-ws.types';

@Injectable()
export class ReplayForkService {
  private readonly replayConnection = inject(ReplayConnectionService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);
  private readonly notify = inject(NotificationService);

  readonly forkEventIndex = signal<number | null>(null);
  /** Phase 6 (2026-06-06) — was `cachedBoardStates: PreComputedState[]`.
   *  Stores a snapshot of `navIndex` during the fork-warning interstitial
   *  so the replay-page timeline stays rendered while the user decides
   *  whether to accept the divergence. */
  readonly cachedNavIndex = signal<ReadonlyArray<ReplayStreamNavEntry>>([]);
  readonly forking = computed(() => this.replayConnection.forkStatus() === 'forking');

  private replayId: string | null = null;

  constructor() {
    effect(() => {
      const status = this.replayConnection.forkStatus();
      switch (status) {
        case 'ready':
          this.navigateToForkDuel();
          break;
        case 'warning': {
          const warning = this.replayConnection.forkWarning() ?? this.translate.instant('replay.viewer.divergenceWarning');
          const ref = this.snackBar.open(
            `${warning} — ${this.translate.instant('replay.viewer.forkDismissHint')}`,
            this.translate.instant('replay.viewer.continue'),
            { duration: 0 },
          );
          ref.onAction().subscribe(() => this.replayConnection.sendForkContinue());
          ref.afterDismissed().subscribe(info => {
            if (!info.dismissedByAction) {
              this.replayConnection.sendForkCancel();
              this.forkEventIndex.set(null);
              this.cachedNavIndex.set([]);
            }
          });
          break;
        }
        case 'error':
          this.replayConnection.resetForkState();
          this.notify.error('replay.viewer.forkError');
          break;
      }
    });
  }

  fork(currentIndex: number, navIndex: ReadonlyArray<ReplayStreamNavEntry>, replayId: string): void {
    if (this.replayConnection.forkStatus() !== 'idle') return;

    const entry = navIndex[currentIndex];
    if (!entry) return;

    this.replayId = replayId;
    this.forkEventIndex.set(currentIndex);
    this.cachedNavIndex.set([...navIndex]);

    const bs = entry.boardStateSnapshot;
    const phaseNum = PHASE_TO_NUM[bs.phase as Phase];
    duelAssert(phaseNum !== undefined, 'replay-fork', `Unknown phase: ${bs.phase}`);
    this.replayConnection.sendFork(entry.responseCount, {
      lp: [bs.players[0].lp, bs.players[1].lp] as [number, number],
      turnNumber: bs.turnCount,
      phase: phaseNum,
    });
  }

  cleanup(): void {
    this.replayConnection.resetForkState();
  }

  private navigateToForkDuel(): void {
    const tokens = this.replayConnection.forkTokens();
    if (!tokens || !this.replayId) return;

    // F5-bis (2026-05-31) — single-token state (collapsed to SOLO multiplex).
    this.router.navigate(['/pvp/duel', `fork-${this.replayId}`], {
      queryParams: { fork: 'true', replayId: this.replayId, seekTo: this.forkEventIndex() },
      state: { wsToken1: tokens.token1 },
    });
  }
}
