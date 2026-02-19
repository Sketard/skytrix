import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';

export interface SnackbarData {
  message: string;
  type: 'success' | 'error';
  icon: string;
}

@Component({
  selector: 'app-snackbar',
  standalone: true,
  imports: [MatIconModule, MatIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './snackbar.component.html',
  styleUrl: './snackbar.component.scss',
})
export class SnackbarComponent {
  readonly data = inject<SnackbarData>(MAT_SNACK_BAR_DATA);
  readonly snackBarRef = inject(MatSnackBarRef);
}
