import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-inactivity-warning-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'duel.inactivity.title' | translate }}</h2>
    <mat-dialog-content>
      <p>{{ 'duel.inactivity.warning' | translate }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button (click)="acknowledge()">{{ 'duel.inactivity.confirm' | translate }}</button>
    </mat-dialog-actions>
  `,
})
export class InactivityWarningDialogComponent {
  constructor(private readonly dialogRef: MatDialogRef<InactivityWarningDialogComponent>) {}

  acknowledge(): void {
    this.dialogRef.close(true);
  }
}
