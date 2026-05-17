// DEV ONLY — to be removed before final ship.
// Board tab content for `DuelDevHubComponent`. Owner: board enrichment spec §8.4.
//
// Categories shipped:
//   A — Thème de plateau (3 radios, drives DuelThemeService)
//   B — Acteur courant (Moi / Adversaire, drives forcedActor)
//   C — Urgence timer player (Green / Yellow / Red, drives forcedTimerMs)
//   D — Mock states (toggles: opponent disconnected, replay readOnly, low LP)
//   E — Force phase (6 buttons, drives forcedPhase + triggers announcement)
//
// Categories not yet wired in production data flow (deferred):
//   - forcedChainPhase = 'resolving' (needs hooking into chain-overlay consumer)

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Phase } from '../../duel-ws.types';
import { PhaseAnnouncementService } from '../phase-announcement.service';
import { DUEL_THEMES, DuelTheme, DuelThemeService } from '../duel-theme.service';
import { DuelDevStateService } from './duel-dev-state.service';

const URGENCY_PRESETS = [
  { key: 'green',  label: 'Green 1:47', ms: 107_000 },
  { key: 'yellow', label: 'Yellow 0:42', ms: 42_000 },
  { key: 'red',    label: 'Red 0:14',   ms: 14_000 },
] as const;

type UrgencyKey = (typeof URGENCY_PRESETS)[number]['key'];

const PHASE_PRESETS: ReadonlyArray<{ key: Phase; label: string }> = [
  { key: 'DRAW',         label: 'DP' },
  { key: 'STANDBY',      label: 'SP' },
  { key: 'MAIN1',        label: 'M1' },
  { key: 'BATTLE_START', label: 'BP' },
  { key: 'MAIN2',        label: 'M2' },
  { key: 'END',          label: 'EP' },
];

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
  private readonly phaseService = inject(PhaseAnnouncementService);

  protected readonly urgencyPresets = URGENCY_PRESETS;
  protected readonly phasePresets = PHASE_PRESETS;

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

  protected toggleLowLp(): void {
    const curr = this.devState.forcedLowLp();
    this.devState.forcedLowLp.set(curr === true ? null : true);
  }

  /** Cat E — set the displayed phase AND trigger a phase announcement overlay.
   *  Major phases (MAIN1/BATTLE_START/MAIN2/END) will fire the overlay; minor
   *  phases (DRAW/STANDBY) are filtered silently by the service. */
  protected setPhase(phase: Phase): void {
    this.devState.forcedPhase.set(phase);
    // Manually trigger the announcement service; turnPlayer/turnCount are
    // approximate dev values (the real ones live in renderedState).
    this.phaseService.show(this.phaseService.phaseDisplayName(phase), false, phase, 0, 1);
  }

  protected clearPhase(): void {
    this.devState.forcedPhase.set(null);
  }
}
