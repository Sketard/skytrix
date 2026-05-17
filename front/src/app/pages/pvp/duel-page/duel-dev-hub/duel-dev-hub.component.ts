// DEV ONLY — to be removed before final ship.
// Sprint 0 shell : 3 onglets vides + listener `Ctrl+Shift+D` (toggle).
// Owner: duel-board-enrichment-spec-2026-05-17 §8.
// Tab contents are implemented by the 3 child specs (board / prompts / end-flow).

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { DuelDevStateService } from './duel-dev-state.service';
import { DuelDevHubBoardTabComponent } from './duel-dev-hub-board-tab.component';
import { DuelDevHubEndFlowTabComponent } from './duel-dev-hub-end-flow-tab.component';

type DevHubTab = 'board' | 'prompts' | 'end-flow';

@Component({
  selector: 'app-duel-dev-hub',
  templateUrl: './duel-dev-hub.component.html',
  styleUrl: './duel-dev-hub.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DuelDevHubBoardTabComponent, DuelDevHubEndFlowTabComponent],
})
export class DuelDevHubComponent {
  protected readonly devState = inject(DuelDevStateService);

  protected readonly visible = signal(false);
  protected readonly collapsed = signal(false);
  protected readonly activeTab = signal<DevHubTab>('board');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.devState.reset());
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.shiftKey && (event.key === 'D' || event.key === 'd')) {
      event.preventDefault();
      this.visible.update(v => !v);
    }
  }

  protected setTab(tab: DevHubTab): void {
    this.activeTab.set(tab);
  }

  protected toggleCollapsed(): void {
    this.collapsed.update(v => !v);
  }

  protected close(): void {
    this.visible.set(false);
  }

  protected resetAll(): void {
    this.devState.reset();
  }
}
