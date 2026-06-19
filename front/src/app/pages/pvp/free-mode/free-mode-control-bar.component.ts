import { ChangeDetectionStrategy, Component, inject, isDevMode, output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { CommandStackService } from './engine/command-stack.service';
import { IconButtonComponent } from '../../../components/icon-button/icon-button.component';
import { MatIcon } from '@angular/material/icon';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog.component';

/**
 * Free-mode control bar — undo / redo / reset. The FIRST concrete step of the
 * simulator migration (chantier 2): extracted from `app-sim-control-bar` WITHOUT
 * its Router dependency (the sim bar's `onBack` navigates to `/decks`, a
 * sim-specific leak). Reset reuses the platform-agnostic ConfirmDialog. Lives in
 * `free-mode/` — the survivor location, not `simulator/`.
 */
@Component({
  selector: 'app-free-mode-control-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './free-mode-control-bar.component.html',
  styleUrl: './free-mode-control-bar.component.scss',
  imports: [IconButtonComponent, MatIcon],
})
export class FreeModeControlBarComponent {
  // Public so the template reads canUndo()/canRedo() directly off the stack —
  // no re-exposed local signal (avoids the pipeline-signal-tagged rule on a
  // pure passthrough of external edit-engine state).
  readonly commandStack = inject(CommandStackService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  /** Fired after a confirmed reset so the page can clear editor state that lives
   *  OUTSIDE the command stack (counters, armed card) — `reset()` rebuilds the
   *  board with deterministic instanceIds, so stale counters would re-bind. */
  readonly didReset = output<void>();

  onUndo(): void {
    try {
      this.commandStack.undo();
    } catch (e) {
      if (isDevMode()) console.warn('Undo failed:', e);
    }
  }

  onRedo(): void {
    try {
      this.commandStack.redo();
    } catch (e) {
      if (isDevMode()) console.warn('Redo failed:', e);
    }
  }

  async onReset(): Promise<void> {
    const t = await firstValueFrom(
      this.translate.get([
        'freeMode.resetTitle', 'freeMode.resetMessage', 'common.confirm', 'common.cancel',
      ]),
    );
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: t['freeMode.resetTitle'],
        message: t['freeMode.resetMessage'],
        confirmLabel: t['common.confirm'],
        cancelLabel: t['common.cancel'],
      } as ConfirmDialogData,
      width: '320px',
      panelClass: ['pvp-dialog-panel'],
      autoFocus: false,
    });

    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;
    try {
      this.commandStack.reset();
      this.didReset.emit();
    } catch (e) {
      if (isDevMode()) console.warn('Reset failed:', e);
    }
  }
}
