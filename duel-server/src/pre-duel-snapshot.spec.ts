import { describe, it, expect } from 'vitest';
import { buildPreDuelSnapshot } from './pre-duel-snapshot.js';
import type { ActiveDuelSession } from './types.js';

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
    decks: [
      { main: [100, 101], extra: [200] },
      { main: [300], extra: [400] },
    ],
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

describe('buildPreDuelSnapshot', () => {
  it('returns empty list during WAITING_PLAYERS — no dice context yet', () => {
    const s = makeSession({ phase: 'WAITING_PLAYERS' });
    expect(buildPreDuelSnapshot(s, 0)).toEqual([]);
  });

  it('returns empty list during ROLLING_DICE — the pending DICE_ROLL prompt is replayed by resendPendingPrompt', () => {
    // Even with partial rolls, we don't emit DICE_RESULT (which only broadcasts
    // once both rolls are in — the live `resolveDiceRound` checks the same).
    const s = makeSession({
      phase: 'ROLLING_DICE',
      firstPlayerState: { rolls: [[3, 4], null], timers: [], round: 0 },
    });
    expect(buildPreDuelSnapshot(s, 0)).toEqual([]);
  });

  it('returns DICE_RESULT during DICE_RESOLVED — suspense window between roll and CHOOSE_FIRST_PLAYER', () => {
    const s = makeSession({
      phase: 'DICE_RESOLVED',
      firstPlayerState: { rolls: [[6, 6], [3, 4]], timers: [], round: 0 },
    });
    const out = buildPreDuelSnapshot(s, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: 'DICE_RESULT', dice0: [6, 6], dice1: [3, 4], sum0: 12, sum1: 7, winner: 0 });
  });

  it('returns DICE_RESULT during CHOOSE_FIRST_PLAYER — SELECT_FIRST_PLAYER itself replayed by resendPendingPrompt', () => {
    const s = makeSession({
      phase: 'CHOOSE_FIRST_PLAYER',
      firstPlayerState: { rolls: [[2, 3], [5, 6]], timers: [], round: 0 },
    });
    const out = buildPreDuelSnapshot(s, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'DICE_RESULT', winner: 1 });
  });

  it('winner is derived from sums (tie returns null)', () => {
    const s = makeSession({
      phase: 'DICE_RESOLVED',
      firstPlayerState: { rolls: [[3, 4], [4, 3]], timers: [], round: 0 },
    });
    const out = buildPreDuelSnapshot(s, 0);
    expect(out[0]).toMatchObject({ winner: null });
  });

  it('returns DICE_RESULT + DECK_PREFETCH + FIRST_PLAYER_RESULT during FIRST_PLAYER_RESOLVED', () => {
    const s = makeSession({
      phase: 'FIRST_PLAYER_RESOLVED',
      firstPlayerState: { rolls: [[6, 6], [1, 1]], timers: [], round: 0 },
      chosenFirstPlayer: 0,
    });
    const out = buildPreDuelSnapshot(s, 0);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'DICE_RESULT', winner: 0 });
    expect(out[1]).toEqual({ type: 'DECK_PREFETCH', cardCodes: [100, 101, 200] });
    expect(out[2]).toEqual({ type: 'FIRST_PLAYER_RESULT', goFirst: true });
  });

  it('FIRST_PLAYER_RESOLVED — recipient on the OTHER side gets goFirst=false and their own cardCodes', () => {
    const s = makeSession({
      phase: 'FIRST_PLAYER_RESOLVED',
      firstPlayerState: { rolls: [[6, 6], [1, 1]], timers: [], round: 0 },
      chosenFirstPlayer: 0,
    });
    const out = buildPreDuelSnapshot(s, 1);
    expect(out[1]).toEqual({ type: 'DECK_PREFETCH', cardCodes: [300, 400] });
    expect(out[2]).toEqual({ type: 'FIRST_PLAYER_RESULT', goFirst: false });
  });

  it('FIRST_PLAYER_RESOLVED — winner picked goFirst=false: roll winner ≠ first player', () => {
    // Player 0 wins the roll but picks `second` → chosenFirstPlayer=1.
    // DICE_RESULT.winner still reports 0 (the roll-winner, who got to pick).
    const s = makeSession({
      phase: 'FIRST_PLAYER_RESOLVED',
      firstPlayerState: { rolls: [[6, 6], [1, 1]], timers: [], round: 0 },
      chosenFirstPlayer: 1,
    });
    const out = buildPreDuelSnapshot(s, 0);
    expect(out[0]).toMatchObject({ type: 'DICE_RESULT', winner: 0 });
    expect(out[2]).toEqual({ type: 'FIRST_PLAYER_RESULT', goFirst: false });
  });

  it('FIRST_PLAYER_RESOLVED with missing chosenFirstPlayer — defensive: skip DECK_PREFETCH + FIRST_PLAYER_RESULT', () => {
    // Defensive: shouldn't happen in production (broadcastFinalAndBridge sets it
    // before flipping phase) but guard against partial state mid-cleanup.
    const s = makeSession({
      phase: 'FIRST_PLAYER_RESOLVED',
      firstPlayerState: { rolls: [[6, 6], [1, 1]], timers: [], round: 0 },
      chosenFirstPlayer: null,
    });
    const out = buildPreDuelSnapshot(s, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'DICE_RESULT' });
  });

  it('returns empty list during DUELING — caller handles the post-DUEL_STARTING board snapshot path', () => {
    const s = makeSession({ phase: 'DUELING' });
    expect(buildPreDuelSnapshot(s, 0)).toEqual([]);
  });

  it('DICE_RESOLVED with missing rolls — defensive: no DICE_RESULT emitted', () => {
    const s = makeSession({
      phase: 'DICE_RESOLVED',
      firstPlayerState: { rolls: [null, [3, 4]], timers: [], round: 0 },
    });
    expect(buildPreDuelSnapshot(s, 0)).toEqual([]);
  });
});
