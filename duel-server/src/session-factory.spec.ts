import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialSessionState, resetSessionForRematch } from './session-factory.js';
import type { Deck, PlayerSession } from './types.js';

/**
 * U15 (audit-4-modes-2026-06-01) — `createInitialSessionState` consolidates
 * the 3 historical ctor sites (PvP normal in server.ts, fork-solo in
 * fork-handlers.ts, rematch reset in server.ts startRematch) into 2 helpers.
 *
 * These specs pin :
 *  - mode-derived defaults (`phase`, `startedAt`, `skipShuffle`)
 *  - explicit overrides win over the mode-derived defaults
 *  - long-lived fields survive `resetSessionForRematch`
 *  - per-duel state is wiped by `resetSessionForRematch`
 *
 * A future change that drifts the defaults or forgets to clear a per-duel
 * field gets caught here BEFORE it ships.
 */

function makePlayer(idx: 0 | 1, id = `p${idx}`): PlayerSession {
  return {
    playerId: id,
    playerIndex: idx,
    ws: null,
    connected: false,
    disconnectedAt: null,
    reconnectToken: null,
    gracePeriodTimer: null,
    inactivitySlot: null,
  };
}

function makeDeck(): Deck {
  return { main: [], extra: [] };
}

describe('createInitialSessionState (U15)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('PvP defaults: phase=WAITING_PLAYERS, startedAt=null, forkMode=false', () => {
    const s = createInitialSessionState({
      duelId: 'd1',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: false,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
    });
    expect(s.phase).toBe('WAITING_PLAYERS');
    expect(s.startedAt).toBeNull();
    expect(s.forkMode).toBe(false);
    expect(s.soloMode).toBe(false);
    expect(s.skipShuffle).toBe(false);
    expect(s.worker).toBeNull();
    expect(s.turnTimeSecs).toBe(300);
  });

  it('fork-solo defaults: phase=DUELING, startedAt=now(), skipShuffle=true', () => {
    const s = createInitialSessionState({
      duelId: 'd-fork',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: true,
      forkMode: true,
      worker: null,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
    });
    expect(s.phase).toBe('DUELING');
    expect(s.startedAt).toBe(Date.now());
    expect(s.forkMode).toBe(true);
    expect(s.soloMode).toBe(true);
    expect(s.skipShuffle).toBe(true);
  });

  it('explicit overrides win over mode-derived defaults', () => {
    // Pathological combination — PvP with manual DUELING phase + startedAt + skipShuffle.
    // Real callers don't mix these, but the override path must work so a future
    // mode (tutorial, practice) can use the same factory.
    const s = createInitialSessionState({
      duelId: 'd-test',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: false,
      playerUsernames: ['x', 'y'],
      deckNames: ['x', 'y'],
      phase: 'DUELING',
      startedAt: 123,
      skipShuffle: true,
      turnTimeSecs: 600,
    });
    expect(s.phase).toBe('DUELING');
    expect(s.startedAt).toBe(123);
    expect(s.skipShuffle).toBe(true);
    expect(s.turnTimeSecs).toBe(600);
  });

  it('throws when forkMode: true is paired with soloMode: false (F5-bis invariant)', () => {
    // U15 review-fix — CLAUDE.md F5-bis: forkMode implies soloMode. Pre-fix
    // the factory accepted the pathological pair silently, then the
    // resulting session would walk through SOLO-aware code paths without
    // the soloMode gate, surfacing as obscure runtime bugs downstream.
    expect(() =>
      createInitialSessionState({
        duelId: 'd-bad',
        players: [makePlayer(0), makePlayer(1)],
        decks: [makeDeck(), makeDeck()],
        soloMode: false,
        forkMode: true,
        playerUsernames: ['x', 'y'],
        deckNames: ['x', 'y'],
      })
    ).toThrowError(/forkMode requires soloMode/);
  });

  it('every ActiveDuelSession field is populated by the factory (enumeration)', () => {
    const s = createInitialSessionState({
      duelId: 'd1',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: false,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
    });

    // Enumeration : assert that EVERY key the factory writes resolves to a
    // defined value (no missing field that would surface as `undefined` at
    // runtime). Drift detection : if a future ActiveDuelSession field is
    // added but the factory forgets to populate it, TS will catch the type
    // error AND this loop will assert the missing key.
    const EXPECTED_KEYS: ReadonlyArray<keyof typeof s> = [
      'duelId', 'phase', 'firstPlayerState', 'chosenFirstPlayer', 'players',
      'createdAt', 'startedAt', 'endedAt', 'worker', 'workerTerminated',
      'awaitingResponse', 'lastBoardState', 'lastSentPrompt', 'lastSentHint',
      'decks', 'rematchRequested', 'rematchTimeout', 'preservationTimer',
      'bothDisconnected', 'combinedGraceTimer', 'storedDuelResult',
      'lastStateSyncAt', 'lastCancelAt', 'cancelTargetPrompt', 'timerContext',
      'soloMode', 'forkMode', 'skipShuffle', 'turnTimeSecs',
      'invalidResponseCount', 'promptSentAt', 'activeChainLinks',
      'chainPhase', 'negatedChainIndices', 'currentSolvingChainIndex',
      'playerUsernames', 'deckNames', 'pendingReplayResult',
      'forkConnectionTimeout', 'gameLog', 'animationsReady',
    ];
    for (const key of EXPECTED_KEYS) {
      // `undefined` is the failure mode we want to catch. `null` is a
      // legitimate baseline for `worker`, `endedAt`, `timerContext`, etc.
      expect(s[key], `field ${String(key)} is undefined`).not.toBeUndefined();
    }

    // Spot-check the load-bearing baseline values that the runtime reads
    // without a null-check. `chainPhase` / `activeChainLinks` /
    // `negatedChainIndices` / `currentSolvingChainIndex` come from
    // `emptyChainState()`.
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks).toEqual([]);
    expect(s.negatedChainIndices).toBeInstanceOf(Set);
    expect(s.currentSolvingChainIndex).toBeNull();
    expect(s.awaitingResponse).toEqual([false, false]);
    expect(s.lastSentPrompt).toEqual([null, null]);
    expect(s.lastSentHint).toEqual([null, null]);
    expect(s.rematchRequested).toEqual([false, false]);
    expect(s.invalidResponseCount).toEqual([0, 0]);
    expect(s.promptSentAt).toEqual([0, 0]);
    expect(s.cancelTargetPrompt).toEqual([null, null]);
    expect(s.lastCancelAt).toEqual([0, 0]);
    expect(s.lastStateSyncAt).toEqual([0, 0]);
    // animations-ready-protocol-2026-06-05 — both slots start NOT ready.
    // The client emits ANIMATIONS_READY once its thumbnail prefetch
    // completes; the server's `isReadyToStart` gate waits for both slots
    // before triggering startFirstPlayerPhase / startDuelWithOrder.
    expect(s.animationsReady).toEqual([false, false]);
  });
});

describe('resetSessionForRematch (U15)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('preserves long-lived fields (decks, players, soloMode, forkMode, names, turnTimeSecs)', () => {
    const players: [PlayerSession, PlayerSession] = [makePlayer(0, 'alice'), makePlayer(1, 'bob')];
    const decks: [Deck, Deck] = [makeDeck(), makeDeck()];
    const s = createInitialSessionState({
      duelId: 'd1',
      players,
      decks,
      soloMode: true,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
      turnTimeSecs: 600,
    });

    resetSessionForRematch(s);

    expect(s.duelId).toBe('d1');
    expect(s.players).toBe(players);
    expect(s.decks).toBe(decks);
    expect(s.soloMode).toBe(true);
    expect(s.forkMode).toBe(false);
    expect(s.playerUsernames).toEqual(['Alice', 'Bob']);
    expect(s.deckNames).toEqual(['ABC', 'DEF']);
    expect(s.turnTimeSecs).toBe(600);
  });

  it('wipes per-duel transient state', () => {
    const s = createInitialSessionState({
      duelId: 'd1',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: false,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
    });
    // Dirty the session as if a real duel had run.
    s.workerTerminated = false;
    s.awaitingResponse = [true, true];
    s.lastBoardState = { type: 'BOARD_STATE' } as never;
    s.lastSentPrompt = [{ type: 'SELECT_CARD' } as never, null];
    s.lastSentHint = [{ type: 'MSG_HINT' } as never, null];
    s.rematchRequested = [true, false];
    s.endedAt = 12345;
    s.bothDisconnected = true;
    s.storedDuelResult = { type: 'DUEL_END' } as never;
    s.lastStateSyncAt = [1, 2];
    s.lastCancelAt = [3, 4];
    s.cancelTargetPrompt = [{ type: 'SELECT_IDLECMD' } as never, null];
    s.invalidResponseCount = [2, 1];
    s.promptSentAt = [100, 200];
    s.chainPhase = 'resolving';
    s.activeChainLinks = [{ type: 'MSG_CHAINING' } as never];
    s.negatedChainIndices = new Set([0, 1]);
    s.currentSolvingChainIndex = 1;
    // animations-ready-protocol-2026-06-05 — dirty the flag so we can
    // assert the rematch reset wipes it back to [false, false].
    s.animationsReady = [true, true];
    // Review F1 — dirty phase so we can assert the reset flips it back
    // to WAITING_PLAYERS.
    s.phase = 'DUELING';

    resetSessionForRematch(s);

    expect(s.worker).toBeNull();
    expect(s.workerTerminated).toBe(true);
    expect(s.awaitingResponse).toEqual([false, false]);
    expect(s.lastBoardState).toBeNull();
    expect(s.lastSentPrompt).toEqual([null, null]);
    expect(s.lastSentHint).toEqual([null, null]);
    expect(s.rematchRequested).toEqual([false, false]);
    expect(s.endedAt).toBeNull();
    expect(s.startedAt).toBe(Date.now());
    expect(s.bothDisconnected).toBe(false);
    expect(s.storedDuelResult).toBeNull();
    expect(s.lastStateSyncAt).toEqual([0, 0]);
    expect(s.lastCancelAt).toEqual([0, 0]);
    expect(s.cancelTargetPrompt).toEqual([null, null]);
    expect(s.invalidResponseCount).toEqual([0, 0]);
    expect(s.promptSentAt).toEqual([0, 0]);
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks).toEqual([]);
    expect(Array.from(s.negatedChainIndices)).toEqual([]);
    expect(s.currentSolvingChainIndex).toBeNull();
    // animations-ready-protocol-2026-06-05 — the rematch must wait for a
    // fresh ANIMATIONS_READY from each connected slot before spawning the
    // new worker. Without this reset the next duel would start in the
    // microsecond following REMATCH_REQUEST.
    expect(s.animationsReady).toEqual([false, false]);
    // Review F1 — phase is flipped back to WAITING_PLAYERS so the
    // `onAnimationsReady` hook's gate predicate (`phase === 'WAITING_PLAYERS'`)
    // fires when the client(s) re-emit. Without this, the gate would miss
    // (phase still 'DUELING' from the prior duel) and the rematch would
    // wedge until the next ws reconnect.
    expect(s.phase).toBe('WAITING_PLAYERS');
  });

  it('replaces gameLog with a fresh instance (prior duel entries do NOT bleed in)', () => {
    const s = createInitialSessionState({
      duelId: 'd1',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: false,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
    });
    const originalLog = s.gameLog;
    expect(originalLog).toBeDefined();

    resetSessionForRematch(s);

    expect(s.gameLog).toBeDefined();
    expect(s.gameLog).not.toBe(originalLog);
  });

  it('clears per-player gracePeriodTimer (U15-review #5)', () => {
    // A rematch can fire while a player is in the disconnect grace window.
    // Without the clear, the timer callback would tire on the freshly-reset
    // session — observable here via the spy on clearTimeout.
    const s = createInitialSessionState({
      duelId: 'd1',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: false,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
    });
    const timer0 = setTimeout(() => undefined, 99_999);
    const timer1 = setTimeout(() => undefined, 99_999);
    s.players[0].gracePeriodTimer = timer0;
    s.players[1].gracePeriodTimer = timer1;
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    resetSessionForRematch(s);

    expect(s.players[0].gracePeriodTimer).toBeNull();
    expect(s.players[1].gracePeriodTimer).toBeNull();
    expect(clearSpy).toHaveBeenCalledWith(timer0);
    expect(clearSpy).toHaveBeenCalledWith(timer1);
    clearSpy.mockRestore();
  });

  it('does NOT reset firstPlayerState / chosenFirstPlayer (caller responsibility) but DOES reset phase to WAITING_PLAYERS (F1)', () => {
    // U15-review #2 + F1 (animations-ready-protocol-2026-06-05 code-review)
    //
    // - `firstPlayerState` / `chosenFirstPlayer` : NOT reset here — the caller
    //   (`server.ts startRematch`) is responsible for `disposeFirstPlayer`
    //   which clears both. Breaking this carve-out in a future refactor must
    //   be explicit.
    // - `phase` : IS reset to `WAITING_PLAYERS`. F1 hoisted the rematch
    //   worker spawn into `server.ts onAnimationsReady`, gated on
    //   `phase === 'WAITING_PLAYERS'`. Leaving phase 'DUELING' would let the
    //   gate miss when the client(s) re-emit ANIMATIONS_READY, wedging the
    //   session until the next ws reconnect.
    const s = createInitialSessionState({
      duelId: 'd1',
      players: [makePlayer(0), makePlayer(1)],
      decks: [makeDeck(), makeDeck()],
      soloMode: false,
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['ABC', 'DEF'],
    });
    // Simulate end-of-duel state.
    s.phase = 'DUELING';
    s.firstPlayerState = { rolls: [null, null], timers: [], round: 0, resolvedWinner: 0 };
    s.chosenFirstPlayer = 0;

    resetSessionForRematch(s);

    // F1 — phase flipped to gate-friendly value.
    expect(s.phase).toBe('WAITING_PLAYERS');
    // Caller-owned fields untouched.
    expect(s.firstPlayerState).not.toBeNull();
    expect(s.chosenFirstPlayer).toBe(0);
  });
});
