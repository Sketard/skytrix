import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';

@Component({
  selector: 'app-inactivity-warning-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton],
  template: `
    <h2 mat-dialog-title>Are you still there?</h2>
    <mat-dialog-content>
      <p>You will forfeit due to inactivity if you don't respond.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button (click)="acknowledge()">I'm here</button>
    </mat-dialog-actions>
  `,
})
export class InactivityWarningDialogComponent {
  constructor(private readonly dialogRef: MatDialogRef<InactivityWarningDialogComponent>) {}

  acknowledge(): void {
    this.dialogRef.close(true);
  }
}
