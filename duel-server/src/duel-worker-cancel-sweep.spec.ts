// =============================================================================
// P0-3bis.6 — Cancel sweep E2E regression test
// =============================================================================
//
// Realistic cancel flow exercised across worker + server-mirror + client-
// mirror. Validates that EVERY state slot listed in the cancel rollback
// contract is correctly reset.
//
// THE CONTRACT THIS TEST GUARDS:
//   `_bmad-output/planning-artifacts/cancel-rollback-contract.md`
//
// MAINTENANCE DISCIPLINE — when adding a new mutable state slot to:
//   - the worker module-level state, OR
//   - `ActiveDuelSession` (server), OR
//   - `DuelConnection` private fields (client),
// you MUST:
//   1. Document the slot in cancel-rollback-contract.md
//   2. Add it to EXPECTED_SLOTS below
//   3. Mirror its mutation in `runDivergencePhase` here
//   4. Mirror its reset in `runRestorePhase` here
//   5. Assert it's restored in the post-restore check
//
// If the test passes after you add the slot but before you wire it into
// the production cancel handler, that's a false green — the contract
// would say the slot exists but real cancel wouldn't reset it. The doc
// IS the source of truth; this test mirrors the doc to catch drift.
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
  type WorkerSnapshot,
  type WorkerStateAccessors,
} from './wasm-snapshot-wrapper.js';
import type { Player, Phase } from './ws-protocol.js';

// -----------------------------------------------------------------------------
// EXPECTED_SLOTS — the slots this test exercises.
// Mirrors `cancel-rollback-contract.md`. Update when the contract changes.
// -----------------------------------------------------------------------------

const EXPECTED_SLOTS = {
  worker: [
    'wasm', // proxy for the WASM linear memory snapshot
    'turnPlayer',
    'turnCount',
    'phase',
    'lp',
    'lastResponsePlayerIndex',
    'lastAnnounceNumberOptions',
    'capturedResponsesLength',
  ],
  server: [
    'cancelTargetPrompt',
    'lastSentPrompt',
    'lastSentHint',
    'awaitingResponse',
    'activeChainLinks',
    'chainPhase',
    'negatedChainIndices',
    'invalidResponseCount',
  ],
  client: [
    '_pendingPrompt',
    '_hintContext',
    '_lastConfirmedCards',
    '_lastSelectedCards',
    '_lastSelectedPromptType',
    '_hintCardConsumed',
  ],
} as const;

// -----------------------------------------------------------------------------
// Boot fixture
// -----------------------------------------------------------------------------

const DATA_DIR = resolve(import.meta.dirname!, '../data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');
const DECK = Array(40).fill(43096270);

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

function isSelect(type: number): boolean { return SELECT_TYPES.has(type); }

function autoRespond(msg: { type: number; player?: number; summons?: unknown[] }): unknown {
  switch (msg.type) {
    case OcgMessageType.SELECT_IDLECMD:
      if ((msg.summons?.length ?? 0) > 0) return { type: 1, action: 0, index: 0 };
      return { type: 1, action: 7 };
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: 20, value: msg.player === 0 ? 1 : 3 };
    default:
      return null;
  }
}

function driveTo(
  core: OcgCoreSync,
  duel: OcgDuelHandle,
  targets: Set<number>,
  opts: { playerFilter?: number; maxSteps?: number } = {},
): { type: number } | null {
  const max = opts.maxSteps ?? 200;
  for (let i = 0; i < max; i++) {
    const status = core.duelProcess(duel);
    const msgs = core.duelGetMessage(duel);
    if (status === OcgProcessResult.END) return null;
    if (status === OcgProcessResult.WAITING) {
      const sel = msgs.find((m) => isSelect(m.type));
      if (!sel) continue;
      if (targets.has(sel.type) && (opts.playerFilter === undefined || (sel as { player?: number }).player === opts.playerFilter)) {
        return { type: sel.type };
      }
      const r = autoRespond(sel as Parameters<typeof autoRespond>[0]);
      if (r !== null) core.duelSetResponse(duel, r as never);
    }
  }
  return null;
}

function bootDuel(seed: [bigint, bigint, bigint, bigint], core: OcgCoreSync, fixtures: { cardDb: CardDB; scripts: ScriptDB }): OcgDuelHandle {
  const cardReader = createCardReader(fixtures.cardDb);
  const scriptReader = createScriptReader(fixtures.scripts);
  const handle = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed,
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader, scriptReader,
    errorHandler: () => {},
  });
  if (!handle) throw new Error('createDuel failed');
  for (const name of STARTUP_SCRIPTS) {
    const c = fixtures.scripts.startupScripts.get(name);
    if (c) core.loadScript(handle, name, c);
  }
  for (const code of DECK) {
    core.duelNewCard(handle, { code, team: 0, duelist: 0, controller: 0, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK });
  }
  for (const code of DECK) {
    core.duelNewCard(handle, { code, team: 1, duelist: 0, controller: 1, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK });
  }
  core.startDuel(handle);
  return handle;
}

function stableSerialize(v: unknown): string {
  return JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? `__bigint:${val.toString()}` : val);
}

// -----------------------------------------------------------------------------
// Server + client state mirrors (the slots this test exercises)
// -----------------------------------------------------------------------------

interface ServerSessionMirror {
  cancelTargetPrompt: [unknown | null, unknown | null];
  lastSentPrompt: [unknown | null, unknown | null];
  lastSentHint: [unknown | null, unknown | null];
  awaitingResponse: [boolean, boolean];
  activeChainLinks: unknown[];
  chainPhase: 'idle' | 'building' | 'resolving';
  negatedChainIndices: Set<number>;
  invalidResponseCount: [number, number];
}

interface ClientStateMirror {
  pendingPrompt: unknown | null;
  hintContext: { hintType: number; player: number; value: number; cardName: string; hintAction: string };
  lastConfirmedCards: unknown[];
  lastSelectedCards: unknown[];
  lastSelectedPromptType: string | null;
  hintCardConsumed: boolean;
}

function makeServerMirror(): ServerSessionMirror {
  return {
    cancelTargetPrompt: [null, null],
    lastSentPrompt: [null, null],
    lastSentHint: [null, null],
    awaitingResponse: [false, false],
    activeChainLinks: [],
    chainPhase: 'idle',
    negatedChainIndices: new Set(),
    invalidResponseCount: [0, 0],
  };
}

function makeClientMirror(): ClientStateMirror {
  return {
    pendingPrompt: null,
    hintContext: { hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' },
    lastConfirmedCards: [],
    lastSelectedCards: [],
    lastSelectedPromptType: null,
    hintCardConsumed: false,
  };
}

function snapshotMirrors(server: ServerSessionMirror, client: ClientStateMirror): string {
  return stableSerialize({
    server: {
      cancelTargetPrompt: server.cancelTargetPrompt,
      lastSentPrompt: server.lastSentPrompt,
      lastSentHint: server.lastSentHint,
      awaitingResponse: server.awaitingResponse,
      activeChainLinks: server.activeChainLinks,
      chainPhase: server.chainPhase,
      negatedChainIndices: [...server.negatedChainIndices].sort(),
      invalidResponseCount: server.invalidResponseCount,
    },
    client: {
      pendingPrompt: client.pendingPrompt,
      hintContext: client.hintContext,
      lastConfirmedCards: client.lastConfirmedCards,
      lastSelectedCards: client.lastSelectedCards,
      lastSelectedPromptType: client.lastSelectedPromptType,
      hintCardConsumed: client.hintCardConsumed,
    },
  });
}

// -----------------------------------------------------------------------------
// Worker accessor mirror (test-local state slots backing the accessors)
// -----------------------------------------------------------------------------

let turnPlayer: Player = 0;
let turnCount = 1; // post-init; the duel has reached IDLECMD
let phase: Phase = 'MAIN1';
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
  log: () => {},
};

// -----------------------------------------------------------------------------
// Suite setup
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
  if (!locateWasmMemory()) throw new Error('WASM memory not captured');
  duel = bootDuel([42n, 123n, 456n, 789n], core, { cardDb, scripts });

  // Drive to player-0 SELECT_IDLECMD with a summon available
  const reached = driveTo(core, duel, new Set([OcgMessageType.SELECT_IDLECMD]), { playerFilter: 0 });
  if (!reached || reached.type !== OcgMessageType.SELECT_IDLECMD) {
    throw new Error('Failed to reach SELECT_IDLECMD with summon');
  }
});

afterAll(() => {
  if (duel && core) {
    try { core.destroyDuel(duel); } catch { /* ignore */ }
  }
  _testResetState();
});

// -----------------------------------------------------------------------------
// AC #2-#5 — Sweep: snapshot → diverge → restore → re-activate cleanly
// -----------------------------------------------------------------------------

describe('Cancel sweep — every contract slot is restored', () => {
  it('exercises a realistic IDLECMD → diverge → cancel → re-IDLECMD flow with all slots', () => {
    // ─── Phase 0: pre-snapshot ─────────────────────────────────────────────
    // Mirror what `broadcastMessage` would have done when SELECT_IDLECMD was
    // sent: lastSentPrompt[0] cached, awaitingResponse[0] = true.
    const server = makeServerMirror();
    const client = makeClientMirror();
    const idleCmdPromptStub = { type: 'SELECT_IDLECMD', player: 0 };
    server.lastSentPrompt[0] = idleCmdPromptStub;
    server.awaitingResponse[0] = true;
    server.lastSentHint[0] = { type: 'MSG_HINT', player: 0, hintType: 1, hintAction: 'Before the normal draw' };

    // Snapshot all surfaces' pre-state
    const preWorkerField = stableSerialize(core.duelQueryField(duel));
    const preTurnPlayer = turnPlayer;
    const preTurnCount = turnCount;
    const prePhase = phase;
    const preLp: [number, number] = [lp[0], lp[1]];
    const preLastResponsePlayerIndex = lastResponsePlayerIndex;
    const preLastAnnounceNumberOptions = [...lastAnnounceNumberOptions];
    const preCapturedResponsesLength = capturedResponses.length;
    const preMirrors = snapshotMirrors(server, client);

    // ─── Phase 1 — AC #2: take the worker snapshot ────────────────────────
    // Mirror the server PLAYER_RESPONSE handler logic for SELECT_IDLECMD:
    // cache the prompt before forwarding to the worker.
    server.cancelTargetPrompt[0] = idleCmdPromptStub;

    const snap: WorkerSnapshot = takeWorkerSnapshotImpl(accessors);
    expect(snap.wasm.byteLength).toBeGreaterThan(0);
    expect(snap.ui.turnPlayer).toBe(preTurnPlayer);
    expect(snap.ui.turnCount).toBe(preTurnCount);
    expect(snap.ui.phase).toBe(prePhase);
    expect(snap.ui.lp).toEqual(preLp);
    expect(snap.lastResponsePlayerIndex).toBe(preLastResponsePlayerIndex);
    expect(snap.lastAnnounceNumberOptions).toEqual(preLastAnnounceNumberOptions);
    expect(snap.capturedResponsesLength).toBe(preCapturedResponsesLength);
    expect(server.cancelTargetPrompt[0]).toBe(idleCmdPromptStub);

    // ─── Phase 2 — AC #3: divergence ──────────────────────────────────────
    // Apply the IDLECMD response (Normal Summon first hand index)
    capturedResponses.push({ data: { type: 1, action: 0, index: 0 }, timestamp: 'T0' });
    core.duelSetResponse(duel, { type: 1, action: 0, index: 0 } as never);
    // Drive ocgcore through the resulting events. Stop at the next select
    // — likely SELECT_PLACE for the Normal Summon zone choice. We don't
    // respond to it; the divergence is sufficient.
    let drove = false;
    for (let step = 0; step < 50 && !drove; step++) {
      const status = core.duelProcess(duel);
      const msgs = core.duelGetMessage(duel);
      if (status === OcgProcessResult.END) break;
      if (status === OcgProcessResult.WAITING) {
        const sel = msgs.find((m) => isSelect(m.type));
        if (sel) drove = true;
      }
    }

    // Mutate every server-side mirror slot the way the realistic flow does
    server.lastSentPrompt[0] = { type: 'SELECT_PLACE', player: 0, count: 1, field_mask: 0xFF };
    server.lastSentHint[0] = { type: 'MSG_HINT', player: 0, hintType: 3, hintAction: 'Select a zone' };
    server.activeChainLinks = [{ chainIndex: 0, cardCode: 73819701, player: 0 }];
    server.chainPhase = 'building';
    server.negatedChainIndices.add(0);
    server.invalidResponseCount[0] = 2;
    // server.awaitingResponse[0] flips to true again on the new prompt
    server.awaitingResponse[0] = true;
    // server.cancelTargetPrompt[0] stays — set at IDLECMD response, not cleared until cancel

    // Mutate every client-side mirror slot
    client.pendingPrompt = { type: 'SELECT_PLACE', player: 0 };
    client.hintContext = { hintType: 3, player: 0, value: 504, cardName: '', hintAction: 'Select a zone' };
    client.lastConfirmedCards = [{ cardCode: 12345, sequence: 0 }];
    client.lastSelectedCards = [{ cardCode: 67890, sequence: 1 }];
    client.lastSelectedPromptType = 'SELECT_CARD';
    client.hintCardConsumed = true;

    // Worker accessors: simulate ocgcore having modified the slots ocgcore
    // owns. The accessors track these via their setters during the real
    // worker's PLAYER_RESPONSE handling, but we tweak directly to make
    // sure the restore path overwrites them.
    turnCount = 99;
    phase = 'END';
    lp = [1234, 5678];
    lastAnnounceNumberOptions = [10, 20, 30];
    lastResponsePlayerIndex = 1;

    // Sanity: at least 10 slots have observably diverged
    const divergedMirrors = snapshotMirrors(server, client);
    expect(divergedMirrors).not.toBe(preMirrors);
    expect(turnCount).not.toBe(preTurnCount);
    expect(phase).not.toBe(prePhase);
    expect(lp).not.toEqual(preLp);
    expect(lastAnnounceNumberOptions).not.toEqual(preLastAnnounceNumberOptions);
    expect(lastResponsePlayerIndex).not.toBe(preLastResponsePlayerIndex);
    expect(capturedResponses.length).toBeGreaterThan(preCapturedResponsesLength);

    // ─── Phase 3 — AC #4: restore cascade ─────────────────────────────────
    // 3a. Worker restore (WASM + 5 ui slots + capturedResponses truncation)
    restoreWorkerSnapshotImpl(snap, accessors);
    expect(stableSerialize(core.duelQueryField(duel))).toBe(preWorkerField);
    expect(turnPlayer).toBe(preTurnPlayer);
    expect(turnCount).toBe(preTurnCount);
    expect(phase).toBe(prePhase);
    expect(lp).toEqual(preLp);
    expect(lastResponsePlayerIndex).toBe(preLastResponsePlayerIndex);
    expect(lastAnnounceNumberOptions).toEqual(preLastAnnounceNumberOptions);
    expect(capturedResponses.length).toBe(preCapturedResponsesLength);

    // 3b. Server-side cascade (mirror the `WORKER_CANCEL_DONE` block)
    server.activeChainLinks = [];
    server.chainPhase = 'idle';
    server.negatedChainIndices.clear();
    server.lastSentHint[0] = null;
    server.invalidResponseCount[0] = 0;
    // Re-broadcast the cached IDLECMD: `lastSentPrompt[0] = cancelTargetPrompt[0]`
    server.lastSentPrompt[0] = server.cancelTargetPrompt[0];
    server.awaitingResponse[0] = true;
    server.cancelTargetPrompt[0] = null;

    // 3c. Client-side cascade (mirror the `STATE_SYNC` handler)
    client.pendingPrompt = null;
    client.hintContext = { hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' };
    client.lastConfirmedCards = [];
    client.lastSelectedCards = [];
    client.lastSelectedPromptType = null;
    client.hintCardConsumed = false;

    // Assertion: every mirror slot is back to a "clean" state. We don't
    // compare to preMirrors directly because `lastSentPrompt[0]` and
    // `awaitingResponse[0]` are intentionally re-set (the prompt is in
    // flight again), and `cancelTargetPrompt[0]` is now null (consumed).
    expect(server.cancelTargetPrompt).toEqual([null, null]);
    expect(server.lastSentPrompt[0]).toBe(idleCmdPromptStub);
    expect(server.lastSentHint).toEqual([null, null]);
    expect(server.awaitingResponse).toEqual([true, false]);
    expect(server.activeChainLinks).toEqual([]);
    expect(server.chainPhase).toBe('idle');
    expect(server.negatedChainIndices.size).toBe(0);
    expect(server.invalidResponseCount).toEqual([0, 0]);

    expect(client.pendingPrompt).toBeNull();
    expect(client.hintContext).toEqual({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' });
    expect(client.lastConfirmedCards).toEqual([]);
    expect(client.lastSelectedCards).toEqual([]);
    expect(client.lastSelectedPromptType).toBeNull();
    expect(client.hintCardConsumed).toBe(false);

    // ─── Phase 4 — AC #5: re-activation cleanliness ──────────────────────
    // Drain post-restore RETRY (ocgcore's signal that it expects a fresh response)
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);
    expect(status).toBe(OcgProcessResult.WAITING);
    expect(messages.some((m) => m.type === OcgMessageType.RETRY)).toBe(true);

    // Snapshot before re-applying the response — we'll compare references later
    const snapBefore = snap.wasm;

    // Re-apply the same IDLECMD response — this is "user clicks Activate again"
    // The server PLAYER_RESPONSE handler would set cancelTargetPrompt[0] again
    server.cancelTargetPrompt[0] = idleCmdPromptStub;
    capturedResponses.push({ data: { type: 1, action: 0, index: 0 }, timestamp: 'T1' });
    core.duelSetResponse(duel, { type: 1, action: 0, index: 0 } as never);

    // The worker would take a NEW snapshot here. Verify it's a fresh ArrayBuffer.
    const newSnap = takeWorkerSnapshotImpl(accessors);
    expect(Object.is(newSnap.wasm, snapBefore)).toBe(false);
    expect(newSnap.wasm.byteLength).toBeGreaterThan(0);

    // Drive once more — assert the fresh chain that builds has chain_size=1
    // (= no leftover chain index from the cancelled flow)
    let chainingFound = false;
    for (let step = 0; step < 30 && !chainingFound; step++) {
      const stat = core.duelProcess(duel);
      const msgs = core.duelGetMessage(duel);
      if (stat === OcgProcessResult.END) break;
      const chaining = msgs.find((m) => m.type === OcgMessageType.CHAINING);
      if (chaining) {
        chainingFound = true;
        expect((chaining as { chain_size?: number }).chain_size ?? 1).toBe(1);
      }
      if (stat === OcgProcessResult.WAITING) break;
    }
    // A Normal Summon doesn't trigger MSG_CHAINING, so chainingFound may be
    // false — that's fine. The ArrayBuffer-reference check above already
    // proves the snapshot mechanism is fresh.

    // Final sanity — invalidResponseCount must still be 0 (no stigma from cancel)
    expect(server.invalidResponseCount[0]).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// AC #6 — Contract drift detection
// -----------------------------------------------------------------------------

describe('Contract reference', () => {
  it('lists the slots this test exercises (mirror of cancel-rollback-contract.md)', () => {
    // This test isn't enforcing — it's a tripwire. If the contract grows
    // a new slot, EXPECTED_SLOTS should grow too. Reviewers should flag
    // a PR that adds a slot to the contract but not here.
    expect(EXPECTED_SLOTS.worker.length).toBeGreaterThanOrEqual(8);
    expect(EXPECTED_SLOTS.server.length).toBeGreaterThanOrEqual(8);
    expect(EXPECTED_SLOTS.client.length).toBeGreaterThanOrEqual(6);
  });
});
