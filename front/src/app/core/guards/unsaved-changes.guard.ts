import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { DeckBuilderComponent } from '../../pages/deck-page/components/deck-builder/deck-builder.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';

export const unsavedChangesGuard: CanDeactivateFn<DeckBuilderComponent> = (component) => {
  if (!component.deckBuildService.isDirty() || component.deckBuildService.isSaving()) return true;

  const dialog = inject(MatDialog);
  const translate = inject(TranslateService);
  const dialogRef = dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
    data: {
      title: translate.instant('deckBuilder.unsavedChangesTitle'),
      message: translate.instant('deckBuilder.unsavedChangesMessage'),
      confirmLabel: translate.instant('deckBuilder.unsavedChangesLeave'),
      cancelLabel: translate.instant('deckBuilder.unsavedChangesStay'),
    },
    width: '360px',
    panelClass: ['pvp-dialog-panel'],
    autoFocus: false,
  });

  return dialogRef.afterClosed().pipe(map(result => !!result));
};
