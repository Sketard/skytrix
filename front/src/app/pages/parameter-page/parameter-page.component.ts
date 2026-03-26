import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnDestroy, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ParameterService } from '../../services/parameter.service';
import { MatButton, MatIconButton } from '@angular/material/button';
import { NotificationService } from '../../core/services/notification.service';
import { MatCard } from '@angular/material/card';
import { MatDivider } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatProgressBar } from '@angular/material/progress-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription, interval } from 'rxjs';
import { TaskState } from '../../core/model/sync-status';

type LoadingKey = 'cards' | 'images' | 'tcgImages' | 'banlist' | 'duelData';

@Component({
  selector: 'app-parameter-page',
  imports: [MatButton, MatIconButton, MatCard, MatDivider, MatIconModule, MatProgressSpinner, MatProgressBar, MatTooltip, TranslatePipe],
  templateUrl: './parameter-page.component.html',
  styleUrl: './parameter-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParameterPageComponent implements OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private pollSub: Subscription | null = null;
  readonly loading = signal<Record<LoadingKey, boolean>>({ cards: false, images: false, tcgImages: false, banlist: false, duelData: false });
  readonly taskStates = signal<Record<string, TaskState>>({});

  private readonly notify = inject(NotificationService);
  private readonly translateService = inject(TranslateService);

  constructor(
    private readonly supportService: ParameterService,
  ) {}

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private startPolling(): void {
    if (this.pollSub) return;
    this.pollSub = interval(2000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.pollStatus());
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  private pollStatus(): void {
    this.supportService.getSyncStatus().subscribe({
      next: (status) => {
        this.taskStates.set(status);
        let anyActive = false;
        for (const [key, state] of Object.entries(status)) {
          const loadingKey = key as LoadingKey;
          if (state.status === 'RUNNING' || state.status === 'PAUSED') {
            this.setLoading(loadingKey, true);
            anyActive = true;
          } else if (this.loading()[loadingKey] && state.status === 'IDLE') {
            this.setLoading(loadingKey, false);
            if (state.error) {
              this.notify.error(state.error);
            } else if (state.total > 0) {
              localStorage.setItem(`sync_${key}_lastDate`, new Date().toISOString());
              this.notify.success('success.IMAGE_SYNC_DONE', { success: state.processed, failed: state.failed });
            } else {
              this.notify.success('success.NO_MISSING_IMAGES');
            }
          }
        }
        const anyLoading = Object.values(this.loading()).some(v => v);
        if (!anyActive && !anyLoading) {
          this.stopPolling();
        }
      },
    });
  }

  getProgress(key: string): number {
    const state = this.taskStates()[key];
    if (!state || state.total === 0) return 0;
    return Math.round(((state.processed + state.failed) / state.total) * 100);
  }

  getProgressLabel(key: string): string {
    const state = this.taskStates()[key];
    if (!state || state.total === 0) return '';
    return `${state.processed + state.failed} / ${state.total}`;
  }

  isPaused(key: string): boolean {
    return this.taskStates()[key]?.status === 'PAUSED';
  }

  isTracked(key: string): boolean {
    const state = this.taskStates()[key];
    return !!state && (state.status === 'RUNNING' || state.status === 'PAUSED');
  }

  togglePause(key: string): void {
    if (this.isPaused(key)) {
      this.supportService.resumeTask(key).subscribe();
    } else {
      this.supportService.pauseTask(key).subscribe();
    }
  }

  lastSync(key: string): string {
    const raw = localStorage.getItem(`sync_${key}_lastDate`);
    if (!raw) return this.translateService.instant('settings.neverSynced');
    const date = new Date(raw);
    const diff = Date.now() - date.getTime();
    const rtf = new Intl.RelativeTimeFormat(this.translateService.currentLang, { numeric: 'auto' });
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return rtf.format(-seconds, 'second');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-Math.floor(hours / 24), 'day');
  }

  private setLoading(key: LoadingKey, value: boolean): void {
    this.loading.update(l => ({ ...l, [key]: value }));
  }

  private onSuccess(key: string, i18nKey: string): void {
    localStorage.setItem(`sync_${key}_lastDate`, new Date().toISOString());
    this.setLoading(key as LoadingKey, false);
    this.notify.success(i18nKey);
  }

  private onError(key: LoadingKey, error: HttpErrorResponse | string): void {
    this.setLoading(key, false);
    this.notify.error(error);
  }

  public fetchDatabaseCards() {
    this.setLoading('cards', true);
    this.supportService.fetchDatabaseCards().subscribe({
      next: () => this.onSuccess('cards', 'success.CARDS_UPDATED'),
      error: (error: HttpErrorResponse) => this.onError('cards', error),
    });
  }

  public fetchDatabaseImages() {
    this.setLoading('images', true);
    this.supportService.fetchDatabaseImages().subscribe({
      next: () => this.startPolling(),
      error: (error: HttpErrorResponse) => this.onError('images', error),
    });
  }

  public fetchDatabaseTcgImages() {
    this.setLoading('tcgImages', true);
    this.supportService.fetchDatabaseTcgImages().subscribe({
      next: () => this.startPolling(),
      error: (error: HttpErrorResponse) => this.onError('tcgImages', error),
    });
  }

  public fetchDatabaseBanlist() {
    this.setLoading('banlist', true);
    this.supportService.fetchDatabaseBanlist().subscribe({
      next: () => this.onSuccess('banlist', 'success.BANLIST_UPDATED'),
      error: (error: HttpErrorResponse) => this.onError('banlist', error),
    });
  }

  public updateDuelData() {
    this.setLoading('duelData', true);
    this.supportService.updateDuelData().subscribe({
      next: () => this.startPolling(),
      error: (error: HttpErrorResponse) => this.onError('duelData', error),
    });
  }
}
