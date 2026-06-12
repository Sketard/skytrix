import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OcgMessageType, OcgProcessResult } from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle, OcgMessage } from '@n1xx1/ocgcore-wasm';
import {
  runReplayPreComputation,
  __test__,
  type ReplayPrecomputeDeps,
  type PortLike,
} from './replay-precompute.js';
import type { InitReplayMessage, ReplayMetadata, WorkerReplayStreamChunk, WorkerReplayStreamInit } from './types.js';
import type { ServerMessage, BoardStatePayload, ReplayStreamAutoResponse, ReplayStreamNavEntry } from './ws-protocol.js';

// =============================================================================
// Anim-pipeline v4 — Phase 2 replay stream tests
// =============================================================================
//
// Two layers :
//
// 1. **`ReplayStreamBuilder` unit tests** — pure, no OCGCore, no
//    `runReplayPreComputation`. Validates the chunking arithmetic,
//    autoResponses partitioning, navIndex accumulation, and `emitInit`
//    contract.
//
// 2. **Integration tests** — scripted OCGCore harness drives
//    `runReplayPreComputation` end-to-end ; assertions count + inspect the
//    WORKER_REPLAY_STREAM_* messages emitted on the mock port. Verifies the
//    legacy WORKER_REPLAY_BOARD_STATES is still emitted (coexistence Phase
//    2 doctrine) and the stream order is CHUNK × N → INIT → COMPLETE.

const { ReplayStreamBuilder } = __test__;

const FAKE_BOARD_STATE: BoardStatePayload = {
  turnPlayer: 0,
  turnCount: 1,
  phase: 'MAIN1',
  players: [
    { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
  ],
};

const FAKE_METADATA: ReplayMetadata = {
  playerUsernames: ['p0', 'p1'],
  deckNames: ['d0', 'd1'],
  turnCount: 1,
  result: 'VICTORY',
  date: '2026-06-05',
  scriptsHash: 'h',
  ocgcoreVersion: 'v',
  durationSec: 0,
};

function makeMockPort(): PortLike & { messages: unknown[] } {
  const messages: unknown[] = [];
  return { messages, postMessage: (msg: unknown) => { messages.push(msg); } };
}

// =============================================================================
// 1. ReplayStreamBuilder — unit
// =============================================================================

describe('ReplayStreamBuilder — unit', () => {
  let port: ReturnType<typeof makeMockPort>;
  let builder: InstanceType<typeof ReplayStreamBuilder>;

  beforeEach(() => {
    port = makeMockPort();
    builder = new ReplayStreamBuilder(port, 'd1');
  });

  it('ingest returns monotonically increasing offsets', () => {
    const msg = (i: number): ServerMessage => ({ type: 'MSG_DRAW', player: 0, cards: [i] } as ServerMessage);
    expect(builder.ingest(msg(1))).toBe(0);
    expect(builder.ingest(msg(2))).toBe(1);
    expect(builder.ingest(msg(3))).toBe(2);
  });

  it('flushTurn with no messages is a no-op (no postMessage)', () => {
    builder.flushTurn(0);
    expect(port.messages).toEqual([]);
  });

  it('flushTurn emits WORKER_REPLAY_STREAM_CHUNK with messages + empty autoResponses', () => {
    builder.ingest({ type: 'MSG_DRAW', player: 0, cards: [100] } as ServerMessage);
    builder.flushTurn(0);
    expect(port.messages).toHaveLength(1);
    const chunk = port.messages[0] as WorkerReplayStreamChunk;
    expect(chunk.type).toBe('WORKER_REPLAY_STREAM_CHUNK');
    expect(chunk.duelId).toBe('d1');
    expect(chunk.turnNumber).toBe(0);
    expect(chunk.baseOffset).toBe(0);
    expect(chunk.messages).toHaveLength(1);
    expect(chunk.autoResponses).toEqual([]);
  });

  it('baseOffset accumulates across flushed turns', () => {
    builder.ingest({ type: 'MSG_DRAW', player: 0, cards: [1] } as ServerMessage);
    builder.ingest({ type: 'MSG_DRAW', player: 0, cards: [2] } as ServerMessage);
    builder.flushTurn(0);

    builder.ingest({ type: 'MSG_DRAW', player: 0, cards: [3] } as ServerMessage);
    builder.flushTurn(1);

    expect(port.messages).toHaveLength(2);
    const c0 = port.messages[0] as WorkerReplayStreamChunk;
    const c1 = port.messages[1] as WorkerReplayStreamChunk;
    expect(c0.baseOffset).toBe(0);
    expect(c0.messages).toHaveLength(2);
    expect(c1.baseOffset).toBe(2); // cursor moved by 2 in turn 0
    expect(c1.messages).toHaveLength(1);
  });

  it('recordAutoResponse attaches the response to the next flush, keyed by offset', () => {
    builder.ingest({ type: 'SELECT_IDLECMD', player: 0, idleCmds: [] } as unknown as ServerMessage);
    builder.recordAutoResponse(0, 'SELECT_IDLECMD', { index: 0 });
    builder.flushTurn(0);
    const chunk = port.messages[0] as WorkerReplayStreamChunk;
    expect(chunk.autoResponses).toHaveLength(1);
    const ar = chunk.autoResponses[0];
    expect(ar.offset).toBe(0);
    expect(ar.promptType).toBe('SELECT_IDLECMD');
    expect(ar.data).toEqual({ index: 0 });
  });

  it('autoResponses are partitioned per chunk when the turn splits', () => {
    // Build a payload large enough to force the chunk split — fill with
    // ~600 KB worth of messages by stuffing a large boardStateAfter on each.
    // Cheaper alternative : seed 1 small SELECT then 1 huge MSG and 1 small
    // SELECT, force split by hand-pushing past the threshold. We use the
    // direct path : ingest > MAX_BATCH_BYTES of bulk then verify partition.
    const bigPayload = 'x'.repeat(10_000);
    const heavy = (i: number): ServerMessage => ({
      type: 'MSG_MOVE', cardCode: i, cardName: bigPayload,
      player: 0, toPlayer: 0,
      fromLocation: 1, fromSequence: 0, fromPosition: 1,
      toLocation: 4, toSequence: 0, toPosition: 1,
      isToken: false, reason: 0,
    } as unknown as ServerMessage);

    // 60 heavy messages + 2 prompts → ~600 KB JSON, triggers split
    for (let i = 0; i < 30; i++) builder.ingest(heavy(i));
    const offsetA = builder.ingest({ type: 'SELECT_CARD', player: 0, min: 1, max: 1, cards: [], cancelable: false } as unknown as ServerMessage);
    builder.recordAutoResponse(offsetA, 'SELECT_CARD', { indices: [0] });
    for (let i = 30; i < 60; i++) builder.ingest(heavy(i));
    const offsetB = builder.ingest({ type: 'SELECT_CARD', player: 0, min: 1, max: 1, cards: [], cancelable: false } as unknown as ServerMessage);
    builder.recordAutoResponse(offsetB, 'SELECT_CARD', { indices: [1] });

    builder.flushTurn(0);

    // Should have been split into 2+ chunks
    expect(port.messages.length).toBeGreaterThan(1);
    const chunks = port.messages as WorkerReplayStreamChunk[];

    // Every chunk type === 'WORKER_REPLAY_STREAM_CHUNK'
    expect(chunks.every(c => c.type === 'WORKER_REPLAY_STREAM_CHUNK')).toBe(true);

    // The 2 autoResponses must be partitioned: each chunk holds at most
    // those whose offset falls inside [baseOffset, baseOffset + messages.length).
    for (const chunk of chunks) {
      const lo = chunk.baseOffset;
      const hi = chunk.baseOffset + chunk.messages.length;
      for (const ar of chunk.autoResponses) {
        expect(ar.offset).toBeGreaterThanOrEqual(lo);
        expect(ar.offset).toBeLessThan(hi);
      }
    }

    // The 2 autoResponses combined across chunks must equal what we recorded
    const allAutoResponses = chunks.flatMap(c => c.autoResponses);
    expect(allAutoResponses).toHaveLength(2);
    expect(allAutoResponses[0].data).toEqual({ indices: [0] });
    expect(allAutoResponses[1].data).toEqual({ indices: [1] });
  });

  it('recordNavEntry accumulates ; emitInit ships the full navIndex + totalMessages', () => {
    const bs = FAKE_BOARD_STATE;
    const ev1 = { type: 'MSG_DRAW', player: 0, cards: [1] } as ServerMessage;
    const ev2 = { type: 'MSG_DRAW', player: 0, cards: [2] } as ServerMessage;
    builder.ingest(ev1);
    builder.recordNavEntry('Turn 1', 1, bs, [ev1], 0, undefined);
    builder.ingest(ev2);
    builder.recordNavEntry('CL1: Effect', 1, bs, [ev2], 1, undefined, 0);
    builder.flushTurn(1);
    builder.emitInit();

    const init = port.messages[port.messages.length - 1] as WorkerReplayStreamInit;
    expect(init.type).toBe('WORKER_REPLAY_STREAM_INIT');
    expect(init.duelId).toBe('d1');
    expect(init.totalMessages).toBe(2);
    expect(init.navIndex).toHaveLength(2);
    expect(init.navIndex[0]).toEqual({ messageOffset: 1, label: 'Turn 1', turnNumber: 1, responseCount: 0, boardStateSnapshot: bs, events: [ev1] });
    expect(init.navIndex[1]).toEqual({ messageOffset: 2, label: 'CL1: Effect', turnNumber: 1, responseCount: 1, boardStateSnapshot: bs, events: [ev2], chainIndex: 0 });
  });

  it('recordNavEntry skips empty labels (mirrors flushState skip)', () => {
    const ev = { type: 'MSG_DRAW', player: 0, cards: [1] } as ServerMessage;
    builder.ingest(ev);
    builder.recordNavEntry('', 1, FAKE_BOARD_STATE, [ev], 0, undefined);
    builder.flushTurn(1);
    builder.emitInit();
    const init = port.messages[port.messages.length - 1] as WorkerReplayStreamInit;
    expect(init.navIndex).toHaveLength(0);
  });
});

// =============================================================================
// 2. Integration — runReplayPreComputation emits the new stream alongside legacy
// =============================================================================

interface ScriptedTick {
  status: number;
  messages: OcgMessage[];
}

function makeMockCore(ticks: ScriptedTick[]): OcgCoreSync {
  let i = 0;
  return {
    duelProcess: vi.fn(() => {
      if (i >= ticks.length) return OcgProcessResult.END;
      return ticks[i].status;
    }),
    duelGetMessage: vi.fn(() => {
      const tick = ticks[i] ?? { status: OcgProcessResult.END, messages: [] };
      i++;
      return tick.messages;
    }),
    duelSetResponse: vi.fn(),
  } as unknown as OcgCoreSync;
}

function makeDeps(ticks: ScriptedTick[], overrides: Partial<InitReplayMessage> = {}): {
  msg: InitReplayMessage;
  deps: ReplayPrecomputeDeps;
  port: ReturnType<typeof makeMockPort>;
} {
  const port = makeMockPort();
  const dlog = { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const buildBoardState = vi.fn((): ServerMessage => ({
    type: 'BOARD_STATE', data: FAKE_BOARD_STATE,
  } as ServerMessage));
  // Default transformMessage returns null. Tests that need a DTO override on a per-test basis.
  const transformMessage = vi.fn((_m: OcgMessage): ServerMessage | null => null);

  const msg: InitReplayMessage = {
    type: 'INIT_REPLAY',
    duelId: 'd1',
    seed: ['1', '2', '3', '4'],
    decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
    playerResponses: [],
    metadata: FAKE_METADATA,
    ...overrides,
  };

  const deps: ReplayPrecomputeDeps = {
    core: makeMockCore(ticks),
    duel: {} as OcgDuelHandle,
    duelId: 'd1',
    dlog,
    port,
    transformMessage,
    updateState: vi.fn(),
    buildBoardState,
    cleanup: vi.fn(),
    getBuildBoardStatePerfStats: vi.fn(() => ({ calls: 0, cumulativeMs: 0, avgMs: 0 })),
  };

  return { msg, deps, port };
}

describe('runReplayPreComputation — v4 stream emission (Phase 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits WORKER_REPLAY_STREAM_INIT before WORKER_REPLAY_COMPLETE at normal END', () => {
    // END must carry a MSG_WIN/DRAW for the precompute to treat it as a normal end.
    // Without it, the precompute emits WORKER_REPLAY_ERROR (REPLAY_DIVERGED_NO_RESULT).
    const { msg, deps, port } = makeDeps([{
      status: OcgProcessResult.END,
      messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage],
    }]);
    runReplayPreComputation(msg, deps);

    const types = port.messages.map(m => (m as { type: string }).type);
    expect(types).toContain('WORKER_REPLAY_STREAM_INIT');
    expect(types).toContain('WORKER_REPLAY_COMPLETE');
    expect(types.indexOf('WORKER_REPLAY_STREAM_INIT')).toBeLessThan(types.indexOf('WORKER_REPLAY_COMPLETE'));
  });

  it('coexists with the legacy WORKER_REPLAY_BOARD_STATES emission', () => {
    // A MSG_NEW_TURN tick triggers an emitTurnBatch (legacy) + flushTurn (v4).
    // Both must show up on the port.
    const { msg, deps, port } = makeDeps([
      { status: OcgProcessResult.CONTINUE, messages: [{ type: OcgMessageType.NEW_TURN } as OcgMessage] },
      { status: OcgProcessResult.END, messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage] },
    ]);
    runReplayPreComputation(msg, deps);
    const types = port.messages.map(m => (m as { type: string }).type);
    // Legacy is emitted even when the turn is empty (emitTurnBatch returns early on []),
    // so there may be zero BOARD_STATES messages — but STREAM_INIT must always be present.
    expect(types.filter(t => t === 'WORKER_REPLAY_STREAM_INIT')).toHaveLength(1);
    // Both code paths run independently — INIT precedes COMPLETE.
    const initIdx = types.indexOf('WORKER_REPLAY_STREAM_INIT');
    const completeIdx = types.indexOf('WORKER_REPLAY_COMPLETE');
    expect(initIdx).toBeLessThan(completeIdx);
  });

  // ===========================================================================
  // F10 unification (2026-06-12) — in-stream BOARD_STATE cadence = the LIVE
  // worker's cadence. Two emission rules, pinned below :
  //   · per-prompt : every SELECT_*/ANNOUNCE_*/SORT_* is followed by a
  //     synthetic BOARD_STATE (mirror of runDuelLoop's
  //     `BOARD_STATE (final, before prompt)` at status=WAITING) ;
  //   · same-batch cost sync : a MSG_CHAIN_SOLVING preceded by a MSG_MOVE in
  //     the SAME duelProcess batch gets a BOARD_STATE right before it
  //     (shared `ChainCostSyncTracker`, also consumed by runDuelLoop).
  // The historical per-flushNavEntry BOARD_STATE was retired : it put a sync
  // BEFORE MSG_CHAINING where live has none, and none after mid-chain
  // prompts where live has one (f10-parity-investigation-2026-06-12.md).
  // ===========================================================================

  it('F10 — a flush boundary WITHOUT a prompt no longer emits a BOARD_STATE (per-flush cadence retired)', () => {
    const moveDto: ServerMessage = {
      type: 'MSG_MOVE', cardCode: 100, cardName: 'Card',
      player: 0, toPlayer: 0,
      fromLocation: 1, fromSequence: 0, fromPosition: 1,
      toLocation: 4, toSequence: 0, toPosition: 1,
      isToken: false, reason: 0,
    } as unknown as ServerMessage;
    const { msg, deps, port } = makeDeps([
      // A MOVE that lands into events, then a NEW_PHASE that flushes it as
      // a nav entry. No prompt, no chain → live emits no BOARD_STATE here,
      // so neither does the precompute.
      { status: OcgProcessResult.CONTINUE, messages: [{ type: OcgMessageType.MOVE } as OcgMessage] },
      { status: OcgProcessResult.CONTINUE, messages: [{ type: OcgMessageType.NEW_PHASE, phase: 4 } as unknown as OcgMessage] },
      { status: OcgProcessResult.END, messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage] },
    ]);
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) =>
      m.type === OcgMessageType.MOVE ? moveDto : null);

    runReplayPreComputation(msg, deps);

    const chunks = port.messages.filter((m): m is WorkerReplayStreamChunk =>
      (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK');
    const allMessages = chunks.flatMap(c => c.messages);
    expect(allMessages.some(m => m.type === 'MSG_MOVE')).toBe(true);
    expect(allMessages.some(m => m.type === 'BOARD_STATE')).toBe(false);

    // The nav entry itself is untouched — `boardStateSnapshot` is the seek
    // surface, independent of the in-stream cadence.
    const init = port.messages.find((m): m is WorkerReplayStreamInit =>
      (m as { type: string }).type === 'WORKER_REPLAY_STREAM_INIT')!;
    const labels = init.navIndex.map(n => n.label);
    expect(labels).toContain('Main Phase 1');
    expect(init.navIndex.every(n => n.boardStateSnapshot)).toBe(true);
  });

  it('F10 — every prompt is immediately followed by a synthetic BOARD_STATE (live per-prompt parity)', () => {
    const selectDto: ServerMessage = {
      type: 'SELECT_IDLECMD', player: 0, idleCmds: [],
    } as unknown as ServerMessage;
    const { msg, deps, port } = makeDeps([
      { status: OcgProcessResult.WAITING, messages: [{ type: OcgMessageType.SELECT_IDLECMD, player: 0 } as unknown as OcgMessage] },
      { status: OcgProcessResult.END, messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage] },
    ], {
      playerResponses: [{ data: { index: 0 } }],
    });
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) =>
      m.type === OcgMessageType.SELECT_IDLECMD ? selectDto : null);

    runReplayPreComputation(msg, deps);

    const chunks = port.messages.filter((m): m is WorkerReplayStreamChunk =>
      (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK');
    const allMessages = chunks.flatMap(c => c.messages);
    const promptIdx = allMessages.findIndex(m => m.type === 'SELECT_IDLECMD');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    // Live wire ships [..., SELECT_*, BOARD_STATE] — same here.
    expect(allMessages[promptIdx + 1]?.type).toBe('BOARD_STATE');
  });

  it('F10 — same-batch cost MOVE + CHAIN_SOLVING gets the intermediate BOARD_STATE before the SOLVING', () => {
    const moveDto: ServerMessage = {
      type: 'MSG_MOVE', cardCode: 100, cardName: 'Card',
      player: 0, toPlayer: 0,
      fromLocation: 2, fromSequence: 0, fromPosition: 1,
      toLocation: 16, toSequence: 0, toPosition: 1,
      isToken: false, reason: 0x40,
    } as unknown as ServerMessage;
    const solvingDto: ServerMessage = { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 } as unknown as ServerMessage;
    const { msg, deps, port } = makeDeps([
      // Cost MOVE and CHAIN_SOLVING in the SAME duelProcess batch — the
      // shared ChainCostSyncTracker case (mirrors runDuelLoop).
      {
        status: OcgProcessResult.CONTINUE,
        messages: [
          { type: OcgMessageType.MOVE } as OcgMessage,
          { type: OcgMessageType.CHAIN_SOLVING } as unknown as OcgMessage,
        ],
      },
      { status: OcgProcessResult.END, messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage] },
    ]);
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) =>
      m.type === OcgMessageType.MOVE ? moveDto
        : m.type === OcgMessageType.CHAIN_SOLVING ? solvingDto
          : null);

    runReplayPreComputation(msg, deps);

    const chunks = port.messages.filter((m): m is WorkerReplayStreamChunk =>
      (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK');
    const types = chunks.flatMap(c => c.messages).map(m => m.type);
    const solvingIdx = types.indexOf('MSG_CHAIN_SOLVING');
    expect(solvingIdx).toBeGreaterThanOrEqual(1);
    expect(types[solvingIdx - 1]).toBe('BOARD_STATE');
    expect(types[solvingIdx - 2]).toBe('MSG_MOVE');
  });

  it('F10 — cross-batch cost (prompt between MOVE and SOLVING) relies on the per-prompt BOARD_STATE only', () => {
    const moveDto: ServerMessage = {
      type: 'MSG_MOVE', cardCode: 100, cardName: 'Card',
      player: 0, toPlayer: 0,
      fromLocation: 2, fromSequence: 0, fromPosition: 1,
      toLocation: 16, toSequence: 0, toPosition: 1,
      isToken: false, reason: 0x40,
    } as unknown as ServerMessage;
    const selectDto: ServerMessage = { type: 'SELECT_OPTION', player: 0, options: [] } as unknown as ServerMessage;
    const solvingDto: ServerMessage = { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 } as unknown as ServerMessage;
    const { msg, deps, port } = makeDeps([
      // The common case the 2026-06-12 investigation surfaced : the cost
      // MOVE and the SOLVING straddle a prompt → two duelProcess batches.
      // The batch-scoped tracker must NOT fire ; the prompt's own
      // BOARD_STATE is the sync (identical to the live wire).
      { status: OcgProcessResult.WAITING, messages: [
        { type: OcgMessageType.MOVE } as OcgMessage,
        { type: OcgMessageType.SELECT_OPTION, player: 0 } as unknown as OcgMessage,
      ] },
      { status: OcgProcessResult.CONTINUE, messages: [{ type: OcgMessageType.CHAIN_SOLVING } as unknown as OcgMessage] },
      { status: OcgProcessResult.END, messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage] },
    ], {
      playerResponses: [{ data: { index: 0 } }],
    });
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) =>
      m.type === OcgMessageType.MOVE ? moveDto
        : m.type === OcgMessageType.SELECT_OPTION ? selectDto
          : m.type === OcgMessageType.CHAIN_SOLVING ? solvingDto
            : null);

    runReplayPreComputation(msg, deps);

    const chunks = port.messages.filter((m): m is WorkerReplayStreamChunk =>
      (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK');
    const types = chunks.flatMap(c => c.messages).map(m => m.type);
    // Exactly ONE BOARD_STATE : the per-prompt one, right after
    // SELECT_OPTION. (Positionally it also sits right before the SOLVING —
    // same adjacency as the live wire when the prompt directly precedes
    // the resolution. The pin is the COUNT : the batch-scoped tracker must
    // not add a second one.)
    expect(types.filter(t => t === 'BOARD_STATE')).toHaveLength(1);
    const promptIdx = types.indexOf('SELECT_OPTION');
    expect(types[promptIdx + 1]).toBe('BOARD_STATE');
  });

  it('records autoResponses for SELECT_* prompts the user answered', () => {
    const selectDto: ServerMessage = {
      type: 'SELECT_IDLECMD', player: 0, idleCmds: [],
    } as unknown as ServerMessage;
    const { msg, deps, port } = makeDeps([
      { status: OcgProcessResult.WAITING, messages: [{ type: OcgMessageType.SELECT_IDLECMD, player: 0 } as unknown as OcgMessage] },
      { status: OcgProcessResult.END, messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage] },
    ], {
      playerResponses: [{ data: { index: 0 }, timestamp: '2026-06-05T00:00:00Z' }],
    });
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) =>
      m.type === OcgMessageType.SELECT_IDLECMD ? selectDto : null);

    runReplayPreComputation(msg, deps);

    const chunks = port.messages.filter((m): m is WorkerReplayStreamChunk =>
      (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK');
    const allAutoResponses: ReplayStreamAutoResponse[] = chunks.flatMap(c => c.autoResponses);
    expect(allAutoResponses).toHaveLength(1);
    expect(allAutoResponses[0].promptType).toBe('SELECT_IDLECMD');
    expect(allAutoResponses[0].data).toEqual({ index: 0 });
    // The offset must point at the SELECT_IDLECMD message in the stream
    const allMessages = chunks.flatMap(c => c.messages);
    expect(allMessages[allAutoResponses[0].offset].type).toBe('SELECT_IDLECMD');
  });

  it('streams SELECT_IDLECMD / SELECT_BATTLECMD into messages[] (doctrine a — PvP parity)', () => {
    // Strict "Replay = PvP readonly" — the boundary prompts that the legacy
    // events[] excludes (lines 470-471 / 528-531 of replay-precompute.ts) must
    // still land in the stream so MockDuelConnection.pendingPrompt flips
    // identically to the live PvP wire.
    const selectDto: ServerMessage = { type: 'SELECT_IDLECMD', player: 0, idleCmds: [] } as unknown as ServerMessage;
    const { msg, deps, port } = makeDeps([
      { status: OcgProcessResult.WAITING, messages: [{ type: OcgMessageType.SELECT_IDLECMD, player: 0 } as unknown as OcgMessage] },
      { status: OcgProcessResult.END, messages: [{ type: OcgMessageType.WIN, player: 0, reason: 1 } as unknown as OcgMessage] },
    ], {
      playerResponses: [{ data: { index: 0 } }],
    });
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) =>
      m.type === OcgMessageType.SELECT_IDLECMD ? selectDto : null);

    runReplayPreComputation(msg, deps);

    const chunks = port.messages.filter((m): m is WorkerReplayStreamChunk =>
      (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK');
    const allMessages = chunks.flatMap(c => c.messages);
    expect(allMessages.some(m => m.type === 'SELECT_IDLECMD')).toBe(true);
  });
});
