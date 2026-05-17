// DEV ONLY — to be removed before final ship.
// Board tab content for `DuelDevHubComponent`. Owner: board enrichment spec §8.4.
//
// Sprint 2 delivers Category A only (theme switcher). Subsequent categories
// (B = actor override, C = timer urgency, D = mock states, E = phase
// announcement) will be added incrementally as their feature lands.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DUEL_THEMES, DuelTheme, DuelThemeService } from '../duel-theme.service';

@Component({
  selector: 'app-duel-dev-hub-board-tab',
  templateUrl: './duel-dev-hub-board-tab.component.html',
  styleUrl: './duel-dev-hub-board-tab.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuelDevHubBoardTabComponent {
  protected readonly themes = DUEL_THEMES;
  protected readonly themeService = inject(DuelThemeService);

  protected setTheme(theme: DuelTheme): void {
    this.themeService.setTheme(theme);
  }
}
