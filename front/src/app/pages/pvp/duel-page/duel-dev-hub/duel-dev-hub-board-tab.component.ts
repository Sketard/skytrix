// DEV ONLY — to be removed before final ship.
// Board tab content for `DuelDevHubComponent`. Owner: board enrichment spec §8.4.
//
// Categories shipped:
//   A — Thème de plateau (3 radios, drives DuelThemeService)
//   B — Acteur courant (Moi / Adversaire, drives forcedActor)
//   C — Urgence timer player (Green / Yellow / Red, drives forcedTimerMs)
//   D — Mock states (toggles: opponent disconnected, replay readOnly)
//
// Categories not yet wired in production data flow (deferred):
//   - forcedChainPhase = 'resolving' (needs hooking into chain-overlay consumer)
//   - forcedLowLp (needs hooking into LP badge danger threshold)
//   - phase announcement / reduced motion toggles

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DUEL_THEMES, DuelTheme, DuelThemeService } from '../duel-theme.service';
import { DuelDevStateService } from './duel-dev-state.service';

const URGENCY_PRESETS = [
  { key: 'green',  label: 'Green 1:47', ms: 107_000 },
  { key: 'yellow', label: 'Yellow 0:42', ms: 42_000 },
  { key: 'red',    label: 'Red 0:14',   ms: 14_000 },
] as const;

type UrgencyKey = (typeof URGENCY_PRESETS)[number]['key'];

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
  protected readonly devState = inject(DuelDevStateService);

  protected readonly urgencyPresets = URGENCY_PRESETS;

  /** True while actor is forced to opp — disables the timer urgency buttons
   *  since a player-side timer has no meaning on opponent turns. */
  protected readonly timerDisabled = computed(() => this.devState.forcedActor() === 'opp');

  /** Maps the current forced timer value to one of the preset keys (or null). */
  protected readonly activeUrgency = computed<UrgencyKey | null>(() => {
    const ms = this.devState.forcedTimerMs();
    if (ms == null) return null;
    const match = URGENCY_PRESETS.find(p => p.ms === ms);
    return match?.key ?? null;
  });

  protected setTheme(theme: DuelTheme): void {
    this.themeService.setTheme(theme);
  }

  protected setActor(actor: 'me' | 'opp' | null): void {
    this.devState.forcedActor.set(actor);
    // Switching to opp invalidates any forced player timer urgency.
    if (actor === 'opp') this.devState.forcedTimerMs.set(null);
  }

  protected setUrgency(key: UrgencyKey | null): void {
    if (key == null) {
      this.devState.forcedTimerMs.set(null);
      return;
    }
    const preset = URGENCY_PRESETS.find(p => p.key === key);
    if (preset) this.devState.forcedTimerMs.set(preset.ms);
  }

  protected toggleOpponentDisconnected(): void {
    const curr = this.devState.forcedOpponentDisconnected();
    this.devState.forcedOpponentDisconnected.set(curr === true ? null : true);
  }

  protected toggleReadOnly(): void {
    const curr = this.devState.forcedReadOnly();
    this.devState.forcedReadOnly.set(curr === true ? null : true);
  }
}
