import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { ReplayService } from '../../services/replay.service';
import { AuthService } from '../../services/auth.service';
import { ReplayDTO } from '../../core/model/dto/replay-dto';
import { DuelResult } from '../../core/enums/duel-result.enum';
import { NotificationService } from '../../core/services/notification.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';
import { DatePipe } from '@angular/common';

interface ReplayRow {
  id: string;
  deckName: string;
  opponent: string;
  turnCount: number;
  resultIcon: string;
  resultColor: string;
  resultI18nKey: string;
  createdAt: string;
}

const RESULT_ICON_MAP: Record<DuelResult, { icon: string; color: string; i18nKey: string }> = {
  [DuelResult.VICTORY]: { icon: 'emoji_events', color: '#FFD700', i18nKey: 'replay.matchHistory.victory' },
  [DuelResult.DEFEAT]: { icon: 'close', color: '#EF4444', i18nKey: 'replay.matchHistory.defeat' },
  [DuelResult.DRAW]: { icon: 'horizontal_rule', color: '#9CA3AF', i18nKey: 'replay.matchHistory.draw' },
  [DuelResult.TIMEOUT]: { icon: 'timer_off', color: '#F59E0B', i18nKey: 'replay.matchHistory.timeout' },
  [DuelResult.DISCONNECT]: { icon: 'wifi_off', color: '#F59E0B', i18nKey: 'replay.matchHistory.disconnect' },
  [DuelResult.SURRENDER]: { icon: 'flag', color: '#EF4444', i18nKey: 'replay.matchHistory.surrender' },
  [DuelResult.OPPONENT_TIMEOUT]: { icon: 'timer_off', color: '#FFD700', i18nKey: 'replay.matchHistory.opponentTimeout' },
  [DuelResult.OPPONENT_DISCONNECT]: { icon: 'wifi_off', color: '#FFD700', i18nKey: 'replay.matchHistory.opponentDisconnect' },
  [DuelResult.OPPONENT_SURRENDER]: { icon: 'flag', color: '#FFD700', i18nKey: 'replay.matchHistory.opponentSurrender' },
};

@Component({
  selector: 'app-match-history-page',
  standalone: true,
  imports: [MatTableModule, MatPaginatorModule, MatProgressSpinnerModule, MatIconModule, MatButtonModule, TranslateModule, DatePipe],
  templateUrl: './match-history-page.component.html',
  styleUrl: './match-history-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchHistoryPageComponent implements OnInit, OnDestroy {
  private readonly replayService = inject(ReplayService);
  private readonly authService = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private loadSubscription?: Subscription;

  readonly displayedColumns = ['deckName', 'opponent', 'turnCount', 'result', 'date', 'actions'];
  readonly rows = signal<ReplayRow[]>([]);
  readonly totalElements = signal(0);
  readonly loading = signal(true);
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);

  ngOnInit(): void {
    this.loadReplays();
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
  }

  loadReplays(): void {
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.loadSubscription = this.replayService.getMatchHistory(this.pageIndex(), this.pageSize()).subscribe({
      next: page => {
        this.rows.set(page.elements.map(replay => this.toRow(replay)));
        this.totalElements.set(page.size);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      },
    });
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.loadReplays();
  }

  openReplay(row: ReplayRow): void {
    this.router.navigate(['/pvp/replay', row.id]);
  }

  async deleteReplay(row: ReplayRow, event: Event): Promise<void> {
    event.stopPropagation();
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('replay.matchHistory.delete'),
        message: this.translate.instant('replay.matchHistory.deleteConfirm'),
        confirmLabel: this.translate.instant('common.delete'),
      } as ConfirmDialogData,
      width: '320px',
      panelClass: ['pvp-dialog-panel', 'pvp-dialog-panel--danger'],
      autoFocus: false,
    });
    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;
    this.replayService.deleteReplay(row.id).subscribe({
      next: () => {
        this.rows.update(rows => rows.filter(r => r.id !== row.id));
        this.totalElements.update(n => n - 1);
      },
      error: err => this.notify.error(err),
    });
  }

  private toRow(replay: ReplayDTO): ReplayRow {
    const isPlayer1 = replay.player1Id === this.authService.user()?.id;
    const { icon, color, i18nKey } = RESULT_ICON_MAP[replay.metadata.result];
    return {
      id: replay.id,
      deckName: isPlayer1 ? replay.metadata.deckNames[0] : replay.metadata.deckNames[1],
      opponent: isPlayer1 ? replay.metadata.playerUsernames[1] : replay.metadata.playerUsernames[0],
      turnCount: replay.metadata.turnCount,
      resultIcon: icon,
      resultColor: color,
      resultI18nKey: i18nKey,
      createdAt: replay.createdAt,
    };
  }
}
