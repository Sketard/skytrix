import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureFirstPlayerCoordinator,
  startFirstPlayerPhase,
  handlePreDuelResponse,
  disposeFirstPlayer,
  DICE_TIE_REROLL_MS,
  DICE_SUSPENSE_MS,
  FINAL_BANNER_MS,
  type FirstPlayerCoordinatorConfig,
} from './first-player-coordinator.js';
import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';

// =============================================================================
// Fixtures
// =============================================================================

const DICE_ROLL_TIMEOUT_MS = 30_000;
const FIRST_PLAYER_TIMEOUT_MS = 15_000;

interface SentMessage {
  player: 0 | 1;
  message: ServerMessage;
}

interface SpyHooks {
  sent: SentMessage[];
  filterCalls: { msg: ServerMessage; playerIndex: Player }[];
  starts: { firstPlayer: 0 | 1 }[];
}

function makeSpy(): SpyHooks {
  return { sent: [], filterCalls: [], starts: [] };
}

function makeConfig(spy: SpyHooks, overrides: Partial<FirstPlayerCoordinatorConfig> = {}): FirstPlayerCoordinatorConfig {
  return {
    sendToPlayer: (_s, p, message) => spy.sent.push({ player: p, message }),
    filterMessage: (msg, playerIndex) => {
      spy.filterCalls.push({ msg, playerIndex });
      return msg;
    },
    startDuelWithOrder: (_s, firstPlayer) => spy.starts.push({ firstPlayer }),
    diceRollTimeoutMs: DICE_ROLL_TIMEOUT_MS,
    firstPlayerTimeoutMs: FIRST_PLAYER_TIMEOUT_MS,
    ...overrides,
  };
}

function makeSession(): ActiveDuelSession {
  return {
    duelId: 'test-duel',
    players: [
      { playerId: 'p0', playerIndex: 0, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: 'p1', playerIndex: 1, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    phase: 'WAITING_PLAYERS',
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
    preservationTimer: null,
    bothDisconnected: false,
    combinedGraceTimer: null,
    storedDuelResult: null,
    lastStateSyncAt: [0, 0],
    lastCancelAt: [0, 0],
    cancelTargetPrompt: [null, null],
    timerContext: null,
    soloMode: false,
    skipShuffle: false,
    turnTimeSecs: 300,
    invalidResponseCount: [0, 0],
    promptSentAt: [0, 0],
    activeChainLinks: [],
    chainPhase: 'idle',
    negatedChainIndices: new Set(),
    currentSolvingChainIndex: null,
    playerUsernames: ['p0', 'p1'],
    deckNames: ['d0', 'd1'],
    pendingReplayResult: null,
    forkConnectionTimeout: null,
  } as unknown as ActiveDuelSession;
}

function diceResultMsgs(spy: SpyHooks): SentMessage[] {
  return spy.sent.filter(s => s.message.type === 'DICE_RESULT');
}

function firstPlayerResultMsgs(spy: SpyHooks): SentMessage[] {
  return spy.sent.filter(s => s.message.type === 'FIRST_PLAYER_RESULT');
}

// Mock Math.random to produce a deterministic sequence: dice[0]+dice[1] for
// each player. Each rollDice() call consumes 2 random values.
function mockDice(...values: number[]): () => number {
  let i = 0;
  // Each `rollDice` does `1 + Math.floor(Math.random() * 6)` so to force a
  // die value `v` we need `(v - 1) / 6` ≤ random < v/6. Using `(v - 1) / 6`
  // for safety against rounding (Math.floor(((v-1)/6)*6) === v-1).
  return () => {
    const v = values[i++ % values.length];
    return (v! - 1) / 6;
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('first-player-coordinator', () => {
  let spy: SpyHooks;
  let s: ActiveDuelSession;

  beforeEach(() => {
    vi.useFakeTimers();
    spy = makeSpy();
    s = makeSession();
    configureFirstPlayerCoordinator(makeConfig(spy));
  });
  afterEach(() => vi.useRealTimers());

  // ==========================================================================
  // startFirstPlayerPhase
  // ==========================================================================

  describe('startFirstPlayerPhase', () => {
    it('sets phase=ROLLING_DICE, builds firstPlayerState, sends DICE_ROLL to both', () => {
      startFirstPlayerPhase(s);

      expect(s.phase).toBe('ROLLING_DICE');
      expect(s.firstPlayerState).not.toBeNull();
      expect(s.firstPlayerState!.rolls).toEqual([null, null]);
      expect(s.firstPlayerState!.round).toBe(0);
      expect(s.awaitingResponse).toEqual([true, true]);
      const prompts = spy.sent.filter(x => x.message.type === 'DICE_ROLL');
      expect(prompts).toHaveLength(2);
      expect(prompts[0]!.player).toBe(0);
      expect(prompts[1]!.player).toBe(1);
    });

    it('auto-rolls both players after diceRollTimeoutMs', () => {
// Force same dice for both = tie → DICE_RESULT with winner=null.
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(3, 4, 3, 4));

      startFirstPlayerPhase(s);
      vi.advanceTimersByTime(DICE_ROLL_TIMEOUT_MS);

      const results = diceResultMsgs(spy);
      expect(results).toHaveLength(2);
      const m = results[0]!.message as Extract<ServerMessage, { type: 'DICE_RESULT' }>;
      expect(m.dice0).toEqual([3, 4]);
      expect(m.dice1).toEqual([3, 4]);
      expect(m.sum0).toBe(7);
      expect(m.sum1).toBe(7);
      expect(m.winner).toBeNull();

      rndSpy.mockRestore();
    });
  });

  // ==========================================================================
  // resolveDiceRound — winner formula
  // ==========================================================================

  describe('resolveDiceRound — winner formula', () => {
    it('higher sum wins (player 0)', () => {
// P0 rolls [6,6]=12, P1 rolls [1,1]=2.
            const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1));

      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      const m = diceResultMsgs(spy)[0]!.message as Extract<ServerMessage, { type: 'DICE_RESULT' }>;
      expect(m.sum0).toBe(12);
      expect(m.sum1).toBe(2);
      expect(m.winner).toBe(0);

      rndSpy.mockRestore();
    });

    it('higher sum wins (player 1)', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(2, 3, 5, 6));

      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      const m = diceResultMsgs(spy)[0]!.message as Extract<ServerMessage, { type: 'DICE_RESULT' }>;
      expect(m.winner).toBe(1);

      rndSpy.mockRestore();
    });

    it('tie → winner null and auto-reroll after 1.8s', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(4, 5, 5, 4));

      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      const r1 = diceResultMsgs(spy)[0]!.message as Extract<ServerMessage, { type: 'DICE_RESULT' }>;
      expect(r1.sum0).toBe(9);
      expect(r1.sum1).toBe(9);
      expect(r1.winner).toBeNull();

      // No reroll prompt yet.
      const promptsBefore = spy.sent.filter(x => x.message.type === 'DICE_ROLL');
      expect(promptsBefore).toHaveLength(2); // initial only

      // Advance past the 1.8s suspense.
      vi.advanceTimersByTime(DICE_TIE_REROLL_MS);
      const promptsAfter = spy.sent.filter(x => x.message.type === 'DICE_ROLL');
      expect(promptsAfter).toHaveLength(4); // 2 initial + 2 reroll
      expect(s.firstPlayerState!.round).toBe(1);

      rndSpy.mockRestore();
    });

    it('forces a winner after the 10th consecutive tie (MAX_ROUNDS)', () => {
// round=9 → this resolution is round 10 → must force a winner.
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(() => 0.99);

      startFirstPlayerPhase(s, 9);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      const m = diceResultMsgs(spy)[0]!.message as Extract<ServerMessage, { type: 'DICE_RESULT' }>;
      expect(m.winner).not.toBeNull();

      rndSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Perspective filtering
  // ==========================================================================

  describe('resolveDiceRound — perspective filtering', () => {
    it('runs DICE_RESULT through filterMessage once per player', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1));

      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      const filterCalls = spy.filterCalls.filter(c => c.msg.type === 'DICE_RESULT');
      expect(filterCalls).toHaveLength(2);
      expect(filterCalls.map(c => c.playerIndex).sort()).toEqual([0, 1]);

      rndSpy.mockRestore();
    });

    it('skips the send when filterMessage returns null for that player', () => {
      // Re-configure with a custom filterMessage — beforeEach's default
      // identity filter is overridden by the second `configure` call.
      configureFirstPlayerCoordinator(makeConfig(spy, {
        filterMessage: (msg, p) => (p === 1 && msg.type === 'DICE_RESULT' ? null : msg),
      }));
            const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1));

      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      const results = diceResultMsgs(spy);
      expect(results).toHaveLength(1);
      expect(results[0]!.player).toBe(0);

      rndSpy.mockRestore();
    });
  });

  // ==========================================================================
  // CHOOSE_FIRST_PLAYER transition
  // ==========================================================================

  describe('CHOOSE_FIRST_PLAYER transition', () => {
    it('promotes to CHOOSE_FIRST_PLAYER after the 1.5s suspense and prompts the winner only', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1));

      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});
      expect(s.phase).toBe('DICE_RESOLVED');

      vi.advanceTimersByTime(DICE_SUSPENSE_MS);

      expect(s.phase).toBe('CHOOSE_FIRST_PLAYER');
      expect(s.awaitingResponse).toEqual([true, false]);
      const prompts = spy.sent.filter(x => x.message.type === 'SELECT_FIRST_PLAYER');
      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.player).toBe(0);
      const waiting = spy.sent.filter(x => x.message.type === 'WAITING_RESPONSE');
      expect(waiting).toHaveLength(1);
      expect(waiting[0]!.player).toBe(1);

      rndSpy.mockRestore();
    });
  });

  // ==========================================================================
  // handlePreDuelResponse — SELECT_FIRST_PLAYER branch
  // ==========================================================================

  describe('handlePreDuelResponse — SELECT_FIRST_PLAYER', () => {
    function arriveAtChoose(spy: SpyHooks, s: ActiveDuelSession, winner: 0 | 1 = 0): () => void {
      const rndSpy = winner === 0
        ? vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1))
        : vi.spyOn(Math, 'random').mockImplementation(mockDice(1, 1, 6, 6));
      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});
      vi.advanceTimersByTime(DICE_SUSPENSE_MS);
      return () => rndSpy.mockRestore();
    }

    it('goFirst=true keeps the responding player going first', () => {
      const cleanup = arriveAtChoose(spy, s, 0);

      const handled = handlePreDuelResponse(s, 0, 'SELECT_FIRST_PLAYER', { goFirst: true });
      expect(handled).toBe(true);
      expect(s.phase).toBe('FIRST_PLAYER_RESOLVED');
      // Stored for refresh-resync: sendStateSnapshot reads this to re-emit
      // FIRST_PLAYER_RESULT during the 2.5s announce window.
      expect(s.chosenFirstPlayer).toBe(0);

      const finals = firstPlayerResultMsgs(spy);
      expect(finals).toHaveLength(2);
      const for0 = finals.find(x => x.player === 0)!.message as Extract<ServerMessage, { type: 'FIRST_PLAYER_RESULT' }>;
      const for1 = finals.find(x => x.player === 1)!.message as Extract<ServerMessage, { type: 'FIRST_PLAYER_RESULT' }>;
      expect(for0.goFirst).toBe(true);
      expect(for1.goFirst).toBe(false);

      cleanup();
    });

    it('goFirst=false flips: opponent goes first', () => {
      const cleanup = arriveAtChoose(spy, s, 0);

      handlePreDuelResponse(s, 0, 'SELECT_FIRST_PLAYER', { goFirst: false });

      const finals = firstPlayerResultMsgs(spy);
      const for0 = finals.find(x => x.player === 0)!.message as Extract<ServerMessage, { type: 'FIRST_PLAYER_RESULT' }>;
      expect(for0.goFirst).toBe(false);

      cleanup();
    });

    it('emits DECK_PREFETCH BEFORE FIRST_PLAYER_RESULT, with per-player cardCodes (no spoil)', () => {
      // Regression guard: a 2026-05-13 audit "dead-code purge" silently
      // dropped both DECK_PREFETCH emissions, which surfaced as blank
      // card art in the opening hand because the FINAL_BANNER_MS window
      // (2.5s warmup) had nothing to prefetch. Restored 2026-05-14.
      s.decks = [
        { main: [10, 20, 30], extra: [40] },
        { main: [50, 60, 70], extra: [80] },
      ];
      const cleanup = arriveAtChoose(spy, s, 0);

      handlePreDuelResponse(s, 0, 'SELECT_FIRST_PLAYER', { goFirst: true });

      // Find the DECK_PREFETCH messages and the FIRST_PLAYER_RESULT
      // messages by their position in the sent log.
      const prefetchIdxP0 = spy.sent.findIndex(s => s.message.type === 'DECK_PREFETCH' && s.player === 0);
      const prefetchIdxP1 = spy.sent.findIndex(s => s.message.type === 'DECK_PREFETCH' && s.player === 1);
      const finalIdxP0 = spy.sent.findIndex(s => s.message.type === 'FIRST_PLAYER_RESULT' && s.player === 0);
      expect(prefetchIdxP0, 'DECK_PREFETCH must be emitted to player 0').toBeGreaterThanOrEqual(0);
      expect(prefetchIdxP1, 'DECK_PREFETCH must be emitted to player 1').toBeGreaterThanOrEqual(0);
      expect(prefetchIdxP0, 'DECK_PREFETCH must precede FIRST_PLAYER_RESULT (warmup window)').toBeLessThan(finalIdxP0);

      const p0Prefetch = spy.sent[prefetchIdxP0]!.message as Extract<ServerMessage, { type: 'DECK_PREFETCH' }>;
      const p1Prefetch = spy.sent[prefetchIdxP1]!.message as Extract<ServerMessage, { type: 'DECK_PREFETCH' }>;
      expect(p0Prefetch.cardCodes.length, 'player 0 must receive their own cardCodes').toBeGreaterThan(0);
      expect(p1Prefetch.cardCodes.length, 'player 1 must receive their own cardCodes').toBeGreaterThan(0);

      // No-spoil: each side receives ONLY their own deck — opponent
      // codes must not leak through DECK_PREFETCH.
      expect(p0Prefetch.cardCodes).not.toContain(50);
      expect(p1Prefetch.cardCodes).not.toContain(10);

      cleanup();
    });

    it('calls startDuelWithOrder after the 2.5s banner delay', () => {
      const cleanup = arriveAtChoose(spy, s, 0);

      handlePreDuelResponse(s, 0, 'SELECT_FIRST_PLAYER', { goFirst: true });
      expect(spy.starts).toHaveLength(0);

      vi.advanceTimersByTime(FINAL_BANNER_MS);
      expect(spy.starts).toEqual([{ firstPlayer: 0 }]);

      cleanup();
    });

    it('firstPlayerTimeout auto-resolves as "winner goes first"', () => {
      const cleanup = arriveAtChoose(spy, s, 1);

      // Winner stays silent for the configured firstPlayerTimeoutMs (15_000).
      vi.advanceTimersByTime(FIRST_PLAYER_TIMEOUT_MS);
      expect(s.phase).toBe('FIRST_PLAYER_RESOLVED');
      const finals = firstPlayerResultMsgs(spy);
      const for1 = finals.find(x => x.player === 1)!.message as Extract<ServerMessage, { type: 'FIRST_PLAYER_RESULT' }>;
      expect(for1.goFirst).toBe(true);

      vi.advanceTimersByTime(FINAL_BANNER_MS);
      expect(spy.starts).toEqual([{ firstPlayer: 1 }]);

      cleanup();
    });
  });

  // ==========================================================================
  // handlePreDuelResponse — DICE_ROLL invariants
  // ==========================================================================

  describe('handlePreDuelResponse — DICE_ROLL invariants', () => {
    it('returns true for the DICE_ROLL prompt during ROLLING_DICE phase', () => {
startFirstPlayerPhase(s);
      expect(handlePreDuelResponse(s, 0, 'DICE_ROLL', {})).toBe(true);
    });

    it('ignores a second confirmation from the same player (no double-roll)', () => {
const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(3, 3));
      startFirstPlayerPhase(s);

      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      const firstRoll = s.firstPlayerState!.rolls[0];

      handlePreDuelResponse(s, 0, 'DICE_ROLL', {}); // ignored

      expect(s.firstPlayerState!.rolls[0]).toEqual(firstRoll);

      rndSpy.mockRestore();
    });

    it('does not resolve until both have confirmed', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1));
      startFirstPlayerPhase(s);

      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      expect(diceResultMsgs(spy)).toHaveLength(0);

      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});
      expect(diceResultMsgs(spy)).toHaveLength(2);

      rndSpy.mockRestore();
    });

    it('returns false for prompts that are not pre-duel (e.g. SELECT_CARD)', () => {
s.phase = 'DUELING';
      expect(handlePreDuelResponse(s, 0, 'SELECT_CARD', { selectedIndices: [0] })).toBe(false);
    });

    it('returns false when phase is not ROLLING_DICE even if promptType is DICE_ROLL', () => {
s.phase = 'DUELING';
      expect(handlePreDuelResponse(s, 0, 'DICE_ROLL', {})).toBe(false);
    });
  });

  // ==========================================================================
  // disposeFirstPlayer
  // ==========================================================================

  describe('disposeFirstPlayer', () => {
    it('clears all timers and nulls firstPlayerState + chosenFirstPlayer', () => {
      startFirstPlayerPhase(s);
      s.chosenFirstPlayer = 1;

      disposeFirstPlayer(s);

      expect(s.firstPlayerState).toBeNull();
      expect(s.chosenFirstPlayer).toBeNull();
      vi.advanceTimersByTime(DICE_ROLL_TIMEOUT_MS);
      expect(diceResultMsgs(spy)).toHaveLength(0);
    });

    it('is idempotent (safe when firstPlayerState is already null)', () => {

      expect(() => disposeFirstPlayer(s)).not.toThrow();
      expect(s.firstPlayerState).toBeNull();
    });

    it('the firstPlayer-timeout timer is cleared on dispose', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1));
      startFirstPlayerPhase(s);
      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});
      vi.advanceTimersByTime(DICE_SUSPENSE_MS); // arrive at CHOOSE_FIRST_PLAYER

      disposeFirstPlayer(s);
      vi.advanceTimersByTime(FIRST_PLAYER_TIMEOUT_MS);
      expect(firstPlayerResultMsgs(spy)).toHaveLength(0);

      rndSpy.mockRestore();
    });

    it('the 1.8s tie reroll timer is cleared on dispose', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(4, 5, 5, 4));
      startFirstPlayerPhase(s);

      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      disposeFirstPlayer(s);
      vi.advanceTimersByTime(DICE_TIE_REROLL_MS);

      const newPrompts = spy.sent.filter(x => x.message.type === 'DICE_ROLL');
      // 2 initial only — a zombie reroll would push to 4.
      expect(newPrompts).toHaveLength(2);

      rndSpy.mockRestore();
    });

    it('the 1.5s DICE_RESOLVED transition timer is cleared on dispose', () => {
      const rndSpy = vi.spyOn(Math, 'random').mockImplementation(mockDice(6, 6, 1, 1));
      startFirstPlayerPhase(s);

      handlePreDuelResponse(s, 0, 'DICE_ROLL', {});
      handlePreDuelResponse(s, 1, 'DICE_ROLL', {});

      disposeFirstPlayer(s);
      vi.advanceTimersByTime(DICE_SUSPENSE_MS);

      expect(spy.sent.find(x => x.message.type === 'SELECT_FIRST_PLAYER')).toBeUndefined();
      expect(spy.sent.find(x => x.message.type === 'WAITING_RESPONSE')).toBeUndefined();

      rndSpy.mockRestore();
    });
  });
});
