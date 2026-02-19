import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map } from 'rxjs';
import { DeckBuilderComponent } from '../../pages/deck-page/components/deck-builder/deck-builder.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';

export const unsavedChangesGuard: CanDeactivateFn<DeckBuilderComponent> = (component) => {
  if (!component.deckBuildService.isDirty() || component.deckBuildService.isSaving()) return true;

  const dialog = inject(MatDialog);
  const dialogRef = dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
    data: {
      title: 'Modifications non sauvegardées',
      message: 'Voulez-vous quitter sans sauvegarder ?',
      confirmLabel: 'Quitter',
      cancelLabel: 'Rester',
    },
    autoFocus: false,
  });

  return dialogRef.afterClosed().pipe(map(result => !!result));
};
