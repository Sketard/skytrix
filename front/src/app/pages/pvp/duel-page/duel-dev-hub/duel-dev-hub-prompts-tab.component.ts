// DEV ONLY — to be removed before final ship.
// Prompts tab content for `DuelDevHubComponent`. Owner: duel-prompts-refresh-spec §9.
//
// Sprint 1 ships 4 base fixtures (Y/N, Option List, Card Grid Target,
// Numeric Counter). Additional variants (Sort, Position, Multi-counter,
// Announce, Zone Highlight, shell states) will be added as their refresh
// lands in subsequent sprints (cf spec §8 / §9.7 ordre de livraison).

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Prompt } from '../../types';
import { DuelDevStateService } from './duel-dev-state.service';
import { PROMPT_FIXTURES } from './prompt-fixtures';

@Component({
  selector: 'app-duel-dev-hub-prompts-tab',
  templateUrl: './duel-dev-hub-prompts-tab.component.html',
  styleUrl: './duel-dev-hub-prompts-tab.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuelDevHubPromptsTabComponent {
  protected readonly devState = inject(DuelDevStateService);
  protected readonly fixtures = PROMPT_FIXTURES;

  protected setPrompt(value: Prompt): void {
    this.devState.forcedPrompt.set(value);
  }

  protected hideAll(): void {
    this.devState.forcedPrompt.set(null);
  }

  /** Match the current `forcedPrompt` back to a fixture key (or null). */
  protected activeKey(): string | null {
    const current = this.devState.forcedPrompt();
    if (!current) return null;
    return PROMPT_FIXTURES.find(f => f.value === current)?.key ?? null;
  }
}
