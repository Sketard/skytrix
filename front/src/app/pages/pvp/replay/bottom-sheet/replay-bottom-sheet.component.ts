import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { BottomSheetHandleComponent } from '../../../../shared/bottom-sheet-handle/bottom-sheet-handle.component';

// Reusable bottom-sheet content wrapper. Designed to be opened via `MatDialog`
// (`{ panelClass: 'replay-bottom-sheet-panel', position: { bottom: '0' } }`)
// and projects two slots:
//   <header-icon>  → optional emoji/glyph in the title row
//   <default>      → main body content
//
// The shared `<app-bottom-sheet-handle>` is rendered as the first child (drag-
// to-close + a11y hooks). The `.bottom-sheet`/`.bottom-sheet-header`/
// `.bottom-sheet-body` visuals come from `_bottom-sheet.scss` (Viewer F0 partial).
//
// Close behaviour:
//   - The X button + Esc handler call `dialogRef.close()` if a MatDialogRef is
//     injected; otherwise emit `(close)` for non-Dialog usage.
@Component({
  selector: 'app-replay-bottom-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, BottomSheetHandleComponent, A11yModule],
  templateUrl: './replay-bottom-sheet.component.html',
  styleUrl: './replay-bottom-sheet.component.scss',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': 'title()',
    tabindex: '-1',
    cdkTrapFocus: '',
    cdkTrapFocusAutoCapture: '',
  },
})
export class ReplayBottomSheetComponent {
  /** Title shown in the header — can be a raw string or an i18n key (caller passes already-translated text). */
  readonly title = input.required<string>();
  /** Optional Material-Icons name displayed before the title. Empty string = none. */
  readonly icon = input<string>('');

  readonly close = output<void>();

  private readonly dialogRef = inject(MatDialogRef, { optional: true });

  protected onClose(): void {
    if (this.dialogRef) {
      this.dialogRef.close();
    } else {
      this.close.emit();
    }
  }
}
