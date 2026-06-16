// =============================================================================
// ocg-message-transforms.ts
//
// U4 (audit-4-modes-2026-06-01) — extracted from `duel-worker.ts` (~1973 LOC
// god-file). Holds the ~14 OcgMessage → ServerMessage transforms, the big
// `transformMessage` dispatch switch, the prompt→OCGCore `transformResponse`,
// plus the 7 pure decode helpers (decodePlaces / decodePositions /
// decodeBitmask / decodeAttributes / countersToRecord / locName / toCardInfo).
//
// Architectural pattern : D1=2 from the audit triage — two context objects
// (`OcgContext` and `LookupContext`) are passed to the transforms that need
// runtime state instead of relying on module-level lets. The worker builds
// the contexts once (closures over its `let core / duel / cardDb /
// systemStrings / dlog / ...` bindings) and forwards them on every call.
//
// State coupling :
//   - OcgContext       : core + duel (OCGCore handle + WASM core)
//   - LookupContext    : cardDb + systemStrings + dlog + isTokenCard +
//                        setLastAnnounceNumberOptions (read for transforms,
//                        write for ANNOUNCE_NUMBER which captures the option
//                        list for the matching `transformResponse`)
//
// The 4 pure transforms (Battle / BecomeTarget / Equip / ShuffleSetCard)
// take no context — they only walk the OcgMessage payload.
//
// Replay-precompute is a downstream consumer : `replay-precompute.ts`
// receives `transformMessage` via DI (the worker passes the bound version
// after building the contexts). The `runReplayPreComputation` deps
// interface is unchanged — only the binding site moves.
//
// Why the lazy closures in the context : `core`, `duel`, `cardDb`,
// `systemStrings`, `dlog` are re-assigned in each `init*` call (worker
// is reused across INIT_DUEL / INIT_REPLAY / INIT_FORK). A direct
// reference would freeze the pre-init values ; the `() => state` getter
// resolves lazily at transform-call time so the worker's re-assignments
// are visible.
// =============================================================================

import { OcgMessageType, OcgQueryFlags } from '@n1xx1/ocgcore-wasm';
import type {
  OcgCoreSync,
  OcgDuelHandle,
  OcgMessage,
  OcgCardLoc,
  OcgCardLocPos,
} from '@n1xx1/ocgcore-wasm';
import type { CardDB } from './types.js';
import type { DuelLogger } from './logger.js';
import { resolveDescription } from './game-log/effect-desc-resolver.js';
import { REASON_XYZ_MATERIAL_SETTLE } from './ocgcore-reason-flags.js';
import {
  readOverlayMaterialsForMove,
  consumeSettlingSource,
  type PreProcessOverlayKey,
  type SettlingSourceFifo,
} from './pre-process-overlays.js';
import type {
  ServerMessage,
  Player,
  CardInfo,
  PlaceOption,
  Position,
} from './ws-protocol.js';
import { LOCATION, POSITION } from './ws-protocol.js';

// =============================================================================
// Context interfaces (D1=2 — two narrow contexts instead of one wide bag)
// =============================================================================

/** OCGCore live state — only `transformMove` reads it (for the reason query
 *  on the destination card). Every other transform is independent. */
export interface OcgContext {
  core: () => OcgCoreSync | null;
  duel: () => OcgDuelHandle | null;
}

/** Card-name resolution + system-strings + logger + token check + the
 *  ANNOUNCE_NUMBER options write-back. Touched by 8 of the 14 transforms +
 *  the `transformMessage` dispatcher (for OCG-ORDER trace logs). */
export interface LookupContext {
  cardDb: () => CardDB | null;
  systemStrings: () => Map<number, string>;
  dlog: () => DuelLogger;
  /** SQLite name lookup (`cardDb.nameStmt.get(code)`) wrapped with the
   *  worker's `duelInstr.time('getCardName', ...)` so the per-OCG-message
   *  hot path keeps surfacing in `DUEL_INSTRUMENT=1` snapshots (perf-audit
   *  chantier 2026-05-22 baselines). Reviewfix B1 (audit-4-modes-2026-06-01)
   *  — extracted module passes the worker's instrumented version through
   *  the context rather than re-implementing the lookup inline, which would
   *  silently lose instrumentation. */
  getCardName: (code: number) => string;
  /** `cardDbCache.get(cardDb, code).cardType & TYPE_TOKEN`. Worker keeps the
   *  cache so the same memoization is shared with `buildBoardState`. */
  isTokenCard: (code: number) => boolean;
  /** Write-back for `ANNOUNCE_NUMBER`. The worker keeps the slot so
   *  `transformResponse('ANNOUNCE_NUMBER', ...)` can look up the index. */
  setLastAnnounceNumberOptions: (opts: number[]) => void;
  /** Read for `transformResponse('ANNOUNCE_NUMBER', ...)` — paired with the
   *  setter above. */
  getLastAnnounceNumberOptions: () => number[];
}

// =============================================================================
// Pure decode helpers (no context)
// =============================================================================

export const LOC_NAME: Record<number, string> = {
  [LOCATION.DECK]: 'DECK', [LOCATION.HAND]: 'HAND', [LOCATION.MZONE]: 'MZONE',
  [LOCATION.SZONE]: 'SZONE', [LOCATION.GRAVE]: 'GY', [LOCATION.BANISHED]: 'BANISHED',
  [LOCATION.EXTRA]: 'EXTRA', [LOCATION.OVERLAY]: 'OVERLAY',
};

export function locName(loc: number): string {
  return LOC_NAME[loc] ?? `0x${loc.toString(16)}`;
}

export function countersToRecord(counters?: Record<number, number>): Record<string, number> {
  if (!counters) return {};
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(counters)) result[k] = v;
  return result;
}

export function decodePlaces(mask: number, selectingPlayer: Player): PlaceOption[] {
  // OCGCore field_mask: set bits = UNAVAILABLE zones. Invert to get selectable zones.
  // Bitmask is from the selecting player's perspective:
  //   bits 0-15  = selecting player's own zones
  //   bits 16-31 = opponent's zones
  const available = ~mask;
  const places: PlaceOption[] = [];
  for (let p = 0; p <= 1; p++) {
    const offset = p * 16;
    // p=0 in bitmask → self, p=1 → opponent. Map to absolute OCGCore player index.
    const actualPlayer = (p === 0 ? selectingPlayer : (1 - selectingPlayer)) as Player;
    for (let s = 0; s < 5; s++) {
      if (available & (1 << (offset + s)))
        places.push({ player: actualPlayer, location: LOCATION.MZONE, sequence: s });
    }
    for (let s = 0; s < 2; s++) {
      if (available & (1 << (offset + 5 + s)))
        places.push({ player: actualPlayer, location: LOCATION.MZONE, sequence: 5 + s });
    }
    for (let s = 0; s < 5; s++) {
      if (available & (1 << (offset + 8 + s)))
        places.push({ player: actualPlayer, location: LOCATION.SZONE, sequence: s });
    }
    if (available & (1 << (offset + 13)))
      places.push({ player: actualPlayer, location: LOCATION.SZONE, sequence: 5 });
    for (let s = 0; s < 2; s++) {
      if (available & (1 << (offset + 14 + s)))
        places.push({ player: actualPlayer, location: LOCATION.SZONE, sequence: 6 + s });
    }
  }
  return places;
}

export function decodePositions(mask: number): number[] {
  const result: number[] = [];
  if (mask & 1) result.push(POSITION.FACEUP_ATTACK);
  if (mask & 2) result.push(POSITION.FACEDOWN_ATTACK);
  if (mask & 4) result.push(POSITION.FACEUP_DEFENSE);
  if (mask & 8) result.push(POSITION.FACEDOWN_DEFENSE);
  return result;
}

export function decodeBitmask(mask: bigint, maxBits: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < maxBits; i++) {
    if (mask & (1n << BigInt(i))) result.push(Number(1n << BigInt(i)));
  }
  return result;
}

export function decodeAttributes(mask: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (mask & (1 << i)) result.push(1 << i);
  }
  return result;
}

/** Builds a `CardInfo` from an OCGCore card payload. The `getCardName`
 *  resolver is injected (it's the only piece that needs the cardDb) so this
 *  helper stays a pure function. */
export function toCardInfo(
  c: OcgCardLoc | OcgCardLocPos,
  getCardName: (code: number) => string,
): CardInfo {
  const info: CardInfo = {
    cardCode: c.code,
    name: getCardName(c.code),
    player: c.controller,
    location: c.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    sequence: c.sequence,
  };
  if ('position' in c) info.position = c.position as number;
  return info;
}

/** Resolve a prompt `description` code to its effect text server-side — the
 *  code's `strN` paragraph (cards.cdb) is only reachable here. Returns ''
 *  (never `%ls`/`%d`) via `resolveDescription`'s placeholder guard, or
 *  undefined when the card db is not loaded. */
export function resolvePromptDescription(
  description: number,
  lookup: LookupContext,
): string | undefined {
  const db = lookup.cardDb();
  return db ? resolveDescription(description, db, lookup.systemStrings()) : undefined;
}

// =============================================================================
// Per-transform helpers (audit finding M1, ported intact)
// =============================================================================
//
// The main switch in `transformMessage` was 395 LOC / 30+ cases — well above
// Miller. These helpers extract the cases that span more than ~8 lines into
// named functions ; trivial 1-line returns stay inline in the dispatcher
// (transformMessage) so the high-level shape (which OcgMessageType maps to
// which DTO) remains scannable in one screen.
//
// 4 transforms (Battle / BecomeTarget / Equip / ShuffleSetCard) are pure —
// they only walk the OcgMessage payload, no context required.

/** Reviewfix B1 — alias for the worker's instrumented `getCardName` (wrapped
 *  with `duelInstr.time('getCardName', ...)`). Earlier drafts of this module
 *  re-rolled the SQLite lookup inline, which lost the per-OCG-message
 *  instrumentation. The lookup now flows through `LookupContext.getCardName`
 *  so the perf-audit buckets stay accurate. */
function makeGetCardName(lookup: LookupContext): (code: number) => string {
  return lookup.getCardName;
}

export function transformMove(
  // `overlay_sequence` is set by the ocgcore-wasm binding (fn `p` in its
  // decoder) when OCGCore emits a position with the LOCATION_OVERLAY (0x80)
  // bit : the binding STRIPS the bit from `location` and moves the overlay
  // index into this field. So an XYZ material becoming an overlay arrives as
  // `{ location: EXTRA|MZONE (the host's base zone), overlay_sequence: N }`,
  // NOT as `location: OVERLAY`. Without reading it we mis-route the material
  // as a plain move to the Extra Deck (the XYZ-summon "materials fly to the
  // Extra Deck" bug). See `_bmad-output/planning-artifacts/xyz-overlay-move-fix-2026-06-16.md`.
  msg: { card: number;
         from: { controller: 0 | 1; location: number; sequence: number; position: number; overlay_sequence?: number };
         to: { controller: 0 | 1; location: number; sequence: number; position: number; overlay_sequence?: number } },
  ocg: OcgContext,
  lookup: LookupContext,
  preProcessOverlays?: Map<PreProcessOverlayKey, number[]>,
  settlingFifo?: SettlingSourceFifo,
): ServerMessage {
  const getCardName = makeGetCardName(lookup);
  const core = ocg.core();
  const duel = ocg.duel();
  let reason = 0;
  if (core && duel && msg.to.location as number !== 0) {
    const reasonInfo = core.duelQuery(duel, {
      flags: OcgQueryFlags.REASON as number,
      controller: msg.to.controller,
      location: msg.to.location as number,
      sequence: msg.to.sequence,
      overlaySequence: 0,
    } as never);
    reason = reasonInfo?.reason ?? 0;
  }

  // β.3 cas #12 (Commit 0bis) — read overlayMaterials from the pre-process
  // snapshot when the card leaves MZONE. The snapshot was captured BEFORE
  // duelProcess applied the mutation, so the overlays of the now-departed
  // XYZ remain accessible. Non-MZONE sources skipped — SZONE/HAND/DECK/EXTRA
  // never hold XYZ materials.
  const overlayMaterials = readOverlayMaterialsForMove(
    preProcessOverlays,
    msg.from.location as number,
    msg.from.controller as 0 | 1,
    msg.from.sequence as number,
    LOCATION.MZONE as number,
  );

  // β.3 cas #12 post-review B3 (2026-05-28) — settling event tagging.
  // A settling is a GRAVE→GRAVE MSG_MOVE with reason exactly equal to
  // REASON_XYZ_MATERIAL_SETTLE (0x600 = REASON_RULE | REASON_LOST_TARGET).
  // Consume the FIFO entry for this cardCode to attach the original
  // XYZ source MZONE seq, so the front-side rule can discriminate
  // between two XYZ that share a material's cardCode.
  let sourceMzoneSeq: number | undefined;
  const fromLoc = msg.from.location as number;
  const toLoc = msg.to.location as number;
  if (
    settlingFifo &&
    fromLoc === (LOCATION.GRAVE as number) &&
    toLoc === (LOCATION.GRAVE as number) &&
    reason === REASON_XYZ_MATERIAL_SETTLE
  ) {
    sourceMzoneSeq = consumeSettlingSource(settlingFifo, msg.card);
  }

  // Re-derive the OVERLAY location the binding decoded away (see the param
  // docblock). `from/to.sequence` is the HOST monster's sequence in its base
  // zone (`location`), per YGOPro `GetCard(controller, location, sequence)` ;
  // we surface the overlay index separately so the client can correlate the
  // material to its host (XYZ-summon animation — layer 2).
  const fromIsOverlay = msg.from.overlay_sequence !== undefined;
  const toIsOverlay = msg.to.overlay_sequence !== undefined;
  // `msg.to.location` BEFORE the OVERLAY override is the host's BASE zone:
  // EXTRA when the material attaches during an XYZ summon (host still in the
  // Extra Deck), MZONE when it attaches to an XYZ ALREADY on the field
  // (Rank-Up / overlay-effect). The client buffers the slide animation only
  // for the EXTRA case — the MZONE case has no Extra-Deck descent to ride, so
  // surfacing the base zone lets it skip those (closes the buffer-collision
  // where a non-XYZ Extra summon shares a numeric sequence with a stale
  // attach-on-field material). See the layer-2 correlator.
  const toOverlayHostLocation = toIsOverlay
    ? (msg.to.location as number as (typeof LOCATION)[keyof typeof LOCATION])
    : undefined;
  const effFromLocation = (fromIsOverlay ? LOCATION.OVERLAY : msg.from.location) as number as (typeof LOCATION)[keyof typeof LOCATION];
  const effToLocation = (toIsOverlay ? LOCATION.OVERLAY : msg.to.location) as number as (typeof LOCATION)[keyof typeof LOCATION];

  return {
    type: 'MSG_MOVE', cardCode: msg.card, cardName: getCardName(msg.card),
    player: msg.from.controller,
    // Destination controller — OCGCore routes a card to its owner's pile, so
    // for GRAVE/BANISHED/EXTRA this is the card's owner. The client resolves
    // the destination zone from this, not `player` (controlled-card-destroyed
    // → owner's GY, not controller's GY).
    toPlayer: msg.to.controller,
    fromLocation: effFromLocation,
    fromSequence: msg.from.sequence,
    fromPosition: msg.from.position as number as Position,
    toLocation: effToLocation,
    toSequence: msg.to.sequence,
    toPosition: msg.to.position as number as Position,
    isToken: lookup.isTokenCard(msg.card),
    reason,
    ...(overlayMaterials ? { overlayMaterials } : {}),
    ...(sourceMzoneSeq !== undefined ? { sourceMzoneSeq } : {}),
    ...(fromIsOverlay ? { fromOverlaySequence: msg.from.overlay_sequence } : {}),
    ...(toIsOverlay ? { toOverlaySequence: msg.to.overlay_sequence } : {}),
    ...(toOverlayHostLocation !== undefined ? { toOverlayHostLocation } : {}),
  };
}

export function transformHint(msg: any, lookup: LookupContext): ServerMessage {
  const getCardName = makeGetCardName(lookup);
  const systemStrings = lookup.systemStrings();
  const hintType = msg.hint_type as number;
  const value = Number(msg.hint);
  // Only the card identity is resolved server-side — it is a card name, not a
  // system string, and the front-end already carries card data. Everything
  // else (system strings, race/attribute labels, numbers) is resolved
  // client-side from the raw `hintType` + `value` (see duel-hint.util.ts).
  let cardName = '';
  if (hintType === 5 || hintType === 8 || hintType === 10 || hintType === 13 || hintType === 15) {
    // HINT_EFFECT / HINT_CODE / HINT_CARD: value is a card code
    cardName = getCardName(value);
  } else if (hintType === 3 || hintType === 4) {
    // HINT_SELECTMSG / HINT_OPSELECTED: value is a system string ID or a card
    // code — resolve the card name only when it is not a system string.
    if (!systemStrings.get(value)) {
      cardName = getCardName(value);
    }
  }
  return { type: 'MSG_HINT', hintType, player: msg.player as Player, value, cardName };
}

export function transformBattle(msg: any): ServerMessage | null {
  if (!msg.target) return null; // Direct attacks don't produce BATTLE
  const defInDef = (msg.target.position as number) & 0xC; // FACEUP_DEFENSE | FACEDOWN_DEFENSE
  return {
    type: 'MSG_BATTLE',
    attackerPlayer: msg.card.controller,
    attackerSequence: msg.card.sequence,
    attackerDamage: msg.card.attack,
    defenderPlayer: msg.target.controller,
    defenderSequence: msg.target.sequence,
    defenderDamage: defInDef ? msg.target.defense : msg.target.attack,
  };
}

export function transformBecomeTarget(msg: any): ServerMessage {
  return {
    type: 'MSG_BECOME_TARGET',
    cards: msg.cards.map((c: any) => ({
      player: c.controller as Player,
      location: c.location as number as (typeof LOCATION)[keyof typeof LOCATION],
      sequence: c.sequence,
    })),
  };
}

export function transformEquip(msg: any): ServerMessage {
  return {
    type: 'MSG_EQUIP',
    equipPlayer: msg.card.controller as Player,
    equipLocation: msg.card.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    equipSequence: msg.card.sequence,
    targetPlayer: msg.target.controller as Player,
    targetLocation: msg.target.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    targetSequence: msg.target.sequence,
  };
}

export function transformShuffleSetCard(msg: any): ServerMessage {
  return {
    type: 'MSG_SHUFFLE_SET_CARD',
    cards: msg.cards.map((c: any) => ({
      fromPlayer: c.from.controller as Player,
      fromSequence: c.from.sequence,
      toPlayer: c.to.controller as Player,
      toSequence: c.to.sequence,
      location: c.from.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    })),
  };
}

export function transformSelectIdleCmd(msg: any, lookup: LookupContext): ServerMessage {
  const getCardName = makeGetCardName(lookup);
  const wrap = (c: any) => toCardInfo(c, getCardName);
  return {
    type: 'SELECT_IDLECMD', player: msg.player as Player,
    summons: msg.summons.map(wrap),
    specialSummons: msg.special_summons.map(wrap),
    repositions: msg.pos_changes.map(wrap),
    setMonsters: msg.monster_sets.map(wrap),
    activations: msg.activates.map((c: any) => ({ ...wrap(c), description: Number(c.description) })),
    setSpellTraps: msg.spell_sets.map(wrap),
    canBattlePhase: msg.to_bp, canEndPhase: msg.to_ep,
  };
}

export function transformSelectChain(msg: any, lookup: LookupContext): ServerMessage {
  const getCardName = makeGetCardName(lookup);
  const wrap = (c: any) => toCardInfo(c, getCardName);
  // `hintTiming` ships raw — the client resolves the timing label from it
  // (see duel-hint.util.ts `resolveHintTimingLabel`).
  // F-bugB3 verbose — log every SELECT_CHAIN the engine emits with its full
  // chain context so we can correlate the back-to-back re-offers user
  // reports (Maxx "C" pattern: 3× SELECT_CHAIN to P2 across the phase shift).
  lookup.dlog().log('SELECT_CHAIN emit', {
    player: msg.player,
    forced: msg.forced,
    hintTiming: msg.hint_timing,
    selectsLen: msg.selects?.length ?? 0,
    selects: (msg.selects ?? []).map((c: any) => ({
      code: c.code,
      loc: c.location,
      seq: c.sequence,
      controller: c.controller,
      description: Number(c.description),
    })),
  });
  return {
    type: 'SELECT_CHAIN', player: msg.player as Player,
    cards: msg.selects.map((c: any) => ({ ...wrap(c), description: Number(c.description) })),
    forced: msg.forced,
    hintTiming: msg.hint_timing as number,
  };
}

export function transformSelectEffectYn(msg: any, lookup: LookupContext): ServerMessage {
  const getCardName = makeGetCardName(lookup);
  const description = Number(msg.description);
  return {
    type: 'SELECT_EFFECTYN', player: msg.player as Player,
    cardCode: msg.code, cardName: getCardName(msg.code), description,
    descriptionText: resolvePromptDescription(description, lookup),
  };
}

export function transformSelectOption(msg: any, lookup: LookupContext): ServerMessage {
  // `options` carries the raw 64-bit description codes. The codes are kept for
  // the client, but the EFFECT TEXT is resolved here: a code's `strN` paragraph
  // (cards.cdb) is only reachable server-side. `resolveDescription` returns a
  // clean string or '' (its placeholder guard drops any `%ls` / `%d`).
  const rawOptions = msg.options.map(Number);
  lookup.dlog().debug('SELECT_OPTION', { raw: msg.options.map(String), decoded: rawOptions.map((o: number) => ({ cardCode: o >> 20, strIndex: o & 0xFFFFF })) });
  const db = lookup.cardDb();
  const systemStrings = lookup.systemStrings();
  const optionTexts = db
    ? rawOptions.map((code: number) => resolveDescription(code, db, systemStrings))
    : undefined;
  return {
    type: 'SELECT_OPTION', player: msg.player as Player,
    options: rawOptions,
    optionTexts,
  };
}

export function transformSelectSum(msg: any, lookup: LookupContext): ServerMessage {
  const getCardName = makeGetCardName(lookup);
  const wrap = (c: any) => toCardInfo(c, getCardName);
  return {
    type: 'SELECT_SUM', player: msg.player as Player,
    mustSelect: msg.selects_must.map((c: any) => ({ ...wrap(c), amount: c.amount })),
    cards: msg.selects.map((c: any) => ({ ...wrap(c), amount: c.amount })),
    targetSum: msg.amount, minCards: msg.min, maxCards: msg.max, selectMax: msg.select_max,
  };
}

export function transformSelectUnselect(msg: any, lookup: LookupContext): ServerMessage {
  const getCardName = makeGetCardName(lookup);
  const wrap = (c: any) => toCardInfo(c, getCardName);
  lookup.dlog().debug('SELECT_UNSELECT_CARD', { select: msg.select_cards.length, unselect: msg.unselect_cards.length, canFinish: msg.can_finish });
  return {
    type: 'SELECT_UNSELECT_CARD', player: msg.player as Player,
    cards: [...msg.select_cards, ...msg.unselect_cards].map(wrap),
    selectCount: msg.select_cards.length,
    canFinish: msg.can_finish,
  };
}

// =============================================================================
// Main dispatch — OcgMessage → ServerMessage
// =============================================================================

export function transformMessage(
  msg: OcgMessage,
  ocg: OcgContext,
  lookup: LookupContext,
  skipRpsFlag: boolean,
  preProcessOverlays?: Map<PreProcessOverlayKey, number[]>,
  settlingFifo?: SettlingSourceFifo,
  /** Per-player snapshot of HAND cardCode counts taken BEFORE the current
   *  `duelProcess` batch ran. Consumed by the CHAINING transform to set
   *  `ChainingMsg.handCopiesAtChaining`. F9-bis hand-discard fix
   *  (2026-06-04) — without this counter, the front's hand chain-badge
   *  resolver cannot distinguish "activated card still in hand" from
   *  "activated card discarded, second copy still in hand" and misroutes
   *  the badge. Optional: when omitted (legacy callers, tests), the
   *  resulting MSG_CHAINING omits the field and the front degrades to
   *  its pre-fix matching. */
  handCountsPreBatch?: ReadonlyArray<ReadonlyMap<number, number>>,
): ServerMessage | null {
  const getCardName = makeGetCardName(lookup);
  const systemStrings = lookup.systemStrings();
  const db = lookup.cardDb();
  const dlog = lookup.dlog();
  const wrap = (c: any) => toCardInfo(c, getCardName);

  if (msg.type === OcgMessageType.MOVE) {
    const m = msg as any;
    dlog.debug('OCG-ORDER MOVE', { card: getCardName(m.card), code: m.card, from: `${locName(m.from.location)}/seq${m.from.sequence}`, to: `${locName(m.to.location)}/seq${m.to.sequence}`, player: m.from.controller });
  } else if (msg.type === OcgMessageType.CHAINING) {
    const m = msg as any;
    dlog.debug('OCG-ORDER CHAINING', { card: getCardName(m.code), code: m.code, loc: `${locName(m.location)}/seq${m.sequence}`, chainSize: m.chain_size });
  } else {
    dlog.debug('OCG-ORDER', { type: OcgMessageType[msg.type] ?? 'UNKNOWN', typeId: msg.type, player: (msg as any).player ?? '?' });
  }
  switch (msg.type) {
    // --- State tracking only (no DTO) ---
    case OcgMessageType.START:
    case OcgMessageType.NEW_TURN:
    case OcgMessageType.NEW_PHASE:
      return null; // Tracked in updateState(), embedded in BOARD_STATE

    // --- Game Messages ---
    case OcgMessageType.DRAW:
      return { type: 'MSG_DRAW', player: msg.player as Player, cards: msg.drawn.map(d => d.code) };

    case OcgMessageType.MOVE:
      return transformMove(msg as any, ocg, lookup, preProcessOverlays, settlingFifo);

    case OcgMessageType.DAMAGE:
      return { type: 'MSG_DAMAGE', player: msg.player as Player, amount: msg.amount };

    case OcgMessageType.RECOVER:
      return { type: 'MSG_RECOVER', player: msg.player as Player, amount: msg.amount };

    case OcgMessageType.PAY_LPCOST:
      return { type: 'MSG_PAY_LPCOST', player: msg.player as Player, amount: msg.amount };

    case OcgMessageType.CHAINING: {
      const description = Number(msg.description);
      // Resolve the effect text server-side — the front needs it for the
      // game-log bubble + panel. Shared by live PvP and replay precompute
      // (both run transformMessage), so old replays inherit it on reload.
      const descriptionText = db
        ? resolveDescription(description, db, systemStrings)
        : '';
      // F9-bis hand-discard fix (2026-06-04) — when the activation comes
      // from HAND, embed the pre-batch hand cardCode count so the client
      // can detect that a copy of this card has been discarded (typically
      // by the activation's own cost) and refuse to misroute the badge to
      // a second copy. Only HAND activations need the field; for other
      // locations the front-side resolver doesn't run the hand-badge
      // code path.
      const isFromHand = (msg.location as number) === (LOCATION.HAND as number);
      const playerCounts = isFromHand && handCountsPreBatch ? handCountsPreBatch[msg.controller] : undefined;
      const handCopiesAtChaining = playerCounts?.get(msg.code);
      return {
        type: 'MSG_CHAINING', cardCode: msg.code, cardName: getCardName(msg.code), player: msg.controller,
        location: msg.location as number as (typeof LOCATION)[keyof typeof LOCATION],
        sequence: msg.sequence, chainIndex: msg.chain_size - 1, description,
        descriptionText,
        ...(handCopiesAtChaining != null ? { handCopiesAtChaining } : {}),
      };
    }

    case OcgMessageType.CHAIN_SOLVING:
      dlog.debug('CHAIN_SOLVING → MSG_CHAIN_SOLVING', { chainIndex: msg.chain_size - 1 });
      return { type: 'MSG_CHAIN_SOLVING', chainIndex: msg.chain_size - 1 };

    case OcgMessageType.CHAIN_SOLVED:
      dlog.debug('CHAIN_SOLVED → MSG_CHAIN_SOLVED', { chainIndex: msg.chain_size - 1 });
      return { type: 'MSG_CHAIN_SOLVED', chainIndex: msg.chain_size - 1 };

    case OcgMessageType.CHAIN_END:
      dlog.debug('CHAIN_END → MSG_CHAIN_END');
      return { type: 'MSG_CHAIN_END' };

    case OcgMessageType.CHAIN_NEGATED:
    case OcgMessageType.CHAIN_DISABLED:
      dlog.debug('MSG_CHAIN_NEGATED', { ocgType: OcgMessageType[msg.type], chainIndex: msg.chain_size - 1 });
      return { type: 'MSG_CHAIN_NEGATED', chainIndex: msg.chain_size - 1 };

    case OcgMessageType.HINT:
      return transformHint(msg, lookup);

    case OcgMessageType.CONFIRM_DECKTOP:
      // Public excavate reveal (YGO standard): every Duel.ConfirmDecktop call
      // in the script library reveals the cards face-up to BOTH players
      // (Adamancipator, Snake-Eye, Spright, GMX Applied Experiment, etc.).
      // No known private-peek effect uses this message type — `Duel.ConfirmCards`
      // is used for "look at opponent's Extra Deck" style effects, and even
      // those reveal publicly. The `private` flag stays in the DTO as a
      // forward-looking escape hatch but is no longer set here. (See finding
      // M22 follow-up; the previous masking was an over-correction of C1.)
      return { type: 'MSG_CONFIRM_CARDS', player: msg.player as Player, cards: msg.cards.map(wrap) };
    case OcgMessageType.CONFIRM_CARDS:
      // Public reveal: passthrough to both players unchanged.
      return { type: 'MSG_CONFIRM_CARDS', player: msg.player as Player, cards: msg.cards.map(wrap) };

    case OcgMessageType.SHUFFLE_HAND:
      return { type: 'MSG_SHUFFLE_HAND', player: msg.player as Player, cards: msg.cards };

    case OcgMessageType.SHUFFLE_DECK:
      return { type: 'MSG_SHUFFLE_DECK', player: msg.player as Player };

    case OcgMessageType.FLIPSUMMONING:
      return {
        type: 'MSG_FLIP_SUMMONING', cardCode: msg.code, cardName: getCardName(msg.code), player: msg.controller,
        location: msg.location as number as (typeof LOCATION)[keyof typeof LOCATION],
        sequence: msg.sequence, position: msg.position as number as Position,
      };

    case OcgMessageType.POS_CHANGE:
      return {
        type: 'MSG_CHANGE_POS', cardCode: msg.code, cardName: getCardName(msg.code), player: msg.controller,
        location: msg.location as number as (typeof LOCATION)[keyof typeof LOCATION],
        sequence: msg.sequence,
        previousPosition: msg.prev_position as number as Position,
        currentPosition: msg.position as number as Position,
      };

    case OcgMessageType.SET:
      return {
        type: 'MSG_SET', cardCode: msg.code, cardName: getCardName(msg.code), player: msg.controller,
        location: msg.location as number as (typeof LOCATION)[keyof typeof LOCATION],
        sequence: msg.sequence, position: msg.position as number as Position,
      };

    case OcgMessageType.SWAP:
      return { type: 'MSG_SWAP', card1: wrap(msg.card1), card2: wrap(msg.card2) };

    case OcgMessageType.BECOME_TARGET:
      return transformBecomeTarget(msg);

    case OcgMessageType.ATTACK:
      return {
        type: 'MSG_ATTACK',
        attackerPlayer: msg.card.controller,
        attackerSequence: msg.card.sequence,
        defenderPlayer: msg.target?.controller ?? null,
        defenderSequence: msg.target?.sequence ?? null,
      };

    case OcgMessageType.BATTLE:
      return transformBattle(msg);

    case OcgMessageType.TOSS_COIN:
      return { type: 'MSG_TOSS_COIN', player: msg.player as Player, results: msg.results };

    case OcgMessageType.TOSS_DICE:
      return { type: 'MSG_TOSS_DICE', player: msg.player as Player, results: msg.results };

    case OcgMessageType.EQUIP:
      return transformEquip(msg);

    case OcgMessageType.ADD_COUNTER:
      return {
        type: 'MSG_ADD_COUNTER', counterType: msg.counter_type, player: msg.controller as Player,
        location: msg.location as number as (typeof LOCATION)[keyof typeof LOCATION],
        sequence: msg.sequence, count: msg.count,
      };

    case OcgMessageType.REMOVE_COUNTER:
      return {
        type: 'MSG_REMOVE_COUNTER', counterType: msg.counter_type, player: msg.controller as Player,
        location: msg.location as number as (typeof LOCATION)[keyof typeof LOCATION],
        sequence: msg.sequence, count: msg.count,
      };

    case OcgMessageType.SHUFFLE_SET_CARD:
      return transformShuffleSetCard(msg);

    case OcgMessageType.SWAP_GRAVE_DECK:
      return { type: 'MSG_SWAP_GRAVE_DECK', player: msg.player as Player };

    case OcgMessageType.WIN:
      return { type: 'MSG_WIN', player: msg.player as Player, reason: msg.reason };

    // --- Prompt Messages ---
    case OcgMessageType.SELECT_IDLECMD:
      return transformSelectIdleCmd(msg, lookup);

    case OcgMessageType.SELECT_BATTLECMD:
      return {
        type: 'SELECT_BATTLECMD', player: msg.player as Player,
        attacks: msg.attacks.map(c => wrap(c)),
        activations: msg.chains.map(c => ({ ...wrap(c), description: Number(c.description) })),
        canMainPhase2: msg.to_m2, canEndPhase: msg.to_ep,
      };

    case OcgMessageType.SELECT_CARD:
      return {
        type: 'SELECT_CARD', player: msg.player as Player,
        min: msg.min, max: msg.max,
        cards: msg.selects.map(wrap),
        cancelable: msg.can_cancel,
      };

    case OcgMessageType.SELECT_CHAIN:
      return transformSelectChain(msg, lookup);

    case OcgMessageType.SELECT_EFFECTYN:
      return transformSelectEffectYn(msg, lookup);

    case OcgMessageType.SELECT_YESNO: {
      const description = Number(msg.description);
      return {
        type: 'SELECT_YESNO', player: msg.player as Player, description,
        descriptionText: resolvePromptDescription(description, lookup),
      };
    }

    case OcgMessageType.SELECT_PLACE:
      return {
        type: 'SELECT_PLACE', player: msg.player as Player,
        count: msg.count, places: decodePlaces(msg.field_mask, msg.player as Player),
      };

    case OcgMessageType.SELECT_DISFIELD:
      return {
        type: 'SELECT_DISFIELD', player: msg.player as Player,
        count: msg.count, places: decodePlaces(msg.field_mask, msg.player as Player),
      };

    case OcgMessageType.SELECT_POSITION:
      return {
        type: 'SELECT_POSITION', player: msg.player as Player,
        cardCode: msg.code, cardName: getCardName(msg.code), positions: decodePositions(msg.positions as number),
      };

    case OcgMessageType.SELECT_OPTION:
      return transformSelectOption(msg, lookup);

    case OcgMessageType.SELECT_TRIBUTE:
      return {
        type: 'SELECT_TRIBUTE', player: msg.player as Player,
        min: msg.min, max: msg.max,
        cards: msg.selects.map(c => ({ ...wrap(c), releaseParam: c.release_param })),
        cancelable: msg.can_cancel,
      };

    case OcgMessageType.SELECT_SUM:
      return transformSelectSum(msg, lookup);

    case OcgMessageType.SELECT_UNSELECT_CARD:
      return transformSelectUnselect(msg, lookup);

    case OcgMessageType.SELECT_COUNTER:
      return {
        type: 'SELECT_COUNTER', player: msg.player as Player,
        counterType: msg.counter_type, count: msg.count,
        cards: msg.cards.map(c => wrap(c)),
      };

    case OcgMessageType.SORT_CARD:
      return { type: 'SORT_CARD', player: msg.player as Player, cards: msg.cards.map(wrap) };

    case OcgMessageType.SORT_CHAIN:
      return { type: 'SORT_CHAIN', player: msg.player as Player, cards: msg.cards.map(wrap) };

    case OcgMessageType.ANNOUNCE_RACE:
      return {
        type: 'ANNOUNCE_RACE', player: msg.player as Player,
        count: msg.count, available: decodeBitmask(msg.available as bigint, 32),
      };

    case OcgMessageType.ANNOUNCE_ATTRIB:
      return {
        type: 'ANNOUNCE_ATTRIB', player: msg.player as Player,
        count: msg.count, available: decodeAttributes(msg.available as number),
      };

    case OcgMessageType.ANNOUNCE_CARD:
      return { type: 'ANNOUNCE_CARD', player: msg.player as Player, opcodes: msg.opcodes.map(Number) };

    case OcgMessageType.ANNOUNCE_NUMBER: {
      const opts = msg.options.map(Number);
      lookup.setLastAnnounceNumberOptions(opts);
      return { type: 'ANNOUNCE_NUMBER', player: msg.player as Player, options: opts };
    }

    // --- OCGCore in-game RPS — short-circuited via skipRps=true at INIT_DUEL.
    // Pre-duel "who goes first" runs through the dice 2D6 first-player
    // coordinator (see first-player-coordinator.ts) and is independent of
    // OCGCore. If OCGCore emits a ROCK_PAPER_SCISSORS message despite
    // skipRpsFlag, it's a regression (engine update? config drift?) — we
    // drop it and log loudly so the next test run catches it.
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      if (!skipRpsFlag) {
        dlog.error('Unexpected OCGCore ROCK_PAPER_SCISSORS message — skipRps was supposed to suppress it. Dropping.');
      }
      return null;

    case OcgMessageType.HAND_RES:
      if (!skipRpsFlag) {
        dlog.error('Unexpected OCGCore HAND_RES message — skipRps was supposed to suppress it. Dropping.');
      }
      return null;

    case OcgMessageType.RETRY:
      dlog.warn('OCGCore sent RETRY — previous response was invalid');
      return null;

    // --- All other OCGCore messages: silently ignored ---
    default:
      return null;
  }
}

// =============================================================================
// Client response → OCGCore response (inverse direction)
// =============================================================================

/** Translates a client PLAYER_RESPONSE payload (`promptType` + `data`) into
 *  the OCGCore response object expected by `duelSetResponse`. The
 *  ANNOUNCE_NUMBER branch reads `lastAnnounceNumberOptions` (captured on
 *  the matching outbound ANNOUNCE_NUMBER) via the lookup context. */
export function transformResponse(
  promptType: string,
  data: Record<string, unknown>,
  lookup: LookupContext,
): unknown {
  switch (promptType) {
    case 'SELECT_BATTLECMD':
      return { type: 0, action: data['action'], index: data['index'] ?? null };
    case 'SELECT_IDLECMD':
      return { type: 1, action: data['action'], index: data['index'] ?? null };
    case 'SELECT_EFFECTYN':
      return { type: 2, yes: data['yes'] };
    case 'SELECT_YESNO':
      return { type: 3, yes: data['yes'] };
    case 'SELECT_OPTION':
      return { type: 4, index: data['index'] };
    case 'SELECT_CARD':
      return { type: 5, indicies: data['indices'] ?? null }; // OCGCore typo: "indicies"
    case 'SELECT_UNSELECT_CARD':
      return { type: 7, index: data['index'] ?? null };
    case 'SELECT_CHAIN':
      return { type: 8, index: data['index'] ?? null };
    case 'SELECT_DISFIELD':
      return { type: 9, places: data['places'] };
    case 'SELECT_PLACE':
      return { type: 10, places: data['places'] };
    case 'SELECT_POSITION':
      return { type: 11, position: data['position'] };
    case 'SELECT_TRIBUTE':
      return { type: 12, indicies: data['indices'] ?? null }; // OCGCore typo
    case 'SELECT_COUNTER':
      return { type: 13, counters: data['counts'] };
    case 'SELECT_SUM': {
      // OCGCore expects indices into the combined array (must first, then optional).
      // Client sends indices into the merged [must...optional] array directly.
      const indices = data['indices'] as number[] | null;
      return { type: 14, indicies: indices ?? null };
    }
    case 'SORT_CARD':
    case 'SORT_CHAIN':
      return { type: 15, order: data['order'] ?? null };
    case 'ANNOUNCE_RACE':
      return { type: 16, races: [BigInt(data['value'] as number)] };
    case 'ANNOUNCE_ATTRIB':
      return { type: 17, attributes: [data['value']] };
    case 'ANNOUNCE_CARD':
      return { type: 18, card: data['value'] };
    case 'ANNOUNCE_NUMBER': {
      const val = data['value'] as number;
      const idx = lookup.getLastAnnounceNumberOptions().indexOf(val);
      return { type: 19, value: idx >= 0 ? idx : val };
    }
    // RPS_CHOICE used to map the in-game OCGCore RPS prompt; the pre-duel
    // first-player flow switched to dice 2D6 (2026-05-13) and INIT_DUEL
    // sets skipRps=true so OCGCore never asks. The auto-respond in
    // runDuelLoop handles the (regression-only) case where it does.
    default:
      lookup.dlog().error('Unknown promptType', { promptType });
      return null;
  }
}
