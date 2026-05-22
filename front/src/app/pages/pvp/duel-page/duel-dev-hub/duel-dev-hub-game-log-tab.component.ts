// DEV ONLY — to be removed before final ship.
// Game Log tab content for `DuelDevHubComponent` (Lot 3d, analysis §3.7 / O11).
//
// Triggers the opponent-effect bubble (Surface 2) on demand: each fixture
// feeds a synthetic `MSG_CHAINING` through `DuelGameLogService.injectDevChaining`
// — the REAL pipeline (mechanism D1), so the bubble is exercised end-to-end
// (opponent-only filter, last-wins replace, anti-flicker floor).
//
// `DuelGameLogService` is provided at the duel-page / replay-page level; the
// dev hub is mounted inside `pvp-board-container` (a page child), so the
// service resolves up the injector chain. `injectDevChaining` is a no-op in
// production builds.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DuelGameLogService } from '../duel-game-log.service';
import {
  EFFECT_BUBBLE_FIXTURES,
  type EffectBubbleFixture,
} from './effect-bubble-fixtures';

@Component({
  selector: 'app-duel-dev-hub-game-log-tab',
  templateUrl: './duel-dev-hub-game-log-tab.component.html',
  styleUrl: './duel-dev-hub-game-log-tab.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuelDevHubGameLogTabComponent {
  private readonly gameLog = inject(DuelGameLogService);
  protected readonly fixtures = EFFECT_BUBBLE_FIXTURES;

  protected trigger(fixture: EffectBubbleFixture): void {
    this.gameLog.injectDevChaining(fixture.value);
  }
}
