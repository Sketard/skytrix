import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyCancelRollbackBroadcast,
  snapshotCancelTarget,
} from './cancel-rollback-main.js';
import type { ActiveDuelSession } from './types.js';
import type { ServerMessage } from './ws-protocol.js';

// =============================================================================
// U38 (audit-4-modes-2026-06-01) — Cancel rollback main-side broadcast.
//
// Extracted from `worker-message-router.ts WORKER_CANCEL_DONE` (60 LOC) +
// `client-message-router.ts PLAYER_RESPONSE` (1 IDLECMD/BATTLECMD branch).
// The spec pins the contract without needing to fire the worker message —
// the function takes a `send` callback so the test captures the outbound
// frames directly.
// =============================================================================

interface SentMessage {
  player: 0 | 1;
  message: ServerMessage;
}

function makeSession(overrides: Partial<ActiveDuelSession> = {}): ActiveDuelSession {
  return {
    duelId: 'test-duel',
    soloMode: false,
    lastBoardState: null,
    cancelTargetPrompt: [null, null],
    activeChainLinks: [],
    chainPhase: 'idle',
    negatedChainIndices: new Set(),
    currentSolvingChainIndex: null,
    lastSentHint: [null, null],
    lastSentPrompt: [null, null],
    invalidResponseCount: [0, 0],
    awaitingResponse: [false, false],
    ...overrides,
  } as unknown as ActiveDuelSession;
}

function makeBoardData(): unknown {
  const emptyBoard = {
    lp: 8000,
    deckCount: 40,
    extraCount: 15,
    zones: [
      { zoneId: 'HAND', cards: [] },
      { zoneId: 'DECK', cards: [] },
      { zoneId: 'EXTRA', cards: [] },
      { zoneId: 'GRAVE', cards: [] },
      { zoneId: 'BANISH', cards: [] },
      { zoneId: 'MZONE', cards: [] },
      { zoneId: 'SZONE', cards: [] },
    ],
  };
  return { players: [emptyBoard, emptyBoard], turnPlayer: 0, turnCount: 1, phase: 1 };
}

function cachedIdleCmd(player: 0 | 1): ServerMessage {
  return {
    type: 'SELECT_IDLECMD',
    player,
    summonable_cards: [],
    spsummonable_cards: [],
    repositionable_cards: [],
    msetable_cards: [],
    ssetable_cards: [],
    activatable_cards: [],
    activatable_descs: [],
    activatable_codes: [],
    can_bp: false,
    can_ep: false,
    can_shuffle: false,
  } as unknown as ServerMessage;
}

describe('cancel-rollback-main (U38)', () => {
  let sent: SentMessage[];
  const send = (_s: ActiveDuelSession, p: 0 | 1, m: ServerMessage) => sent.push({ player: p, message: m });

  beforeEach(() => { sent = []; });

  // ---------------------------------------------------------------------------
  // snapshotCancelTarget
  // ---------------------------------------------------------------------------

  describe('snapshotCancelTarget', () => {
    it('writes the prompt into session.cancelTargetPrompt[p]', () => {
      const s = makeSession();
      const prompt = cachedIdleCmd(0);

      snapshotCancelTarget(s, 0, prompt);

      expect(s.cancelTargetPrompt[0]).toBe(prompt);
      expect(s.cancelTargetPrompt[1]).toBeNull();
    });

    it('null prompt clears the slot', () => {
      const s = makeSession({ cancelTargetPrompt: [cachedIdleCmd(0), null] });

      snapshotCancelTarget(s, 0, null);

      expect(s.cancelTargetPrompt[0]).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // applyCancelRollbackBroadcast — happy path
  // ---------------------------------------------------------------------------

  describe('applyCancelRollbackBroadcast — PvP normal', () => {
    it('re-broadcasts STATE_SYNC + CHAIN_STATE + cached prompt to player p', () => {
      const cached = cachedIdleCmd(1);
      const s = makeSession({
        cancelTargetPrompt: [null, cached],
        lastBoardState: { type: 'BOARD_STATE', data: makeBoardData() } as unknown as ServerMessage,
      });

      const applied = applyCancelRollbackBroadcast(s, 1, send);

      expect(applied).toBe(true);
      // Order: STATE_SYNC, CHAIN_STATE, cached prompt — all to player 1.
      expect(sent.map(x => x.message.type)).toEqual(['STATE_SYNC', 'CHAIN_STATE', 'SELECT_IDLECMD']);
      for (const s of sent) expect(s.player).toBe(1);
    });

    it('mirrors server-side chain bookkeeping to empty / idle', () => {
      const cached = cachedIdleCmd(0);
      const s = makeSession({
        cancelTargetPrompt: [cached, null],
        activeChainLinks: [{ chainIndex: 0 }] as unknown as ActiveDuelSession['activeChainLinks'],
        chainPhase: 'resolving',
        negatedChainIndices: new Set([0]),
        currentSolvingChainIndex: 0,
      });

      applyCancelRollbackBroadcast(s, 0, send);

      expect(s.activeChainLinks).toEqual([]);
      expect(s.chainPhase).toBe('idle');
      expect(s.negatedChainIndices.size).toBe(0);
      expect(s.currentSolvingChainIndex).toBeNull();
    });

    it('resets invalidResponseCount[p] + lastSentHint[p], arms awaitingResponse[p]', () => {
      const cached = cachedIdleCmd(0);
      const s = makeSession({
        cancelTargetPrompt: [cached, null],
        invalidResponseCount: [3, 0],
        lastSentHint: [{ type: 'MSG_HINT' } as unknown as ServerMessage, null],
        awaitingResponse: [false, false],
      });

      applyCancelRollbackBroadcast(s, 0, send);

      expect(s.invalidResponseCount[0]).toBe(0);
      expect(s.lastSentHint[0]).toBeNull();
      expect(s.awaitingResponse[0]).toBe(true);
    });

    it('writes cached prompt to lastSentPrompt[p] + clears cancelTargetPrompt[p]', () => {
      const cached = cachedIdleCmd(0);
      const s = makeSession({ cancelTargetPrompt: [cached, null] });

      applyCancelRollbackBroadcast(s, 0, send);

      expect(s.lastSentPrompt[0]).toBe(cached);
      expect(s.cancelTargetPrompt[0]).toBeNull();
    });

    it('does NOT touch the opposite player slots', () => {
      const cached = cachedIdleCmd(0);
      const otherPrompt = { type: 'SELECT_PLACE' } as ServerMessage;
      const s = makeSession({
        cancelTargetPrompt: [cached, null],
        invalidResponseCount: [3, 4],
        lastSentPrompt: [null, otherPrompt],
      });

      applyCancelRollbackBroadcast(s, 0, send);

      expect(s.invalidResponseCount[1]).toBe(4); // unchanged
      expect(s.lastSentPrompt[1]).toBe(otherPrompt); // unchanged
    });
  });

  // ---------------------------------------------------------------------------
  // applyCancelRollbackBroadcast — SOLO multiplex
  // ---------------------------------------------------------------------------

  describe('applyCancelRollbackBroadcast — SOLO multiplex', () => {
    it('routes the 3 sends to socket 0 even when player is 1', () => {
      const cached = cachedIdleCmd(1);
      const s = makeSession({
        soloMode: true,
        cancelTargetPrompt: [null, cached],
        lastBoardState: { type: 'BOARD_STATE', data: makeBoardData() } as unknown as ServerMessage,
      });

      applyCancelRollbackBroadcast(s, 1, send);

      // Every outbound message must target socket 0 (A30 routing).
      for (const m of sent) expect(m.player).toBe(0);
      expect(sent.map(x => x.message.type)).toEqual(['STATE_SYNC', 'CHAIN_STATE', 'SELECT_IDLECMD']);
    });
  });

  // ---------------------------------------------------------------------------
  // applyCancelRollbackBroadcast — no cached prompt
  // ---------------------------------------------------------------------------

  describe('applyCancelRollbackBroadcast — no cached prompt', () => {
    it('returns false + does not emit any frame', () => {
      const s = makeSession({ cancelTargetPrompt: [null, null] });

      const applied = applyCancelRollbackBroadcast(s, 0, send);

      expect(applied).toBe(false);
      expect(sent).toHaveLength(0);
    });
  });
});
