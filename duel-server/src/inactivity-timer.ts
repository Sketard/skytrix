/**
 * Per-player inactivity timer state-machine (L6).
 *
 * Replaces the original 3-level nested setTimeout pattern. Each player has
 * a single timer slot tagged with the current stage. Transitions:
 *
 *   start ──(warningDelay)──▶ warning  ──(warningBeforeMs)──▶ forfeit
 *                                                                │
 *                                                       (raceWindowMs)
 *                                                                ▼
 *                                                              race ──▶ DUEL_END
 *
 * The race window exists so a late client response (e.g. ANIMATIONS_DONE
 * arriving in the same tick as the forfeit fires) can still cancel the
 * forfeit by calling `cancel()`. This preserves the original AC4 semantics
 * exactly — what changes is the implementation: one slot instead of three,
 * a flat dispatcher instead of nested closures, and dependencies injected
 * for testability.
 */

import type { Player } from './ws-protocol.js';

export type InactivityStage = 'warning' | 'forfeit' | 'race';

/** Per-player timer slot. `null` means no inactivity countdown is running. */
export interface InactivitySlot {
  timer: ReturnType<typeof setTimeout>;
  stage: InactivityStage;
}

export interface InactivityScheduler {
  /** Start (or restart) the countdown for a player. Cancels any existing slot first. */
  start(player: Player): void;
  /** Cancel any running countdown for a player. Idempotent. */
  cancel(player: Player): void;
  /** Inspect the current stage (for debug/observability). */
  peek(player: Player): InactivityStage | null;
}

export interface InactivityDeps {
  /** True when the duel has already ended — every stage callback short-circuits if so. */
  isDuelEnded(): boolean;
  /** Returns the slot holder for the player. Implementations may store on PlayerSession. */
  getSlot(player: Player): InactivitySlot | null;
  /** Stores the slot holder for the player. Pass null to clear. */
  setSlot(player: Player, slot: InactivitySlot | null): void;
  /** Sends INACTIVITY_WARNING to the player at stage 'warning'. */
  sendWarning(player: Player, remainingSec: number): void;
  /** Performs the actual forfeit (DUEL_END broadcast + cleanup). */
  forfeit(player: Player): void;
  /** Total time before the warning fires (= INACTIVITY_TIMEOUT_MS - warningBeforeMs). */
  warningDelayMs: number;
  /** Time between warning and the forfeit stage. */
  warningBeforeMs: number;
  /** Race window: client has this many ms after forfeit stage to react. */
  raceWindowMs: number;
}

/**
 * Build a scheduler bound to the provided deps. Returns a small interface so
 * callers don't need to know about the stages or the slot storage strategy.
 */
export function createInactivityScheduler(deps: InactivityDeps): InactivityScheduler {
  function schedule(player: Player, stage: InactivityStage, delayMs: number): void {
    const timer = setTimeout(() => {
      deps.setSlot(player, null);
      if (deps.isDuelEnded()) return;
      runStage(player, stage);
    }, delayMs);
    deps.setSlot(player, { timer, stage });
  }

  function runStage(player: Player, stage: InactivityStage): void {
    switch (stage) {
      case 'warning': {
        const remainingSec = Math.round(deps.warningBeforeMs / 1000);
        deps.sendWarning(player, remainingSec);
        schedule(player, 'forfeit', deps.warningBeforeMs);
        return;
      }
      case 'forfeit':
        schedule(player, 'race', deps.raceWindowMs);
        return;
      case 'race':
        deps.forfeit(player);
        return;
    }
  }

  function start(player: Player): void {
    cancel(player);
    schedule(player, 'warning', deps.warningDelayMs);
  }

  function cancel(player: Player): void {
    const slot = deps.getSlot(player);
    if (slot) {
      clearTimeout(slot.timer);
      deps.setSlot(player, null);
    }
  }

  function peek(player: Player): InactivityStage | null {
    return deps.getSlot(player)?.stage ?? null;
  }

  return { start, cancel, peek };
}
