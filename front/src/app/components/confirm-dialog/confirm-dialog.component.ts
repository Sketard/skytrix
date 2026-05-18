import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateService } from '@ngx-translate/core';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * When true, renders a warning icon hero + the confirm CTA uses
   * `.btn--danger` instead of the default primary. Apply for any
   * irreversible operation (delete, ban, reset).
   */
  destructive?: boolean;
}

@Component({
  selector: 'confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="confirm-dialog" [class.confirm-dialog--destructive]="data.destructive">
      @if (data.destructive) {
        <div class="confirm-dialog__icon" aria-hidden="true">
          <mat-icon>warning</mat-icon>
        </div>
      }
      <h2 mat-dialog-title class="confirm-dialog__title">{{ data.title }}</h2>
      <mat-dialog-content class="confirm-dialog__message">{{ data.message }}</mat-dialog-content>
      <mat-dialog-actions align="end" class="confirm-dialog__actions">
        <button type="button" class="btn btn--ghost btn--sm" [mat-dialog-close]="false">
          {{ data.cancelLabel || translate.instant('common.cancel') }}
        </button>
        <button type="button"
          class="btn btn--sm"
          [class.btn--primary]="!data.destructive"
          [class.btn--danger]="data.destructive"
          [mat-dialog-close]="true">
          @if (data.destructive) {
            <mat-icon>delete</mat-icon>
          }
          <span>{{ data.confirmLabel || translate.instant('common.confirm') }}</span>
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .confirm-dialog {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      padding: var(--space-2);
    }

    .confirm-dialog__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      margin: 0 auto var(--space-3);
      border-radius: var(--radius-pill);
      background: var(--danger-soft);
      color: var(--danger-strong);

      mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        line-height: 28px;
      }
    }

    .confirm-dialog__title {
      font-family: var(--font-display);
      font-size: var(--text-lg);
      font-weight: var(--weight-bold);
      letter-spacing: 0.02em;
      margin: 0 0 var(--space-2);
    }

    .confirm-dialog--destructive .confirm-dialog__title {
      text-align: center;
    }

    .confirm-dialog__message {
      color: var(--text-secondary);
      font-size: var(--text-sm);
      line-height: var(--line-relaxed);
      padding-bottom: var(--space-4);
    }

    .confirm-dialog--destructive .confirm-dialog__message {
      text-align: center;
    }

    .confirm-dialog__actions {
      gap: var(--space-2);
      padding: 0;
    }
  `],
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  readonly translate = inject(TranslateService);
}
