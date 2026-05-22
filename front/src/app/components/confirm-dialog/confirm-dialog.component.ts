import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslateService } from '@ngx-translate/core';
import { ButtonComponent } from '../button/button.component';

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
  imports: [MatDialogModule, MatIconModule, ButtonComponent],
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
        <app-button variant="ghost" size="sm" [mat-dialog-close]="false">
          {{ data.cancelLabel || translate.instant('common.cancel') }}
        </app-button>
        <app-button
          size="sm"
          [variant]="data.destructive ? 'danger' : 'primary'"
          [mat-dialog-close]="true">
          @if (data.destructive) {
            <mat-icon>delete</mat-icon>
          }
          <span>{{ data.confirmLabel || translate.instant('common.confirm') }}</span>
        </app-button>
      </mat-dialog-actions>
    </div>
  `,
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  readonly translate = inject(TranslateService);
}
