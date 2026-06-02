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
import {
  capturePreProcessOverlays, readOverlayMaterialsForMove,
  buildSettlingSourceFifo, consumeSettlingSource,
  type PreProcessOverlayKey, type SettlingSourceFifo,
} from './pre-process-overlays.js';
import { REASON_XYZ_MATERIAL_SETTLE } from './ocgcore-reason-flags.js';
import { CardDbCache } from './card-db-cache.js';
import { resolveDeckLoadOrder, normalizeReplayDeck } from './deck-load-order.js';
import { runReplayPreComputation, SELECT_MESSAGE_TYPES } from './replay-precompute.js';
import { createWorkerEmitter, type WorkerEmitter } from './duel-worker-emit.js';
import * as duelInstr from './duel-instrumentation.js';
import {
  countersToRecord,
  transformMessage as transformMessageExtracted,
  transformResponse as transformResponseExtracted,
  type OcgContext,
  type LookupContext,
} from './ocg-message-transforms.js';
import {
  runForkReconstruction as runForkReconstructionExtracted,
  type ForkContext,
  type PhaseToCodeMap,
} from './duel-worker-fork.js';
import type {
  ServerMessage,
  BoardStateMsg,
  BoardStatePayload,
  Player,
  Phase,
  CardInfo,
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
// U33 (2026-06-01) — typed emitter. Recreated in each `init*` after `duelId`
// is assigned (so the captured duelId in the closure is the live one). The
// 25 raw `port.postMessage(...)` call sites are now `emit.xxx(...)` — typos
// + missing variants fail at compile time. See duel-worker-emit.ts.
let emit: WorkerEmitter = createWorkerEmitter(port, duelId);
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

const PHASE_MAP: Record<number, Phase> = {
  1: 'DRAW', 2: 'STANDBY', 4: 'MAIN1', 8: 'BATTLE_START',
  16: 'BATTLE_STEP', 32: 'DAMAGE', 64: 'DAMAGE_CALC',
  128: 'BATTLE', 256: 'MAIN2', 512: 'END',
};

const MZONE_IDS: ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
const SZONE_IDS: ZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];

function getCardName(code: number): string {
  if (!cardDb || !code) return '';
  // Phase 0b instrumentation: the SQLite name lookup is un-memoized and called
  // per OCG message (finding D-C1/D-M1). time() is a no-op unless
  // DUEL_INSTRUMENT=1 — see duel-instrumentation.ts.
  return duelInstr.time('getCardName', () => {
    const row = cardDb!.nameStmt.get(code) as { name: string } | undefined;
    return row?.name ?? '';
  });
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

// U4 (audit-4-modes-2026-06-01) — `toCardInfo`, `countersToRecord`,
// `decodePlaces/Positions/Bitmask/Attributes`, `LOC_NAME`, `locName`, the
// 14 `transformXxx` helpers, `resolvePromptDescription`, `transformMessage`,
// and `transformResponse` all moved to `ocg-message-transforms.ts`. The
// worker builds OcgContext + LookupContext once and forwards them on every
// call. `countersToRecord` is re-imported above for `buildBoardState`.
//
// Lazy closures — `core` / `duel` / `cardDb` / `systemStrings` / `dlog` are
// re-assigned in each `init*` (worker is reused across INIT_DUEL /
// INIT_REPLAY / INIT_FORK). The getters resolve at transform-call time so
// the worker's re-assignments are visible.
const ocgContext: OcgContext = {
  core: () => core,
  duel: () => duel,
};

const lookupContext: LookupContext = {
  cardDb: () => cardDb,
  systemStrings: () => systemStrings,
  dlog: () => dlog,
  // Reviewfix B1 (audit-4-modes-2026-06-01) — forward the worker's
  // instrumented `getCardName` (wrapped with `duelInstr.time('getCardName',
  // ...)`) so per-OCG-message hot-path metrics keep surfacing in
  // DUEL_INSTRUMENT=1 snapshots.
  getCardName,
  isTokenCard,
  setLastAnnounceNumberOptions: (opts) => { lastAnnounceNumberOptions = opts; },
  getLastAnnounceNumberOptions: () => lastAnnounceNumberOptions,
};

/** Worker-bound `transformMessage` (audit U4) — forwards both contexts +
 *  `skipRpsFlag` to the extracted dispatcher. Function declaration (not
 *  `const`) so it's hoisted and reachable from `initReplay`'s DI bag below. */
function transformMessage(
  msg: import('@n1xx1/ocgcore-wasm').OcgMessage,
  preProcessOverlays?: Map<import('./pre-process-overlays.js').PreProcessOverlayKey, number[]>,
  settlingFifo?: import('./pre-process-overlays.js').SettlingSourceFifo,
): ServerMessage | null {
  return transformMessageExtracted(msg, ocgContext, lookupContext, skipRpsFlag, preProcessOverlays, settlingFifo);
}

/** Worker-bound `transformResponse` (audit U4) — forwards the lookup context
 *  to the extracted module so `ANNOUNCE_NUMBER` can resolve the option index. */
function transformResponse(promptType: string, data: Record<string, unknown>): unknown {
  return transformResponseExtracted(promptType, data, lookupContext);
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
  const elapsedMs = performance.now() - perfStart;
  buildBoardStateCumulativeMs += elapsedMs;
  buildBoardStateCallCount++;
  // Phase 0b instrumentation: feed the env-gated bucket so the histogram +
  // /status aggregation see this call. No-op unless DUEL_INSTRUMENT=1.
  duelInstr.record('buildBoardState', BigInt(Math.round(elapsedMs * 1_000_000)));

  return msg;
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
  emit.replayData({
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
      // capturedDecks is the live top→bottom pile order (loadDeckToOcg
      // returns it verbatim since the back-to-front sequence:0 fix).
      deckOrder: 'verbatim',
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
      emit.error('Watchdog timeout (30s)');
      cleanup();
      // Give the MessagePort enough time to drain before killing the process
      setTimeout(() => process.exit(1), 1000);
    }, WATCHDOG_TIMEOUT_MS);

    // β.3 cas #12 (Commit 0bis) — capture MZONE overlayMaterials BEFORE
    // duelProcess applies the next batch of mutations. A post-process query
    // on the source MZONE of a just-departed XYZ returns [] (R8 invariant);
    // the snapshot is the only way for `transformMove` to surface the
    // matériaux on the outgoing MSG_MOVE.
    //
    // M1 limit (post-review, 2026-05-28) — the snapshot is taken once
    // PER `duelProcess`, not per OCG event. `duelProcess` can batch
    // multiple mutations (e.g. chain resolution with several MSG_MOVEs).
    // The lookup `snapshot[controller-seq]` keyed by MZONE source seq is
    // physically unique : each seq holds at most one card at any moment,
    // so MSG_MOVE_XYZ→GY events that leave a unique seq during the batch
    // find the right entry. The pathological case (a card ENTERS then
    // LEAVES MZONE-N in the same duelProcess) would stale the snapshot
    // for the second occupant. No known OCG scenario produces this
    // sequence in one batch — flagged for future investigation if
    // observed. If hit, the fix is to snapshot per OCG event (cost :
    // an extra `duelQueryLocation` per MOVE event = N×~100µs).
    const preProcessOverlays = duelInstr.time(
      'preProcessOverlays',
      () => capturePreProcessOverlays(core!, duel!, dlog),
    );

    // β.3 cas #12 post-review B3 (2026-05-28) — derive the per-batch FIFO
    // from the snapshot for settling tagging. Consumed inside transformMove
    // as each GRAVE→GRAVE settling event flows through. Mutates as events
    // are tagged ; shared with every transformMessage call of this batch.
    const settlingFifo = buildSettlingSourceFifo(preProcessOverlays);

    let status: number;
    try {
      status = duelInstr.time('duelProcess', () => core!.duelProcess(duel!));
    } catch (err) {
      clearTimeout(watchdog);
      const message = err instanceof Error ? err.message : String(err);
      dlog.error('duelProcess threw', { error: message });
      emit.error(message);
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

      // Transform and forward — preProcessOverlays surfaces overlayMaterials
      // on MSG_MOVE for XYZ leaving MZONE (β.3 cas #12 Commit 0bis).
      // settlingFifo tags GRAVE→GRAVE settlings with their source XYZ MZONE
      // seq for the discriminating rule predicate (B3 post-review).
      const dto = transformMessage(msg, preProcessOverlays, settlingFifo);
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
        //
        // F10 (2026-05-31) — cross-side parity. Replay precompute achieves
        // the equivalent intermediate sync via PreComputedState segmentation
        // on MSG_CHAINING (replay-precompute.ts:394-399), NOT via an
        // intermediate BOARD_STATE. The two mechanisms differ in ORDER vs
        // MSG_CHAINING (PvP sync arrives after MSG_CHAINING, replay before)
        // but converge on "DECK/EXTRA pile counts + metadata up to date
        // before chain resolution". See CLAUDE.md → "Intermediate post-cost
        // board sync (F10)". If you remove or relocate this branch, update
        // the replay precompute counterpart + the doctrine in lock-step.
        if (dto.type === 'MSG_CHAIN_SOLVING' && hasCostMoves) {
          dlog.debug('BOARD_STATE (intermediate, before chain solving)');
          emit.message(buildBoardState());
          hasCostMoves = false;
        }
        dlog.debug('EMIT', { type: dto.type });
        emit.message(dto);
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
      emit.retry(lastResponsePlayerIndex);
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
      emit.message(buildBoardState());
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
  // Phase 0b instrumentation: worker cold-start — WASM instantiate + cdb open
  // + scripts + strings parse, per duel (finding D-M8). initOcgEngine is async
  // so duelInstr.time() (sync-only) can't wrap it; we measure with an explicit
  // hrtime span and feed duelInstr.record(). No-op unless DUEL_INSTRUMENT=1.
  const coldStartT0 = process.hrtime.bigint();
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

  duelInstr.record('workerColdStart', process.hrtime.bigint() - coldStartT0);
  return { newCore, handle, db, strings };
}

function loadDeckToOcg(c: OcgCoreSync, d: OcgDuelHandle, deck: Deck, team: 0 | 1, shuffle: boolean): Deck {
  const ordered = resolveDeckLoadOrder(deck, shuffle);

  // duelNewCard with `sequence: 0` inserts the card on TOP, so each insertion
  // lands above the previous one. To end up with `ordered.main[0]` on top we
  // must insert it LAST → iterate the array back-to-front.
  for (let i = ordered.main.length - 1; i >= 0; i--) {
    c.duelNewCard(d, {
      code: ordered.main[i], team, duelist: 0, controller: team,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of ordered.extra) {
    c.duelNewCard(d, {
      code, team, duelist: 0, controller: team,
      location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  // Return the top→bottom order actually loaded so the replay/fork path
  // rebuilds the exact same pile via resolveDeckLoadOrder(captured, false).
  return ordered;
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
  emit = createWorkerEmitter(port, duelId);
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
    emit.error('Failed to create duel instance');
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
  emit.duelCreated();
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
  // Phase 0b instrumentation: worker-thread buckets (buildBoardState,
  // getCardName, duelProcess, workerColdStart) can't reach GET /status in the
  // main process — log the snapshot at duel end so the debug-replay harness
  // (and prod logs) capture it. No-op unless DUEL_INSTRUMENT=1.
  if (duelInstr.instrumentationEnabled()) {
    dlog.log('duel-instrumentation snapshot', { perf: duelInstr.snapshot() });
    duelInstr.reset();
  }
}

// =============================================================================
// Replay Pre-Computation (entry point — body lives in `replay-precompute.ts`)
// =============================================================================

async function initReplay(msg: InitReplayMessage): Promise<void> {
  duelId = msg.duelId;
  dlog = logger.forDuel(duelId);
  emit = createWorkerEmitter(port, duelId);
  skipRpsFlag = true;
  skipShuffleFlag = true;

  const seed = msg.seed.map(BigInt) as [bigint, bigint, bigint, bigint];
  const result = await initOcgEngine(seed);
  if (!result) {
    emit.replayError('REPLAY_INIT_FAILED', 'Failed to create duel instance');
    return;
  }
  core = result.newCore;
  duel = result.handle;
  cardDb = result.db;
  systemStrings = result.strings;

  // Legacy replays stored their decks reversed vs. the live pile — normalise
  // to the current 'verbatim' convention before the shuffle-off load so the
  // pile matches the original duel and the captured responses still apply.
  const replayConvention = msg.metadata.deckOrder;
  loadDeckToOcg(core, duel, normalizeReplayDeck(msg.decks[0], replayConvention), 0, false);
  loadDeckToOcg(core, duel, normalizeReplayDeck(msg.decks[1], replayConvention), 1, false);

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
//
// U4 (audit-4-modes-2026-06-01) — `runForkReconstruction` + `performSanityCheck`
// moved to `duel-worker-fork.ts`. `initFork` stays here (touches the OCGCore
// init pipeline) ; the 2 fork-state slots also stay here (read by FORK_RESUME
// + cleanup port handlers). The extracted module receives setters + getters
// via `forkContext` below.

let forkMode = false;
let forkPendingSelect: OcgMessage | null = null;

/** Phase → OCGCore code lookup — only `performSanityCheck` reads it. Built
 *  once from the worker's `PHASE_MAP` so the inverse stays in sync. */
const PHASE_MAP_REVERSE: PhaseToCodeMap = Object.fromEntries(
  Object.entries(PHASE_MAP).map(([k, v]) => [v, Number(k)]),
) as PhaseToCodeMap;

/** Bound context for the extracted fork module. Closures (`() => state`)
 *  because the worker re-assigns `core / duel / dlog / emit` and the
 *  state slots each `init*` call. Setters wire the 2 fork-state slots
 *  back into the worker. */
const forkContext: ForkContext = {
  core: () => core,
  duel: () => duel,
  lp: () => lp,
  turnCount: () => turnCount,
  phase: () => phase,
  phaseMap: PHASE_MAP_REVERSE,
  dlog: () => dlog,
  emit: () => emit,
  updateState,
  cleanup,
  setForkMode: (v) => { forkMode = v; },
  setForkPendingSelect: (v) => { forkPendingSelect = v; },
};

async function initFork(msg: InitForkMessage): Promise<void> {
  duelId = msg.duelId;
  dlog = logger.forDuel(duelId);
  emit = createWorkerEmitter(port, duelId);
  skipRpsFlag = true;
  skipShuffleFlag = true;

  // Inject pre-computed metadata from main thread (same as initDuel)
  setScriptsHash(msg.scriptsHash);
  setOcgcoreVersion(msg.ocgcoreVersion);

  const seed = msg.seed.map(BigInt) as [bigint, bigint, bigint, bigint];
  const result = await initOcgEngine(seed);
  if (!result) {
    emit.forkError('REPLAY_INIT_FAILED', 'Failed to create duel instance');
    return;
  }
  core = result.newCore;
  duel = result.handle;
  cardDb = result.db;
  systemStrings = result.strings;

  // Same legacy normalisation as the replay path (see initReplay).
  const forkConvention = msg.deckOrder;
  loadDeckToOcg(core, duel, normalizeReplayDeck(msg.decks[0], forkConvention), 0, false);
  loadDeckToOcg(core, duel, normalizeReplayDeck(msg.decks[1], forkConvention), 1, false);

  resetDuelState();
  core.startDuel(duel);
  runForkReconstructionExtracted(msg, forkContext);
}


// =============================================================================
// Message Handler
// =============================================================================

port.on('message', (msg: MainToWorkerMessage) => {
  if (msg.type === 'INIT_DUEL') {
    initDuel(msg).catch(err => {
      emit.error(err instanceof Error ? err.message : String(err));
    });
  } else if (msg.type === 'INIT_REPLAY') {
    initReplay(msg).catch(err => {
      emit.replayError('REPLAY_COMPUTATION_ERROR', err instanceof Error ? err.message : String(err));
    });
  } else if (msg.type === 'INIT_FORK') {
    initFork(msg).catch(err => {
      emit.forkError('REPLAY_COMPUTATION_ERROR', err instanceof Error ? err.message : String(err));
    });
  } else if (msg.type === 'FORK_RESUME') {
    // Both clients connected — emit current board state + pending SELECT prompt
    if (forkMode && core && duel) {
      emit.message(buildBoardState());
      if (forkPendingSelect) {
        const dto = transformMessage(forkPendingSelect);
        if (dto) {
          emit.message(dto);
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
      emit.error(`emitReplayData failed: ${err instanceof Error ? err.message : err}`);
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
      //
      // F5-bis (2026-05-31) — fork-solo now inherits cancel-rollback. The
      // pre-F5-bis gate `!forkMode` was historical (no client UI when fork
      // first shipped) but functionally there was no blocker. Fork-solo
      // sessions go through the same SOLO multiplex path and thus benefit
      // from cancel-rollback identically — anti-fat-finger discipline is
      // valuable in an exploratory variant.
      if (snapshotAvailable() && (msg.promptType === 'SELECT_IDLECMD' || msg.promptType === 'SELECT_BATTLECMD')) {
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
    emit.message(buildBoardState());
    emit.cancelDone(msg.playerIndex);
  }
});
