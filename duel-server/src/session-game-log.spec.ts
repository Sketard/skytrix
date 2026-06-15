import { describe, it, expect, beforeAll } from 'vitest';
import {
  createSessionGameLog,
  ingestMessage,
  entriesForPlayer,
} from './session-game-log.js';
import { configureWorkerMessageRouter, broadcastMessage } from './worker-message-router.js';
import type { ServerMessage, BoardStatePayload, PlayerBoardState } from './ws-protocol.js';
import type { ActiveDuelSession } from './types.js';
import { emptyChainState } from './chain-state-tracker.js';

// ─── Board state fixture ────────────────────────────────────────────────────
// The builder uses BoardStatePayload only for turn/phase synthesis (turnCount,
// phase, players[0].lp, players[1].lp) and for MSG_BECOME_TARGET resolution.
// A minimal shape is enough for the tests below.

function emptyPlayerBoard(lp = 8000): PlayerBoardState {
  return { lp, hand: 0, zones: [] } as unknown as PlayerBoardState;
}

function boardState(
  turnCount: number,
  phase: string,
  turnPlayer: 0 | 1 = 0,
): BoardStatePayload {
  return {
    turnCount,
    phase,
    turnPlayer,
    players: [emptyPlayerBoard(), emptyPlayerBoard()],
  } as unknown as BoardStatePayload;
}

function boardMsg(
  turnCount: number,
  phase: string,
  turnPlayer: 0 | 1 = 0,
): ServerMessage {
  return { type: 'BOARD_STATE', data: boardState(turnCount, phase, turnPlayer) } as ServerMessage;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SessionGameLog — createSessionGameLog', () => {
  it('creates two builders with perspectives 0 and 1', () => {
    const log = createSessionGameLog();
    expect(log.builders).toHaveLength(2);
    expect(entriesForPlayer(log, 0)).toEqual([]);
    expect(entriesForPlayer(log, 1)).toEqual([]);
  });

  it('returns a fresh object each call (no shared state)', () => {
    const a = createSessionGameLog();
    const b = createSessionGameLog();
    expect(a).not.toBe(b);
    expect(a.builders).not.toBe(b.builders);
  });
});

describe('SessionGameLog — ingestMessage', () => {
  it('BOARD_STATE drives turn/phase synthesis for both perspectives', () => {
    const log = createSessionGameLog();
    ingestMessage(log, boardMsg(1, 'MAIN1', 0));

    const p0 = entriesForPlayer(log, 0);
    const p1 = entriesForPlayer(log, 1);

    // Both perspectives should emit the turn + phase separators.
    expect(p0.some(e => e.block === 'separator' && e.kind === 'turn')).toBe(true);
    expect(p0.some(e => e.block === 'separator' && e.kind === 'phase')).toBe(true);
    expect(p1.some(e => e.block === 'separator' && e.kind === 'turn')).toBe(true);
    expect(p1.some(e => e.block === 'separator' && e.kind === 'phase')).toBe(true);
  });

  it('emits a fresh turn separator on turnCount delta', () => {
    const log = createSessionGameLog();
    ingestMessage(log, boardMsg(1, 'MAIN1', 0));
    ingestMessage(log, boardMsg(2, 'MAIN1', 1));

    const turnSeparators = entriesForPlayer(log, 0).filter(
      e => e.block === 'separator' && e.kind === 'turn',
    );
    expect(turnSeparators).toHaveLength(2);
  });

  it('ingests events before the first BOARD_STATE (OCGCore opening hand)', () => {
    const log = createSessionGameLog();
    // MSG_DRAW × 5 fires before the first BOARD_STATE — start_duel runs
    // before the first prompt. Without the stub-board fallback, the opening
    // hand row would never reach the journal.
    const draw: ServerMessage = {
      type: 'MSG_DRAW',
      player: 0,
      cards: [1234567, 2345678, 3456789, 4567890, 5678901],
    } as ServerMessage;
    ingestMessage(log, draw);

    expect(entriesForPlayer(log, 0).length).toBeGreaterThan(0);
    expect(entriesForPlayer(log, 1).length).toBeGreaterThan(0);
  });

  it('ingests events into both perspectives once a board snapshot exists', () => {
    const log = createSessionGameLog();
    ingestMessage(log, boardMsg(1, 'MAIN1', 0));

    const beforeP0 = entriesForPlayer(log, 0).length;
    const beforeP1 = entriesForPlayer(log, 1).length;

    const draw: ServerMessage = {
      type: 'MSG_DRAW',
      player: 0,
      cards: [1234567, 2345678],
    } as ServerMessage;
    ingestMessage(log, draw);

    // Both perspectives got the draw row appended.
    expect(entriesForPlayer(log, 0).length).toBeGreaterThan(beforeP0);
    expect(entriesForPlayer(log, 1).length).toBeGreaterThan(beforeP1);
  });

  it('snapshot returned by entriesForPlayer is an independent copy', () => {
    const log = createSessionGameLog();
    ingestMessage(log, boardMsg(1, 'MAIN1', 0));

    const snap = entriesForPlayer(log, 0);
    const lenBefore = snap.length;

    // Mutating the snapshot must not affect future reads.
    snap.length = 0;
    expect(entriesForPlayer(log, 0).length).toBe(lenBefore);
  });
});

describe('SessionGameLog — relativization via per-perspective builders', () => {
  it('the same MSG_DRAW yields entries that differ ONLY in their RelPlayer fields', () => {
    const log = createSessionGameLog();
    ingestMessage(log, boardMsg(1, 'DRAW', 0));

    const draw: ServerMessage = {
      type: 'MSG_DRAW',
      player: 0,
      cards: [1234567],
    } as ServerMessage;
    ingestMessage(log, draw);

    const p0 = entriesForPlayer(log, 0);
    const p1 = entriesForPlayer(log, 1);
    expect(p0.length).toBe(p1.length);

    // Same count + same kinds in same order — only RelPlayer fields swap.
    for (let i = 0; i < p0.length; i++) {
      const a = p0[i];
      const b = p1[i];
      expect(a.block).toBe(b.block);
      if (a.block === 'move' && b.block === 'move') {
        // 0 in perspective 0 must be 1 in perspective 1 (the drawing player
        // is OCGCore P0 = self for builder 0, opponent for builder 1).
        expect(a.player).toBe(0);
        expect(b.player).toBe(1);
      }
    }
  });
});

// ─── Integration: tap in broadcastMessage ───────────────────────────────────

describe('worker-message-router — game-log ingestion tap', () => {
  // Minimal session shape — only the fields the broadcast path reads.
  function makeSession(): ActiveDuelSession {
    return {
      duelId: 'test-duel',
      players: [
        { playerId: 'p0', playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
        { playerId: 'p1', playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      ],
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      phase: 'DUELING',
      firstPlayerState: null,
      chosenFirstPlayer: null,
      worker: null,
      workerTerminated: false,
      awaitingResponse: [false, false],
      lastBoardState: null,
      lastSentPrompt: [null, null],
      lastSentHint: [null, null],
      decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
      rematchRequested: [false, false],
      rematchTimeout: null,
      soloOrphanTimeout: null,
      preservationTimer: null,
      bothDisconnected: false,
      combinedGraceTimer: null,
      storedDuelResult: null,
      lastStateSyncAt: [0, 0],
      lastCancelAt: [0, 0],
      cancelTargetPrompt: [null, null],
      timerContext: null,
      soloMode: false,
      forkMode: false,
      skipShuffle: false,
      turnTimeSecs: 300,
      invalidResponseCount: [0, 0],
      promptSentAt: [0, 0],
      ...emptyChainState(),
      playerUsernames: ['p0', 'p1'],
      deckNames: ['d0', 'd1'],
      pendingReplayResult: null,
      forkConnectionTimeout: null,
    animationsReadyDeadline: null,
      gameLog: createSessionGameLog(),
      animationsReady: [false, false],
    } as ActiveDuelSession;
  }

  beforeAll(() => {
    configureWorkerMessageRouter({
      sendToPlayer: () => undefined,
      maxInvalidResponses: 3,
    });
  });

  it('feeds session.gameLog on every broadcastMessage call', () => {
    const session = makeSession();
    expect(entriesForPlayer(session.gameLog!, 0)).toEqual([]);

    broadcastMessage(session, boardMsg(1, 'MAIN1', 0));
    expect(entriesForPlayer(session.gameLog!, 0).length).toBeGreaterThan(0);
  });

  it('survives messages that the builder skips silently (unknown / SYSTEM types)', () => {
    const session = makeSession();
    broadcastMessage(session, boardMsg(1, 'MAIN1', 0));
    const lenBefore = entriesForPlayer(session.gameLog!, 0).length;

    // TIMER_STATE is not a game-log event — should be silently ignored by the
    // builder without exploding.
    const timer: ServerMessage = {
      type: 'TIMER_STATE',
      player: 0,
      remainingMs: 300000,
      totalMs: 300000,
    } as ServerMessage;
    broadcastMessage(session, timer);

    expect(entriesForPlayer(session.gameLog!, 0).length).toBe(lenBefore);
  });

  it('no-ops on a session without gameLog (test fixture compatibility)', () => {
    const session = makeSession();
    (session as { gameLog?: unknown }).gameLog = undefined;

    // Should not throw — the guard `if (session.gameLog)` covers this.
    expect(() => broadcastMessage(session, boardMsg(1, 'MAIN1', 0))).not.toThrow();
  });
});
