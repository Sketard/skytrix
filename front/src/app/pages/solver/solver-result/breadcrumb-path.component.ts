import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';

import type { SolverAction } from '../../../core/model/solver.model';
import { onCardImgError } from './card-image-fallback';
import { createHoverPopupController } from './hover-popup.controller';

interface BreadcrumbItem {
  action: SolverAction;
  imageUrl: string;
  isHandtrap: boolean;
}

@Component({
  selector: 'app-breadcrumb-path',
  standalone: true,
  imports: [MatChipsModule, MatIconModule, CdkConnectedOverlay, CdkOverlayOrigin],
  templateUrl: './breadcrumb-path.component.html',
  styleUrl: './breadcrumb-path.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreadcrumbPathComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly mainPath = input.required<SolverAction[]>();
  readonly cardImageMap = input.required<Map<number, string>>();
  readonly chipClick = output<SolverAction>();

  private readonly hoverCtrl = createHoverPopupController<number>(this.destroyRef);
  readonly hoverChipIndex = this.hoverCtrl.hoverKey;

  readonly breadcrumbs = computed<BreadcrumbItem[]>(() => {
    const path = this.mainPath();
    const imgMap = this.cardImageMap();
    return path.map(action => {
      const inDeck = imgMap.has(action.cardId);
      return {
        action,
        imageUrl: inDeck ? imgMap.get(action.cardId)! : `/api/documents/small/code/${action.cardId}`,
        isHandtrap: !inDeck,
      };
    });
  });

  onChipEnter(index: number): void {
    this.hoverCtrl.enter(index);
  }

  onChipLeave(): void {
    this.hoverCtrl.leave();
  }

  onPopupEnter(): void {
    this.hoverCtrl.popupEnter();
  }

  onImgError = onCardImgError;
}
