import { CardInstance, ZoneId as SimZoneId } from './engine/board-models';
import {
  BoardStatePayload,
  BoardZone,
  CardOnField,
  PlayerBoardState,
  POSITION,
  ZoneId as PvpZoneId,
} from '../duel-ws.types';

/**
 * Pure adapter — sim edit model (`Record<ZoneId_sim, CardInstance[]>`) → PvP
 * board render payload (`BoardStatePayload`, aliased as `DuelState`).
 *
 * Hard invariants (tech spec §5-bis — violating them crashes render / arms the
 * POLL-DROP watchdog):
 *  - every `CardOnField.overlayMaterials` is ALWAYS an array (`[]` if none) —
 *    the board template reads `.length` without a guard.
 *  - every `position` is one of the 4 valid bitmasks, never `undefined`/`NaN`.
 *  - no legality validation: a monster in an S-zone (swap inter-types, #2)
 *    still maps to a valid `CardOnField`. The editor is a sandbox.
 *  - `chainPhase` is NOT this adapter's concern — the page passes `'idle'` in
 *    hard. The payload only carries board state.
 *
 * Mono-player: `players[0]` is the player, `players[1]` is an inert slot the
 * board expects but never renders interactively.
 *
 * Input contract: `board` MUST be a COMPLETE `Record<SimZoneId, …>` (every key
 * present) — the function indexes `board[sim]` / `board[MAIN_DECK]` without a
 * guard, so a partial record throws. Callers always source it from
 * `BoardStateService` (complete by construction) or `emptySimBoard()`.
 *
 * DECK vs EXTRA asymmetry (caught in review) — the board renders DECK from the
 * scalar `deckCount` (count-only, no BoardZone needed) but renders EXTRA as a
 * `pile-faceup` zone reading `BoardZone.cards.length`. So EXTRA MUST be emitted
 * as a real zone (else the Extra Deck pile shows empty), while DECK stays
 * count-only. `extraCount` is set in parallel for robustness.
 */

/**
 * Sim zones projected as PvP board zones. DECK is omitted (count-only render);
 * EXTRA IS emitted as a real pile zone (the board reads its `cards.length`).
 */
const SIM_TO_PVP_FIELD_ZONES: ReadonlyArray<[SimZoneId, PvpZoneId]> = [
  [SimZoneId.MONSTER_1, 'M1'],
  [SimZoneId.MONSTER_2, 'M2'],
  [SimZoneId.MONSTER_3, 'M3'],
  [SimZoneId.MONSTER_4, 'M4'],
  [SimZoneId.MONSTER_5, 'M5'],
  [SimZoneId.SPELL_TRAP_1, 'S1'],
  [SimZoneId.SPELL_TRAP_2, 'S2'],
  [SimZoneId.SPELL_TRAP_3, 'S3'],
  [SimZoneId.SPELL_TRAP_4, 'S4'],
  [SimZoneId.SPELL_TRAP_5, 'S5'],
  [SimZoneId.EXTRA_MONSTER_L, 'EMZ_L'],
  [SimZoneId.EXTRA_MONSTER_R, 'EMZ_R'],
  [SimZoneId.FIELD_SPELL, 'FIELD'],
  [SimZoneId.GRAVEYARD, 'GY'],
  [SimZoneId.BANISH, 'BANISHED'],
  [SimZoneId.EXTRA_DECK, 'EXTRA'],
  [SimZoneId.HAND, 'HAND'],
];

/**
 * PvP ZoneId → sim ZoneId. The reverse of the projection above, PLUS `DECK`
 * (which the payload exposes count-only but the interaction layer still needs
 * to route deposits/pile taps into). The board never emits the `XYZ`
 * pseudo-zone as a tap target, so it has no sim mapping.
 */
const PVP_TO_SIM_ZONE: Partial<Record<PvpZoneId, SimZoneId>> = {
  ...Object.fromEntries(SIM_TO_PVP_FIELD_ZONES.map(([sim, pvp]) => [pvp, sim])),
  DECK: SimZoneId.MAIN_DECK,
};

/** Maps a board (PvP) ZoneId back to its sim ZoneId, or null if not mappable. */
export function pvpZoneToSim(pvp: PvpZoneId): SimZoneId | null {
  return PVP_TO_SIM_ZONE[pvp] ?? null;
}

const SIM_TO_PVP_ZONE: Partial<Record<SimZoneId, PvpZoneId>> = {
  ...Object.fromEntries(SIM_TO_PVP_FIELD_ZONES),
  [SimZoneId.MAIN_DECK]: 'DECK',
};

/** Maps a sim ZoneId to its board (PvP) ZoneId, or null if not mappable. */
export function simZoneToPvp(sim: SimZoneId): PvpZoneId | null {
  return SIM_TO_PVP_ZONE[sim] ?? null;
}

/**
 * The inert slot-1 board. Built FRESH per call (not a shared module constant)
 * so no two payloads alias the same `zones: []` array — a downstream
 * `commitAll`/mutation on `players[1]` can't bleed across payloads.
 */
function inertPlayerBoard(): PlayerBoardState {
  return { lp: 8000, deckCount: 0, extraCount: 0, zones: [] };
}

/** A fresh sim board with every zone empty. */
export function emptySimBoard(): Record<SimZoneId, CardInstance[]> {
  const board = {} as Record<SimZoneId, CardInstance[]>;
  for (const zone of Object.values(SimZoneId)) {
    board[zone] = [];
  }
  return board;
}

function toPosition(ci: CardInstance): CardOnField['position'] {
  const isDef = ci.position === 'DEF';
  if (ci.faceDown) {
    return isDef ? POSITION.FACEDOWN_DEFENSE : POSITION.FACEDOWN_ATTACK;
  }
  return isDef ? POSITION.FACEUP_DEFENSE : POSITION.FACEUP_ATTACK;
}

/** Generic counter key used by the free-mode mini-bar (#11, v1 single type). */
export const FREE_MODE_COUNTER_KEY = 'counter';

function toCardOnField(ci: CardInstance, counters: ReadonlyMap<string, number>): CardOnField {
  const card = ci.card.card;
  const count = counters.get(ci.instanceId) ?? 0;
  return {
    cardCode: card.passcode ?? null,
    name: card.name ?? null,
    position: toPosition(ci),
    overlayMaterials: (ci.overlayMaterials ?? []).map(m => m.card.card.passcode ?? 0),
    counters: count > 0 ? { [FREE_MODE_COUNTER_KEY]: count } : {},
  };
}

const NO_COUNTERS: ReadonlyMap<string, number> = new Map();

export function cardInstancesToBoardStatePayload(
  board: Record<SimZoneId, CardInstance[]>,
  lp: number,
  counters: ReadonlyMap<string, number> = NO_COUNTERS,
): BoardStatePayload {
  const zones: BoardZone[] = SIM_TO_PVP_FIELD_ZONES.map(([sim, pvp]) => ({
    zoneId: pvp,
    cards: board[sim].map(ci => toCardOnField(ci, counters)),
  }));

  const player: PlayerBoardState = {
    lp,
    deckCount: board[SimZoneId.MAIN_DECK].length,
    extraCount: board[SimZoneId.EXTRA_DECK].length,
    zones,
  };

  return {
    turnPlayer: 0,
    turnCount: 1,
    phase: 'MAIN1',
    players: [player, inertPlayerBoard()],
  };
}
