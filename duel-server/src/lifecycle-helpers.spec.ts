import { describe, it, expect } from 'vitest';
import {
  isReadyToStart,
  isFullyDisconnected,
  decideSoloRouting,
  buildDuelStartingMessage,
  PSEUDO_PAIRWISE_SOLO_ROUTED,
} from './lifecycle-helpers.js';
import type { ActiveDuelSession, Deck } from './types.js';

interface MakeSessionOpts {
  soloMode: boolean;
  p0Connected: boolean;
  p1Connected: boolean;
  /**
   * animations-ready-protocol-2026-06-05 — defaults to `[true, true]`
   * so legacy tests pre-dating the gate keep the same semantic
   * intent (a connected socket is "ready to start"). Tests targeting
   * the gate itself override this.
   */
  animationsReady?: [boolean, boolean];
}

function makeSession(opts: MakeSessionOpts): ActiveDuelSession {
  return {
    soloMode: opts.soloMode,
    players: [
      { connected: opts.p0Connected },
      { connected: opts.p1Connected },
    ],
    animationsReady: opts.animationsReady ?? [true, true],
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

    // animations-ready-protocol-2026-06-05 — the gate also requires every
    // required slot to have signalled `ANIMATIONS_READY`. Without this,
    // the server would spawn the worker before the client had finished
    // its thumbnail prefetch and the initial MSG_DRAW × 5 would race the
    // pre-activation buffer.
    describe('animations-ready gate', () => {
      it('SOLO: false when socket 0 connected but animationsReady[0]=false', () => {
        expect(isReadyToStart(makeSession({
          soloMode: true, p0Connected: true, p1Connected: false,
          animationsReady: [false, false],
        }))).toBe(false);
      });

      it('SOLO: true when socket 0 connected AND animationsReady[0]=true', () => {
        expect(isReadyToStart(makeSession({
          soloMode: true, p0Connected: true, p1Connected: false,
          animationsReady: [true, false],
        }))).toBe(true);
      });

      it('SOLO: ignores animationsReady[1] entirely (slot 1 is never expected)', () => {
        // Both connected + ready[0] true is sufficient; ready[1] state is irrelevant.
        expect(isReadyToStart(makeSession({
          soloMode: true, p0Connected: true, p1Connected: false,
          animationsReady: [true, false],
        }))).toBe(true);
        // And ready[1] true alone doesn't unlock anything if ready[0] is false.
        expect(isReadyToStart(makeSession({
          soloMode: true, p0Connected: true, p1Connected: false,
          animationsReady: [false, true],
        }))).toBe(false);
      });

      it('PvP normal: false when only one slot has emitted animationsReady', () => {
        expect(isReadyToStart(makeSession({
          soloMode: false, p0Connected: true, p1Connected: true,
          animationsReady: [true, false],
        }))).toBe(false);
        expect(isReadyToStart(makeSession({
          soloMode: false, p0Connected: true, p1Connected: true,
          animationsReady: [false, true],
        }))).toBe(false);
      });

      it('PvP normal: true only when both connected AND both animations-ready', () => {
        expect(isReadyToStart(makeSession({
          soloMode: false, p0Connected: true, p1Connected: true,
          animationsReady: [true, true],
        }))).toBe(true);
      });

      it('PvP normal: false when both animations-ready but only one connected', () => {
        // Defense: the connection gate is the outer check; if a slot is
        // disconnected its animationsReady cannot have been set legitimately,
        // but the predicate must reject either failure mode.
        expect(isReadyToStart(makeSession({
          soloMode: false, p0Connected: true, p1Connected: false,
          animationsReady: [true, true],
        }))).toBe(false);
      });
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
      // Non-whitelisted types are no-op on socket 1 (the broadcast loop
      // already covered the send via socket 0 — see lifecycle-helpers.ts
      // jsdoc on PSEUDO_PAIRWISE_SOLO_ROUTED).
      expect(decideSoloRouting(true, 1, 'TIMER_STATE')).toBe('noop');
      expect(decideSoloRouting(true, 1, 'DUEL_STARTING')).toBe('noop');
      expect(decideSoloRouting(true, 1, 'BOARD_STATE')).toBe('noop');
    });

    // γ Option C A28 (PR2 c4.5, 2026-05-28) — the 4 whitelisted types route
    // to socket 0 from socket 1 in SOLO multiplex. The front consumer reads
    // the slot tag (`message.player` / `message.targetPlayer`) and routes
    // into the correct PerspectiveSlot.
    it('SOLO + socket 1 + type IN whitelist: returns "route-to-0"', () => {
      expect(decideSoloRouting(true, 1, 'WAITING_RESPONSE')).toBe('route-to-0');
      expect(decideSoloRouting(true, 1, 'INACTIVITY_WARNING')).toBe('route-to-0');
      expect(decideSoloRouting(true, 1, 'ERROR')).toBe('route-to-0');
      expect(decideSoloRouting(true, 1, 'REMATCH_INVITATION')).toBe('route-to-0');
    });

    // Documented invariant: the whitelist is populated at PR2 c4.5 with
    // EXACTLY these 4 types. Locking the contents catches an accidental
    // bump (a new type added requires updating CLAUDE.md + the front
    // PerspectiveSlot routing per spec §6.2).
    it('PR2 c4.5 SOLO routing whitelist contains exactly the 4 expected types', () => {
      expect(PSEUDO_PAIRWISE_SOLO_ROUTED.size).toBe(4);
      expect(PSEUDO_PAIRWISE_SOLO_ROUTED.has('WAITING_RESPONSE')).toBe(true);
      expect(PSEUDO_PAIRWISE_SOLO_ROUTED.has('INACTIVITY_WARNING')).toBe(true);
      expect(PSEUDO_PAIRWISE_SOLO_ROUTED.has('ERROR')).toBe(true);
      expect(PSEUDO_PAIRWISE_SOLO_ROUTED.has('REMATCH_INVITATION')).toBe(true);
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
