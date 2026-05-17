// DEV ONLY — to be removed before final ship.
// Owner: duel-board-enrichment-spec-2026-05-17 §8.3 (canonical definition).
// Cross-spec consumers: duel-prompts-refresh-spec-2026-05-17 §9,
// duel-end-flow-spec-2026-05-17 §8.

import { Injectable, isDevMode, signal, Signal, WritableSignal } from '@angular/core';
import { Phase } from '../../duel-ws.types';
import { Prompt } from '../../types';

export type DevResultOutcome = {
  outcome: 'victory' | 'defeat' | 'draw';
  reason: string;
  cause: string;
};

export type DevRematchState =
  | 'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired';

@Injectable({ providedIn: 'root' })
export class DuelDevStateService {
  /** Hub visibility — shared between the hub component (closes itself via
   *  the × button and Ctrl+Shift+D) and external triggers like the duel
   *  mini-toolbar button. NOT gated by `_signal()` because it's a UI toggle,
   *  not a data-flow override. In prod the hub component is gated by
   *  `isDevMode()` upstream so this signal is unreachable anyway. */
  readonly hubVisible = signal(false);

  toggleHub(): void {
    this.hubVisible.update(v => !v);
  }

  // ─── Onglet Board (board enrichment spec) ────────────────────
  readonly forcedActor = this._signal<'me' | 'opp' | null>(null);
  readonly forcedTimerMs = this._signal<number | null>(null);
  readonly forcedChainPhase = this._signal<'resolving' | null>(null);
  readonly forcedOpponentDisconnected = this._signal<boolean | null>(null);
  readonly forcedLowLp = this._signal<boolean | null>(null);
  readonly forcedReadOnly = this._signal<boolean | null>(null);
  /** Wave 3 Sprint 3 extension — Cat E force phase. Overrides displayedPhase
   *  passed to the phase-pill. The Board tab also triggers a phase announcement
   *  manually when set. */
  readonly forcedPhase = this._signal<Phase | null>(null);

  // ─── Onglet Prompts (prompts refresh spec §9) ────────────────
  readonly forcedPrompt = this._signal<Prompt | null>(null);

  // ─── Onglet End-flow (end-flow spec §8) ──────────────────────
  readonly forcedResultOutcome = this._signal<DevResultOutcome | null>(null);
  readonly forcedRematchState = this._signal<DevRematchState | null>(null);

  override<T>(forced: Signal<T | null>, real: () => T): T {
    return forced() ?? real();
  }

  reset(): void {
    this.forcedActor.set(null);
    this.forcedTimerMs.set(null);
    this.forcedChainPhase.set(null);
    this.forcedOpponentDisconnected.set(null);
    this.forcedLowLp.set(null);
    this.forcedReadOnly.set(null);
    this.forcedPhase.set(null);
    this.forcedPrompt.set(null);
    this.forcedResultOutcome.set(null);
    this.forcedRematchState.set(null);
  }

  private _signal<T>(initial: T): WritableSignal<T> {
    const s = signal<T>(initial);
    if (!isDevMode()) {
      s.set = (() => {}) as WritableSignal<T>['set'];
      s.update = (() => {}) as WritableSignal<T>['update'];
    }
    return s;
  }
}
