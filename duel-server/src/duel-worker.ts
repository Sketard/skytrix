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
import { loadDatabase, loadScripts, loadSystemStrings, STARTUP_SCRIPTS } from './ocg-scripts.js';
import { createCardReader, createScriptReader } from './ocg-callbacks.js';
import { WATCHDOG_TIMEOUT_MS } from './types.js';
import type { MainToWorkerMessage } from './types.js';
import type {
  ServerMessage,
  Player,
  Phase,
  CardInfo,
  PlaceOption,
  BoardStatePayload,
  PlayerBoardState,
  BoardZone,
  CardOnField,
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
let turnPlayer: Player = 0;
let turnCount = 0;
let phase: Phase = 'DRAW';
let lp: [number, number] = [8000, 8000];
let cardDb: import('./types.js').CardDB | null = null;
let systemStrings: Map<number, string> = new Map();
let skipRpsFlag = false;
let skipShuffleFlag = false;
let lastAnnounceNumberOptions: number[] = [];

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
const TYPE_XYZ = 0x800000;
const TYPE_LINK = 0x4000000;
const STATUS_DISABLED = 0x0001;
function isTokenCard(code: number): boolean {
  if (!cardDb || !code) return false;
  const row = cardDb.stmt.get(code) as Record<string, number | bigint> | undefined;
  return row ? (Number(row['type']) & TYPE_TOKEN) !== 0 : false;
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

function transformMessage(msg: OcgMessage): ServerMessage | null {
  switch (msg.type) {
    // --- State tracking only (no DTO) ---
    case OcgMessageType.START:
    case OcgMessageType.NEW_TURN:
    case OcgMessageType.NEW_PHASE:
      return null; // Tracked in updateState(), embedded in BOARD_STATE

    // --- Game Messages ---
    case OcgMessageType.DRAW:
      return { type: 'MSG_DRAW', player: msg.player as Player, cards: msg.drawn.map(d => d.code) };

    case OcgMessageType.MOVE: {
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
      console.log('[DBG:WORKER] CHAIN_SOLVING → MSG_CHAIN_SOLVING chainIndex=%d', msg.chain_size - 1);
      return { type: 'MSG_CHAIN_SOLVING', chainIndex: msg.chain_size - 1 };

    case OcgMessageType.CHAIN_SOLVED:
      console.log('[DBG:WORKER] CHAIN_SOLVED → MSG_CHAIN_SOLVED chainIndex=%d', msg.chain_size - 1);
      return { type: 'MSG_CHAIN_SOLVED', chainIndex: msg.chain_size - 1 };

    case OcgMessageType.CHAIN_END:
      console.log('[DBG:WORKER] CHAIN_END → MSG_CHAIN_END');
      return { type: 'MSG_CHAIN_END' };

    case OcgMessageType.CHAIN_NEGATED:
    case OcgMessageType.CHAIN_DISABLED:
      console.log('[DBG:WORKER] %s → MSG_CHAIN_NEGATED chainIndex=%d (chain_size=%d)',
        OcgMessageType[msg.type], msg.chain_size - 1, msg.chain_size);
      return { type: 'MSG_CHAIN_NEGATED', chainIndex: msg.chain_size - 1 };

    case OcgMessageType.HINT: {
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

    case OcgMessageType.CONFIRM_DECKTOP:
    case OcgMessageType.CONFIRM_CARDS:
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
      return {
        type: 'MSG_BECOME_TARGET',
        cards: msg.cards.map(c => ({
          player: c.controller as Player,
          location: c.location as number as (typeof LOCATION)[keyof typeof LOCATION],
          sequence: c.sequence,
        })),
      };

    case OcgMessageType.ATTACK:
      return {
        type: 'MSG_ATTACK',
        attackerPlayer: msg.card.controller,
        attackerSequence: msg.card.sequence,
        defenderPlayer: msg.target?.controller ?? null,
        defenderSequence: msg.target?.sequence ?? null,
      };

    case OcgMessageType.BATTLE: {
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

    case OcgMessageType.WIN:
      return { type: 'MSG_WIN', player: msg.player as Player, reason: msg.reason };

    // --- Prompt Messages ---
    case OcgMessageType.SELECT_IDLECMD:
      return {
        type: 'SELECT_IDLECMD', player: msg.player as Player,
        summons: msg.summons.map(toCardInfo),
        specialSummons: msg.special_summons.map(toCardInfo),
        repositions: msg.pos_changes.map(toCardInfo),
        setMonsters: msg.monster_sets.map(toCardInfo),
        activations: msg.activates.map(c => ({ ...toCardInfo(c), description: getOptionDesc(c.description) })),
        setSpellTraps: msg.spell_sets.map(toCardInfo),
        canBattlePhase: msg.to_bp, canEndPhase: msg.to_ep,
      };

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

    case OcgMessageType.SELECT_CHAIN: {
      const timing = msg.hint_timing as number;
      const timingLabel = systemStrings.get(TIMING_STRING_ID[timing] ?? 0) ?? '';
      return {
        type: 'SELECT_CHAIN', player: msg.player as Player,
        cards: msg.selects.map(c => toCardInfo(c)),
        forced: msg.forced,
        hintTiming: timing,
        hintTimingLabel: timingLabel,
      };
    }

    case OcgMessageType.SELECT_EFFECTYN:
      return {
        type: 'SELECT_EFFECTYN', player: msg.player as Player,
        cardCode: msg.code, cardName: getCardName(msg.code), description: Number(msg.description),
      };

    case OcgMessageType.SELECT_YESNO: {
      const desc = Number(msg.description);
      return { type: 'SELECT_YESNO', player: msg.player as Player, description: desc, descriptionText: getOptionDesc(BigInt(desc)) };
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

    case OcgMessageType.SELECT_OPTION: {
      const rawOptions = msg.options.map(Number);
      const descriptions = msg.options.map(o => getOptionDesc(BigInt(o)));
      console.log('[WORKER][SELECT_OPTION] raw options=%o decoded=%o descriptions=%o',
        msg.options.map(String), rawOptions.map(o => ({ cardCode: o >> 20, strIndex: o & 0xFFFFF, hex: '0x' + o.toString(16) })), descriptions);
      return {
        type: 'SELECT_OPTION', player: msg.player as Player,
        options: rawOptions, descriptions,
      };
    }

    case OcgMessageType.SELECT_TRIBUTE:
      console.log('[WORKER][SELECT_TRIBUTE] raw selects=%o min=%d max=%d can_cancel=%s',
        msg.selects, msg.min, msg.max, msg.can_cancel);
      return {
        type: 'SELECT_TRIBUTE', player: msg.player as Player,
        min: msg.min, max: msg.max,
        cards: msg.selects.map(c => toCardInfo(c)),
        cancelable: msg.can_cancel,
      };

    case OcgMessageType.SELECT_SUM:
      return {
        type: 'SELECT_SUM', player: msg.player as Player,
        mustSelect: msg.selects_must.map(c => ({ ...toCardInfo(c), amount: c.amount })),
        cards: msg.selects.map(c => ({ ...toCardInfo(c), amount: c.amount })),
        targetSum: msg.amount, minCards: msg.min, maxCards: msg.max, selectMax: msg.select_max,
      };

    case OcgMessageType.SELECT_UNSELECT_CARD:
      console.log('[WORKER][SELECT_UNSELECT_CARD] select=%d unselect=%d can_finish=%s selectable=%o selected=%o',
        msg.select_cards.length, msg.unselect_cards.length, msg.can_finish,
        msg.select_cards.map(c => `code=${c.code} loc=${c.location} seq=${c.sequence}`),
        msg.unselect_cards.map(c => `code=${c.code} loc=${c.location} seq=${c.sequence}`));
      return {
        type: 'SELECT_UNSELECT_CARD', player: msg.player as Player,
        cards: [...msg.select_cards, ...msg.unselect_cards].map(toCardInfo),
        selectCount: msg.select_cards.length,
        canFinish: msg.can_finish,
      };

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

    // --- RPS ---
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      if (skipRpsFlag) return null;
      return { type: 'RPS_CHOICE', player: msg.player as Player };

    case OcgMessageType.HAND_RES:
      if (skipRpsFlag) return null;
      return {
        type: 'RPS_RESULT',
        player1Choice: (msg as unknown as { res1: number }).res1,
        player2Choice: (msg as unknown as { res2: number }).res2,
        winner: (msg as unknown as { winner: number }).winner === 2
          ? null
          : (msg as unknown as { winner: number }).winner as Player,
      };

    case OcgMessageType.RETRY:
      console.warn('[WORKER] OCGCore sent RETRY — previous response was invalid');
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

function buildBoardState(): ServerMessage {
  if (!core || !duel) throw new Error('No active duel');

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

      // Base values from card database (level, rank, attribute, race, scales)
      const dbRow = cardDb?.stmt.get(code) as Record<string, number | bigint> | undefined;
      if (dbRow) {
        const rawLevel = Number(dbRow['level']);
        const cardType = Number(dbRow['type']);
        const isXyz = (cardType & TYPE_XYZ) !== 0;
        const isLink = (cardType & TYPE_LINK) !== 0;
        card.baseLevel = (isXyz || isLink) ? 0 : (rawLevel & 0xFF);
        card.baseRank = isXyz ? (rawLevel & 0xFF) : 0;
        card.baseAttribute = Number(dbRow['attribute']);
        card.baseRace = Number(dbRow['race']);
        card.baseLScale = (rawLevel >> 16) & 0xFF;
        card.baseRScale = (rawLevel >> 24) & 0xFF;
      } else {
        console.warn('[WORKER] No DB row for card code=%d — base alteration fields unavailable', code);
      }

      // Effect negation from STATUS bitmask (AC4)
      if (statusInfo?.status !== undefined) {
        card.isEffectNegated = (Number(statusInfo.status) & STATUS_DISABLED) !== 0;
      }

      // Equip target (AC5)
      const ec = equipInfo?.equipCard;
      if (ec) {
        if (ec.controller !== undefined && ec.sequence !== undefined) {
          card.equipTarget = {
            controller: ec.controller,
            location: Number(ec.location),
            sequence: ec.sequence,
          };
        } else {
          console.warn('[WORKER] Unexpected EQUIP_CARD format: %o', ec);
          card.equipTarget = null;
        }
      } else {
        card.equipTarget = null;
      }
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

  return {
    type: 'BOARD_STATE',
    data: { turnPlayer, turnCount, phase, players: [buildPlayerState(0), buildPlayerState(1)] },
  };
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
    case 'RPS_CHOICE':
      return { type: 20, value: (data['choice'] as number) + 1 }; // Client sends 0-2, OCGCore expects 1-3
    default:
      console.error(`Unknown promptType: ${promptType}`);
      return null;
  }
}

// =============================================================================
// Duel Loop
// =============================================================================

function runDuelLoop(): void {
  if (!core || !duel) return;

  while (true) {
    let skipRpsAutoResponded = false;

    // Watchdog timer
    const watchdog = setTimeout(() => {
      port.postMessage({ type: 'WORKER_ERROR', duelId, error: 'Watchdog timeout (30s)' });
      cleanup();
      process.exit(1);
    }, WATCHDOG_TIMEOUT_MS);

    let status: number;
    try {
      status = core.duelProcess(duel);
    } catch (err) {
      clearTimeout(watchdog);
      const message = err instanceof Error ? err.message : String(err);
      console.error('[WORKER] duelProcess threw:', message);
      port.postMessage({ type: 'WORKER_ERROR', duelId, error: message });
      cleanup();
      return;
    }
    clearTimeout(watchdog);

    console.log('[WORKER] duelProcess status=%d (0=END, 1=WAITING, 2=CONTINUE)', status);
    const messages = core.duelGetMessage(duel);
    console.log('[WORKER] duelGetMessage count=%d', messages.length);

    let hasRetry = false;
    for (const msg of messages) {
      // Track state for BOARD_STATE construction
      updateState(msg);

      // RETRY: OCGCore rejected the previous response — flag for re-prompt
      if (msg.type === OcgMessageType.RETRY) {
        console.warn('[WORKER] RETRY received — OCGCore rejected previous response');
        hasRetry = true;
        continue;
      }

      // skipRps auto-respond: when OCGCore asks for RPS, respond immediately
      if (skipRpsFlag && msg.type === OcgMessageType.ROCK_PAPER_SCISSORS) {
        const playerIndex = msg.player as number;
        core.duelSetResponse(duel, { type: 20, value: playerIndex === 0 ? 1 : 3 } as never);
        skipRpsAutoResponded = true;
        continue;
      }

      // DEBUG: Log every OCGCore message
      console.log('[WORKER][MSG] %s raw=%o', OcgMessageType[msg.type] ?? msg.type, msg);

      // Transform and forward
      const dto = transformMessage(msg);
      if (dto) {
        if (dto.type === 'MSG_MOVE') {
          console.log('[WORKER][MOVE] card=%s (%d) from=loc%d/seq%d → to=loc%d/seq%d',
            dto.cardName, dto.cardCode, dto.fromLocation, dto.fromSequence,
            dto.toLocation, dto.toSequence);
        }
        port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: dto });
      } else {
        console.warn('[WORKER] transformMessage returned null for type=%s (%d)', OcgMessageType[msg.type] ?? 'UNKNOWN', msg.type);
      }
    }

    // RETRY recovery: tell the server to re-send the cached prompt
    if (hasRetry && status === OcgProcessResult.WAITING) {
      port.postMessage({ type: 'WORKER_RETRY', duelId });
    }

    if (status === OcgProcessResult.END) {
      cleanup();
      return;
    }

    if (status === OcgProcessResult.WAITING) {
      if (skipRpsAutoResponded) {
        // RPS auto-responded — do NOT emit intermediate BOARD_STATE, continue processing
        continue;
      }
      // Player prompt — send BOARD_STATE snapshot then wait
      port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: buildBoardState() });
      return;
    }
    // OcgProcessResult.CONTINUE → loop again
  }
}

// =============================================================================
// Init Duel
// =============================================================================

async function initDuel(msg: MainToWorkerMessage & { type: 'INIT_DUEL' }): Promise<void> {
  duelId = msg.duelId;
  skipRpsFlag = msg.skipRps === true;
  skipShuffleFlag = msg.skipShuffle === true;
  const [deck0, deck1] = msg.decks;

  const dbPath = join(dataDir, 'cards.cdb');
  const scriptsDir = join(dataDir, 'scripts_full');

  // 1. Initialize OCGCore WASM
  core = await createCore({ sync: true });

  // 2. Load data
  const db = loadDatabase(dbPath);
  cardDb = db;
  systemStrings = loadSystemStrings(join(dataDir, 'strings.conf'));
  const scripts = loadScripts(scriptsDir);
  const cardReader = createCardReader(db);
  const scriptReader = createScriptReader(scripts);

  // 3. Create duel instance
  const handle = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: generateSeed(),
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader,
    scriptReader,
    errorHandler: (_type, text) => {
      if (!text.includes('script not found')) console.error(`[OCG] ${text}`);
    },
  });

  if (!handle) {
    port.postMessage({ type: 'WORKER_ERROR', duelId, error: 'Failed to create duel instance' });
    return;
  }
  duel = handle;

  // 4. Load startup scripts
  for (const name of STARTUP_SCRIPTS) {
    const content = scripts.startupScripts.get(name);
    if (content) core.loadScript(duel, name, content);
  }

  // 5. Load player decks
  function loadDeck(deck: { main: number[]; extra: number[] }, team: 0 | 1): void {
    const mainCards = skipShuffleFlag ? deck.main : shuffleArray(deck.main);
    for (const code of mainCards) {
      core!.duelNewCard(duel!, {
        code, team, duelist: 0, controller: team,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
    for (const code of deck.extra) {
      core!.duelNewCard(duel!, {
        code, team, duelist: 0, controller: team,
        location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
  }
  loadDeck(deck0, 0);
  loadDeck(deck1, 1);

  // 6. Start duel
  lp = [8000, 8000];
  turnPlayer = 0;
  turnCount = 0;
  phase = 'DRAW';

  core.startDuel(duel);
  port.postMessage({ type: 'WORKER_DUEL_CREATED', duelId });

  // 7. Start the duel loop
  runDuelLoop();
}

// =============================================================================
// Cleanup
// =============================================================================

function cleanup(): void {
  if (core && duel) {
    try { core.destroyDuel(duel); } catch { /* ignore */ }
    duel = null;
  }
  if (cardDb) {
    try { cardDb.db.close(); } catch { /* ignore */ }
    cardDb = null;
  }
}

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
  } else if (msg.type === 'PLAYER_RESPONSE') {
    if (!core || !duel) {
      console.error('Received PLAYER_RESPONSE but no active duel');
      return;
    }
    const response = transformResponse(msg.promptType, msg.data as unknown as Record<string, unknown>);
    console.log('[WORKER] transformResponse promptType=%s response=%o', msg.promptType, response);
    if (response) {
      core.duelSetResponse(duel, response as never);
      console.log('[WORKER] duelSetResponse done, calling runDuelLoop...');
      runDuelLoop();
      console.log('[WORKER] runDuelLoop returned');
    } else {
      console.error('[WORKER] transformResponse returned null for promptType=%s', msg.promptType);
    }
  }
});
