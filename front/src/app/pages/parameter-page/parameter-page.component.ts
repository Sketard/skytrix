import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnDestroy, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ParameterService } from '../../services/parameter.service';
import { NotificationService } from '../../core/services/notification.service';
import { MatIconModule } from '@angular/material/icon';
import { HttpErrorResponse } from '@angular/common/http';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription, interval } from 'rxjs';
import { TaskState } from '../../core/model/sync-status';

type JobKey = 'cards' | 'images' | 'tcgImages' | 'banlist' | 'duelData';

interface Job {
  readonly key: JobKey;
  readonly titleKey: string;
  readonly descKey: string;
}

interface Section {
  readonly key: string;
  readonly icon: string;
  readonly titleKey: string;
  readonly jobs: readonly Job[];
}

const SECTIONS: readonly Section[] = [
  {
    key: 'database',
    icon: 'storage',
    titleKey: 'settings.database',
    jobs: [
      { key: 'cards', titleKey: 'settings.updateCards', descKey: 'settings.updateCardsDesc' },
    ],
  },
  {
    key: 'images',
    icon: 'image',
    titleKey: 'settings.images',
    jobs: [
      { key: 'images',    titleKey: 'settings.originalImages',  descKey: 'settings.originalImagesDesc' },
      { key: 'tcgImages', titleKey: 'settings.translatedImages', descKey: 'settings.translatedImagesDesc' },
    ],
  },
  {
    key: 'duelServer',
    icon: 'sports_esports',
    titleKey: 'settings.duelServer',
    jobs: [
      { key: 'duelData', titleKey: 'settings.updateDuelData', descKey: 'settings.updateDuelDataDesc' },
    ],
  },
  {
    key: 'rules',
    icon: 'gavel',
    titleKey: 'settings.rules',
    jobs: [
      { key: 'banlist', titleKey: 'settings.updateBanlist', descKey: 'settings.updateBanlistDesc' },
    ],
  },
];

@Component({
  selector: 'app-parameter-page',
  imports: [MatIconModule, MatTooltip, TranslatePipe],
  templateUrl: './parameter-page.component.html',
  styleUrl: './parameter-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParameterPageComponent implements OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private pollSub: Subscription | null = null;

  readonly sections = signal<readonly Section[]>(SECTIONS);
  readonly loading = signal<Record<JobKey, boolean>>({
    cards: false, images: false, tcgImages: false, banlist: false, duelData: false,
  });
  readonly taskStates = signal<Record<string, TaskState>>({});

  private readonly notify = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly supportService = inject(ParameterService);

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // ===== Job dispatch — single entry point keyed on JobKey =====================

  trigger(key: JobKey): void {
    this.setLoading(key, true);
    switch (key) {
      case 'cards':     return this.runFire('cards',     this.supportService.fetchDatabaseCards(),    'success.CARDS_UPDATED');
      case 'images':    return this.runTracked('images', this.supportService.fetchDatabaseImages());
      case 'tcgImages': return this.runTracked('tcgImages', this.supportService.fetchDatabaseTcgImages());
      case 'duelData':  return this.runTracked('duelData', this.supportService.updateDuelData());
      case 'banlist':   return this.runTracked('banlist',  this.supportService.fetchDatabaseBanlist());
    }
  }

  // Synchronous-style call: the HTTP completes, then we fire a notify.
  // Used historically for endpoints that didn't return until done. With the
  // back-side `processAsynchronously` + tracker wiring (2026-05-16), `cards`
  // and `banlist` now also return immediately and rely on the poll loop —
  // but we keep this branch for any future synchronous endpoint.
  private runFire(key: JobKey, obs: ReturnType<ParameterService['fetchDatabaseCards']>, successKey: string): void {
    obs.subscribe({
      next: () => this.startPolling(),
      error: (error: HttpErrorResponse) => this.onError(key, error),
    });
  }

  private runTracked(key: JobKey, obs: ReturnType<ParameterService['fetchDatabaseImages']>): void {
    obs.subscribe({
      next: () => this.startPolling(),
      error: (error: HttpErrorResponse) => this.onError(key, error),
    });
  }

  // ===== Polling — tracks tasks running on the back ============================

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
          const jobKey = key as JobKey;
          if (state.status === 'RUNNING' || state.status === 'PAUSED') {
            this.setLoading(jobKey, true);
            anyActive = true;
          } else if (this.loading()[jobKey] && state.status === 'IDLE') {
            this.setLoading(jobKey, false);
            if (state.error) {
              // Error remains visible inline via `getError()`. Toast is silent
              // for tracked tasks to avoid double-signalling.
            } else if (state.total > 0) {
              localStorage.setItem(`sync_${key}_lastDate`, new Date().toISOString());
              if (state.total > 1) {
                // Image syncs report processed / failed counts.
                this.notify.success('success.IMAGE_SYNC_DONE', { success: state.processed, failed: state.failed });
              } else {
                this.notify.success('success.SYNC_DONE');
              }
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

  // ===== Template helpers ======================================================

  isTracked(key: string): boolean {
    const state = this.taskStates()[key];
    return !!state && (state.status === 'RUNNING' || state.status === 'PAUSED');
  }

  isPaused(key: string): boolean {
    return this.taskStates()[key]?.status === 'PAUSED';
  }

  hasError(key: string): boolean {
    const state = this.taskStates()[key];
    return !!state && state.status === 'IDLE' && !!state.error;
  }

  getError(key: string): string {
    return this.taskStates()[key]?.error ?? '';
  }

  getTotal(key: string): number {
    return this.taskStates()[key]?.total ?? 0;
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

  statusPillClass(key: string): string {
    if (this.hasError(key))     return 'pill pill--danger';
    if (this.isPaused(key))     return 'pill pill--warning';
    if (this.isTracked(key))    return 'pill pill--cyan pill--live';
    return 'pill pill--neutral';
  }

  statusLabelKey(key: string): string {
    if (this.hasError(key))  return 'settings.status.error';
    if (this.isPaused(key))  return 'settings.status.paused';
    if (this.isTracked(key)) return 'settings.status.running';
    return 'settings.status.idle';
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
    if (!raw) return this.translate.instant('settings.neverSynced');
    const date = new Date(raw);
    const diff = Date.now() - date.getTime();
    const rtf = new Intl.RelativeTimeFormat(this.translate.currentLang, { numeric: 'auto' });
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return rtf.format(-seconds, 'second');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-Math.floor(hours / 24), 'day');
  }

  private setLoading(key: JobKey, value: boolean): void {
    this.loading.update(l => ({ ...l, [key]: value }));
  }

  private onError(key: JobKey, error: HttpErrorResponse | string): void {
    this.setLoading(key, false);
    this.notify.error(error);
  }
}
