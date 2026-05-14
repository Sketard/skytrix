import { parentPort, workerData } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
  OcgQueryFlags,
} from '@n1xx1/ocgcore-wasm';
import type {
  OcgCoreSync,
  OcgDuelHandle,
  OcgMessage,
  OcgCardLoc,
  OcgCardLocPos,
} from '@n1xx1/ocgcore-wasm';
import { loadDatabase, loadScripts, loadSystemStrings, getScriptsHash, getOcgcoreVersion, setScriptsHash, setOcgcoreVersion, STARTUP_SCRIPTS } from './ocg-scripts.js';
import { createCardReader, createScriptReader } from './ocg-callbacks.js';
import { WATCHDOG_TIMEOUT_MS } from './types.js';
import * as logger from './logger.js';
import { installWasmHook, uninstallWasmHook, locateWasmMemory, snapshotAvailable } from './wasm-snapshot.js';
import type { MainToWorkerMessage, CapturedResponse, Deck, InitReplayMessage, InitForkMessage } from './types.js';
import { filterMessage } from './message-filter.js';
import { ChainSnapshotTracker } from './chain-snapshot-tracker.js';
import { CardDbCache } from './card-db-cache.js';
import { runReplayPreComputation, SELECT_MESSAGE_TYPES } from './replay-precompute.js';
import type {
  ServerMessage,
  BoardStateMsg,
  BoardStatePayload,
  Player,
  Phase,
  CardInfo,
  PlaceOption,
  PlayerBoardState,
  BoardZone,
  CardOnField,
  LinkedCardRef,
  Position,
} from './ws-protocol.js';
import { LOCATION, POSITION } from './ws-protocol.js';
import type { ZoneId } from './ws-protocol.js';
import { join } from 'node:path';

// =============================================================================
// Worker Thread Setup
// =============================================================================

if (!parentPort) throw new Error('Must run as a worker thread');
const port = parentPort;
const { dataDir } = workerData as { dataDir: string };

// =============================================================================
// State
// =============================================================================

let core: OcgCoreSync | null = null;
let duel: OcgDuelHandle | null = null;
let duelId = '';
let dlog = logger.forDuel('(pre-init)');
let turnPlayer: Player = 0;
let turnCount = 0;
let phase: Phase = 'DRAW';
let lp: [number, number] = [8000, 8000];
let cardDb: import('./types.js').CardDB | null = null;
let systemStrings: Map<number, string> = new Map();
let skipRpsFlag = false;
let skipShuffleFlag = false;
let lastAnnounceNumberOptions: number[] = [];
let lastResponsePlayerIndex: 0 | 1 = 0;

// Replay capture state
let capturedResponses: CapturedResponse[] = [];
let duelSeed: bigint[] = [];
let capturedDecks: [Deck, Deck] = [{ main: [], extra: [] }, { main: [], extra: [] }];
let playerUsernames: [string, string] = ['', ''];
let deckNames: [string, string] = ['', ''];
let duelResult: string | null = null;
let replayEmitted = false;
let duelStartMs = 0;

// =============================================================================
// Worker Snapshot Wrapper (P0-3bis.2)
// =============================================================================
//
// Bridge between `wasm-snapshot.ts` (WASM-only primitives) and the
// 5 divergent module-level state slots identified in P0-3bis-POC.1's
// report Q2. The actual capture/restore logic lives in
// `wasm-snapshot-wrapper.ts` (testable without booting the worker);
// this module just exposes accessor closures for the wrapper to use.
//
// NOTE: not yet wired to any production code path. The next story
// (P0-3bis.3) will plug these into the `CANCEL_PROMPT_SEQUENCE` WS
// message handler.
// =============================================================================

import {
  type WorkerSnapshot,
  type WorkerStateAccessors,
  takeWorkerSnapshotImpl,
  restoreWorkerSnapshotImpl,
  tryCancelRollback,
} from './wasm-snapshot-wrapper.js';

/** Accessor closures bound to this worker module's `let` bindings. */
const workerStateAccessors: WorkerStateAccessors = {
  getTurnPlayer: () => turnPlayer,
  getTurnCount: () => turnCount,
  getPhase: () => phase,
  getLp: () => lp,
  getLastResponsePlayerIndex: () => lastResponsePlayerIndex,
  getLastAnnounceNumberOptions: () => lastAnnounceNumberOptions,
  getCapturedResponsesLength: () => capturedResponses.length,
  setTurnPlayer: (v) => { turnPlayer = v; },
  setTurnCount: (v) => { turnCount = v; },
  setPhase: (v) => { phase = v; },
  setLp: (v) => { lp = v; },
  setLastResponsePlayerIndex: (v) => { lastResponsePlayerIndex = v; },
  setLastAnnounceNumberOptions: (v) => { lastAnnounceNumberOptions = v; },
  truncateCapturedResponses: (len) => { capturedResponses.length = len; },
  log: (msg) => dlog.debug(msg),
};

export function takeWorkerSnapshot(): WorkerSnapshot {
  return takeWorkerSnapshotImpl(workerStateAccessors);
}

export function restoreWorkerSnapshot(snap: WorkerSnapshot): void {
  restoreWorkerSnapshotImpl(snap, workerStateAccessors);
}

export type { WorkerSnapshot };

/**
 * P0-3bis.3 — single-slot rollback target.
 * Set BEFORE applying a SELECT_IDLECMD/SELECT_BATTLECMD response, used by
 * `CANCEL_PROMPT_SEQUENCE` to roll back. Cleared (a) when the next
 * IDLECMD/BATTLECMD prompt is emitted (= new boundary), (b) on cancel
 * after restore, (c) on duel cleanup, (d) after SNAPSHOT_TTL_MS expires.
 *
 * For the FULL inventory of state slots reset across the cancel flow
 * (worker + server + client), see
 * `_bmad-output/planning-artifacts/cancel-rollback-contract.md`.
 * READ IT BEFORE ADDING A NEW MUTABLE MODULE-LEVEL STATE SLOT.
 */
let lastIdleSnapshot: WorkerSnapshot | null = null;

/** P0-3bis.4 — TTL timer that drops a stale snapshot if the player
 *  ignores the continuation prompt for too long. Always paired with
 *  `lastIdleSnapshot`; reset on snapshot replace/clear. */
let lastIdleSnapshotTimer: NodeJS.Timeout | null = null;
const SNAPSHOT_TTL_MS = 30_000;

/** P0-3bis.4 — chain-resolution tracker, hoisted out of `runDuelLoop` so the
 *  CANCEL_PROMPT_SEQUENCE handler can refuse mid-chain rollbacks via
 *  `liveChainTracker.isResolving`. Reset at the top of each `runDuelLoop`
 *  call to preserve the original per-call semantics. The
 *  `runReplayPreComputation` path uses its own local instance since cancel
 *  never applies in replay. Audit finding H2 — same code path on both sides
 *  guarantees PvP↔Replay parity by construction. */
const liveChainTracker = new ChainSnapshotTracker();

/**
 * P0-3bis.4 — Replace (or clear) the held rollback snapshot. Cancels any
 * pending TTL timer and schedules a new one for non-null assignments.
 *
 * MUST be the only EXTERNAL writer to `lastIdleSnapshot`. The internal
 * TTL timer callback is the single sanctioned exception — it nulls the
 * slot and the timer ref atomically (the timer is already firing, so
 * calling `setLastIdleSnapshot(null)` from within would re-enter the
 * helper to clear a timer that doesn't need clearing).
 */
function setLastIdleSnapshot(snap: WorkerSnapshot | null): void {
  if (lastIdleSnapshotTimer) {
    clearTimeout(lastIdleSnapshotTimer);
    lastIdleSnapshotTimer = null;
  }
  lastIdleSnapshot = snap;
  if (snap !== null) {
    const tookAt = performance.now();
    lastIdleSnapshotTimer = setTimeout(() => {
      // Sanctioned in-place mutation — see helper docstring. The
      // try/finally ensures the (slot=null, timer=null) invariant holds
      // even if the debug log throws unexpectedly.
      try {
        const aliveMs = performance.now() - tookAt;
        dlog.debug(`[duel-worker] snapshot expired after ${aliveMs.toFixed(0)}ms`);
      } finally {
        lastIdleSnapshot = null;
        lastIdleSnapshotTimer = null;
      }
    }, SNAPSHOT_TTL_MS);
  }
}

// =============================================================================
// Constants & Helpers
// =============================================================================

// Maps OCGCore hint_timing bitmask values to strings.conf system string indices.
const TIMING_STRING_ID: Record<number, number> = {
  0x01: 20, // Draw Phase
  0x02: 21, // Standby Phase
  0x04: 23, // Attempting to end the Main Phase
  0x08: 80, // Entering the Battle Phase
  0x10: 25, // End of the Battle Phase
  0x20: 81, // Entering the End Phase
};

const PHASE_MAP: Record<number, Phase> = {
  1: 'DRAW', 2: 'STANDBY', 4: 'MAIN1', 8: 'BATTLE_START',
  16: 'BATTLE_STEP', 32: 'DAMAGE', 64: 'DAMAGE_CALC',
  128: 'BATTLE', 256: 'MAIN2', 512: 'END',
};

const MZONE_IDS: ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
const SZONE_IDS: ZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];

const RACE_LABELS: Record<number, string> = {
  1: 'Warrior', 2: 'Spellcaster', 4: 'Fairy', 8: 'Fiend', 16: 'Zombie',
  32: 'Machine', 64: 'Aqua', 128: 'Pyro', 256: 'Rock', 512: 'Winged Beast',
  1024: 'Plant', 2048: 'Insect', 4096: 'Thunder', 8192: 'Dragon', 16384: 'Beast',
  32768: 'Beast-Warrior', 65536: 'Dinosaur', 131072: 'Fish', 262144: 'Sea Serpent',
  524288: 'Reptile', 1048576: 'Psychic', 2097152: 'Divine-Beast', 4194304: 'Creator God',
  8388608: 'Wyrm', 16777216: 'Cyberse',
};

const ATTRIB_LABELS: Record<number, string> = {
  1: 'EARTH', 2: 'WATER', 4: 'FIRE', 8: 'WIND', 16: 'LIGHT', 32: 'DARK', 64: 'DIVINE',
};


function getCardName(code: number): string {
  if (!cardDb || !code) return '';
  const row = cardDb.nameStmt.get(code) as { name: string } | undefined;
  return row?.name ?? '';
}

const TYPE_TOKEN = 0x4000;
const STATUS_DISABLED = 0x0001;

/**
 * Per-cardCode memoization of cards.cdb base values + bitwise post-processing
 * (level/rank/scales/type masks). Cleared in `cleanup()` when CardDB is closed.
 * See `card-db-cache.ts` for invariants.
 */
const cardDbCache = new CardDbCache();

function isTokenCard(code: number): boolean {
  const cached = cardDbCache.get(cardDb, code);
  return cached ? (cached.cardType & TYPE_TOKEN) !== 0 : false;
}

function getOptionDesc(optionCode: bigint): string {
  const cardCode = Number(optionCode >> 20n);
  const strIndex = Number(optionCode & 0xFFFFFn);
  if (!cardCode) {
    // System string (cardCode=0) — look up in strings.conf
    return systemStrings.get(strIndex) ?? '';
  }
  if (!cardDb) return '';
  const row = cardDb.descStmt.get(cardCode) as Record<string, string> | undefined;
  if (!row) return '';
  return row[`str${strIndex + 1}`] || '';
}

/** Returns the description text if fully resolved, or empty string if it still contains unresolved '%' placeholders. */
function resolvedDescOrEmpty(desc: string): string { return desc.includes('%') ? '' : desc; }

function toCardInfo(c: OcgCardLoc | OcgCardLocPos): CardInfo {
  const info: CardInfo = { cardCode: c.code, name: getCardName(c.code), player: c.controller, location: c.location as number as (typeof LOCATION)[keyof typeof LOCATION], sequence: c.sequence };
  if ('position' in c) info.position = c.position as number;
  return info;
}

function countersToRecord(counters?: Record<number, number>): Record<string, number> {
  if (!counters) return {};
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(counters)) result[k] = v;
  return result;
}

function decodePlaces(mask: number, selectingPlayer: Player): PlaceOption[] {
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

function decodePositions(mask: number): number[] {
  const result: number[] = [];
  if (mask & 1) result.push(POSITION.FACEUP_ATTACK);
  if (mask & 2) result.push(POSITION.FACEDOWN_ATTACK);
  if (mask & 4) result.push(POSITION.FACEUP_DEFENSE);
  if (mask & 8) result.push(POSITION.FACEDOWN_DEFENSE);
  return result;
}

function decodeBitmask(mask: bigint, maxBits: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < maxBits; i++) {
    if (mask & (1n << BigInt(i))) result.push(Number(1n << BigInt(i)));
  }
  return result;
}

function decodeAttributes(mask: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (mask & (1 << i)) result.push(1 << i);
  }
  return result;
}

function generateSeed(): [bigint, bigint, bigint, bigint] {
  const buf = randomBytes(32);
  return [
    buf.readBigUInt64LE(0),
    buf.readBigUInt64LE(8),
    buf.readBigUInt64LE(16),
    buf.readBigUInt64LE(24),
  ];
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  // Fisher-Yates with crypto randomness
  const buf = randomBytes(result.length * 4);
  for (let i = result.length - 1; i > 0; i--) {
    const j = buf.readUInt32LE(i * 4) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// =============================================================================
// OcgMessage → ServerMessage Transformation
// =============================================================================

const LOC_NAME: Record<number, string> = {
  [LOCATION.DECK]: 'DECK', [LOCATION.HAND]: 'HAND', [LOCATION.MZONE]: 'MZONE',
  [LOCATION.SZONE]: 'SZONE', [LOCATION.GRAVE]: 'GY', [LOCATION.BANISHED]: 'BANISHED',
  [LOCATION.EXTRA]: 'EXTRA', [LOCATION.OVERLAY]: 'OVERLAY',
};
function locName(loc: number): string { return LOC_NAME[loc] ?? `0x${loc.toString(16)}`; }

// =============================================================================
// transformMessage helpers (audit finding M1)
// =============================================================================
// The main switch in `transformMessage` was 395 LOC / 30+ cases — well above
// Miller. These helpers extract the cases that span more than ~8 lines into
// named functions; trivial 1-line returns stay inline in the dispatcher so
// the high-level shape (which OcgMessageType maps to which DTO) remains
// scannable in one screen. Helpers close over module-level state
// (`getCardName`, `systemStrings`, `core`, `duel`, etc.) — not exported.

function transformMove(msg: any): ServerMessage {
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
  return {
    type: 'MSG_MOVE', cardCode: msg.card, cardName: getCardName(msg.card), player: msg.from.controller,
    fromLocation: msg.from.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    fromSequence: msg.from.sequence,
    fromPosition: msg.from.position as number as Position,
    toLocation: msg.to.location as number as (typeof LOCATION)[keyof typeof LOCATION],
    toSequence: msg.to.sequence,
    toPosition: msg.to.position as number as Position,
    isToken: isTokenCard(msg.card),
    reason,
  };
}

function transformHint(msg: any): ServerMessage {
  const hintType = msg.hint_type as number;
  const value = Number(msg.hint);
  let cardName = '';
  let hintAction = '';
  if (hintType === 5 || hintType === 8 || hintType === 10 || hintType === 13 || hintType === 15) {
    // HINT_EFFECT / HINT_CODE / HINT_CARD: value is a card code
    cardName = getCardName(value);
  } else if (hintType === 1 || hintType === 2) {
    // HINT_EVENT / HINT_MESSAGE: value is a system string ID
    hintAction = systemStrings.get(value) ?? '';
  } else if (hintType === 3 || hintType === 4) {
    // HINT_SELECTMSG / HINT_OPSELECTED: value is a system string ID or a card code
    const sysStr = systemStrings.get(value);
    if (sysStr) {
      hintAction = sysStr;
    } else {
      cardName = getCardName(value);
    }
  } else if (hintType === 6) {
    // HINT_RACE: value is a race bitmask
    hintAction = RACE_LABELS[value] ?? `race:0x${value.toString(16)}`;
  } else if (hintType === 7) {
    // HINT_ATTRIB: value is an attribute bitmask
    hintAction = ATTRIB_LABELS[value] ?? `attr:0x${value.toString(16)}`;
  } else if (hintType === 9) {
    // HINT_NUMBER: value is a number
    hintAction = String(value);
  }
  return { type: 'MSG_HINT', hintType, player: msg.player as Player, value, cardName, hintAction };
}

function transformBattle(msg: any): ServerMessage | null {
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

function transformBecomeTarget(msg: any): ServerMessage {
  return {
    type: 'MSG_BECOME_TARGET',
    cards: msg.cards.map((c: any) => ({
      player: c.controller as Player,
      location: c.location as number as (typeof LOCATION)[keyof typeof LOCATION],
      sequence: c.sequence,
    })),
  };
}

function transformEquip(msg: any): ServerMessage {
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

function transformShuffleSetCard(msg: any): ServerMessage {
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

function transformSelectIdleCmd(msg: any): ServerMessage {
  return {
    type: 'SELECT_IDLECMD', player: msg.player as Player,
    summons: msg.summons.map(toCardInfo),
    specialSummons: msg.special_summons.map(toCardInfo),
    repositions: msg.pos_changes.map(toCardInfo),
    setMonsters: msg.monster_sets.map(toCardInfo),
    activations: msg.activates.map((c: any) => ({ ...toCardInfo(c), description: getOptionDesc(c.description) })),
    setSpellTraps: msg.spell_sets.map(toCardInfo),
    canBattlePhase: msg.to_bp, canEndPhase: msg.to_ep,
  };
}

function transformSelectChain(msg: any): ServerMessage {
  const timing = msg.hint_timing as number;
  const timingLabel = systemStrings.get(TIMING_STRING_ID[timing] ?? 0) ?? '';
  return {
    type: 'SELECT_CHAIN', player: msg.player as Player,
    cards: msg.selects.map((c: any) => toCardInfo(c)),
    forced: msg.forced,
    hintTiming: timing,
    hintTimingLabel: timingLabel,
  };
}

function transformSelectEffectYn(msg: any): ServerMessage {
  const effectDesc = getOptionDesc(msg.description as bigint);
  return {
    type: 'SELECT_EFFECTYN', player: msg.player as Player,
    cardCode: msg.code, cardName: getCardName(msg.code), description: Number(msg.description),
    descriptionText: resolvedDescOrEmpty(effectDesc),
  };
}

function transformSelectOption(msg: any): ServerMessage {
  const rawOptions = msg.options.map(Number);
  const descriptions = msg.options.map((o: any) => getOptionDesc(BigInt(o)));
  dlog.debug('SELECT_OPTION', { raw: msg.options.map(String), decoded: rawOptions.map((o: number) => ({ cardCode: o >> 20, strIndex: o & 0xFFFFF })), descriptions });
  return {
    type: 'SELECT_OPTION', player: msg.player as Player,
    options: rawOptions, descriptions,
  };
}

function transformSelectSum(msg: any): ServerMessage {
  return {
    type: 'SELECT_SUM', player: msg.player as Player,
    mustSelect: msg.selects_must.map((c: any) => ({ ...toCardInfo(c), amount: c.amount })),
    cards: msg.selects.map((c: any) => ({ ...toCardInfo(c), amount: c.amount })),
    targetSum: msg.amount, minCards: msg.min, maxCards: msg.max, selectMax: msg.select_max,
  };
}

function transformSelectUnselect(msg: any): ServerMessage {
  dlog.debug('SELECT_UNSELECT_CARD', { select: msg.select_cards.length, unselect: msg.unselect_cards.length, canFinish: msg.can_finish });
  return {
    type: 'SELECT_UNSELECT_CARD', player: msg.player as Player,
    cards: [...msg.select_cards, ...msg.unselect_cards].map(toCardInfo),
    selectCount: msg.select_cards.length,
    canFinish: msg.can_finish,
  };
}

function transformMessage(msg: OcgMessage): ServerMessage | null {
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
      return transformMove(msg);

    case OcgMessageType.DAMAGE:
      return { type: 'MSG_DAMAGE', player: msg.player as Player, amount: msg.amount };

    case OcgMessageType.RECOVER:
      return { type: 'MSG_RECOVER', player: msg.player as Player, amount: msg.amount };

    case OcgMessageType.PAY_LPCOST:
      return { type: 'MSG_PAY_LPCOST', player: msg.player as Player, amount: msg.amount };

    case OcgMessageType.CHAINING:
      return {
        type: 'MSG_CHAINING', cardCode: msg.code, cardName: getCardName(msg.code), player: msg.controller,
        location: msg.location as number as (typeof LOCATION)[keyof typeof LOCATION],
        sequence: msg.sequence, chainIndex: msg.chain_size - 1, description: Number(msg.description),
      };

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
      return transformHint(msg);

    case OcgMessageType.CONFIRM_DECKTOP:
      // Public excavate reveal (YGO standard): every Duel.ConfirmDecktop call
      // in the script library reveals the cards face-up to BOTH players
      // (Adamancipator, Snake-Eye, Spright, GMX Applied Experiment, etc.).
      // No known private-peek effect uses this message type — `Duel.ConfirmCards`
      // is used for "look at opponent's Extra Deck" style effects, and even
      // those reveal publicly. The `private` flag stays in the DTO as a
      // forward-looking escape hatch but is no longer set here. (See finding
      // M22 follow-up; the previous masking was an over-correction of C1.)
      return { type: 'MSG_CONFIRM_CARDS', player: msg.player as Player, cards: msg.cards.map(toCardInfo) };
    case OcgMessageType.CONFIRM_CARDS:
      // Public reveal: passthrough to both players unchanged.
      return { type: 'MSG_CONFIRM_CARDS', player: msg.player as Player, cards: msg.cards.map(toCardInfo) };

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
      return { type: 'MSG_SWAP', card1: toCardInfo(msg.card1), card2: toCardInfo(msg.card2) };

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
      return transformSelectIdleCmd(msg);

    case OcgMessageType.SELECT_BATTLECMD:
      return {
        type: 'SELECT_BATTLECMD', player: msg.player as Player,
        attacks: msg.attacks.map(c => toCardInfo(c)),
        activations: msg.chains.map(c => ({ ...toCardInfo(c), description: getOptionDesc(c.description) })),
        canMainPhase2: msg.to_m2, canEndPhase: msg.to_ep,
      };

    case OcgMessageType.SELECT_CARD:
      return {
        type: 'SELECT_CARD', player: msg.player as Player,
        min: msg.min, max: msg.max,
        cards: msg.selects.map(toCardInfo),
        cancelable: msg.can_cancel,
      };

    case OcgMessageType.SELECT_CHAIN:
      return transformSelectChain(msg);

    case OcgMessageType.SELECT_EFFECTYN:
      return transformSelectEffectYn(msg);

    case OcgMessageType.SELECT_YESNO: {
      const desc = Number(msg.description);
      const yesNoDesc = getOptionDesc(BigInt(desc));
      return { type: 'SELECT_YESNO', player: msg.player as Player, description: desc, descriptionText: resolvedDescOrEmpty(yesNoDesc) };
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
      return transformSelectOption(msg);

    case OcgMessageType.SELECT_TRIBUTE:
      return {
        type: 'SELECT_TRIBUTE', player: msg.player as Player,
        min: msg.min, max: msg.max,
        cards: msg.selects.map(c => ({ ...toCardInfo(c), releaseParam: c.release_param })),
        cancelable: msg.can_cancel,
      };

    case OcgMessageType.SELECT_SUM:
      return transformSelectSum(msg);

    case OcgMessageType.SELECT_UNSELECT_CARD:
      return transformSelectUnselect(msg);

    case OcgMessageType.SELECT_COUNTER:
      return {
        type: 'SELECT_COUNTER', player: msg.player as Player,
        counterType: msg.counter_type, count: msg.count,
        cards: msg.cards.map(c => toCardInfo(c)),
      };

    case OcgMessageType.SORT_CARD:
      return { type: 'SORT_CARD', player: msg.player as Player, cards: msg.cards.map(toCardInfo) };

    case OcgMessageType.SORT_CHAIN:
      return { type: 'SORT_CHAIN', player: msg.player as Player, cards: msg.cards.map(toCardInfo) };

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

    case OcgMessageType.ANNOUNCE_NUMBER:
      lastAnnounceNumberOptions = msg.options.map(Number);
      return { type: 'ANNOUNCE_NUMBER', player: msg.player as Player, options: lastAnnounceNumberOptions };

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
// State Tracking (from OCGCore messages, used for BOARD_STATE)
// =============================================================================

function updateState(msg: OcgMessage): void {
  switch (msg.type) {
    case OcgMessageType.NEW_TURN:
      turnPlayer = msg.player as Player;
      turnCount++;
      break;
    case OcgMessageType.NEW_PHASE:
      phase = PHASE_MAP[msg.phase as number] ?? 'DRAW';
      break;
    case OcgMessageType.DAMAGE:
      lp[msg.player] -= msg.amount;
      break;
    case OcgMessageType.RECOVER:
      lp[msg.player] += msg.amount;
      break;
    case OcgMessageType.PAY_LPCOST:
      lp[msg.player] -= msg.amount;
      break;
    case OcgMessageType.LPUPDATE:
      lp[msg.player] = msg.lp;
      break;
  }
}

// =============================================================================
// BOARD_STATE Builder
// =============================================================================

let buildBoardStateCumulativeMs = 0;
let buildBoardStateCallCount = 0;

export function getBuildBoardStatePerfStats(): { calls: number; cumulativeMs: number; avgMs: number } {
  return {
    calls: buildBoardStateCallCount,
    cumulativeMs: Math.round(buildBoardStateCumulativeMs * 100) / 100,
    avgMs: buildBoardStateCallCount > 0 ? Math.round((buildBoardStateCumulativeMs / buildBoardStateCallCount) * 100) / 100 : 0,
  };
}

function buildBoardState(): ServerMessage {
  if (!core || !duel) throw new Error('No active duel');

  const perfStart = performance.now();

  const fieldState = core.duelQueryField(duel);
  // WASM bug workaround: combining multiple OcgQueryFlags in a single query
  // returns null/corrupt data. Query each flag individually and merge results.
  const FLAG_CODE = OcgQueryFlags.CODE as number;
  const FLAG_POS = OcgQueryFlags.POSITION as number;
  const FLAG_OVERLAY = OcgQueryFlags.OVERLAY_CARD as number;
  const FLAG_COUNTERS = OcgQueryFlags.COUNTERS as number;
  const FLAG_ATK = OcgQueryFlags.ATTACK as number;
  const FLAG_DEF = OcgQueryFlags.DEFENSE as number;
  const FLAG_BASE_ATK = OcgQueryFlags.BASE_ATTACK as number;
  const FLAG_BASE_DEF = OcgQueryFlags.BASE_DEFENSE as number;
  const FLAG_LEVEL = OcgQueryFlags.LEVEL as number;
  const FLAG_RANK = OcgQueryFlags.RANK as number;
  const FLAG_ATTRIBUTE = OcgQueryFlags.ATTRIBUTE as number;
  const FLAG_RACE = OcgQueryFlags.RACE as number;
  const FLAG_STATUS = OcgQueryFlags.STATUS as number;
  const FLAG_EQUIP = OcgQueryFlags.EQUIP_CARD as number;
  const FLAG_TARGET = OcgQueryFlags.TARGET_CARD as number;
  const FLAG_TYPE = OcgQueryFlags.TYPE as number;
  const FLAG_LSCALE = OcgQueryFlags.LSCALE as number;
  const FLAG_RSCALE = OcgQueryFlags.RSCALE as number;

  function queryFlag(controller: 0 | 1, location: number, sequence: number, flags: number) {
    return core!.duelQuery(duel!, { flags, controller, location, sequence, overlaySequence: 0 } as never);
  }

  function queryCard(controller: 0 | 1, location: number, sequence: number, fieldPosition: number): CardOnField {
    const codeInfo = queryFlag(controller, location, sequence, FLAG_CODE);
    const overlayInfo = queryFlag(controller, location, sequence, FLAG_OVERLAY);
    const counterInfo = queryFlag(controller, location, sequence, FLAG_COUNTERS);
    const code = codeInfo?.code ?? null;
    const overlayCards = overlayInfo?.overlayCards ?? [];

    const card: CardOnField = {
      cardCode: code,
      name: code ? getCardName(code) : null,
      position: fieldPosition as Position,
      overlayMaterials: overlayCards,
      counters: countersToRecord(counterInfo?.counters),
    };

    // Alteration fields only for face-up cards (AC8, AC9 — queryCard is only called for field zones)
    const isFaceUp = (fieldPosition & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
    if (isFaceUp && code) {
      const atkInfo = queryFlag(controller, location, sequence, FLAG_ATK);
      const defInfo = queryFlag(controller, location, sequence, FLAG_DEF);
      const baseAtkInfo = queryFlag(controller, location, sequence, FLAG_BASE_ATK);
      const baseDefInfo = queryFlag(controller, location, sequence, FLAG_BASE_DEF);
      const levelInfo = queryFlag(controller, location, sequence, FLAG_LEVEL);
      const rankInfo = queryFlag(controller, location, sequence, FLAG_RANK);
      const attrInfo = queryFlag(controller, location, sequence, FLAG_ATTRIBUTE);
      const raceInfo = queryFlag(controller, location, sequence, FLAG_RACE);
      const statusInfo = queryFlag(controller, location, sequence, FLAG_STATUS);
      const equipInfo = queryFlag(controller, location, sequence, FLAG_EQUIP);
      const targetInfo = queryFlag(controller, location, sequence, FLAG_TARGET);
      const typeInfo = queryFlag(controller, location, sequence, FLAG_TYPE);
      const lscaleInfo = queryFlag(controller, location, sequence, FLAG_LSCALE);
      const rscaleInfo = queryFlag(controller, location, sequence, FLAG_RSCALE);

      // Number() guards: WASM may return bigint for any numeric field
      card.currentAtk = atkInfo?.attack !== undefined ? Number(atkInfo.attack) : undefined;
      card.currentDef = defInfo?.defense !== undefined ? Number(defInfo.defense) : undefined;
      card.baseAtk = baseAtkInfo?.baseAttack !== undefined ? Number(baseAtkInfo.baseAttack) : undefined;
      card.baseDef = baseDefInfo?.baseDefense !== undefined ? Number(baseDefInfo.baseDefense) : undefined;
      card.currentLevel = levelInfo?.level !== undefined ? Number(levelInfo.level) : undefined;
      card.currentRank = rankInfo?.rank !== undefined ? Number(rankInfo.rank) : undefined;
      card.currentAttribute = attrInfo?.attribute !== undefined ? Number(attrInfo.attribute) : undefined;
      card.currentRace = raceInfo?.race !== undefined ? Number(raceInfo.race) : undefined;
      card.currentLScale = lscaleInfo?.leftScale !== undefined ? Number(lscaleInfo.leftScale) : undefined;
      card.currentRScale = rscaleInfo?.rightScale !== undefined ? Number(rscaleInfo.rightScale) : undefined;
      card.currentType = typeInfo?.type !== undefined ? Number(typeInfo.type) : undefined;

      // Base values from card database (level, rank, attribute, race, scales, type).
      // Memoized per-cardCode via `cardDbCache` — these values never change for
      // a given card and are queried per face-up zone on every BOARD_STATE.
      const dbRow = cardDbCache.get(cardDb, code);
      if (dbRow) {
        card.isLink = dbRow.isLink;
        card.baseLevel = dbRow.baseLevel;
        card.baseRank = dbRow.baseRank;
        card.baseAttribute = dbRow.baseAttribute;
        card.baseRace = dbRow.baseRace;
        card.baseLScale = dbRow.baseLScale;
        card.baseRScale = dbRow.baseRScale;
        card.baseType = dbRow.baseType;
      } else {
        dlog.warn('No DB row for card — base alteration fields unavailable', { cardCode: code });
      }

      // Effect negation from STATUS bitmask (AC4)
      if (statusInfo?.status !== undefined) {
        card.isEffectNegated = (Number(statusInfo.status) & STATUS_DISABLED) !== 0;
      }

      // Linked cards: merge EQUIP_CARD (single ref, equip-spell side) and
      // TARGET_CARD (multi-ref, persistent effect-target list) into one
      // wire-format array (AC5 + new persistent-target relations).
      const links: LinkedCardRef[] = [];
      const ec = equipInfo?.equipCard;
      if (ec && ec.controller !== undefined && ec.sequence !== undefined) {
        links.push({
          kind: 'equip',
          controller: ec.controller,
          location: Number(ec.location),
          sequence: ec.sequence,
        });
      } else if (ec) {
        dlog.warn('Unexpected EQUIP_CARD format', { equipCard: ec });
      }
      const tcs = targetInfo?.targetCards ?? [];
      for (const tc of tcs) {
        if (tc.controller === undefined || tc.sequence === undefined) {
          dlog.warn('Unexpected TARGET_CARD format', { targetCard: tc });
          continue;
        }
        links.push({
          kind: 'target',
          controller: tc.controller,
          location: Number(tc.location),
          sequence: tc.sequence,
        });
      }
      if (links.length > 0) card.linkedCards = links;
    }

    return card;
  }

  function queryZone(controller: 0 | 1, location: number): CardOnField[] {
    const cards = core!.duelQueryLocation(duel!, {
      flags: FLAG_CODE | FLAG_POS, controller, location,
    } as never);
    return cards
      .filter((c): c is NonNullable<typeof c> => c != null && c.code !== undefined)
      .map(c => ({
        cardCode: c.code ?? null,
        name: c.code ? getCardName(c.code) : null,
        position: (c.position as Position) ?? (POSITION.FACEUP_ATTACK as Position),
        overlayMaterials: [] as number[],
        counters: {} as Record<string, number>,
      }));
  }

  function buildPlayerState(controller: 0 | 1): PlayerBoardState {
    const fp = fieldState.players[controller];
    const zones: BoardZone[] = [];

    // Monster Zones M1-M5 (seq 0-4)
    for (let s = 0; s < 5; s++) {
      const cards: CardOnField[] = [];
      const monsterSlot = fp.monsters[s];
      const pos = monsterSlot?.position as number ?? 0;
      if (monsterSlot && pos !== 0) {
        const card = queryCard(controller, OcgLocation.MZONE as number, s, pos);
        cards.push(card);
      }
      zones.push({ zoneId: MZONE_IDS[s], cards });
    }

    // EMZ_L (seq 5), EMZ_R (seq 6)
    for (const [s, zid] of [[5, 'EMZ_L' as ZoneId], [6, 'EMZ_R' as ZoneId]] as const) {
      const cards: CardOnField[] = [];
      if (fp.monsters[s] && (fp.monsters[s].position as number) !== 0) {
        cards.push(queryCard(controller, OcgLocation.MZONE as number, s, fp.monsters[s].position as number));
      }
      zones.push({ zoneId: zid, cards });
    }

    // Spell/Trap Zones S1-S5 (seq 0-4), with pendulum overlap
    for (let s = 0; s < 5; s++) {
      const cards: CardOnField[] = [];
      if (fp.spells[s] && (fp.spells[s].position as number) !== 0) {
        cards.push(queryCard(controller, OcgLocation.SZONE as number, s, fp.spells[s].position as number));
      } else if (s === 0 && fp.spells[6] && (fp.spells[6].position as number) !== 0) {
        cards.push(queryCard(controller, OcgLocation.SZONE as number, 6, fp.spells[6].position as number));
      } else if (s === 4 && fp.spells[7] && (fp.spells[7].position as number) !== 0) {
        cards.push(queryCard(controller, OcgLocation.SZONE as number, 7, fp.spells[7].position as number));
      }
      zones.push({ zoneId: SZONE_IDS[s], cards });
    }

    // Field Zone (seq 5)
    {
      const cards: CardOnField[] = [];
      if (fp.spells[5] && (fp.spells[5].position as number) !== 0) {
        cards.push(queryCard(controller, OcgLocation.SZONE as number, 5, fp.spells[5].position as number));
      }
      zones.push({ zoneId: 'FIELD', cards });
    }

    // List zones
    zones.push({ zoneId: 'GY', cards: queryZone(controller, OcgLocation.GRAVE as number) });
    zones.push({ zoneId: 'BANISHED', cards: queryZone(controller, OcgLocation.REMOVED as number) });
    zones.push({ zoneId: 'EXTRA', cards: queryZone(controller, OcgLocation.EXTRA as number) });
    zones.push({ zoneId: 'DECK', cards: [] });

    zones.push({ zoneId: 'HAND', cards: queryZone(controller, OcgLocation.HAND as number) });

    // TODO: Read LP from fieldState if available (fp.lp) to avoid manual tracking drift
    return { lp: lp[controller], deckCount: fp.deck_size, extraCount: fp.extra_size, zones };
  }

  const msg: ServerMessage = {
    type: 'BOARD_STATE',
    data: { turnPlayer, turnCount, phase, players: [buildPlayerState(0), buildPlayerState(1)] },
  };

  // Perf tracking: buildBoardState is hot during chain-resolving replays
  // (one call per BOARD_CHANGING event with a `boardStateAfter` snapshot).
  // WASM `duelQuery` has a known bug preventing multi-flag combination, so
  // each face-up field card requires ~12 individual queries. Tracking avg
  // lets us spot regressions if future zones expand; optimization path is
  // blocked on the WASM bug fix (see `buildBoardState` comments above).
  buildBoardStateCumulativeMs += performance.now() - perfStart;
  buildBoardStateCallCount++;

  return msg;
}

// =============================================================================
// ResponseData → OcgResponse Transformation
// =============================================================================

function transformResponse(promptType: string, data: Record<string, unknown>): unknown {
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
      const idx = lastAnnounceNumberOptions.indexOf(val);
      return { type: 19, value: idx >= 0 ? idx : val };
    }
    // RPS_CHOICE used to map the in-game OCGCore RPS prompt; the pre-duel
    // first-player flow switched to dice 2D6 (2026-05-13) and INIT_DUEL
    // sets skipRps=true so OCGCore never asks. The auto-respond in
    // runDuelLoop handles the (regression-only) case where it does.
    default:
      dlog.error('Unknown promptType', { promptType });
      return null;
  }
}

// =============================================================================
// Replay Capture
// =============================================================================

function capturedSetResponse(d: OcgDuelHandle, response: unknown): void {
  dlog.debug('Replay capture response', { index: capturedResponses.length });
  capturedResponses.push({ data: response, timestamp: new Date().toISOString() });
  core!.duelSetResponse(d, response as never);
}

function emitReplayData(): void {
  if (replayEmitted) return;
  replayEmitted = true;
  dlog.log('Emitting replay data', { responses: capturedResponses.length, result: duelResult });
  port.postMessage({
    type: 'WORKER_REPLAY_DATA',
    duelId,
    payload: {
      seed: duelSeed.map(s => s.toString()),
      decks: capturedDecks,
      playerResponses: capturedResponses,
      metadata: {
        playerUsernames,
        deckNames,
        turnCount,
        result: duelResult,
        date: new Date().toISOString(),
        scriptsHash: getScriptsHash(),
        ocgcoreVersion: getOcgcoreVersion(),
        durationSec: Math.round((Date.now() - duelStartMs) / 1000),
      },
    },
  });
}

// =============================================================================
// Duel Loop
// =============================================================================

function runDuelLoop(): void {
  if (!core || !duel) return;

  // Reset the live chain tracker on every runDuelLoop entry to preserve the
  // original per-call semantics (the tracker is hoisted to module-level so
  // the CANCEL_PROMPT_SEQUENCE handler can read its `isResolving` flag).
  liveChainTracker.reset();

  while (true) {
    let skipRpsAutoResponded = false;

    // Watchdog timer
    const watchdog = setTimeout(() => {
      dlog.error('Watchdog timeout — saving partial replay before exit', { timeoutMs: WATCHDOG_TIMEOUT_MS });
      if (!forkMode) emitReplayData();
      port.postMessage({ type: 'WORKER_ERROR', duelId, error: 'Watchdog timeout (30s)' });
      cleanup();
      // Give the MessagePort enough time to drain before killing the process
      setTimeout(() => process.exit(1), 1000);
    }, WATCHDOG_TIMEOUT_MS);

    let status: number;
    try {
      status = core.duelProcess(duel);
    } catch (err) {
      clearTimeout(watchdog);
      const message = err instanceof Error ? err.message : String(err);
      dlog.error('duelProcess threw', { error: message });
      port.postMessage({ type: 'WORKER_ERROR', duelId, error: message });
      cleanup();
      return;
    }
    clearTimeout(watchdog);

    dlog.debug('duelProcess', { status, statusLabel: status === OcgProcessResult.CONTINUE ? 'CONTINUE' : status === OcgProcessResult.WAITING ? 'WAITING' : 'END' });
    const messages = core.duelGetMessage(duel);
    dlog.debug('duelGetMessage', { count: messages.length });

    let hasRetry = false;
    let hasCostMoves = false;
    for (const msg of messages) {
      // Track state for BOARD_STATE construction
      updateState(msg);

      // RETRY: OCGCore rejected the previous response — flag for re-prompt
      if (msg.type === OcgMessageType.RETRY) {
        hasRetry = true;
        continue;
      }

      // skipRps auto-respond: when OCGCore asks for RPS, respond immediately
      if (skipRpsFlag && msg.type === OcgMessageType.ROCK_PAPER_SCISSORS) {
        const playerIndex = msg.player as number;
        capturedSetResponse(duel, { type: 20, value: playerIndex === 0 ? 1 : 3 });
        skipRpsAutoResponded = true;
        continue;
      }

      // Replay: track duel result from OCGCore messages (skip in fork mode — no replay capture)
      if (msg.type === OcgMessageType.WIN && !forkMode) {
        const p = msg.player as number;
        duelResult = p === 0 ? 'VICTORY' : p === 1 ? 'DEFEAT' : 'DRAW';
      }

      // DEBUG: Log every OCGCore message
      dlog.debug('OCG message', { type: OcgMessageType[msg.type] ?? msg.type });

      // Transform and forward
      const dto = transformMessage(msg);
      if (dto) {
        if (dto.type === 'MSG_MOVE') {
          dlog.debug('MSG_MOVE', { card: dto.cardName, code: dto.cardCode, from: `loc${dto.fromLocation}/seq${dto.fromSequence}`, to: `loc${dto.toLocation}/seq${dto.toSequence}` });
          hasCostMoves = true;
        }
        // Track chain-resolving window + attach `boardStateAfter` snapshot to
        // BOARD_CHANGING events. Lets the client's `processEvent` hook
        // `rbs.updateLogical(boardStateAfter)` progress logical state per
        // event, matching the replay precompute behavior. Cost is one
        // `buildBoardState()` per BOARD_CHANGING event during resolving
        // (~10-50ms each, bounded by chain length).
        liveChainTracker.process(dto, () => (buildBoardState() as BoardStateMsg).data);
        // Emit intermediate BOARD_STATE before chain resolution starts so the client
        // can apply cost-related moves (e.g. cards sent to GY) before chainPhase='resolving'
        // blocks applyPendingBoardState().
        if (dto.type === 'MSG_CHAIN_SOLVING' && hasCostMoves) {
          dlog.debug('BOARD_STATE (intermediate, before chain solving)');
          port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: buildBoardState() });
          hasCostMoves = false;
        }
        dlog.debug('EMIT', { type: dto.type });
        port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: dto });
        // P0-3bis.3 — drop the rollback target when a fresh
        // IDLECMD/BATTLECMD prompt is emitted. The next response will
        // re-take a snapshot for the next rollback boundary.
        // P0-3bis.4 — go through `setLastIdleSnapshot` so the TTL timer
        // is also cleared.
        //
        // Design decision (2026-05-08, with Axel): the rollback target
        // is dropped here, which means PHASE TRANSITIONS (Battle Phase,
        // End Turn) and IDLECMD↔BATTLECMD pivots are NOT cancellable.
        // This is intentional:
        //   1. YGO rules: announcing a phase is binding — Main Phase
        //      effects can't fire retroactively after Battle declared.
        //   2. UX: no prompt is visible during the transient window
        //      between PLAYER_RESPONSE and the next prompt — the player
        //      has nowhere to right-click on.
        //   3. Fairness: rolling back after seeing the opponent's
        //      response would break the OPT/timing fence.
        // If a future product decision wants confirmable phase
        // transitions, the right pattern is a client-side "Are you
        // sure?" confirm step (Master Duel-style), NOT a server-side
        // snapshot rollback.
        if (!forkMode && (dto.type === 'SELECT_IDLECMD' || dto.type === 'SELECT_BATTLECMD')) {
          setLastIdleSnapshot(null);
        }
      } else {
        dlog.debug('transformMessage returned null', { type: OcgMessageType[msg.type] ?? 'UNKNOWN', typeId: msg.type });
      }
    }

    // RETRY recovery: tell the server to re-send the cached prompt
    if (hasRetry && status === OcgProcessResult.WAITING) {
      port.postMessage({ type: 'WORKER_RETRY', duelId, playerIndex: lastResponsePlayerIndex });
    }

    if (status === OcgProcessResult.END) {
      if (!forkMode) emitReplayData();
      cleanup();
      return;
    }

    if (status === OcgProcessResult.WAITING) {
      if (skipRpsAutoResponded) {
        // RPS auto-responded — do NOT emit intermediate BOARD_STATE, continue processing
        continue;
      }
      // Player prompt — send BOARD_STATE snapshot then wait
      dlog.debug('BOARD_STATE (final, before prompt)');
      port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: buildBoardState() });
      return;
    }
    // OcgProcessResult.CONTINUE → loop again
  }
}

// =============================================================================
// Shared OCG Engine Init (DRY: used by initDuel, initReplay, initFork)
// =============================================================================

interface OcgInitResult {
  newCore: OcgCoreSync;
  handle: OcgDuelHandle;
  db: import('./types.js').CardDB;
  strings: Map<number, string>;
}

// First-call WASM-memory capture flag. The worker may call `initOcgEngine`
// multiple times (init duel, init replay, init fork) — we only need to
// hook `WebAssembly.instantiate` around the very FIRST `createCore` call
// to grab the Memory reference. Subsequent calls reuse the same Memory
// (the OCGCore wasm module is cached by `@n1xx1/ocgcore-wasm`).
let wasmHookAttempted = false;

async function initOcgEngine(
  seed: [bigint, bigint, bigint, bigint],
): Promise<OcgInitResult | null> {
  const dbPath = join(dataDir, 'cards.cdb');
  const scriptsDir = join(dataDir, 'scripts_full');

  // Hook the first createCore to capture WebAssembly.Memory.
  // After this, snapshot/restore primitives in `wasm-snapshot.ts` are
  // available. Failure is non-fatal — feature stays unavailable.
  let shouldHook = false;
  if (!wasmHookAttempted) {
    wasmHookAttempted = true;
    shouldHook = true;
    installWasmHook();
  }

  let newCore: OcgCoreSync;
  try {
    newCore = await createCore({ sync: true });
  } finally {
    if (shouldHook) {
      uninstallWasmHook();
      locateWasmMemory();
    }
  }
  const db = loadDatabase(dbPath);
  const strings = loadSystemStrings(join(dataDir, 'strings.conf'));
  const scripts = loadScripts(scriptsDir);
  const cardReader = createCardReader(db);
  const scriptReader = createScriptReader(scripts);

  const handle = newCore.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed,
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader,
    scriptReader,
    errorHandler: (_type, text) => {
      if (!text.includes('script not found')) dlog.error('OCG error', { text });
    },
  });

  if (!handle) return null;

  for (const name of STARTUP_SCRIPTS) {
    const content = scripts.startupScripts.get(name);
    if (content) newCore.loadScript(handle, name, content);
  }

  return { newCore, handle, db, strings };
}

function loadDeckToOcg(c: OcgCoreSync, d: OcgDuelHandle, deck: Deck, team: 0 | 1, shuffle: boolean): Deck {
  const mainCards = shuffle ? shuffleArray(deck.main) : deck.main;
  for (const code of mainCards) {
    c.duelNewCard(d, {
      code, team, duelist: 0, controller: team,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of deck.extra) {
    c.duelNewCard(d, {
      code, team, duelist: 0, controller: team,
      location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  return { main: [...mainCards], extra: [...deck.extra] };
}

function resetDuelState(): void {
  lp = [8000, 8000];
  turnPlayer = 0;
  turnCount = 0;
  phase = 'DRAW';
}

// =============================================================================
// Init Duel
// =============================================================================

async function initDuel(msg: MainToWorkerMessage & { type: 'INIT_DUEL' }): Promise<void> {
  duelId = msg.duelId;
  dlog = logger.forDuel(duelId);
  skipRpsFlag = msg.skipRps === true;
  skipShuffleFlag = msg.skipShuffle === true;
  const [deck0, deck1] = msg.decks;

  // Inject pre-computed metadata from main thread (avoids re-reading 22k scripts in worker)
  setScriptsHash(msg.scriptsHash);
  setOcgcoreVersion(msg.ocgcoreVersion);

  // Replay: capture metadata from INIT_DUEL
  playerUsernames = msg.playerUsernames;
  deckNames = msg.deckNames;
  capturedResponses = [];
  duelResult = null;
  replayEmitted = false;
  duelStartMs = Date.now();
  // P0-3bis.4 — defensive: clear any leftover rollback snapshot in case
  // cleanup() was skipped (re-init without prior duel-end signal).
  setLastIdleSnapshot(null);

  const seed = generateSeed();
  duelSeed = [...seed];

  const result = await initOcgEngine(seed);
  if (!result) {
    port.postMessage({ type: 'WORKER_ERROR', duelId, error: 'Failed to create duel instance' });
    return;
  }
  core = result.newCore;
  duel = result.handle;
  cardDb = result.db;
  systemStrings = result.strings;

  const loadedDeck0 = loadDeckToOcg(core, duel, deck0, 0, !skipShuffleFlag);
  const loadedDeck1 = loadDeckToOcg(core, duel, deck1, 1, !skipShuffleFlag);
  capturedDecks = [loadedDeck0, loadedDeck1];

  resetDuelState();
  core.startDuel(duel);
  port.postMessage({ type: 'WORKER_DUEL_CREATED', duelId });
  runDuelLoop();
}

// =============================================================================
// Cleanup
// =============================================================================

function cleanup(): void {
  if (core && duel) {
    try { core.destroyDuel(duel); } catch (e) { dlog.error('destroyDuel failed', { error: e instanceof Error ? e.message : String(e) }); }
    duel = null;
  }
  if (cardDb) {
    try { cardDb.db.close(); } catch (e) { dlog.error('db.close failed', { error: e instanceof Error ? e.message : String(e) }); }
    cardDb = null;
  }
  // Drop memoized cards.cdb base values — entries reference data from a DB
  // that's now closed, and a worker reused for a different cards.cdb version
  // could otherwise serve stale entries.
  cardDbCache.clear();
  // Release WASM core reference + replay capture buffers so a worker that
  // doesn't process.exit (replay/fork error paths) doesn't retain memory.
  core = null;
  systemStrings.clear();
  capturedResponses = [];
  duelSeed = [];
  forkPendingSelect = null;
  // Defensive reset (code-review 2026-05-08) — `forkMode` was previously
  // sticky across error paths that don't `process.exit`. Resetting here
  // makes a re-init via INIT_DUEL after an INIT_FORK error pick up the
  // correct mode. Pre-existing latent bug, surfaced when P0-3bis.3
  // started gating its snapshot-take and cancel handler on `!forkMode`.
  forkMode = false;
  // P0-3bis.4 — release any held rollback snapshot + its TTL timer.
  setLastIdleSnapshot(null);
}

// =============================================================================
// Replay Pre-Computation (entry point — body lives in `replay-precompute.ts`)
// =============================================================================

async function initReplay(msg: InitReplayMessage): Promise<void> {
  duelId = msg.duelId;
  dlog = logger.forDuel(duelId);
  skipRpsFlag = true;
  skipShuffleFlag = true;

  const seed = msg.seed.map(BigInt) as [bigint, bigint, bigint, bigint];
  const result = await initOcgEngine(seed);
  if (!result) {
    port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code: 'REPLAY_INIT_FAILED', message: 'Failed to create duel instance' });
    return;
  }
  core = result.newCore;
  duel = result.handle;
  cardDb = result.db;
  systemStrings = result.strings;

  loadDeckToOcg(core, duel, msg.decks[0], 0, false);
  loadDeckToOcg(core, duel, msg.decks[1], 1, false);

  resetDuelState();
  core.startDuel(duel);
  runReplayPreComputation(msg, {
    core, duel, duelId, dlog, port,
    transformMessage, updateState, buildBoardState, cleanup,
    getBuildBoardStatePerfStats,
  });
}

// =============================================================================
// Fork Reconstruction
// =============================================================================

let forkMode = false;
let forkPendingSelect: OcgMessage | null = null;

async function initFork(msg: InitForkMessage): Promise<void> {
  duelId = msg.duelId;
  dlog = logger.forDuel(duelId);
  skipRpsFlag = true;
  skipShuffleFlag = true;

  // Inject pre-computed metadata from main thread (same as initDuel)
  setScriptsHash(msg.scriptsHash);
  setOcgcoreVersion(msg.ocgcoreVersion);

  const seed = msg.seed.map(BigInt) as [bigint, bigint, bigint, bigint];
  const result = await initOcgEngine(seed);
  if (!result) {
    port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code: 'REPLAY_INIT_FAILED', message: 'Failed to create duel instance' });
    return;
  }
  core = result.newCore;
  duel = result.handle;
  cardDb = result.db;
  systemStrings = result.strings;

  loadDeckToOcg(core, duel, msg.decks[0], 0, false);
  loadDeckToOcg(core, duel, msg.decks[1], 1, false);

  resetDuelState();
  core.startDuel(duel);
  runForkReconstruction(msg);
}

function runForkReconstruction(msg: InitForkMessage): void {
  if (!core || !duel) return;

  let responseIndex = 0;
  const MAX_ITERATIONS = 100_000;
  let iterations = 0;

  dlog.log('Fork starting reconstruction', { targetResponses: msg.targetResponseCount });

  while (true) {
    if (++iterations > MAX_ITERATIONS) {
      dlog.error('Fork max iterations reached — aborting', { maxIterations: MAX_ITERATIONS });
      port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code: 'REPLAY_MAX_ITERATIONS', message: 'Fork reconstruction exceeded maximum iterations' });
      cleanup();
      return;
    }

    let status: number;
    try {
      status = core.duelProcess(duel);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      dlog.error('Fork duelProcess threw', { error: message });
      port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code: 'REPLAY_COMPUTATION_ERROR', message: `Fork reconstruction error: ${message}` });
      cleanup();
      return;
    }

    const messages = core.duelGetMessage(duel);

    for (const rawMsg of messages) {
      if (rawMsg.type === OcgMessageType.RETRY) {
        dlog.error('Fork MSG_RETRY — divergence', { responseIndex });
        port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code: 'REPLAY_DIVERGED_RETRY', message: 'Fork diverged: MSG_RETRY encountered' });
        cleanup();
        return;
      }

      updateState(rawMsg);

      if (SELECT_MESSAGE_TYPES.has(rawMsg.type)) {
        if (responseIndex >= msg.targetResponseCount) {
          // Reached fork point — WASM is waiting for player input
          dlog.log('Fork reached fork point', { responseIndex });
          forkPendingSelect = rawMsg;
          performSanityCheck(msg.expectedState);
          return;
        }

        if (responseIndex >= msg.playerResponses.length) {
          dlog.error('Fork ran out of responses', { responseIndex });
          port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code: 'REPLAY_DIVERGED_NO_RESPONSES', message: 'Fork diverged: ran out of recorded responses' });
          cleanup();
          return;
        }

        core.duelSetResponse(duel, msg.playerResponses[responseIndex].data as never);
        responseIndex++;
      }
    }

    if (status === OcgProcessResult.END) {
      dlog.error('Fork duel ended before reaching fork point', { responseIndex, target: msg.targetResponseCount });
      port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code: 'REPLAY_DIVERGED_NO_RESULT', message: 'Fork failed: duel ended before reaching target response count' });
      cleanup();
      return;
    }
  }
}

function performSanityCheck(expectedState: InitForkMessage['expectedState']): void {
  const actualLp: [number, number] = [lp[0], lp[1]];
  const actualTurn = turnCount;
  const actualPhase = PHASE_MAP_REVERSE[phase];
  if (actualPhase === undefined) {
    dlog.warn('Fork unknown phase during sanity check — defaulting to 0', { phase });
  }

  const mismatches: string[] = [];
  if (expectedState.lp[0] !== actualLp[0] || expectedState.lp[1] !== actualLp[1]) {
    mismatches.push(`LP mismatch: expected [${expectedState.lp}] got [${actualLp}]`);
  }
  if (expectedState.turnNumber !== actualTurn) {
    mismatches.push(`Turn mismatch: expected ${expectedState.turnNumber} got ${actualTurn}`);
  }
  if (expectedState.phase !== actualPhase) {
    mismatches.push(`Phase mismatch: expected ${expectedState.phase} got ${actualPhase}`);
  }

  const match = mismatches.length === 0;
  const details = match ? undefined : mismatches.join('; ');

  dlog.log('Fork sanity check', { result: match ? 'PASS' : 'MISMATCH', details: details ?? undefined });

  forkMode = true;
  port.postMessage({ type: 'WORKER_FORK_READY', duelId, sanityResult: { match, details } });
  // Worker stays alive — waiting for PLAYER_RESPONSE messages in solo mode
}

const PHASE_MAP_REVERSE: Record<Phase, number> = Object.fromEntries(
  Object.entries(PHASE_MAP).map(([k, v]) => [v, Number(k)]),
) as Record<Phase, number>;

// =============================================================================
// Message Handler
// =============================================================================

port.on('message', (msg: MainToWorkerMessage) => {
  if (msg.type === 'INIT_DUEL') {
    initDuel(msg).catch(err => {
      port.postMessage({
        type: 'WORKER_ERROR', duelId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } else if (msg.type === 'INIT_REPLAY') {
    initReplay(msg).catch(err => {
      port.postMessage({
        type: 'WORKER_REPLAY_ERROR', duelId,
        code: 'REPLAY_COMPUTATION_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } else if (msg.type === 'INIT_FORK') {
    initFork(msg).catch(err => {
      port.postMessage({
        type: 'WORKER_FORK_ERROR', duelId,
        code: 'REPLAY_COMPUTATION_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } else if (msg.type === 'FORK_RESUME') {
    // Both clients connected — emit current board state + pending SELECT prompt
    if (forkMode && core && duel) {
      port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: buildBoardState() });
      if (forkPendingSelect) {
        const dto = transformMessage(forkPendingSelect);
        if (dto) {
          port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: dto });
        }
        forkPendingSelect = null;
      }
    }
  } else if (msg.type === 'EMIT_REPLAY_DATA') {
    // Main thread requests replay data (disconnect/timeout/surrender — worker doesn't know the result)
    try {
      emitReplayData();
      cleanup();
    } catch (err) {
      dlog.error('emitReplayData failed', { error: err instanceof Error ? err.message : String(err) });
      port.postMessage({ type: 'WORKER_ERROR', duelId, error: `emitReplayData failed: ${err instanceof Error ? err.message : err}` });
    }
  } else if (msg.type === 'PLAYER_RESPONSE') {
    if (!core || !duel) {
      dlog.error('Received PLAYER_RESPONSE but no active duel');
      return;
    }
    lastResponsePlayerIndex = msg.playerIndex;
    const response = transformResponse(msg.promptType, msg.data as unknown as Record<string, unknown>);
    if (response) {
      // P0-3bis.3 — take a rollback snapshot BEFORE applying an
      // IDLECMD/BATTLECMD response. The cancel path will restore this if
      // the user right-clicks on the continuation prompt.
      // Only applies in regular PVP (not fork mode — replay-fork already
      // bypasses capturedSetResponse, and rollback there has no client UI).
      if (!forkMode && snapshotAvailable() && (msg.promptType === 'SELECT_IDLECMD' || msg.promptType === 'SELECT_BATTLECMD')) {
        try {
          setLastIdleSnapshot(takeWorkerSnapshot());
        } catch (err) {
          dlog.warn('Failed to take rollback snapshot', { error: err instanceof Error ? err.message : String(err) });
          setLastIdleSnapshot(null);
        }
      }

      if (forkMode) {
        core!.duelSetResponse(duel, response as never);
      } else {
        capturedSetResponse(duel, response);
      }
      dlog.debug('duelSetResponse done, calling runDuelLoop');
      runDuelLoop();
      dlog.debug('runDuelLoop returned');
    } else {
      dlog.error('transformResponse returned null', { promptType: msg.promptType });
    }
  } else if (msg.type === 'CANCEL_PROMPT_SEQUENCE') {
    // P0-3bis.3 — Roll the duel back to the most recent IDLECMD/BATTLECMD
    // snapshot and re-emit the original prompt.
    if (!core || !duel) {
      dlog.error('Received CANCEL_PROMPT_SEQUENCE but no active duel');
      return;
    }
    if (forkMode) {
      dlog.warn('[duel-worker] cancel ignored (fork mode)');
      return;
    }
    // P0-3bis.4 — pure decision helper: gate on snapshot existence,
    // player match, and chain-resolving interlock. Side-effect-free.
    const decision = tryCancelRollback(lastIdleSnapshot, msg.playerIndex, liveChainTracker.isResolving);
    if (!decision.canCancel) {
      switch (decision.reason) {
        case 'no-snapshot':
          dlog.warn('[duel-worker] cancel ignored (no snapshot)');
          break;
        case 'wrong-player':
          dlog.warn('[duel-worker] cancel rejected (wrong player)', {
            snapshotPlayer: lastIdleSnapshot?.lastResponsePlayerIndex,
            messagePlayer: msg.playerIndex,
          });
          break;
        case 'chain-resolving':
          // P0-3bis.4 — keep snapshot alive across the interlock; player
          // can re-attempt cancel after MSG_CHAIN_SOLVED. By design we do
          // NOT auto-replay post-chain (per AC #3) — the user's mental
          // model may have shifted; require an explicit re-action.
          dlog.warn('[duel-worker] cancel ignored (chain resolving)');
          break;
      }
      return;
    }
    try {
      // tryCancelRollback proved snapshot is non-null; assert by capture
      const snap = lastIdleSnapshot as WorkerSnapshot;
      restoreWorkerSnapshot(snap);
    } catch (err) {
      dlog.error('restoreWorkerSnapshot failed', { error: err instanceof Error ? err.message : String(err) });
      setLastIdleSnapshot(null);
      return;
    }
    setLastIdleSnapshot(null);
    dlog.log('[duel-worker] cancel applied', { player: msg.playerIndex });
    // Drain the post-restore RETRY message that ocgcore emits — the
    // restored state is "awaiting response to the original prompt", and
    // ocgcore signals this via RETRY. We DON'T want runDuelLoop to handle
    // it (that would route through the regular RETRY path which counts
    // toward `invalidResponseCount` and could trigger DUEL_END at 5
    // cancels). Instead, drain it silently and ask the main thread to
    // re-broadcast the cached prompt without counting it as a retry.
    if (core && duel) {
      const status = core.duelProcess(duel);
      const messages = core.duelGetMessage(duel);
      // Sanity: post-restore should be WAITING with at least RETRY.
      // If something else, log a warning but proceed — server will still
      // re-broadcast the cached prompt.
      if (status !== OcgProcessResult.WAITING) {
        dlog.warn('[duel-worker] post-cancel duelProcess unexpected status', { status });
      }
      const hasRetry = messages.some((m) => m.type === OcgMessageType.RETRY);
      if (!hasRetry) {
        dlog.warn('[duel-worker] post-cancel did not emit RETRY', { messageTypes: messages.map((m) => OcgMessageType[m.type] ?? m.type) });
      }
    }
    // Re-emit BOARD_STATE so the client re-syncs visual state to the
    // pre-action point, then ask the server to re-send the cached
    // IDLECMD/BATTLECMD prompt without counting it as a retry.
    port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: buildBoardState() });
    port.postMessage({ type: 'WORKER_CANCEL_DONE', duelId, playerIndex: msg.playerIndex });
  }
});
