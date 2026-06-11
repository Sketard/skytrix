/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are test fixtures (perspective
   stub for `duelCtx` injection). They are not pipeline signals at
   runtime ; the §3.2 tagging convention targets real pipeline classes only. */

import { signal } from '@angular/core';

import { MockDuelConnection, type ReplayStream } from './mock-duel-connection';
import type {
  BoardStateMsg, BoardStatePayload, ChainingMsg, ChainNegatedMsg,
  DamageMsg, DrawMsg, MoveMsg, Player,
  SelectCardMsg, ServerMessage,
} from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';
import type { StreamEvent } from '../types';

// =============================================================================
// Fixtures
// =============================================================================

function boardState(overrides?: Partial<BoardStatePayload>): BoardStatePayload {
  return {
    turnPlayer: 0, turnCount: 1, phase: 'MAIN1',
    players: [
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    ],
    ...overrides,
  };
}

const boardStateMsg = (overrides?: Partial<BoardStatePayload>): BoardStateMsg => ({
  type: 'BOARD_STATE', data: boardState(overrides),
});

const msgDraw = (player: Player = 0 as Player): DrawMsg => ({
  type: 'MSG_DRAW', player, cards: [100],
});

const msgMove = (): MoveMsg => ({
  type: 'MSG_MOVE', cardCode: 100, cardName: 'Card',
  player: 0 as Player, toPlayer: 0 as Player,
  fromLocation: LOCATION.DECK, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
  toLocation: LOCATION.HAND, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
  isToken: false, reason: 0,
});

const msgDamage = (): DamageMsg => ({
  type: 'MSG_DAMAGE', player: 0 as Player, amount: 500,
});

const chaining = (): ChainingMsg => ({
  type: 'MSG_CHAINING', chainIndex: 1, player: 0 as Player,
  cardCode: 200, cardName: 'Trap',
  location: LOCATION.SZONE, sequence: 0, description: 0,
});

const chainNegated = (): ChainNegatedMsg => ({
  type: 'MSG_CHAIN_NEGATED', chainIndex: 1,
});

const selectCard = (): SelectCardMsg => ({
  type: 'SELECT_CARD', player: 0 as Player, min: 1, max: 1, cards: [
    { cardCode: 100, name: 'Card', player: 0 as Player, location: LOCATION.HAND, sequence: 0 },
  ], cancelable: false,
});

function streamOf(messages: ServerMessage[]): ReplayStream {
  return { messages, autoResponses: new Map() };
}

// =============================================================================
// Tests
// =============================================================================

describe('MockDuelConnection — Phase 1', () => {
  let conn: MockDuelConnection;

  beforeEach(() => {
    conn = new MockDuelConnection();
  });

  afterEach(() => conn.cleanup());

  // ─── Cursor + stream lifecycle ───────────────────────────────────────────

  describe('dispatchNext lifecycle', () => {
    it('returns false when no stream is loaded', () => {
      expect(conn.dispatchNext()).toBeFalse();
      expect(conn.messageCursor()).toBe(0);
    });

    it('returns false once cursor reaches end of stream', () => {
      conn.loadStream(streamOf([msgDraw()]));
      expect(conn.dispatchNext()).toBeTrue();
      expect(conn.messageCursor()).toBe(1);
      expect(conn.dispatchNext()).toBeFalse();
    });

    it('resets cursor to 0 on loadStream', () => {
      conn.loadStream(streamOf([msgDraw(), msgDraw()]));
      conn.dispatchNext();
      expect(conn.messageCursor()).toBe(1);
      conn.loadStream(streamOf([msgMove()]));
      expect(conn.messageCursor()).toBe(0);
    });
  });

  // ─── Routing to processor ────────────────────────────────────────────────

  describe('dispatch routes to processor', () => {
    it('GAME_EVENT (MSG_DRAW) flows to processor.processMessage', () => {
      const spy = spyOn(conn.processor, 'processMessage').and.callThrough();
      conn.loadStream(streamOf([msgDraw()]));
      conn.dispatchNext();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.calls.first().args[0].type).toBe('MSG_DRAW');
    });

    it('MSG_CHAINING transitions chainPhase to building + accumulates pending entry', () => {
      conn.loadStream(streamOf([chaining()]));
      expect(conn.chainPhase()).toBe('idle');
      conn.dispatchNext();
      expect(conn.chainPhase()).toBe('building');
      expect(conn.hasPendingChainEntry()).toBeTrue();
    });
  });

  // ─── SELECT_* → pendingPrompt ────────────────────────────────────────────

  describe('SELECT_* prompts', () => {
    it('SELECT_CARD dispatch sets pendingPrompt + emits to out-of-band sink', () => {
      const sinkSpy = jasmine.createSpy('sink');
      conn.attachOutOfBandSink(sinkSpy as (e: StreamEvent) => void);
      conn.loadStream(streamOf([selectCard()]));
      conn.dispatchNext();
      expect(conn.pendingPrompt()?.type).toBe('SELECT_CARD');
      // SELECT_CARD is the only SELECT_MODAL type that mirrors PvP's
      // EventStream push (game-log builder consumer).
      const calls = sinkSpy.calls.allArgs() as Array<[StreamEvent]>;
      const selectCardCalls = calls.filter(([e]) => 'type' in e && e.type === 'SELECT_CARD');
      expect(selectCardCalls.length).toBe(1);
    });

    it('simulatePlayerResponse clears pendingPrompt', () => {
      conn.loadStream(streamOf([selectCard()]));
      conn.dispatchNext();
      expect(conn.pendingPrompt()).not.toBeNull();
      conn.simulatePlayerResponse({ promptType: 'SELECT_CARD', data: { indices: [0] } });
      expect(conn.pendingPrompt()).toBeNull();
    });
  });

  // ─── attachOutOfBandSink wiring ──────────────────────────────────────────

  describe('attachOutOfBandSink', () => {
    it('routes MSG_CHAIN_NEGATED via sink (processor.onEvent)', () => {
      const sinkSpy = jasmine.createSpy('sink');
      conn.attachOutOfBandSink(sinkSpy as (e: StreamEvent) => void);
      conn.loadStream(streamOf([chaining(), chainNegated()]));
      conn.dispatchNext();
      conn.dispatchNext();
      const calls = sinkSpy.calls.allArgs() as Array<[StreamEvent]>;
      const negatedCalls = calls.filter(([e]) => 'type' in e && e.type === 'MSG_CHAIN_NEGATED');
      expect(negatedCalls.length).toBe(1);
    });
  });

  // ─── BOARD_STATE handling + perspective swap ─────────────────────────────

  describe('BOARD_STATE + perspective swap', () => {
    it('BOARD_STATE without duelCtx applies payload as-is to logical state', () => {
      const bs = boardState({ turnPlayer: 0 });
      conn.loadStream(streamOf([{ type: 'BOARD_STATE', data: bs }]));
      conn.dispatchNext();
      expect(conn.renderedBoardState.logicalState().turnPlayer).toBe(0);
    });

    it('BOARD_STATE with duelCtx perspective=1 swaps players[] and turnPlayer', () => {
      const perspective = signal<0 | 1>(1);
      const swapConn = new MockDuelConnection({
        duelCtx: { perspective: () => perspective },
      });
      try {
        const bs = boardState({
          turnPlayer: 0,
          players: [
            { lp: 7000, deckCount: 30, extraCount: 10, zones: [] },
            { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
          ],
        });
        swapConn.loadStream(streamOf([{ type: 'BOARD_STATE', data: bs }]));
        swapConn.dispatchNext();
        const logical = swapConn.renderedBoardState.logicalState();
        // Perspective 1 → players reversed, turnPlayer flipped.
        expect(logical.turnPlayer).toBe(1);
        expect(logical.players[0].lp).toBe(8000);
        expect(logical.players[1].lp).toBe(7000);
      } finally {
        swapConn.cleanup();
      }
    });

    it('perspective=0 leaves boardStateAfter snapshots unswapped (identity fast-path)', () => {
      const damage = msgDamage() as DamageMsg & { boardStateAfter?: BoardStatePayload };
      damage.boardStateAfter = boardState({ turnPlayer: 0 });
      conn.loadStream(streamOf([damage]));
      conn.dispatchNext();
      expect(damage.boardStateAfter?.turnPlayer).toBe(0);
    });

    it('perspective=1 swaps per-event boardStateAfter on a clone — stored message stays absolute (re-dispatch safe)', () => {
      const perspective = signal<0 | 1>(1);
      const swapConn = new MockDuelConnection({
        duelCtx: { perspective: () => perspective },
      });
      try {
        const damage = msgDamage() as DamageMsg & { boardStateAfter?: BoardStatePayload };
        damage.boardStateAfter = boardState({
          turnPlayer: 0,
          players: [
            { lp: 7000, deckCount: 30, extraCount: 10, zones: [] },
            { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
          ],
        });
        const spy = spyOn(swapConn.processor, 'processMessage').and.callThrough();
        swapConn.loadStream(streamOf([damage]));
        swapConn.dispatchNext();
        // The processor receives the swapped clone…
        const dispatched = spy.calls.mostRecent().args[0] as DamageMsg & { boardStateAfter?: BoardStatePayload };
        expect(dispatched.boardStateAfter?.turnPlayer).toBe(1);
        expect(dispatched.boardStateAfter?.players[0].lp).toBe(8000);
        // …while the stored stream message stays absolute, so a re-dispatch
        // after a backward seek swaps from the original again instead of
        // double-swapping back to absolute (audit 2026-06-11 finding #6).
        expect(damage.boardStateAfter?.turnPlayer).toBe(0);
        expect(damage.boardStateAfter?.players[0].lp).toBe(7000);
      } finally {
        swapConn.cleanup();
      }
    });
  });

  // ─── Skip-list + unknown types are fail-soft ─────────────────────────────

  describe('replay-irrelevant types', () => {
    it('skips replay-irrelevant types silently (no throw, no processor call)', () => {
      const spy = spyOn(conn.processor, 'processMessage').and.callThrough();
      // TIMER_STATE is in REPLAY_IGNORED_TYPES — it would never appear in
      // a precomputed replay stream but the dispatch must stay fail-soft.
      const timerMsg = { type: 'TIMER_STATE', timers: [null, null] } as unknown as ServerMessage;
      conn.loadStream(streamOf([timerMsg]));
      expect(() => conn.dispatchNext()).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
      expect(conn.messageCursor()).toBe(1);
    });
  });
});

// =============================================================================
// Phase 4 — seekToOffset + chunked appendChunk
// =============================================================================

describe('MockDuelConnection — Phase 4 seekToOffset', () => {
  let conn: MockDuelConnection;

  beforeEach(() => {
    conn = new MockDuelConnection();
  });

  afterEach(() => conn.cleanup());

  it('appendChunk grows messages + navIndex incrementally', () => {
    expect(conn.bufferedMessageCount()).toBe(0);
    expect(conn.navIndex().length).toBe(0);

    conn.appendChunk({
      messages: [msgDraw(), boardStateMsg()],
      autoResponses: [],
      navEntries: [{
        messageOffset: 1,
        label: 'Draw Phase',
        turnNumber: 1,
        boardStateSnapshot: boardState(),
        events: [],
        responseCount: 0,
      }],
    });
    expect(conn.bufferedMessageCount()).toBe(2);
    expect(conn.navIndex().length).toBe(1);
    expect(conn.navIndex()[0].label).toBe('Draw Phase');

    conn.appendChunk({
      messages: [msgDamage(), boardStateMsg({ phase: 'MAIN2' })],
      autoResponses: [],
      navEntries: [{
        messageOffset: 3,
        label: 'Main Phase 2',
        turnNumber: 1,
        boardStateSnapshot: boardState({ phase: 'MAIN2' }),
        events: [],
        responseCount: 0,
      }],
    });
    expect(conn.bufferedMessageCount()).toBe(4);
    expect(conn.navIndex().length).toBe(2);
  });

  it('seekToOffset(N) sets cursor to navEntry.messageOffset', () => {
    conn.appendChunk({
      messages: [msgDraw(), boardStateMsg(), msgDamage(), boardStateMsg({ phase: 'MAIN2' })],
      autoResponses: [],
      navEntries: [
        { messageOffset: 1, label: 'Draw Phase', turnNumber: 1, boardStateSnapshot: boardState(), events: [], responseCount: 0 },
        { messageOffset: 3, label: 'Main Phase 2', turnNumber: 1, boardStateSnapshot: boardState({ phase: 'MAIN2' }), events: [], responseCount: 0 },
      ],
    });

    conn.seekToOffset(1);
    expect(conn.messageCursor()).toBe(3);
  });

  it('seekToOffset(N) restores boardStateSnapshot to rendered logical state', () => {
    const targetBs = boardState({ turnPlayer: 1, turnCount: 5, phase: 'BATTLE' });
    conn.appendChunk({
      messages: [boardStateMsg()],
      autoResponses: [],
      navEntries: [
        { messageOffset: 1, label: 'Battle Phase', turnNumber: 5, boardStateSnapshot: targetBs, events: [], responseCount: 0 },
      ],
    });

    conn.seekToOffset(0);
    const logical = conn.renderedBoardState.logicalState();
    expect(logical.turnPlayer).toBe(1);
    expect(logical.turnCount).toBe(5);
    expect(logical.phase).toBe('BATTLE');
  });

  it('seekToOffset(N) with chainSnapshot restores activeChainLinks + chainPhase', () => {
    const chainSnapshot = {
      links: [chaining()],
      phase: 'building' as const,
      negatedIndices: [],
      currentSolvingChainIndex: null,
    };
    conn.appendChunk({
      messages: [boardStateMsg()],
      autoResponses: [],
      navEntries: [
        {
          messageOffset: 1, label: 'CL1: Trap', turnNumber: 1,
          boardStateSnapshot: boardState(), events: [], responseCount: 0, chainSnapshot,
        },
      ],
    });

    conn.seekToOffset(0);
    expect(conn.chainPhase()).toBe('building');
    expect(conn.activeChainLinks().length).toBe(1);
  });

  it('seekToOffset(N) with chainSnapshot + currentSolvingChainIndex restores resolving phase', () => {
    const chainSnapshot = {
      links: [chaining()],
      phase: 'resolving' as const,
      negatedIndices: [],
      currentSolvingChainIndex: 1,
    };
    conn.appendChunk({
      messages: [boardStateMsg()],
      autoResponses: [],
      navEntries: [
        {
          messageOffset: 1, label: 'CL1: Trap', turnNumber: 1,
          boardStateSnapshot: boardState(), events: [], responseCount: 0, chainSnapshot,
        },
      ],
    });

    conn.seekToOffset(0);
    expect(conn.chainPhase()).toBe('resolving');
    const link = conn.activeChainLinks()[0];
    expect(link.resolving).toBeTrue();
  });

  it('seekToOffset(N) clears pendingPrompt', () => {
    conn.appendChunk({
      messages: [selectCard(), boardStateMsg()],
      autoResponses: [],
      navEntries: [
        { messageOffset: 2, label: 'Prompt', turnNumber: 1, boardStateSnapshot: boardState(), events: [], responseCount: 0 },
      ],
    });
    // Dispatch the SELECT_CARD to set pendingPrompt
    conn.dispatchNext();
    expect(conn.pendingPrompt()).not.toBeNull();
    // Now seek to a later nav entry — prompt must clear
    conn.seekToOffset(0);
    expect(conn.pendingPrompt()).toBeNull();
  });

  it('seekToOffset(N) is no-op when index is out of range', () => {
    conn.appendChunk({
      messages: [msgDraw()],
      autoResponses: [],
      navEntries: [],
    });
    const cursorBefore = conn.messageCursor();
    conn.seekToOffset(0); // navIndex empty
    expect(conn.messageCursor()).toBe(cursorBefore);
    conn.seekToOffset(-1);
    expect(conn.messageCursor()).toBe(cursorBefore);
  });

  it('seekToOffset(N) applies perspective swap on boardStateSnapshot', () => {
    const perspective = signal<0 | 1>(1);
    const swapConn = new MockDuelConnection({
      duelCtx: { perspective: () => perspective },
    });
    try {
      const absBs = boardState({
        turnPlayer: 0,
        players: [
          { lp: 7000, deckCount: 30, extraCount: 10, zones: [] },
          { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
        ],
      });
      swapConn.appendChunk({
        messages: [],
        autoResponses: [],
        navEntries: [
          { messageOffset: 0, label: 'Seek target', turnNumber: 1, boardStateSnapshot: absBs, events: [], responseCount: 0 },
        ],
      });
      swapConn.seekToOffset(0);
      // After swap: turnPlayer flipped + players reversed
      const logical = swapConn.renderedBoardState.logicalState();
      expect(logical.turnPlayer).toBe(1);
      expect(logical.players[0].lp).toBe(8000);
      expect(logical.players[1].lp).toBe(7000);
    } finally {
      swapConn.cleanup();
    }
  });

  it('loadStreamInit replaces navIndex with the authoritative final list', () => {
    conn.appendChunk({
      messages: [msgDraw()],
      autoResponses: [],
      navEntries: [
        { messageOffset: 1, label: 'A', turnNumber: 0, boardStateSnapshot: boardState(), events: [], responseCount: 0 },
      ],
    });
    expect(conn.navIndex().length).toBe(1);
    expect(conn.totalMessages()).toBeNull();

    conn.loadStreamInit({
      totalMessages: 1,
      navIndex: [
        { messageOffset: 1, label: 'A-final', turnNumber: 0, boardStateSnapshot: boardState(), events: [], responseCount: 0 },
      ],
    });
    expect(conn.totalMessages()).toBe(1);
    expect(conn.navIndex()[0].label).toBe('A-final');
  });
});
