import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';

@Component({
  selector: 'app-inactivity-warning-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton],
  template: `
    <h2 mat-dialog-title>Êtes-vous toujours là ?</h2>
    <mat-dialog-content>
      <p>Vous serez déclaré forfait pour inactivité si vous ne répondez pas.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-raised-button color="primary" (click)="acknowledge()">Je suis là</button>
    </mat-dialog-actions>
  `,
})
export class InactivityWarningDialogComponent {
  constructor(private readonly dialogRef: MatDialogRef<InactivityWarningDialogComponent>) {}

  acknowledge(): void {
    this.dialogRef.close(true);
  }
}
