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
import { applyChainTransition, emptyChainState, type ChainStateContainer } from './chain-state-tracker.js';

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

  it('emits WORKER_REPLAY_STREAM_CHUNK with turnNumber=0 for Setup before first NEW_TURN', () => {
    // Push one DTO so the Turn 0 nav entry has a non-empty label
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
      (m) => (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK'
        && (m as { turnNumber: number }).turnNumber === 0,
    ) as { navEntries: { label: string }[] } | undefined;
    expect(turn0).toBeDefined();
    expect(turn0!.navEntries.length).toBeGreaterThan(0);
    expect(turn0!.navEntries[0].label).toContain('Draw');
  });

  it('increments currentTurn after each NEW_TURN; emits separate chunks', () => {
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
    const chunks = port.messages.filter((m) => (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK') as { turnNumber: number }[];
    const turnNumbers = chunks.map((c) => c.turnNumber);
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
      (m) => (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK'
        && (m as { turnNumber: number }).turnNumber === 0,
    ) as { navEntries: { label: string; chainIndex?: number }[] } | undefined;
    expect(turn0).toBeDefined();
    // CHAIN_END always becomes its own nav entry with label 'MSG_CHAIN_END' and no chainIndex
    expect(turn0!.navEntries.some((s) => s.label === 'MSG_CHAIN_END' && s.chainIndex == null)).toBe(true);
  });

  // F9-bis (2026-06-04) — chainSnapshot embedding. Drives the replay viewer's
  // mid-chain seek restore. Tests pin the contract:
  //   1. States flushed mid-chain carry a chainSnapshot reflecting the chain
  //      state AFTER the last event in their `events[]`.
  //   2. The MSG_CHAIN_END separator state has NO chainSnapshot (phase is
  //      flipped to idle BEFORE that flush).
  //   3. States flushed outside any chain have NO chainSnapshot.
  //   4. negatedIndices and currentSolvingChainIndex are propagated.
  describe('F9-bis chainSnapshot embedding', () => {
    interface FlushedState { label: string; chainIndex?: number; chainSnapshot?: { links: unknown[]; phase: string; negatedIndices: number[]; currentSolvingChainIndex: number | null } }

    function collectStates(port: ReturnType<typeof makeDeps>['port']): FlushedState[] {
      const chunks = port.messages.filter(m => (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK');
      return chunks.flatMap(c => (c as { navEntries: FlushedState[] }).navEntries);
    }

    it('embeds chainSnapshot on mid-chain states + omits it on the MSG_CHAIN_END separator', () => {
      const { msg, deps, port } = makeDeps([
        {
          status: OcgProcessResult.CONTINUE,
          messages: [
            // CHAINING(0) — opens the chain
            ocg(OcgMessageType.CHAINING, { chainIndex: 0 }),
            // CHAINING(1) — flushes the link-0 state; triggers a snapshot
            ocg(OcgMessageType.CHAINING, { chainIndex: 1 }),
            // CHAIN_SOLVING(0) — flips phase=resolving
            ocg(OcgMessageType.CHAIN_SOLVING, { chainIndex: 0 }),
            ocg(OcgMessageType.CHAIN_SOLVED, { chainIndex: 0 }),
            ocg(OcgMessageType.CHAIN_END, {}),
            ocg(OcgMessageType.NEW_TURN, { player: 0 }),
          ],
        },
        { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
      ]);
      (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) => {
        if (m.type === OcgMessageType.CHAINING) return { type: 'MSG_CHAINING', chainIndex: (m as unknown as { chainIndex: number }).chainIndex, cardName: 'X', cardCode: 100, player: 0, location: 0x2, sequence: 0 } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_SOLVING) return { type: 'MSG_CHAIN_SOLVING', chainIndex: (m as unknown as { chainIndex: number }).chainIndex } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_SOLVED) return { type: 'MSG_CHAIN_SOLVED', chainIndex: (m as unknown as { chainIndex: number }).chainIndex } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_END) return { type: 'MSG_CHAIN_END' } as unknown as ServerMessage;
        return null;
      });

      runReplayPreComputation(msg, deps);

      const states = collectStates(port);
      // The MSG_CHAIN_END separator MUST NOT carry chainSnapshot — by then
      // applyChainTransition has already flipped phase to idle.
      const endState = states.find(s => s.label === 'MSG_CHAIN_END');
      expect(endState).toBeDefined();
      expect(endState!.chainSnapshot).toBeUndefined();
    });

    it('chainSnapshot carries currentSolvingChainIndex during the resolving window', () => {
      // Sequence: CHAINING(0), CHAIN_SOLVING(0), MOVE (mid-resolve, flushes via NEW_PHASE),
      //           CHAIN_SOLVED(0), CHAIN_END.
      // The MOVE flush should see currentSolvingChainIndex=0.
      const { msg, deps, port } = makeDeps([
        {
          status: OcgProcessResult.CONTINUE,
          messages: [
            ocg(OcgMessageType.CHAINING, { chainIndex: 0 }),
            ocg(OcgMessageType.CHAIN_SOLVING, { chainIndex: 0 }),
            ocg(OcgMessageType.MOVE, {}),
            ocg(OcgMessageType.NEW_PHASE, { phase: 4 }),
            ocg(OcgMessageType.CHAIN_SOLVED, { chainIndex: 0 }),
            ocg(OcgMessageType.CHAIN_END, {}),
            ocg(OcgMessageType.NEW_TURN, { player: 0 }),
          ],
        },
        { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
      ]);
      (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) => {
        if (m.type === OcgMessageType.CHAINING) return { type: 'MSG_CHAINING', chainIndex: 0, cardName: 'X', cardCode: 100, player: 0, location: 0x2, sequence: 0 } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_SOLVING) return { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 } as unknown as ServerMessage;
        if (m.type === OcgMessageType.MOVE) return { type: 'MSG_MOVE', cardCode: 100, cardName: 'X', player: 0 } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_SOLVED) return { type: 'MSG_CHAIN_SOLVED', chainIndex: 0 } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_END) return { type: 'MSG_CHAIN_END' } as unknown as ServerMessage;
        return null;
      });

      runReplayPreComputation(msg, deps);

      const states = collectStates(port);
      // A state captured during the resolving window MUST carry phase='resolving'
      // and currentSolvingChainIndex=0.
      const resolvingState = states.find(s => s.chainSnapshot?.phase === 'resolving');
      expect(resolvingState).toBeDefined();
      expect(resolvingState!.chainSnapshot!.currentSolvingChainIndex).toBe(0);
      expect(resolvingState!.chainSnapshot!.links.length).toBe(1);
    });

    it('snapshots are independent across flushed states (no shared array reference)', () => {
      // Regression for the F9-bis shared-reference bug discovered 2026-06-04:
      // `buildChainSnapshot` originally returned `links: container.activeChainLinks`
      // (a direct ref). `applyChainTransition` mutates that array via .push(),
      // so by serialization time every snapshot pointed at the FINAL post-push
      // array. The fix is `links: [...container.activeChainLinks]` (shallow copy).
      //
      // Scenario: 3 consecutive MSG_CHAINING in the same OCG batch, plus some
      // intermediate non-chain events to force individual flushes between each.
      // After the buggy implementation, the first flushed state's snapshot
      // carries 3 links. After the fix, it carries 1.
      const { msg, deps, port } = makeDeps([
        {
          status: OcgProcessResult.CONTINUE,
          messages: [
            ocg(OcgMessageType.CHAINING, { chainIndex: 0 }),
            ocg(OcgMessageType.CHAINING, { chainIndex: 1 }),
            ocg(OcgMessageType.CHAINING, { chainIndex: 2 }),
            ocg(OcgMessageType.CHAIN_SOLVING, { chainIndex: 2 }),
            ocg(OcgMessageType.CHAIN_SOLVED, { chainIndex: 2 }),
            ocg(OcgMessageType.CHAIN_END, {}),
            ocg(OcgMessageType.NEW_TURN, { player: 0 }),
          ],
        },
        { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
      ]);
      (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) => {
        if (m.type === OcgMessageType.CHAINING) return { type: 'MSG_CHAINING', chainIndex: (m as unknown as { chainIndex: number }).chainIndex, cardName: `Card${(m as unknown as { chainIndex: number }).chainIndex}`, cardCode: 100, player: 0, location: 0x2, sequence: 0 } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_SOLVING) return { type: 'MSG_CHAIN_SOLVING', chainIndex: (m as unknown as { chainIndex: number }).chainIndex } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_SOLVED) return { type: 'MSG_CHAIN_SOLVED', chainIndex: (m as unknown as { chainIndex: number }).chainIndex } as unknown as ServerMessage;
        if (m.type === OcgMessageType.CHAIN_END) return { type: 'MSG_CHAIN_END' } as unknown as ServerMessage;
        return null;
      });

      runReplayPreComputation(msg, deps);

      const states = collectStates(port);
      // Filter to mid-chain states carrying a snapshot, in flush order.
      const snapshotStates = states.filter(s => s.chainSnapshot);
      expect(snapshotStates.length).toBeGreaterThanOrEqual(2);
      // Monotonic non-decreasing link counts AND, critically, NOT all equal
      // to the final link count — that would be the shared-reference bug.
      const linkCounts = snapshotStates.map(s => s.chainSnapshot!.links.length);
      for (let i = 1; i < linkCounts.length; i++) {
        expect(linkCounts[i]).toBeGreaterThanOrEqual(linkCounts[i - 1]);
      }
      // At least the first mid-chain snapshot MUST carry fewer links than the
      // last — the regression collapsed them all to the same final count.
      expect(linkCounts[0]).toBeLessThan(linkCounts[linkCounts.length - 1]);
    });

    it('omits chainSnapshot on states flushed outside any chain', () => {
      const { msg, deps, port } = makeDeps([
        {
          status: OcgProcessResult.CONTINUE,
          messages: [
            ocg(OcgMessageType.MOVE, {}),
            ocg(OcgMessageType.NEW_PHASE, { phase: 4 }),
            ocg(OcgMessageType.NEW_TURN, { player: 0 }),
          ],
        },
        { status: OcgProcessResult.END, messages: [ocg(OcgMessageType.WIN, { player: 0 })] },
      ]);
      (deps.transformMessage as ReturnType<typeof vi.fn>).mockImplementation((m: OcgMessage) => {
        if (m.type === OcgMessageType.MOVE) return { type: 'MSG_MOVE', cardCode: 100, cardName: 'X', player: 0 } as unknown as ServerMessage;
        return null;
      });

      runReplayPreComputation(msg, deps);

      const states = collectStates(port);
      // No chain ever opened — every flushed state should be snapshot-free.
      for (const s of states) {
        expect(s.chainSnapshot).toBeUndefined();
      }
    });
  });

  // ─── F14 (2026-06-06) — stream MUST NOT contain REPLAY_IGNORED_TYPES ─────
  //
  // The mock-side `REPLAY_IGNORED_TYPES` set (`front/src/app/pages/pvp/replay/
  // mock-duel-connection.ts`) silently drops these message types — they
  // belong to PvP-only lifecycle (matchmaking, timers, reconnect handshake,
  // rematch). The doctrine "Replay = PvP readonly" promises the precompute
  // never emits them ; without this gate, a future precompute regression
  // that adds e.g. `INACTIVITY_WARNING` would be skipped by the mock
  // without any warning, masking a real divergence.
  //
  // Duplicates the front-side set verbatim with a cross-reference comment ;
  // a CI step could in theory parse both files to assert identity, but the
  // 2 sites + this test are tractable enough that manual sync at PR review
  // is the path of least resistance.
  describe('F14 — REPLAY_IGNORED_TYPES disjointness', () => {
    /** Verbatim mirror of `mock-duel-connection.ts:REPLAY_IGNORED_TYPES`
     *  (front side). Update both sites together if the protocol grows. */
    const FRONT_REPLAY_IGNORED_TYPES = new Set<string>([
      'SESSION_TOKEN', 'SESSION_PHASE',
      'DUEL_STARTING', 'DUEL_END',
      'DICE_ROLL', 'DICE_RESULT',
      'SELECT_FIRST_PLAYER', 'FIRST_PLAYER_RESULT',
      'DECK_PREFETCH', 'EARLY_DECK_PREFETCH',
      'TIMER_STATE', 'INACTIVITY_WARNING', 'WAITING_RESPONSE',
      'OPPONENT_DISCONNECTED', 'OPPONENT_RECONNECTED',
      'REMATCH_INVITATION', 'REMATCH_CANCELLED', 'REMATCH_STARTING',
      'STATE_SYNC', 'CHAIN_STATE',
      // MSG_WIN deliberately ABSENT — routed via the explicit branch in
      // the mock's `_dispatch` post-F2/F4 fix (2026-06-06 commit 753e2d70).
      'ERROR',
    ]);

    it('a complete WIN run emits zero messages whose type is in REPLAY_IGNORED_TYPES', () => {
      // Drive the precompute through a minimal complete duel : one CONTINUE
      // tick with a no-op message, one END tick with WIN. This is enough to
      // exercise every code path that pushes onto the stream
      // (`ingestStream`, the synthetic `BOARD_STATE` inside `flushNavEntry`,
      // the `recordAutoResponse` map). A precompute regression that started
      // emitting e.g. `INACTIVITY_WARNING` here would fail this assert.
      const { msg, deps, port } = makeDeps([
        {
          status: OcgProcessResult.CONTINUE,
          messages: [ocg(OcgMessageType.NEW_TURN, { player: 0 })],
        },
        {
          status: OcgProcessResult.END,
          messages: [ocg(OcgMessageType.WIN, { player: 0, reason: 0x01 })],
        },
      ]);
      runReplayPreComputation(msg, deps);
      const chunks = port.messages.filter(
        m => (m as { type: string }).type === 'WORKER_REPLAY_STREAM_CHUNK',
      ) as { messages: ServerMessage[] }[];
      const emitted = chunks.flatMap(c => c.messages.map(m => m.type));
      const violations = emitted.filter(t => FRONT_REPLAY_IGNORED_TYPES.has(t));
      expect(violations).toEqual([]);
    });
  });
});

// ─── Pure helpers (label generation + chain finalization) ───────────────────

describe('buildChainSnapshot (F9-bis unit)', () => {
  // applyChainTransition + emptyChainState come from chain-state-tracker; the
  // buildChainSnapshot under test sits in replay-precompute and we reach it
  // via __test__ to keep its module-internal status.
  const newContainer = (): ChainStateContainer => emptyChainState();
  const transition = (container: ChainStateContainer, msg: ServerMessage) => applyChainTransition(container, msg);
  const chaining = (chainIndex: number): ServerMessage => ({
    type: 'MSG_CHAINING', chainIndex, cardCode: 100 + chainIndex,
    cardName: `Card${chainIndex}`, player: 0, location: 0x2, sequence: chainIndex,
  } as unknown as ServerMessage);

  it('returns undefined when chainPhase is idle', () => {
    const container = newContainer();
    expect(__test__.buildChainSnapshot(container)).toBeUndefined();
  });

  it('returns a snapshot with the current links + phase when building', () => {
    const container = newContainer();
    transition(container, chaining(0));
    const snap = __test__.buildChainSnapshot(container);
    expect(snap).toBeDefined();
    expect(snap!.phase).toBe('building');
    expect(snap!.links.length).toBe(1);
    expect(snap!.currentSolvingChainIndex).toBeNull();
    expect(snap!.negatedIndices).toEqual([]);
  });

  it('snapshots taken across mutations are INDEPENDENT (defensive copy)', () => {
    // This is the F9-bis shared-reference regression from 2026-06-04. The
    // buggy version returned `links: container.activeChainLinks` directly,
    // so every snapshot pointed at the same array. By the time the precompute
    // finished pushing all N links, every snapshot displayed N links instead
    // of growing from 1 to N. The shallow-copy `[...container.activeChainLinks]`
    // is the fix this test pins.
    const container = newContainer();
    transition(container, chaining(0));
    const snapA = __test__.buildChainSnapshot(container);
    transition(container, chaining(1));
    const snapB = __test__.buildChainSnapshot(container);
    transition(container, chaining(2));
    const snapC = __test__.buildChainSnapshot(container);

    // Each snapshot must reflect the state at its capture moment, not the
    // final state of the container.
    expect(snapA!.links.length).toBe(1);
    expect(snapB!.links.length).toBe(2);
    expect(snapC!.links.length).toBe(3);

    // Identity check: the `links` arrays must be distinct objects so that
    // future mutations to the container don't propagate retroactively.
    expect(snapA!.links).not.toBe(snapB!.links);
    expect(snapB!.links).not.toBe(snapC!.links);
    expect(snapA!.links).not.toBe(container.activeChainLinks);
  });

  it('propagates currentSolvingChainIndex when phase is resolving', () => {
    const container = newContainer();
    transition(container, chaining(0));
    transition(container, chaining(1));
    transition(container, { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 } as unknown as ServerMessage);
    const snap = __test__.buildChainSnapshot(container);
    expect(snap!.phase).toBe('resolving');
    expect(snap!.currentSolvingChainIndex).toBe(1);
  });

  it('propagates negatedIndices', () => {
    const container = newContainer();
    transition(container, chaining(0));
    transition(container, chaining(1));
    transition(container, { type: 'MSG_CHAIN_NEGATED', chainIndex: 0 } as unknown as ServerMessage);
    const snap = __test__.buildChainSnapshot(container);
    expect(snap!.negatedIndices).toContain(0);
    expect(snap!.negatedIndices).not.toContain(1);
  });

  it('negatedIndices array is defensively copied (Set mutation does not leak)', () => {
    const container = newContainer();
    transition(container, chaining(0));
    transition(container, { type: 'MSG_CHAIN_NEGATED', chainIndex: 0 } as unknown as ServerMessage);
    const snapA = __test__.buildChainSnapshot(container);
    transition(container, chaining(1));
    transition(container, { type: 'MSG_CHAIN_NEGATED', chainIndex: 1 } as unknown as ServerMessage);
    const snapB = __test__.buildChainSnapshot(container);
    expect(snapA!.negatedIndices).toEqual([0]);
    expect(snapB!.negatedIndices.sort()).toEqual([0, 1]);
  });

  it('after MSG_CHAIN_END the container is back to idle and snapshot is undefined', () => {
    const container = newContainer();
    transition(container, chaining(0));
    transition(container, { type: 'MSG_CHAIN_END' } as unknown as ServerMessage);
    expect(__test__.buildChainSnapshot(container)).toBeUndefined();
  });
});

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

  it('generateLabel prefers MSG_CHAINING over MSG_MOVE when a Spell is activated from hand', () => {
    // A Spell/Trap activated from hand emits BOTH events in the same batch.
    // Without the priority pass, MSG_MOVE → "Set: ..." would shadow the
    // Activate verb. Regression guard for the timeline "Set" mislabel.
    const label = __test__.generateLabel([
      {
        type: 'MSG_MOVE',
        cardName: 'Pot of Greed',
        fromLocation: 0x02, // HAND
        toLocation: 0x08, // SZONE
        reason: 0,
        toPosition: 0x1, // FACEUP_ATTACK
      } as unknown as ServerMessage,
      { type: 'MSG_CHAINING', cardName: 'Pot of Greed' } as unknown as ServerMessage,
    ]);
    expect(label).toBe('Activate: Pot of Greed');
  });

  it('generateLabel returns Set only when MSG_MOVE lands the card face-down on SZONE', () => {
    const setLabel = __test__.generateLabel([
      {
        type: 'MSG_MOVE',
        cardName: 'Mirror Force',
        fromLocation: 0x02, // HAND
        toLocation: 0x08, // SZONE
        reason: 0,
        toPosition: 0x8, // FACEDOWN_DEFENSE
      } as unknown as ServerMessage,
    ]);
    expect(setLabel).toBe('Set: Mirror Force');
    // Face-up SZONE landing without a sibling MSG_CHAINING falls back to
    // generic "Move" — the timeline should never call it "Set".
    const moveLabel = __test__.generateLabel([
      {
        type: 'MSG_MOVE',
        cardName: 'Some Spell',
        fromLocation: 0x02,
        toLocation: 0x08, // SZONE
        reason: 0,
        toPosition: 0x1, // FACEUP_ATTACK
      } as unknown as ServerMessage,
    ]);
    expect(moveLabel).toBe('Move: Some Spell');
  });

  it('generateLabel returns empty string for non-visual events', () => {
    const label = __test__.generateLabel([
      { type: 'WAITING_RESPONSE' } as unknown as ServerMessage,
      { type: 'MSG_CHAIN_SOLVING' } as unknown as ServerMessage,
    ]);
    expect(label).toBe('');
  });

  it('finalizeChainGroupsForNav strips chainIndex on single-link chains', () => {
    const entries = [
      { messageOffset: 0, label: 'A', turnNumber: 0, responseCount: 0, boardStateSnapshot: FAKE_BOARD_STATE, events: [], chainIndex: 0 },
      { messageOffset: 1, label: 'B', turnNumber: 0, responseCount: 0, boardStateSnapshot: FAKE_BOARD_STATE, events: [] },
    ];
    __test__.finalizeChainGroupsForNav(entries);
    expect(entries[0].chainIndex).toBeUndefined();
    expect(entries[0].label).toBe('A');
  });

  it('finalizeChainGroupsForNav prefixes CL{n+1} on multi-link chains', () => {
    const entries = [
      { messageOffset: 0, label: 'A', turnNumber: 0, responseCount: 0, boardStateSnapshot: FAKE_BOARD_STATE, events: [], chainIndex: 0 },
      { messageOffset: 1, label: 'B', turnNumber: 0, responseCount: 0, boardStateSnapshot: FAKE_BOARD_STATE, events: [], chainIndex: 1 },
    ];
    __test__.finalizeChainGroupsForNav(entries);
    expect(entries[0].label).toBe('CL1: A');
    expect(entries[1].label).toBe('CL2: B');
    // chainIndex is preserved on multi-link (not stripped)
    expect(entries[0].chainIndex).toBe(0);
  });
});
