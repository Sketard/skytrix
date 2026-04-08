import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';

import type { SolverAction } from '../../../core/model/solver.model';

interface BreadcrumbItem {
  action: SolverAction;
  imageUrl: string;
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

  readonly hoverChipIndex = signal<number | null>(null);
  private hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.hoverLeaveTimer) clearTimeout(this.hoverLeaveTimer);
    });
  }

  readonly breadcrumbs = computed<BreadcrumbItem[]>(() => {
    const path = this.mainPath();
    const imgMap = this.cardImageMap();
    return path.map(action => ({
      action,
      imageUrl: imgMap.get(action.cardId) ?? 'assets/images/card_back.jpg',
    }));
  });

  onChipEnter(index: number): void {
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
    this.hoverChipIndex.set(index);
  }

  onChipLeave(): void {
    this.hoverLeaveTimer = setTimeout(() => {
      this.hoverChipIndex.set(null);
      this.hoverLeaveTimer = null;
    }, 80);
  }

  onPopupEnter(): void {
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith('card_back.jpg')) {
      img.src = 'assets/images/card_back.jpg';
    }
  }
}
