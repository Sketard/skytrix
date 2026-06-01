import { ChangeDetectionStrategy, Component, Inject, Optional } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

export interface InactivityWarningDialogData {
  soloMode?: boolean;
}

@Component({
  selector: 'app-inactivity-warning-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'duel.inactivity.title' | translate }}</h2>
    <mat-dialog-content>
      <p>{{ warningKey | translate }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button (click)="acknowledge()">{{ 'duel.inactivity.confirm' | translate }}</button>
    </mat-dialog-actions>
  `,
})
export class InactivityWarningDialogComponent {
  readonly warningKey: string;

  constructor(
    private readonly dialogRef: MatDialogRef<InactivityWarningDialogComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) data: InactivityWarningDialogData | null,
  ) {
    this.warningKey = data?.soloMode ? 'duel.inactivity.warningSolo' : 'duel.inactivity.warning';
  }

  acknowledge(): void {
    this.dialogRef.close(true);
  }
}
