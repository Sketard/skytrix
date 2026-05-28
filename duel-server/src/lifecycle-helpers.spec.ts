import { describe, it, expect } from 'vitest';
import {
  isReadyToStart,
  isFullyDisconnected,
  decideSoloRouting,
  buildDuelStartingMessage,
  PSEUDO_PAIRWISE_SOLO_ROUTED,
} from './lifecycle-helpers.js';
import type { ActiveDuelSession, Deck } from './types.js';

function makeSession(opts: { soloMode: boolean; p0Connected: boolean; p1Connected: boolean }): ActiveDuelSession {
  return {
    soloMode: opts.soloMode,
    players: [
      { connected: opts.p0Connected },
      { connected: opts.p1Connected },
    ],
  } as unknown as ActiveDuelSession;
}

function makeSessionWithDecks(soloMode: boolean, deck0: Deck, deck1: Deck): ActiveDuelSession {
  return {
    duelId: 'd-test',
    soloMode,
    decks: [deck0, deck1] as readonly [Deck, Deck],
  } as unknown as ActiveDuelSession;
}

describe('lifecycle-helpers — γ Option C A3 + A28', () => {
  describe('isReadyToStart', () => {
    // T-S7 — SOLO ready with socket 0 connected alone
    it('SOLO: true when socket 0 alone is connected', () => {
      expect(isReadyToStart(makeSession({ soloMode: true, p0Connected: true, p1Connected: false }))).toBe(true);
    });

    it('SOLO: false when socket 0 is not connected (ignores socket 1)', () => {
      expect(isReadyToStart(makeSession({ soloMode: true, p0Connected: false, p1Connected: true }))).toBe(false);
      expect(isReadyToStart(makeSession({ soloMode: true, p0Connected: false, p1Connected: false }))).toBe(false);
    });

    it('PvP normal: true only when BOTH players are connected', () => {
      expect(isReadyToStart(makeSession({ soloMode: false, p0Connected: true, p1Connected: true }))).toBe(true);
      expect(isReadyToStart(makeSession({ soloMode: false, p0Connected: true, p1Connected: false }))).toBe(false);
      expect(isReadyToStart(makeSession({ soloMode: false, p0Connected: false, p1Connected: true }))).toBe(false);
      expect(isReadyToStart(makeSession({ soloMode: false, p0Connected: false, p1Connected: false }))).toBe(false);
    });
  });

  describe('isFullyDisconnected', () => {
    // T-S8 — SOLO fully disconnected when socket 0 goes down
    it('SOLO: true when socket 0 is disconnected (ignores socket 1 which is always false in SOLO)', () => {
      expect(isFullyDisconnected(makeSession({ soloMode: true, p0Connected: false, p1Connected: false }))).toBe(true);
    });

    it('SOLO: false when socket 0 stays connected', () => {
      expect(isFullyDisconnected(makeSession({ soloMode: true, p0Connected: true, p1Connected: false }))).toBe(false);
    });

    it('PvP normal: true only when BOTH players are disconnected', () => {
      expect(isFullyDisconnected(makeSession({ soloMode: false, p0Connected: false, p1Connected: false }))).toBe(true);
      expect(isFullyDisconnected(makeSession({ soloMode: false, p0Connected: true, p1Connected: false }))).toBe(false);
      expect(isFullyDisconnected(makeSession({ soloMode: false, p0Connected: false, p1Connected: true }))).toBe(false);
      expect(isFullyDisconnected(makeSession({ soloMode: false, p0Connected: true, p1Connected: true }))).toBe(false);
    });
  });

  describe('decideSoloRouting', () => {
    // T-S5 — sendToPlayer SOLO routing (no-op-on-1 with empty whitelist)
    it('PvP normal: always returns "send" regardless of playerIndex', () => {
      expect(decideSoloRouting(false, 0, 'WAITING_RESPONSE')).toBe('send');
      expect(decideSoloRouting(false, 1, 'WAITING_RESPONSE')).toBe('send');
      expect(decideSoloRouting(false, 0, 'TIMER_STATE')).toBe('send');
    });

    it('SOLO + socket 0: returns "send"', () => {
      expect(decideSoloRouting(true, 0, 'WAITING_RESPONSE')).toBe('send');
      expect(decideSoloRouting(true, 0, 'TIMER_STATE')).toBe('send');
      expect(decideSoloRouting(true, 0, 'DUEL_STARTING')).toBe('send');
    });

    it('SOLO + socket 1 + type NOT in whitelist: returns "noop"', () => {
      // PR1 ships an empty whitelist; every type is no-op on socket 1.
      expect(decideSoloRouting(true, 1, 'TIMER_STATE')).toBe('noop');
      expect(decideSoloRouting(true, 1, 'WAITING_RESPONSE')).toBe('noop');
      expect(decideSoloRouting(true, 1, 'DUEL_STARTING')).toBe('noop');
      expect(decideSoloRouting(true, 1, 'BOARD_STATE')).toBe('noop');
    });

    // Documented invariant: the whitelist is empty in PR1 — PR2 commit 4
    // populates it. Locking the size catches an accidental early bump.
    it('PR1 keeps the SOLO routing whitelist empty (PR2 c4 populates it)', () => {
      expect(PSEUDO_PAIRWISE_SOLO_ROUTED.size).toBe(0);
    });
  });

  describe('buildDuelStartingMessage', () => {
    const deck0: Deck = { main: [1001, 1002, 1003, 0], extra: [9001] };
    const deck1: Deck = { main: [2001, 2002, 0], extra: [9001, 9002] };

    // T-S9 — DUEL_STARTING in SOLO carries bothCardCodes (initial site)
    it('SOLO: includes `bothCardCodes` with deduped codes for BOTH players', () => {
      const s = makeSessionWithDecks(true, deck0, deck1);
      const msg = buildDuelStartingMessage(s, 0);

      expect(msg.type).toBe('DUEL_STARTING');
      expect(msg.playerIndex).toBe(0);
      expect(msg.traceId).toBe('d-test');
      expect(msg.cardCodes).toEqual([1001, 1002, 1003, 9001]); // own deck dedup, zeros dropped
      expect(msg.bothCardCodes).toEqual([
        [1001, 1002, 1003, 9001],
        [2001, 2002, 9001, 9002],
      ]);
    });

    // T-S12 — DUEL_STARTING reconnect in SOLO also carries bothCardCodes
    it('SOLO: still emits `bothCardCodes` on reconnect with playerIndex=1', () => {
      const s = makeSessionWithDecks(true, deck0, deck1);
      const msg = buildDuelStartingMessage(s, 1);

      expect(msg.playerIndex).toBe(1);
      expect(msg.cardCodes).toEqual([2001, 2002, 9001, 9002]); // own slot
      expect(msg.bothCardCodes).toBeDefined();
      expect(msg.bothCardCodes![0]).toEqual([1001, 1002, 1003, 9001]);
      expect(msg.bothCardCodes![1]).toEqual([2001, 2002, 9001, 9002]);
    });

    it('PvP normal: omits `bothCardCodes` (each side only sees its own deck)', () => {
      const s = makeSessionWithDecks(false, deck0, deck1);
      const msg = buildDuelStartingMessage(s, 0);

      expect(msg.cardCodes).toEqual([1001, 1002, 1003, 9001]);
      expect(msg.bothCardCodes).toBeUndefined();
    });
  });
});
