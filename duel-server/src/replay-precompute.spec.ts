import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OcgMessageType, OcgProcessResult } from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle, OcgMessage } from '@n1xx1/ocgcore-wasm';
import {
  runReplayPreComputation,
  SELECT_MESSAGE_TYPES,
  __test__,
  type ReplayPrecomputeDeps,
  type PortLike,
} from './replay-precompute.js';
import type { InitReplayMessage, ReplayMetadata } from './types.js';
import type { ServerMessage, BoardStatePayload } from './ws-protocol.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  date: '2026-05-10',
  scriptsHash: 'h',
  ocgcoreVersion: 'v',
  durationSec: 0,
};

interface ScriptedTick {
  /** Status returned by duelProcess for this tick. */
  status: number;
  /** Messages returned by duelGetMessage for this tick. */
  messages: OcgMessage[];
}

function makeMockCore(ticks: ScriptedTick[]): OcgCoreSync {
  let i = 0;
  const setResponseCalls: unknown[] = [];
  const core = {
    duelProcess: vi.fn(() => {
      if (i >= ticks.length) {
        // Default to END so an unscripted spec doesn't infinite-loop the SUT.
        return OcgProcessResult.END;
      }
      return ticks[i].status;
    }),
    duelGetMessage: vi.fn(() => {
      const tick = ticks[i] ?? { status: OcgProcessResult.END, messages: [] };
      i++;
      return tick.messages;
    }),
    duelSetResponse: vi.fn((_duel: OcgDuelHandle, data: unknown) => {
      setResponseCalls.push(data);
    }),
  } as unknown as OcgCoreSync;
  // Expose for assertions
  (core as unknown as { __setResponseCalls: unknown[] }).__setResponseCalls = setResponseCalls;
  return core;
}

function makeMockPort(): PortLike & { messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    messages,
    postMessage: (msg: unknown) => { messages.push(msg); },
  };
}

function makeDeps(
  ticks: ScriptedTick[],
  msgOverrides: Partial<InitReplayMessage> = {},
  depOverrides: Partial<ReplayPrecomputeDeps> = {},
): { msg: InitReplayMessage; deps: ReplayPrecomputeDeps; port: ReturnType<typeof makeMockPort>; cleanup: ReturnType<typeof vi.fn> } {
  const port = makeMockPort();
  const cleanup = vi.fn();
  const dlog = {
    debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  const buildBoardState = vi.fn((): ServerMessage => ({ type: 'BOARD_STATE', data: FAKE_BOARD_STATE } as ServerMessage));
  // Default `transformMessage` returns null (no DTO) — tests that need a DTO override.
  const transformMessage = vi.fn((_m: OcgMessage): ServerMessage | null => null);
  const updateState = vi.fn();
  const getBuildBoardStatePerfStats = vi.fn(() => ({ calls: 0, cumulativeMs: 0, avgMs: 0 }));

  const msg: InitReplayMessage = {
    type: 'INIT_REPLAY',
    duelId: 'd1',
    seed: ['1', '2', '3', '4'],
    decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
    playerResponses: [],
    metadata: FAKE_METADATA,
    ...msgOverrides,
  };

  const deps: ReplayPrecomputeDeps = {
    core: makeMockCore(ticks),
    duel: {} as OcgDuelHandle,
    duelId: 'd1',
    dlog,
    port,
    transformMessage,
    updateState,
    buildBoardState,
    cleanup,
    getBuildBoardStatePerfStats,
    ...depOverrides,
  };

  return { msg, deps, port, cleanup };
}

/** Minimal OCG message factory — caller sets the specific fields each test needs. */
function ocg(type: OcgMessageType, extra: Record<string, unknown> = {}): OcgMessage {
  return { type, ...extra } as unknown as OcgMessage;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('runReplayPreComputation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Happy path: completion ───────────────────────────────────────────────

  it('emits WORKER_REPLAY_COMPLETE after END with WIN', () => {
    const { msg, deps, port, cleanup } = makeDeps([
      { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
    ]);
    runReplayPreComputation(msg, deps);
    expect(port.messages).toContainEqual({ type: 'WORKER_REPLAY_COMPLETE', duelId: 'd1' });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('END with DRAW also counts as graceful completion', () => {
    const { msg, deps, port } = makeDeps([
      { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.DRAW)] },
    ]);
    runReplayPreComputation(msg, deps);
    expect(port.messages).toContainEqual({ type: 'WORKER_REPLAY_COMPLETE', duelId: 'd1' });
  });

  it('END without WIN/DRAW emits REPLAY_DIVERGED_NO_RESULT', () => {
    const { msg, deps, port, cleanup } = makeDeps([
      { status: OcgProcessResult.END, messages: [] },
    ]);
    runReplayPreComputation(msg, deps);
    const errors = port.messages.filter((m) => (m as { type: string }).type === 'WORKER_REPLAY_ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'REPLAY_DIVERGED_NO_RESULT' });
    expect(cleanup).toHaveBeenCalled();
  });

  // ─── Divergence detection ─────────────────────────────────────────────────

  it('MSG_RETRY mid-stream emits REPLAY_DIVERGED_RETRY + cleanup', () => {
    const { msg, deps, port, cleanup } = makeDeps([
      { status: OcgProcessResult.CONTINUE, messages: [ocg(OcgMessageType.RETRY)] },
    ]);
    runReplayPreComputation(msg, deps);
    expect(port.messages.some((m) => (m as { code?: string }).code === 'REPLAY_DIVERGED_RETRY')).toBe(true);
    expect(cleanup).toHaveBeenCalled();
  });

  it('duelProcess throw is caught and emits REPLAY_COMPUTATION_ERROR', () => {
    const { msg, deps, port, cleanup } = makeDeps([]);
    (deps.core.duelProcess as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('boom'); });
    runReplayPreComputation(msg, deps);
    const err = port.messages.find((m) => (m as { type: string }).type === 'WORKER_REPLAY_ERROR');
    expect(err).toMatchObject({ code: 'REPLAY_COMPUTATION_ERROR', message: 'Pre-computation error: boom' });
    expect(cleanup).toHaveBeenCalled();
  });

  it('WAITING after first response without SELECT_* emits REPLAY_DIVERGED_UNEXPECTED', () => {
    // First tick: feed one response so responseIndex > 0
    // Second tick: WAITING with no select message
    const { msg, deps, port } = makeDeps([
      {
        status: OcgProcessResult.CONTINUE,
        messages: [ocg(OcgMessageType.SELECT_IDLECMD, { player: 0 })],
      },
      { status: OcgProcessResult.WAITING, messages: [] }, // no select → divergence
    ], {
      playerResponses: [{ data: { type: 1, action: 7 }, timestamp: '0' }],
    });
    runReplayPreComputation(msg, deps);
    expect(port.messages.some((m) => (m as { code?: string }).code === 'REPLAY_DIVERGED_UNEXPECTED')).toBe(true);
  });

  it('respects custom maxIterations override (test-only dep)', () => {
    // Always CONTINUE with no messages → loop forever unless guard fires.
    const ticks: ScriptedTick[] = Array.from({ length: 100 }, () => ({
      status: OcgProcessResult.CONTINUE,
      messages: [],
    }));
    const { msg, deps, port } = makeDeps(ticks, {}, { maxIterations: 5 });
    runReplayPreComputation(msg, deps);
    const err = port.messages.find((m) => (m as { type: string }).type === 'WORKER_REPLAY_ERROR');
    expect(err).toMatchObject({ code: 'REPLAY_MAX_ITERATIONS' });
  });

  // ─── Turn batching ────────────────────────────────────────────────────────

  it('emits WORKER_REPLAY_BOARD_STATES with turnNumber=0 for Setup before first NEW_TURN', () => {
    // Push one DTO so the Turn 0 state has a non-empty label
    const { msg, deps, port } = makeDeps([
      {
        status: OcgProcessResult.CONTINUE,
        messages: [
          ocg(OcgMessageType.DRAW, {}),
          ocg(OcgMessageType.NEW_TURN, { player: 0 }),
        ],
      },
      { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
    ]);
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) => {
      if (m.type === OcgMessageType.DRAW) return { type: 'MSG_DRAW', cards: [{ cardCode: 1 }] } as unknown as ServerMessage;
      return null;
    });
    runReplayPreComputation(msg, deps);
    const turn0 = port.messages.find(
      (m) => (m as { type: string }).type === 'WORKER_REPLAY_BOARD_STATES'
        && (m as { turnNumber: number }).turnNumber === 0,
    ) as { states: { label: string }[] } | undefined;
    expect(turn0).toBeDefined();
    expect(turn0!.states.length).toBeGreaterThan(0);
    expect(turn0!.states[0].label).toContain('Draw');
  });

  it('increments currentTurn after each NEW_TURN; emits separate batches', () => {
    const { msg, deps, port } = makeDeps([
      {
        status: OcgProcessResult.CONTINUE,
        messages: [
          ocg(OcgMessageType.DRAW, {}),
          ocg(OcgMessageType.NEW_TURN, { player: 0 }), // flush turn 0
          ocg(OcgMessageType.DRAW, {}),
          ocg(OcgMessageType.NEW_TURN, { player: 1 }), // flush turn 1
        ],
      },
      { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
    ]);
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) => {
      if (m.type === OcgMessageType.DRAW) return { type: 'MSG_DRAW', cards: [{ cardCode: 1 }] } as unknown as ServerMessage;
      return null;
    });
    runReplayPreComputation(msg, deps);
    const batches = port.messages.filter((m) => (m as { type: string }).type === 'WORKER_REPLAY_BOARD_STATES') as { turnNumber: number }[];
    const turnNumbers = batches.map((b) => b.turnNumber);
    expect(turnNumbers).toContain(0);
    expect(turnNumbers).toContain(1);
  });

  // ─── Response feeding ─────────────────────────────────────────────────────

  it('feeds response and increments responseIndex on SELECT prompt', () => {
    const { msg, deps } = makeDeps([
      {
        status: OcgProcessResult.CONTINUE,
        messages: [ocg(OcgMessageType.SELECT_IDLECMD, { player: 0 })],
      },
      { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
    ], {
      playerResponses: [{ data: { type: 1, action: 7 }, timestamp: '100' }],
    });
    runReplayPreComputation(msg, deps);
    expect(deps.core.duelSetResponse).toHaveBeenCalledTimes(1);
    expect(deps.core.duelSetResponse).toHaveBeenCalledWith(deps.duel, { type: 1, action: 7 });
  });

  it('out-of-responses with SURRENDER metadata completes gracefully (no warning escalation)', () => {
    const { msg, deps, port } = makeDeps([
      {
        status: OcgProcessResult.CONTINUE,
        messages: [ocg(OcgMessageType.SELECT_IDLECMD, { player: 0 })],
      },
    ], {
      playerResponses: [], // 0 responses
      metadata: { ...FAKE_METADATA, result: 'SURRENDER' },
    });
    runReplayPreComputation(msg, deps);
    expect(port.messages.some((m) => (m as { type: string }).type === 'WORKER_REPLAY_COMPLETE')).toBe(true);
    // No warn for graceful interrupts
    expect(deps.dlog.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Unexpected end'),
      expect.anything(),
    );
  });

  // ─── Chain handling ──────────────────────────────────────────────────────

  it('flushes chain link on MSG_CHAINING and emits separator on MSG_CHAIN_END', () => {
    const { msg, deps, port } = makeDeps([
      {
        status: OcgProcessResult.CONTINUE,
        messages: [
          ocg(OcgMessageType.CHAINING, {}),
          ocg(OcgMessageType.CHAIN_END, {}),
          ocg(OcgMessageType.NEW_TURN, { player: 0 }),
        ],
      },
      { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
    ]);
    (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) => {
      if (m.type === OcgMessageType.CHAINING) return { type: 'MSG_CHAINING', chainIndex: 0, cardName: 'X' } as unknown as ServerMessage;
      if (m.type === OcgMessageType.CHAIN_END) return { type: 'MSG_CHAIN_END' } as unknown as ServerMessage;
      return null;
    });
    runReplayPreComputation(msg, deps);
    const turn0 = port.messages.find(
      (m) => (m as { type: string }).type === 'WORKER_REPLAY_BOARD_STATES'
        && (m as { turnNumber: number }).turnNumber === 0,
    ) as { states: { label: string; chainIndex?: number }[] } | undefined;
    expect(turn0).toBeDefined();
    // CHAIN_END always becomes its own state with label 'MSG_CHAIN_END' and no chainIndex
    expect(turn0!.states.some((s) => s.label === 'MSG_CHAIN_END' && s.chainIndex == null)).toBe(true);
  });
});

// ─── Pure helpers (label generation + chain finalization) ───────────────────

describe('replay-precompute helpers', () => {
  it('SELECT_MESSAGE_TYPES contains all SELECT_* + ANNOUNCE_* + ROCK_PAPER_SCISSORS', () => {
    expect(SELECT_MESSAGE_TYPES.has(OcgMessageType.SELECT_IDLECMD)).toBe(true);
    expect(SELECT_MESSAGE_TYPES.has(OcgMessageType.SELECT_BATTLECMD)).toBe(true);
    expect(SELECT_MESSAGE_TYPES.has(OcgMessageType.ROCK_PAPER_SCISSORS)).toBe(true);
    expect(SELECT_MESSAGE_TYPES.has(OcgMessageType.ANNOUNCE_NUMBER)).toBe(true);
    // Non-prompt types shouldn't be in
    expect(SELECT_MESSAGE_TYPES.has(OcgMessageType.NEW_PHASE)).toBe(false);
  });

  it('generateLabel returns Activate label for MSG_CHAINING', () => {
    const label = __test__.generateLabel([
      { type: 'MSG_CHAINING', cardName: 'Ash Blossom' } as unknown as ServerMessage,
    ]);
    expect(label).toBe('Activate: Ash Blossom');
  });

  it('generateLabel returns empty string for non-visual events', () => {
    const label = __test__.generateLabel([
      { type: 'WAITING_RESPONSE' } as unknown as ServerMessage,
      { type: 'MSG_CHAIN_SOLVING' } as unknown as ServerMessage,
    ]);
    expect(label).toBe('');
  });

  it('finalizeChainGroups strips chainIndex on single-link chains', () => {
    const states = [
      { label: 'A', chainIndex: 0, boardState: FAKE_BOARD_STATE, events: [], responseCount: 0 },
      { label: 'B', boardState: FAKE_BOARD_STATE, events: [], responseCount: 0 },
    ];
    __test__.finalizeChainGroups(states);
    expect(states[0].chainIndex).toBeUndefined();
    expect(states[0].label).toBe('A');
  });

  it('finalizeChainGroups prefixes CL{n+1} on multi-link chains', () => {
    const states = [
      { label: 'A', chainIndex: 0, boardState: FAKE_BOARD_STATE, events: [], responseCount: 0 },
      { label: 'B', chainIndex: 1, boardState: FAKE_BOARD_STATE, events: [], responseCount: 0 },
    ];
    __test__.finalizeChainGroups(states);
    expect(states[0].label).toBe('CL1: A');
    expect(states[1].label).toBe('CL2: B');
    // chainIndex is preserved on multi-link (not stripped)
    expect(states[0].chainIndex).toBe(0);
  });

  it('emitTurnBatch single-batch path posts one message when under MAX_BATCH_BYTES', () => {
    const port = makeMockPort();
    const states = [
      { label: 'A', boardState: FAKE_BOARD_STATE, events: [], responseCount: 0 },
    ];
    __test__.emitTurnBatch(port, 'd1', 0, states);
    expect(port.messages).toHaveLength(1);
    expect(port.messages[0]).toMatchObject({
      type: 'WORKER_REPLAY_BOARD_STATES',
      duelId: 'd1',
      turnNumber: 0,
    });
  });

  it('emitTurnBatch noops on empty states', () => {
    const port = makeMockPort();
    __test__.emitTurnBatch(port, 'd1', 0, []);
    expect(port.messages).toHaveLength(0);
  });
});
