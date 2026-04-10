import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateService } from '@ngx-translate/core';
import type { HistoryEntry, SolverResult } from '../../../core/model/solver.model';

function relativeTime(ts: number, translate: TranslateService): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return translate.instant('solver.history.justNow');
  if (diff < 3600) return translate.instant('solver.history.minutesAgo', { n: Math.floor(diff / 60) });
  return translate.instant('solver.history.hoursAgo', { n: Math.floor(diff / 3600) });
}

@Component({
  selector: 'app-solver-history-menu',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .history-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px 0;
      min-width: 280px;
    }
    .history-line1 {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .history-score {
      font-weight: 600;
    }
    .history-mode {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    .history-minimax {
      font-size: 11px;
      opacity: 0.8;
    }
    .history-partial {
      font-size: 10px;
      font-style: italic;
      opacity: 0.7;
    }
    .history-time {
      margin-left: auto;
      font-size: 11px;
      opacity: 0.6;
    }
    .history-line2 {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 320px;
    }
    .history-active {
      opacity: 0.5;
    }
  `,
  template: `
    <button mat-icon-button [matMenuTriggerFor]="historyMenu" [attr.aria-label]="historyButtonLabel()">
      <mat-icon>history</mat-icon>
    </button>
    <mat-menu #historyMenu="matMenu">
      @for (entry of reversedHistory(); track entry.timestamp) {
        <button mat-menu-item
                [class.history-active]="currentResult() === entry.result"
                (click)="restore.emit(entry)">
          <div class="history-item">
            <div class="history-line1">
              <span class="history-score">{{ entry.result.score }}</span>
              <span class="history-mode">{{ modeLabel(entry) }}</span>
              @if (entry.config.mode === 'adversarial' && entry.result.minimax != null) {
                <span class="history-minimax">{{ minimaxLabel() }} {{ entry.result.minimax }}</span>
              }
              @if (entry.partial) {
                <span class="history-partial">{{ partialLabel() }}</span>
              }
              <span class="history-time">{{ relativeTime(entry.timestamp) }}</span>
            </div>
            <div class="history-line2">{{ entry.config.deckName }} · {{ handSummary(entry) }}</div>
          </div>
        </button>
      }
    </mat-menu>
  `,
})
export class SolverHistoryMenuComponent {
  private readonly translate = inject(TranslateService);

  readonly history = input.required<HistoryEntry[]>();
  readonly currentResult = input<SolverResult | null>(null);
  readonly restore = output<HistoryEntry>();

  readonly reversedHistory = computed(() => [...this.history()].reverse());
  readonly historyButtonLabel = computed(() => this.translate.instant('solver.history.button'));

  modeLabel(entry: HistoryEntry): string {
    return entry.config.mode === 'adversarial'
      ? this.translate.instant('solver.history.adversarial')
      : this.translate.instant('solver.history.goldfish');
  }

  minimaxLabel(): string {
    return this.translate.instant('solver.history.minimax');
  }

  partialLabel(): string {
    return this.translate.instant('solver.history.partial');
  }

  relativeTime(ts: number): string {
    return relativeTime(ts, this.translate);
  }

  handSummary(entry: HistoryEntry): string {
    return entry.handCardNames.join(', ');
  }
}
