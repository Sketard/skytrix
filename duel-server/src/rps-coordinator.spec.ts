import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureRpsCoordinator,
  startRpsPhase,
  handlePreDuelResponse,
  disposeRps,
  type RpsCoordinatorConfig,
} from './rps-coordinator.js';
import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';

// =============================================================================
// Fixtures
// =============================================================================

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

function makeConfig(spy: SpyHooks, overrides: Partial<RpsCoordinatorConfig> = {}): RpsCoordinatorConfig {
  return {
    sendToPlayer: (_s, p, message) => spy.sent.push({ player: p, message }),
    filterMessage: (msg, playerIndex) => {
      spy.filterCalls.push({ msg, playerIndex });
      return msg;
    },
    startDuelWithOrder: (_s, firstPlayer) => spy.starts.push({ firstPlayer }),
    rpsTimeoutMs: 10_000,
    tpTimeoutMs: 30_000,
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
    rpsState: null,
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

function rpsResultMsgs(spy: SpyHooks): SentMessage[] {
  return spy.sent.filter(s => s.message.type === 'RPS_RESULT');
}

function tpResultMsgs(spy: SpyHooks): SentMessage[] {
  return spy.sent.filter(s => s.message.type === 'TP_RESULT');
}

// =============================================================================
// Tests
// =============================================================================

describe('rps-coordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ==========================================================================
  // startRpsPhase
  // ==========================================================================

  describe('startRpsPhase', () => {
    it('sets phase=RPS, builds rpsState, and sends RPS_CHOICE to both players', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();

      startRpsPhase(s);

      expect(s.phase).toBe('RPS');
      expect(s.rpsState).not.toBeNull();
      expect(s.rpsState!.choices).toEqual([null, null]);
      expect(s.rpsState!.round).toBe(0);
      expect(s.awaitingResponse).toEqual([true, true]);
      const choices = spy.sent.filter(x => x.message.type === 'RPS_CHOICE');
      expect(choices).toHaveLength(2);
      expect(choices[0]!.player).toBe(0);
      expect(choices[1]!.player).toBe(1);
      expect(s.lastSentPrompt[0]).toEqual({ type: 'RPS_CHOICE', player: 0 });
      expect(s.lastSentPrompt[1]).toEqual({ type: 'RPS_CHOICE', player: 1 });
    });

    it('carries the round number through (used by draw-restart)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();

      startRpsPhase(s, 4);

      expect(s.rpsState!.round).toBe(4);
    });

    it('auto-fills both choices and resolves after rpsTimeoutMs', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();

      // Force deterministic random choices: both pick 0 (Rock) → draw.
      const rndSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

      startRpsPhase(s);
      vi.advanceTimersByTime(10_000);

      // Both random choices → both 0 → draw → RPS_RESULT with winner=null
      const results = rpsResultMsgs(spy);
      expect(results).toHaveLength(2);
      for (const r of results) {
        const m = r.message as Extract<ServerMessage, { type: 'RPS_RESULT' }>;
        expect(m.player1Choice).toBe(0);
        expect(m.player2Choice).toBe(0);
        expect(m.winner).toBeNull();
      }

      rndSpy.mockRestore();
    });
  });

  // ==========================================================================
  // resolveRps — winner formula (the bug fixed at ad041d14)
  // ==========================================================================

  describe('resolveRps — winner formula', () => {
    const cases: Array<{ c0: number; c1: number; winner: 0 | 1 }> = [
      { c0: 0, c1: 2, winner: 0 }, // Rock beats Scissors
      { c0: 2, c1: 0, winner: 1 },
      { c0: 2, c1: 1, winner: 0 }, // Scissors beats Paper
      { c0: 1, c1: 2, winner: 1 },
      { c0: 1, c1: 0, winner: 0 }, // Paper beats Rock
      { c0: 0, c1: 1, winner: 1 },
    ];

    for (const { c0, c1, winner } of cases) {
      it(`c0=${c0} vs c1=${c1} → winner=${winner}`, () => {
        const spy = makeSpy();
        configureRpsCoordinator(makeConfig(spy));
        const s = makeSession();
        startRpsPhase(s);
        handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: c0 });
        handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: c1 });

        const results = rpsResultMsgs(spy);
        expect(results).toHaveLength(2);
        const m = results[0]!.message as Extract<ServerMessage, { type: 'RPS_RESULT' }>;
        expect(m.winner).toBe(winner);
      });
    }

    it('emits winner=null on a draw (rounds 0..8)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);
      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 1 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 1 });

      const m = rpsResultMsgs(spy)[0]!.message as Extract<ServerMessage, { type: 'RPS_RESULT' }>;
      expect(m.winner).toBeNull();
    });

    it('forces a winner after the 10th consecutive draw (MAX_RPS_ROUNDS)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      // round=9 means this resolution is round 10 → must force a winner.
      startRpsPhase(s, 9);

      // Force the random tiebreak to pick player 1.
      const rndSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 2 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });

      const m = rpsResultMsgs(spy)[0]!.message as Extract<ServerMessage, { type: 'RPS_RESULT' }>;
      expect(m.winner).toBe(1);

      rndSpy.mockRestore();
    });
  });

  // ==========================================================================
  // resolveRps — perspective filtering
  // ==========================================================================

  describe('resolveRps — perspective filtering', () => {
    it('runs RPS_RESULT through filterMessage once per player', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });

      const rpsFilterCalls = spy.filterCalls.filter(c => c.msg.type === 'RPS_RESULT');
      expect(rpsFilterCalls).toHaveLength(2);
      expect(rpsFilterCalls.map(c => c.playerIndex).sort()).toEqual([0, 1]);
    });

    it('skips the send when filterMessage returns null for that player', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy, {
        filterMessage: (msg, p) => (p === 1 && msg.type === 'RPS_RESULT' ? null : msg),
      }));
      const s = makeSession();
      startRpsPhase(s);

      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });

      const results = rpsResultMsgs(spy);
      expect(results).toHaveLength(1);
      expect(results[0]!.player).toBe(0);
    });
  });

  // ==========================================================================
  // CHOOSE_ORDER transition
  // ==========================================================================

  describe('CHOOSE_ORDER transition', () => {
    it('promotes to CHOOSE_ORDER after the 1.5s post-RPS delay and sends SELECT_TP to the winner only', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });
      // Phase still RPS until the 1.5s delay expires
      expect(s.phase).toBe('RPS');

      vi.advanceTimersByTime(1500);

      expect(s.phase).toBe('CHOOSE_ORDER');
      expect(s.awaitingResponse).toEqual([true, false]);
      const tp = spy.sent.filter(x => x.message.type === 'SELECT_TP');
      expect(tp).toHaveLength(1);
      expect(tp[0]!.player).toBe(0);
      const waiting = spy.sent.filter(x => x.message.type === 'WAITING_RESPONSE');
      expect(waiting).toHaveLength(1);
      expect(waiting[0]!.player).toBe(1);
    });
  });

  // ==========================================================================
  // handlePreDuelResponse — SELECT_TP branch
  // ==========================================================================

  describe('handlePreDuelResponse — SELECT_TP', () => {
    function arriveAtChooseOrder(spy: SpyHooks, s: ActiveDuelSession, winnerPlayer: 0 | 1 = 0): void {
      startRpsPhase(s);
      // Winner = 0 by Rock vs Scissors. To make winner=1 use (c0=2, c1=0).
      if (winnerPlayer === 0) {
        handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
        handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });
      } else {
        handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 2 });
        handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 0 });
      }
      vi.advanceTimersByTime(1500);
    }

    it('goFirst=true keeps the responding player going first', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      arriveAtChooseOrder(spy, s, 0);

      const handled = handlePreDuelResponse(s, 0, 'SELECT_TP', { goFirst: true });
      expect(handled).toBe(true);
      expect(s.phase).toBe('TP_RESULT');

      const tps = tpResultMsgs(spy);
      expect(tps).toHaveLength(2);
      const tpFor0 = tps.find(x => x.player === 0)!.message as Extract<ServerMessage, { type: 'TP_RESULT' }>;
      const tpFor1 = tps.find(x => x.player === 1)!.message as Extract<ServerMessage, { type: 'TP_RESULT' }>;
      expect(tpFor0.goFirst).toBe(true);
      expect(tpFor1.goFirst).toBe(false);
    });

    it('goFirst=false flips: opponent goes first', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      arriveAtChooseOrder(spy, s, 0);

      handlePreDuelResponse(s, 0, 'SELECT_TP', { goFirst: false });

      const tps = tpResultMsgs(spy);
      const tpFor0 = tps.find(x => x.player === 0)!.message as Extract<ServerMessage, { type: 'TP_RESULT' }>;
      expect(tpFor0.goFirst).toBe(false);
    });

    it('calls startDuelWithOrder after the 1s TP_RESULT → DUELING delay', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      arriveAtChooseOrder(spy, s, 0);

      handlePreDuelResponse(s, 0, 'SELECT_TP', { goFirst: true });
      expect(spy.starts).toHaveLength(0);

      vi.advanceTimersByTime(1000);
      expect(spy.starts).toEqual([{ firstPlayer: 0 }]);
    });

    it('TP_TIMEOUT auto-resolves as "winner goes first"', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      arriveAtChooseOrder(spy, s, 1);

      // No SELECT_TP response — let the configured tpTimeoutMs fire (30_000).
      vi.advanceTimersByTime(30_000);
      expect(s.phase).toBe('TP_RESULT');
      const tps = tpResultMsgs(spy);
      const tpFor1 = tps.find(x => x.player === 1)!.message as Extract<ServerMessage, { type: 'TP_RESULT' }>;
      expect(tpFor1.goFirst).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(spy.starts).toEqual([{ firstPlayer: 1 }]);
    });
  });

  // ==========================================================================
  // handlePreDuelResponse — RPS_CHOICE invariants
  // ==========================================================================

  describe('handlePreDuelResponse — RPS_CHOICE invariants', () => {
    it('returns true for the RPS_CHOICE prompt during RPS phase', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);
      expect(handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 1 })).toBe(true);
    });

    it('ignores invalid choice values (negative / >2 / non-number)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: -1 });
      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 3 });
      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 'rock' as unknown as number });

      expect(s.rpsState!.choices[0]).toBeNull();
      expect(s.awaitingResponse[0]).toBe(true);
    });

    it('ignores a second answer from the same player', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 2 }); // ignored

      expect(s.rpsState!.choices[0]).toBe(0);
    });

    it('does not resolve until both have answered', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
      expect(rpsResultMsgs(spy)).toHaveLength(0);

      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });
      expect(rpsResultMsgs(spy)).toHaveLength(2);
    });

    it('returns false for prompts that are not pre-duel (e.g. SELECT_CARD)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      s.phase = 'DUELING';
      expect(handlePreDuelResponse(s, 0, 'SELECT_CARD', { selectedIndices: [0] })).toBe(false);
    });

    it('returns false when phase is not RPS even if promptType is RPS_CHOICE', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      s.phase = 'DUELING';
      expect(handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 })).toBe(false);
    });
  });

  // ==========================================================================
  // disposeRps
  // ==========================================================================

  describe('disposeRps', () => {
    it('clears all RPS timers and nulls rpsState', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      disposeRps(s);

      expect(s.rpsState).toBeNull();
      // The pending auto-resolve timer was cleared — no RPS_RESULT after rpsTimeoutMs.
      vi.advanceTimersByTime(10_000);
      expect(rpsResultMsgs(spy)).toHaveLength(0);
    });

    it('is idempotent (safe to call when rpsState is already null)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();

      expect(() => disposeRps(s)).not.toThrow();
      expect(s.rpsState).toBeNull();
    });

    it('the TP-timeout timer is cleared on dispose (covers the rematch path)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);
      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });
      vi.advanceTimersByTime(1500); // arrive at CHOOSE_ORDER + arm TP timeout

      disposeRps(s);
      // TP-timeout was tracked in rpsState.timers → cleared.
      vi.advanceTimersByTime(30_000);
      expect(tpResultMsgs(spy)).toHaveLength(0);
    });

    it('the 2s draw-restart timer is cleared on dispose (no zombie next-round)', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      // Both pick Paper → draw → 2s restart timer armed.
      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 1 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 1 });

      disposeRps(s);
      vi.advanceTimersByTime(2000);

      // No new RPS_CHOICE prompt — startRpsPhase did not re-fire.
      const newPrompts = spy.sent.filter(x => x.message.type === 'RPS_CHOICE');
      // Initial startRpsPhase sent 2 RPS_CHOICE prompts (one per player); a
      // zombie restart would push that to 4.
      expect(newPrompts).toHaveLength(2);
    });

    it('the 1.5s RPS → CHOOSE_ORDER transition timer is cleared on dispose', () => {
      const spy = makeSpy();
      configureRpsCoordinator(makeConfig(spy));
      const s = makeSession();
      startRpsPhase(s);

      // Resolve with a clear winner → arms the 1.5s transition timer.
      handlePreDuelResponse(s, 0, 'RPS_CHOICE', { choice: 0 });
      handlePreDuelResponse(s, 1, 'RPS_CHOICE', { choice: 2 });

      // Dispose BEFORE the 1.5s fires.
      disposeRps(s);
      vi.advanceTimersByTime(1500);

      // Phase was reset to whatever it was — the callback's phase-guard
      // catches it, AND no SELECT_TP / WAITING_RESPONSE is emitted.
      expect(spy.sent.find(x => x.message.type === 'SELECT_TP')).toBeUndefined();
      expect(spy.sent.find(x => x.message.type === 'WAITING_RESPONSE')).toBeUndefined();
    });
  });
});
