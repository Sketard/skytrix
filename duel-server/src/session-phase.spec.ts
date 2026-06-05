import { describe, it, expect } from 'vitest';
import { derivePhase } from './session-phase.js';
import type { ActiveDuelSession, SessionPhase } from './types.js';

function makeSession(overrides: Partial<ActiveDuelSession> = {}): ActiveDuelSession {
  return {
    duelId: 'd',
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
    ...overrides,
  } as unknown as ActiveDuelSession;
}

describe('derivePhase', () => {
  const preDuelPhases: SessionPhase[] = [
    'WAITING_PLAYERS', 'ROLLING_DICE', 'DICE_RESOLVED',
    'CHOOSE_FIRST_PLAYER', 'FIRST_PLAYER_RESOLVED',
  ];

  for (const phase of preDuelPhases) {
    it(`returns 'PRE_DUEL' for session.phase === '${phase}' (PvP normal)`, () => {
      expect(derivePhase(makeSession({ phase, soloMode: false }))).toBe('PRE_DUEL');
    });
  }

  it("returns 'DUELING' for session.phase === 'DUELING'", () => {
    expect(derivePhase(makeSession({ phase: 'DUELING' }))).toBe('DUELING');
  });

  it("returns 'ENDED' when storedDuelResult is set (preservation period after natural end)", () => {
    const s = makeSession({
      phase: 'DUELING',
      storedDuelResult: { type: 'DUEL_END', winner: 0, reason: 'win' },
    });
    expect(derivePhase(s)).toBe('ENDED');
  });

  it("returns 'ENDED' when endedAt is set even without storedDuelResult", () => {
    const s = makeSession({ phase: 'DUELING', endedAt: Date.now() });
    expect(derivePhase(s)).toBe('ENDED');
  });

  it("'ENDED' overrides 'PRE_DUEL' (race: duel ended before first dice)", () => {
    const s = makeSession({ phase: 'WAITING_PLAYERS', endedAt: Date.now() });
    expect(derivePhase(s)).toBe('ENDED');
  });

  // -------- SOLO multiplex skips PRE_DUEL --------------------------------
  // Parity investigation 2026-06-05 — SOLO has no dice roll to display, so
  // emitting PRE_DUEL during the sub-millisecond `WAITING_PLAYERS` window
  // makes the client mount the dice arena briefly (the "flash dice" UX bug).
  // Reporting DUELING upfront eliminates the flash AND lets SOLO skip the
  // pre-activation buffer race that costs initial draws + cost moves in the
  // event stream (parity test failure on fixture 18a55f97).

  it("SOLO + WAITING_PLAYERS returns 'DUELING' (skip dice arena flash)", () => {
    expect(derivePhase(makeSession({ phase: 'WAITING_PLAYERS', soloMode: true }))).toBe('DUELING');
  });

  it("SOLO + DUELING still returns 'DUELING' (steady state)", () => {
    expect(derivePhase(makeSession({ phase: 'DUELING', soloMode: true }))).toBe('DUELING');
  });

  it("SOLO + ENDED still returns 'ENDED' (preservation override holds)", () => {
    const s = makeSession({ phase: 'WAITING_PLAYERS', soloMode: true, endedAt: Date.now() });
    expect(derivePhase(s)).toBe('ENDED');
  });

  // Only the WAITING_PLAYERS shortcut is documented for SOLO — pre-duel phases
  // beyond WAITING_PLAYERS (ROLLING_DICE, …) can't legitimately apply because
  // SOLO bypasses the dice flow server-side via `startDuelWithOrder(0)`
  // directly from the connection handler. If a SOLO session is ever observed
  // in one of those phases, returning PRE_DUEL is the safe fallback.
  it("SOLO + ROLLING_DICE returns 'PRE_DUEL' (unreachable in prod, safe fallback)", () => {
    expect(derivePhase(makeSession({ phase: 'ROLLING_DICE', soloMode: true }))).toBe('PRE_DUEL');
  });
});
