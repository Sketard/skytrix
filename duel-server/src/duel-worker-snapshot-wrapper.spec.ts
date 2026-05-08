// =============================================================================
// P0-3bis.2 — Smoke test for the worker snapshot wrapper
// =============================================================================
//
// Validates AC #5, #6, #7, #8 from
// `_bmad-output/implementation-artifacts/p0-3bis-2-worker-snapshot-wrapper.md`.
//
// Strategy:
//   - Boot ocgcore in-process (same fixture as the POC).
//   - Maintain test-local state slots that mirror the worker's `let`
//     bindings, with accessors fed to `takeWorkerSnapshotImpl` /
//     `restoreWorkerSnapshotImpl`.
//   - Drive the duel through a snapshot/respond/restore cycle and
//     assert each of the 5 state slots is fully restored.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
} from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from './ocg-scripts.js';
import { createCardReader, createScriptReader } from './ocg-callbacks.js';
import type { CardDB, ScriptDB } from './types.js';
import {
  installWasmHook,
  uninstallWasmHook,
  locateWasmMemory,
  _testResetState,
} from './wasm-snapshot.js';
import {
  takeWorkerSnapshotImpl,
  restoreWorkerSnapshotImpl,
  type WorkerStateAccessors,
} from './wasm-snapshot-wrapper.js';
import type { Player, Phase } from './ws-protocol.js';

// -----------------------------------------------------------------------------
// Boot fixture (40x Alexandrite Dragon — same as the POC)
// -----------------------------------------------------------------------------

const DATA_DIR = resolve(import.meta.dirname!, '../data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');
const DECK = Array(40).fill(43096270); // 40x Alexandrite Dragon

const SELECT_TYPES = new Set<number>([
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.ROCK_PAPER_SCISSORS,
]);

function isSelect(type: number): boolean {
  return SELECT_TYPES.has(type);
}

function autoRespond(msg: { type: number; player?: number; summons?: unknown[]; to_ep?: boolean; places?: { player: number; location: number; sequence: number }[] }): unknown {
  switch (msg.type) {
    case OcgMessageType.SELECT_IDLECMD:
      if ((msg.summons?.length ?? 0) > 0) return { type: 1, action: 0, index: 0 };
      return { type: 1, action: 7 };
    case OcgMessageType.SELECT_BATTLECMD:
      return { type: 0, action: 3 };
    case OcgMessageType.SELECT_CHAIN:
      return { type: 8, index: null };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: 2, yes: true };
    case OcgMessageType.SELECT_POSITION:
      return { type: 11, position: OcgPosition.FACEUP_ATTACK };
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const place = msg.places?.[0];
      if (!place) return null;
      const respType = msg.type === OcgMessageType.SELECT_PLACE ? 10 : 9;
      return { type: respType, places: [{ player: place.player, location: place.location, sequence: place.sequence }] };
    }
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: 20, value: msg.player === 0 ? 1 : 3 };
    default:
      return null;
  }
}

interface DriveResult {
  select: { type: number; player?: number; summons?: unknown[]; to_ep?: boolean } | null;
  field: unknown | null;
}

function driveUntil(
  core: OcgCoreSync,
  duel: OcgDuelHandle,
  targetTypes: Set<number>,
  opts: { playerFilter?: number; maxSteps?: number } = {},
): DriveResult {
  const max = opts.maxSteps ?? 200;
  for (let i = 0; i < max; i++) {
    const status = core.duelProcess(duel);
    const msgs = core.duelGetMessage(duel);
    if (status === OcgProcessResult.END) return { select: null, field: null };
    if (status === OcgProcessResult.WAITING) {
      const sel = msgs.find((m) => isSelect(m.type));
      if (!sel) continue;
      const matches =
        targetTypes.has(sel.type) &&
        (opts.playerFilter === undefined || (sel as { player?: number }).player === opts.playerFilter);
      if (matches) {
        return { select: sel as DriveResult['select'], field: core.duelQueryField(duel) };
      }
      const r = autoRespond(sel as Parameters<typeof autoRespond>[0]);
      if (r !== null) core.duelSetResponse(duel, r as never);
    }
  }
  return { select: null, field: null };
}

function bootFreshDuel(
  seed: [bigint, bigint, bigint, bigint],
  core: OcgCoreSync,
  fixtures: { cardDb: CardDB; scripts: ScriptDB },
): OcgDuelHandle {
  const cardReader = createCardReader(fixtures.cardDb);
  const scriptReader = createScriptReader(fixtures.scripts);
  const handle = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed,
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader,
    scriptReader,
    errorHandler: () => {},
  });
  if (!handle) throw new Error('createDuel failed');
  for (const name of STARTUP_SCRIPTS) {
    const c = fixtures.scripts.startupScripts.get(name);
    if (c) core.loadScript(handle, name, c);
  }
  for (const code of DECK) {
    core.duelNewCard(handle, {
      code, team: 0, duelist: 0, controller: 0,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of DECK) {
    core.duelNewCard(handle, {
      code, team: 1, duelist: 0, controller: 1,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  core.startDuel(handle);
  return handle;
}

// -----------------------------------------------------------------------------
// Test-local state slots that mirror the worker's `let` bindings.
// The accessor object below is the bridge between the wrapper and these
// vars — exactly the same shape as the worker's accessor.
// -----------------------------------------------------------------------------

let turnPlayer: Player = 0;
let turnCount = 0;
let phase: Phase = 'DRAW';
let lp: [number, number] = [8000, 8000];
let lastResponsePlayerIndex: 0 | 1 = 0;
let lastAnnounceNumberOptions: number[] = [];
const capturedResponses: { data: unknown; timestamp: string }[] = [];

const accessors: WorkerStateAccessors = {
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
  log: () => {}, // silence DEBUG output in tests
};

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

let core: OcgCoreSync;
let duel: OcgDuelHandle;
let cardDb: CardDB;
let scripts: ScriptDB;

beforeAll(async () => {
  cardDb = loadDatabase(DB_PATH);
  scripts = loadScripts(SCRIPTS_DIR);

  installWasmHook();
  try {
    core = await createCore({ sync: true });
  } finally {
    uninstallWasmHook();
  }
  if (!locateWasmMemory()) {
    throw new Error('WASM memory not captured — POC infra failure');
  }

  duel = bootFreshDuel([42n, 123n, 456n, 789n], core, { cardDb, scripts });
});

afterAll(() => {
  if (duel && core) {
    try { core.destroyDuel(duel); } catch { /* ignore */ }
  }
  _testResetState();
});

// -----------------------------------------------------------------------------
// AC #5 — coherence after take → mutate → restore
// -----------------------------------------------------------------------------

describe('AC #5: takeWorkerSnapshot + ocgcore advance + restoreWorkerSnapshot restores all 5 slots', () => {
  it('field, ui mirror, response trace, captured-responses-length all match pre-snapshot', () => {
    // Drive to player-0 SELECT_IDLECMD with a summon
    const idle = driveUntil(core, duel, new Set([OcgMessageType.SELECT_IDLECMD]), { playerFilter: 0 });
    expect(idle.select).not.toBeNull();

    // Set non-default values for the divergent slots so we can see them
    // bounce back after restore.
    turnPlayer = 0;
    turnCount = 1;
    phase = 'MAIN1';
    lp = [8000, 8000];
    lastResponsePlayerIndex = 0;
    lastAnnounceNumberOptions = [10, 20, 30];

    // Pre-snapshot state captured for comparison
    const pre = {
      turnPlayer,
      turnCount,
      phase,
      lp: [lp[0], lp[1]] as [number, number],
      lastResponsePlayerIndex,
      lastAnnounceNumberOptions: [...lastAnnounceNumberOptions],
      capturedResponsesLength: capturedResponses.length,
      field: JSON.stringify(core.duelQueryField(duel), (_k, v) => typeof v === 'bigint' ? `__bigint:${v.toString()}` : v),
    };

    // Take the worker snapshot (WASM + 5 slots)
    const snap = takeWorkerSnapshotImpl(accessors);
    expect(snap.wasm.byteLength).toBeGreaterThan(0);
    expect(snap.ui.turnPlayer).toBe(pre.turnPlayer);
    expect(snap.ui.turnCount).toBe(pre.turnCount);
    expect(snap.ui.phase).toBe(pre.phase);
    expect(snap.ui.lp).toEqual(pre.lp);
    expect(snap.lastResponsePlayerIndex).toBe(pre.lastResponsePlayerIndex);
    expect(snap.lastAnnounceNumberOptions).toEqual(pre.lastAnnounceNumberOptions);
    expect(snap.capturedResponsesLength).toBe(pre.capturedResponsesLength);

    // Send a real PLAYER_RESPONSE through the captured path: push to
    // capturedResponses + advance ocgcore. This is exactly what
    // capturedSetResponse does in the worker.
    capturedResponses.push({ data: { type: 1, action: 0, index: 0 }, timestamp: 'T' });
    core.duelSetResponse(duel, { type: 1, action: 0, index: 0 } as never);
    driveUntil(core, duel, new Set([OcgMessageType.SELECT_PLACE]), { playerFilter: 0 });

    // Pollute the 5 slots so we know restore actually overwrites them
    turnPlayer = 1;
    turnCount = 99;
    phase = 'END';
    lp = [1234, 5678];
    lastResponsePlayerIndex = 1;
    lastAnnounceNumberOptions = [999];
    expect(capturedResponses.length).toBe(pre.capturedResponsesLength + 1);

    // Restore the worker snapshot
    restoreWorkerSnapshotImpl(snap, accessors);

    // All 5 slots restored
    expect(turnPlayer).toBe(pre.turnPlayer);
    expect(turnCount).toBe(pre.turnCount);
    expect(phase).toBe(pre.phase);
    expect(lp).toEqual(pre.lp);
    expect(lastResponsePlayerIndex).toBe(pre.lastResponsePlayerIndex);
    expect(lastAnnounceNumberOptions).toEqual(pre.lastAnnounceNumberOptions);

    // capturedResponses truncated to pre-snapshot length (cancelled response gone)
    expect(capturedResponses.length).toBe(pre.capturedResponsesLength);

    // WASM field rolled back
    const postField = JSON.stringify(core.duelQueryField(duel), (_k, v) => typeof v === 'bigint' ? `__bigint:${v.toString()}` : v);
    expect(postField).toBe(pre.field);
  });
});

// -----------------------------------------------------------------------------
// AC #6 — capturedResponses identity preserved (truncation, not reassign)
// -----------------------------------------------------------------------------

describe('AC #6: capturedResponses truncation preserves array identity', () => {
  it('the SAME array reference is shrunk, not replaced', () => {
    // Fresh duel
    if (duel) { try { core.destroyDuel(duel); } catch { /* ignore */ } }
    duel = bootFreshDuel([42n, 123n, 456n, 789n], core, { cardDb, scripts });

    // Reset test-local state
    turnPlayer = 0; turnCount = 0; phase = 'DRAW';
    lp = [8000, 8000];
    lastResponsePlayerIndex = 0;
    lastAnnounceNumberOptions = [];
    capturedResponses.length = 0;
    capturedResponses.push({ data: 'pre-existing', timestamp: 'T0' });

    driveUntil(core, duel, new Set([OcgMessageType.SELECT_IDLECMD]), { playerFilter: 0 });

    const arrayRefBefore = capturedResponses;
    const lengthBefore = capturedResponses.length;

    const snap = takeWorkerSnapshotImpl(accessors);
    capturedResponses.push({ data: 'cancelled-response', timestamp: 'T1' });
    expect(capturedResponses.length).toBe(lengthBefore + 1);

    restoreWorkerSnapshotImpl(snap, accessors);

    // The SAME array reference, shrunk in-place
    expect(capturedResponses).toBe(arrayRefBefore);
    expect(capturedResponses.length).toBe(lengthBefore);
    expect(capturedResponses[capturedResponses.length - 1]?.data).toBe('pre-existing');
  });
});

// -----------------------------------------------------------------------------
// AC #8 — 50 cycles RSS leak guard
// -----------------------------------------------------------------------------

describe('AC #8: 50 take/restore cycles bounded RSS growth', () => {
  it('rss growth < 100MB after 50 cycles', () => {
    // Fresh duel at branch point
    if (duel) { try { core.destroyDuel(duel); } catch { /* ignore */ } }
    duel = bootFreshDuel([42n, 123n, 456n, 789n], core, { cardDb, scripts });

    turnPlayer = 0; turnCount = 0; phase = 'DRAW';
    lp = [8000, 8000];
    lastResponsePlayerIndex = 0;
    lastAnnounceNumberOptions = [];
    capturedResponses.length = 0;

    driveUntil(core, duel, new Set([OcgMessageType.SELECT_IDLECMD]), { playerFilter: 0 });

    const rssBefore = process.memoryUsage().rss;
    const totalMsList: number[] = [];

    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const snap = takeWorkerSnapshotImpl(accessors);
      restoreWorkerSnapshotImpl(snap, accessors);
      totalMsList.push(performance.now() - t0);
    }

    const rssAfter = process.memoryUsage().rss;
    const rssDeltaMb = (rssAfter - rssBefore) / 1024 / 1024;

    totalMsList.sort((a, b) => a - b);
    const median = totalMsList[Math.floor(totalMsList.length / 2)];
    const p95 = totalMsList[Math.floor(totalMsList.length * 0.95)];

    // eslint-disable-next-line no-console
    console.log(`[AC #8 wrapper] 50x bench — total: median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms · rss Δ=${rssDeltaMb.toFixed(1)}MB`);

    expect(rssDeltaMb).toBeLessThan(100);
    expect(median).toBeLessThan(50); // wrapper adds negligible overhead vs raw WASM
  });
});
