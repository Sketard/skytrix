// =============================================================================
// ocg-field-query.ts — Field state extraction from OCGCore WASM. Pure
// query logic split out of ocgcore-adapter.ts: takes a live OCGCore handle
// and returns a FieldState / FieldCard[] / decoded field masks.
//
// Independent of the handle's solver-specific state (turn counter, phase
// tracking, config) — those are passed in as parameters so the adapter
// remains the single owner of InternalHandle state.
// =============================================================================

import { OcgLocation, OcgQueryFlags, type OcgCoreSync, type OcgDuelHandle as OcgNativeHandle } from '@n1xx1/ocgcore-wasm';
import type { Phase, ZoneId } from '../ws-protocol.js';
import type { FieldCard, FieldState } from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import { POSITION_MAP, PLAYER, OPPONENT } from './ocg-constants.js';

// =============================================================================
// Runtime field shapes (richer than @n1xx1/ocgcore-wasm type defs)
// =============================================================================

interface RuntimeFieldCard {
  code: number;
  position: number;
  materials: number;
}

interface RuntimeFieldPlayer {
  lp: number;
  monsters: (RuntimeFieldCard | null)[];
  spells: (RuntimeFieldCard | null)[];
  deck_size: number;
  hand_size: number;
  grave_size: number;
  banish_size: number;
  extra_size: number;
  extra_faceup_count: number;
}

// =============================================================================
// Context — data the adapter passes in
// =============================================================================

/** Everything `queryFieldState` needs from the adapter. Passed as a single
 *  object so the adapter can pre-bind `getCardName` without a class method
 *  detour. */
export interface FieldQueryContext {
  core: OcgCoreSync;
  nativeHandle: OcgNativeHandle;
  /** Turn number tracked by the adapter (incremented on NEW_TURN). */
  turn: number;
  /** Current phase tracked by the adapter (updated on NEW_PHASE). */
  phase: Phase;
  /** Resolve a cardId to a display name via the adapter's card DB. */
  getCardName: (code: number) => string;
  /** Phase B (graph-ml-v2) — per-player NS-used snapshot from the adapter's
   *  InternalHandle.normalSummonsByPlayer. Forwarded to FieldState.
   *  Optional: callers that don't track it omit the field. */
  normalSummonUsed?: [boolean, boolean];
}

// =============================================================================
// Public API
// =============================================================================

/** Build a full FieldState snapshot from the live OCGCore handle. Iterates
 *  monster/spell zones, then pile zones (HAND, GY, BANISHED, DECK, EXTRA).
 *
 *  IMPORTANT: `duelQueryField()` only returns slot occupancy (`position`
 *  bitmap), NOT card codes. Each occupied slot requires a separate
 *  `duelQuery` with `OcgQueryFlags.CODE` — see `queryCardCode`. This was
 *  the C6 bug fixed in the Epic 1 review. */
export function queryFieldState(ctx: FieldQueryContext): FieldState {
  const { core, nativeHandle, turn, phase, getCardName, normalSummonUsed } = ctx;
  const field = core.duelQueryField(nativeHandle);

  const zones: Record<string, FieldCard[]> = {};

  // @n1xx1/ocgcore-wasm type defs are incomplete — cast through unknown
  const p0 = field.players[PLAYER] as unknown as RuntimeFieldPlayer;
  const p1 = field.players[OPPONENT] as unknown as RuntimeFieldPlayer;

  for (const z of ALL_ZONE_IDS) zones[z] = [];

  // Monster zones (player 0): M1-M5 = sequences 0-4, EMZ_L = 5, EMZ_R = 6.
  for (let seq = 0; seq < p0.monsters.length; seq++) {
    const slot = p0.monsters[seq];
    const pos = slot?.position as number ?? 0;
    if (!slot || pos === 0) continue;

    const cardCode = queryCardCode(core, nativeHandle, PLAYER, OcgLocation.MZONE, seq);
    if (!cardCode) continue;

    const zoneId = seq < 5 ? `M${seq + 1}` : (seq === 5 ? 'EMZ_L' : 'EMZ_R');
    const overlayCount = queryOverlayCount(core, nativeHandle, PLAYER, OcgLocation.MZONE, seq);
    zones[zoneId] = [{
      cardId: cardCode,
      cardName: getCardName(cardCode),
      position: POSITION_MAP[pos] ?? 'faceup-atk',
      overlayCount,
    }];
  }

  // Spell/Trap zones (player 0): S1-S5 = sequences 0-4, FIELD = 5
  for (let seq = 0; seq < p0.spells.length; seq++) {
    const slot = p0.spells[seq];
    const pos = slot?.position as number ?? 0;
    if (!slot || pos === 0) continue;

    const cardCode = queryCardCode(core, nativeHandle, PLAYER, OcgLocation.SZONE, seq);
    if (!cardCode) continue;

    const zoneId = seq < 5 ? `S${seq + 1}` : 'FIELD';
    zones[zoneId] = [{
      cardId: cardCode,
      cardName: getCardName(cardCode),
      position: POSITION_MAP[pos] ?? 'facedown',
      overlayCount: 0,
    }];
  }

  // Pile zones via duelQueryLocation
  zones['HAND'] = queryPileZone(core, nativeHandle, PLAYER, OcgLocation.HAND, getCardName);
  zones['GY'] = queryPileZone(core, nativeHandle, PLAYER, OcgLocation.GRAVE, getCardName);
  zones['BANISHED'] = queryPileZone(core, nativeHandle, PLAYER, OcgLocation.REMOVED, getCardName);
  zones['DECK'] = queryPileZone(core, nativeHandle, PLAYER, OcgLocation.DECK, getCardName);
  zones['EXTRA'] = queryPileZone(core, nativeHandle, PLAYER, OcgLocation.EXTRA, getCardName);

  // Opponent-side zones (Phase B) — same layout as p0, queried with
  // controller=OPPONENT. Populated unconditionally; ranker features 32-35
  // read MZONE/EMZ/SZONE/FIELD only. Pile zones included for Phase B+
  // backlog features (no info-leak concern: solver never crosses a network
  // boundary with FieldState).
  const oppZones: Record<string, FieldCard[]> = {};
  for (const z of ALL_ZONE_IDS) oppZones[z] = [];

  for (let seq = 0; seq < p1.monsters.length; seq++) {
    const slot = p1.monsters[seq];
    const pos = slot?.position as number ?? 0;
    if (!slot || pos === 0) continue;

    const cardCode = queryCardCode(core, nativeHandle, OPPONENT, OcgLocation.MZONE, seq);
    if (!cardCode) continue;

    const zoneId = seq < 5 ? `M${seq + 1}` : (seq === 5 ? 'EMZ_L' : 'EMZ_R');
    const overlayCount = queryOverlayCount(core, nativeHandle, OPPONENT, OcgLocation.MZONE, seq);
    oppZones[zoneId] = [{
      cardId: cardCode,
      cardName: getCardName(cardCode),
      position: POSITION_MAP[pos] ?? 'faceup-atk',
      overlayCount,
    }];
  }

  for (let seq = 0; seq < p1.spells.length; seq++) {
    const slot = p1.spells[seq];
    const pos = slot?.position as number ?? 0;
    if (!slot || pos === 0) continue;

    const cardCode = queryCardCode(core, nativeHandle, OPPONENT, OcgLocation.SZONE, seq);
    if (!cardCode) continue;

    const zoneId = seq < 5 ? `S${seq + 1}` : 'FIELD';
    oppZones[zoneId] = [{
      cardId: cardCode,
      cardName: getCardName(cardCode),
      position: POSITION_MAP[pos] ?? 'facedown',
      overlayCount: 0,
    }];
  }

  oppZones['HAND'] = queryPileZone(core, nativeHandle, OPPONENT, OcgLocation.HAND, getCardName);
  oppZones['GY'] = queryPileZone(core, nativeHandle, OPPONENT, OcgLocation.GRAVE, getCardName);
  oppZones['BANISHED'] = queryPileZone(core, nativeHandle, OPPONENT, OcgLocation.REMOVED, getCardName);
  oppZones['DECK'] = queryPileZone(core, nativeHandle, OPPONENT, OcgLocation.DECK, getCardName);
  oppZones['EXTRA'] = queryPileZone(core, nativeHandle, OPPONENT, OcgLocation.EXTRA, getCardName);

  return {
    zones: zones as Record<ZoneId, FieldCard[]>,
    lifePoints: [p0.lp, p1.lp],
    turn,
    phase,
    oppZones: oppZones as Record<ZoneId, FieldCard[]>,
    normalSummonUsed: normalSummonUsed
      ? [normalSummonUsed[0], normalSummonUsed[1]]
      : undefined,
  };
}

/** Query a single occupied field slot's card code. `duelQueryField()` only
 *  returns the slot occupancy bitmap (`position`), not the card code — that
 *  requires a per-slot `duelQuery` with `OcgQueryFlags.CODE`. Mirrors the
 *  PvP `duel-worker.ts` queryCard pattern. Returns 0 when the slot is empty
 *  or the query fails. */
export function queryCardCode(
  core: OcgCoreSync,
  nativeHandle: OcgNativeHandle,
  controller: 0 | 1,
  location: number,
  sequence: number,
): number {
  try {
    const result = core.duelQuery(nativeHandle, {
      flags: OcgQueryFlags.CODE as number,
      controller,
      location,
      sequence,
      overlaySequence: 0,
    } as never);
    const code = (result as { code?: number | bigint })?.code;
    if (code === undefined || code === null) return 0;
    return typeof code === 'bigint' ? Number(code) : code;
  } catch {
    return 0;
  }
}

/** Count the Xyz materials attached to a field card. Returns 0 on any
 *  failure — not all bindings expose the field consistently. */
export function queryOverlayCount(
  core: OcgCoreSync,
  nativeHandle: OcgNativeHandle,
  controller: 0 | 1,
  location: number,
  sequence: number,
): number {
  try {
    const result = core.duelQuery(nativeHandle, {
      flags: OcgQueryFlags.OVERLAY_CARD as number,
      controller,
      location,
      sequence,
      overlaySequence: 0,
    } as never);
    // Both `overlay_cards` (snake) and `overlayCards` (camel) seen across
    // bindings — accept either to stay forward-compatible.
    const r = result as { overlay_cards?: unknown[]; overlayCards?: unknown[] };
    return (r?.overlay_cards ?? r?.overlayCards)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Query a pile zone (HAND/GY/BANISHED/DECK/EXTRA) via `duelQueryLocation`.
 *  Returns the contained cards as FieldCard[]. Falls back to empty array
 *  on any binding error — solver continues gracefully with a partial view. */
export function queryPileZone(
  core: OcgCoreSync,
  nativeHandle: OcgNativeHandle,
  controller: 0 | 1,
  location: number,
  getCardName: (code: number) => string,
): FieldCard[] {
  try {
    const cards = core.duelQueryLocation(nativeHandle, {
      flags: (OcgQueryFlags.CODE as number) | (OcgQueryFlags.POSITION as number),
      controller,
      location,
    } as never);
    return (cards as ({ code?: number; position?: number } | null)[])
      .filter((c): c is { code: number; position: number } => c != null && c.code !== undefined && c.code > 0)
      .map(c => ({
        cardId: c.code,
        cardName: getCardName(c.code),
        position: POSITION_MAP[c.position] ?? 'facedown',
        overlayCount: 0,
      }));
  } catch {
    return [];
  }
}

/** Decode a field mask bitmap into a list of place coordinates.
 *  Used by `autoRespondMechanical` for SELECT_PLACE / SELECT_DISFIELD. */
export function decodeFieldMask(
  mask: number,
  count: number,
): { player: number; location: number; sequence: number }[] {
  // OCGCore field-mask bit layout (per ygopro source):
  //   bits 0-4   : MZONE seq 0-4 (main monster zones)
  //   bits 5-6   : MZONE seq 5-6 (Extra Monster Zones L/R)
  //   bits 8-12  : SZONE seq 0-4 (spell/trap zones)
  //   bit 13     : FZONE (field spell)
  //   bits 14-15 : PZONE (pendulum)
  //   bits 16-31 : player 1 (same layout shifted by 16)
  // A SET bit means the zone is BLOCKED. An UNSET bit means the zone is
  // available for placement. Link summons to EMZ-only zones previously failed
  // because seqs 5-6 weren't iterated. Added 2026-04-19 alongside trace-assist
  // multi-pick support.
  const places: { player: number; location: number; sequence: number }[] = [];
  for (let p = 0; p < 2 && places.length < count; p++) {
    // Main + Extra Monster Zones (seq 0-6)
    for (let seq = 0; seq < 7 && places.length < count; seq++) {
      const bit = p * 16 + seq;
      if (!(mask & (1 << bit))) {
        places.push({ player: p, location: OcgLocation.MZONE, sequence: seq });
      }
    }
    // Spell/Trap Zones (seq 0-4)
    for (let seq = 0; seq < 5 && places.length < count; seq++) {
      const bit = p * 16 + 8 + seq;
      if (!(mask & (1 << bit))) {
        places.push({ player: p, location: OcgLocation.SZONE, sequence: seq });
      }
    }
    // Field Spell Zone (single slot, bit 13)
    if (places.length < count) {
      const bit = p * 16 + 13;
      if (!(mask & (1 << bit))) {
        places.push({ player: p, location: OcgLocation.FZONE, sequence: 0 });
      }
    }
  }
  return places;
}
