// DEV ONLY — to be removed before final ship.
// End-flow tab content for `DuelDevHubComponent`. Owner: duel-end-flow-spec §8.
//
// Categories shipped:
//   I — Result overlay (6 fixtures: victory/defeat/draw × normal/disconnect/timeout)
//   J — Rematch state (5 states drive the Rematch button label + pulse)
//
// Category H (surrender dialog dry-run) is intentionally NOT shipped here:
// the existing Surrender button in the duel UI already opens the (refreshed)
// dialog. Adding a dedicated "Open" button in the hub would duplicate UI without
// new test coverage. Re-add if a use case appears.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DuelDevStateService, DevRematchState } from './duel-dev-state.service';
import { RESULT_FIXTURES, REMATCH_STATES } from './end-flow-fixtures';

@Component({
  selector: 'app-duel-dev-hub-end-flow-tab',
  templateUrl: './duel-dev-hub-end-flow-tab.component.html',
  styleUrl: './duel-dev-hub-end-flow-tab.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuelDevHubEndFlowTabComponent {
  protected readonly devState = inject(DuelDevStateService);
  protected readonly fixtures = RESULT_FIXTURES;
  protected readonly rematchStates = REMATCH_STATES;

  protected setResult(key: string): void {
    const f = RESULT_FIXTURES.find(x => x.key === key);
    this.devState.forcedResultOutcome.set(f ? f.value : null);
  }

  protected clearResult(): void {
    this.devState.forcedResultOutcome.set(null);
    this.devState.forcedRematchState.set(null);
  }

  protected setRematchState(state: DevRematchState | null): void {
    this.devState.forcedRematchState.set(state);
  }

  /** Match the current `forcedResultOutcome` value back to a fixture key (or null). */
  protected activeFixtureKey(): string | null {
    const current = this.devState.forcedResultOutcome();
    if (!current) return null;
    return RESULT_FIXTURES.find(f =>
      f.value.outcome === current.outcome && f.value.cause === current.cause
    )?.key ?? null;
  }
}
