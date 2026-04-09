import { describe, it, expect } from 'vitest';
import { filterMessage } from './message-filter.js';
import { LOCATION, POSITION } from './ws-protocol.js';
import type { ServerMessage, Player, BoardStatePayload, PlayerBoardState, BoardZone, CardOnField, Position } from './ws-protocol.js';

// ── Helpers ──────────────────────────────────────────────────────────

function card(code: number, pos: Position = POSITION.FACEUP_ATTACK): CardOnField {
  return {
    cardCode: code, name: `Card ${code}`, position: pos,
    overlayMaterials: [], counters: {},
    currentAtk: 2500, currentDef: 2000, baseAtk: 2500, baseDef: 2000,
    currentLevel: 7, baseLevel: 7,
  };
}

function zone(zoneId: string, cards: CardOnField[] = []): BoardZone {
  return { zoneId: zoneId as any, cards };
}

function boardState(): BoardStatePayload {
  return {
    turnPlayer: 0, turnCount: 1, phase: 'MAIN1',
    players: [
      {
        lp: 8000, deckCount: 40, extraCount: 15,
        zones: [
          zone('HAND', [card(100), card(200)]),
          zone('DECK', [card(300)]),
          zone('EXTRA', [card(400)]),
          zone('M1', [card(500)]),
          zone('S1', [card(600, POSITION.FACEDOWN_DEFENSE)]),
          zone('GY', [card(700)]),
          zone('BANISHED', [card(800)]),
        ],
      },
      {
        lp: 7000, deckCount: 35, extraCount: 12,
        zones: [
          zone('HAND', [card(900), card(1000)]),
          zone('DECK', [card(1100)]),
          zone('EXTRA', [card(1200)]),
          zone('M2', [card(1300)]),
          zone('S2', [card(1400, POSITION.FACEDOWN_DEFENSE)]),
          zone('GY', [card(1500)]),
          zone('BANISHED', [card(1600)]),
        ],
      },
    ],
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('filterMessage', () => {

  // === Passthrough messages ===

  describe('passthrough messages', () => {
    const passthroughTypes = [
      'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST', 'MSG_CHAINING',
      'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED', 'MSG_CHAIN_END', 'MSG_CHAIN_NEGATED',
      'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET', 'MSG_SWAP', 'MSG_BECOME_TARGET',
      'MSG_ATTACK', 'MSG_BATTLE', 'MSG_TOSS_COIN', 'MSG_TOSS_DICE',
      'MSG_EQUIP', 'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER',
      'MSG_SHUFFLE_SET_CARD', 'MSG_SWAP_GRAVE_DECK', 'MSG_WIN', 'DUEL_END',
      'TIMER_STATE', 'WORKER_ERROR', 'SESSION_TOKEN', 'OPPONENT_DISCONNECTED',
      'OPPONENT_RECONNECTED', 'WAITING_RESPONSE', 'TP_RESULT', 'DUEL_STARTING',
      'CHAIN_STATE', 'REMATCH_INVITATION', 'REMATCH_STARTING', 'REMATCH_CANCELLED',
    ];

    for (const type of passthroughTypes) {
      it(`should pass ${type} to both players`, () => {
        const msg = { type } as ServerMessage;
        expect(filterMessage(msg, 0)).toBe(msg);
        expect(filterMessage(msg, 1)).toBe(msg);
      });
    }
  });

  // === Default DROP ===

  describe('default DROP policy', () => {
    it('should drop unknown message types', () => {
      const msg = { type: 'UNKNOWN_GARBAGE' } as any;
      expect(filterMessage(msg, 0)).toBeNull();
      expect(filterMessage(msg, 1)).toBeNull();
    });

    it('should drop unknown types even in omniscient mode', () => {
      const msg = { type: 'UNKNOWN_GARBAGE' } as any;
      expect(filterMessage(msg, 0, true)).toBeNull();
    });
  });

  // === MSG_DRAW / MSG_SHUFFLE_HAND ===

  describe('MSG_DRAW', () => {
    const msg: ServerMessage = { type: 'MSG_DRAW', player: 0, cards: [100, 200] } as any;

    it('should reveal cards to the drawing player', () => {
      const result = filterMessage(msg, 0) as any;
      expect(result.cards).toEqual([100, 200]);
    });

    it('should hide cards from the opponent', () => {
      const result = filterMessage(msg, 1) as any;
      expect(result.cards).toEqual([null, null]);
    });

    it('should reveal cards in omniscient mode', () => {
      const result = filterMessage(msg, 1, true) as any;
      expect(result.cards).toEqual([100, 200]);
    });
  });

  describe('MSG_SHUFFLE_HAND', () => {
    const msg: ServerMessage = { type: 'MSG_SHUFFLE_HAND', player: 1, cards: [300, 400, 500] } as any;

    it('should reveal cards to the shuffling player', () => {
      expect((filterMessage(msg, 1) as any).cards).toEqual([300, 400, 500]);
    });

    it('should hide cards from the opponent', () => {
      expect((filterMessage(msg, 0) as any).cards).toEqual([null, null, null]);
    });
  });

  // === MSG_SHUFFLE_DECK ===

  describe('MSG_SHUFFLE_DECK', () => {
    it('should pass through to both players', () => {
      const msg = { type: 'MSG_SHUFFLE_DECK', player: 0 } as ServerMessage;
      expect(filterMessage(msg, 0)).toBe(msg);
      expect(filterMessage(msg, 1)).toBe(msg);
    });
  });

  // === MSG_MOVE ===

  describe('MSG_MOVE', () => {
    it('should reveal card moving between public zones', () => {
      const msg = {
        type: 'MSG_MOVE', player: 0, cardCode: 100, cardName: 'Monster',
        fromLocation: LOCATION.MZONE, toLocation: LOCATION.GRAVE,
      } as any;
      const result = filterMessage(msg, 1) as any;
      expect(result.cardCode).toBe(100);
      expect(result.cardName).toBe('Monster');
    });

    it('should hide card moving FROM private zone (DECK) to opponent', () => {
      const msg = {
        type: 'MSG_MOVE', player: 0, cardCode: 100, cardName: 'Monster',
        fromLocation: LOCATION.DECK, toLocation: LOCATION.HAND,
      } as any;
      const result = filterMessage(msg, 1) as any;
      expect(result.cardCode).toBe(0);
      expect(result.cardName).toBe('');
    });

    it('should hide card moving TO private zone (HAND) from opponent', () => {
      const msg = {
        type: 'MSG_MOVE', player: 0, cardCode: 100, cardName: 'Monster',
        fromLocation: LOCATION.GRAVE, toLocation: LOCATION.HAND,
      } as any;
      const result = filterMessage(msg, 1) as any;
      expect(result.cardCode).toBe(0);
    });

    it('should reveal card to the owning player regardless of zone', () => {
      const msg = {
        type: 'MSG_MOVE', player: 0, cardCode: 100, cardName: 'Monster',
        fromLocation: LOCATION.DECK, toLocation: LOCATION.HAND,
      } as any;
      const result = filterMessage(msg, 0) as any;
      expect(result.cardCode).toBe(100);
    });

    it('should reveal in omniscient mode', () => {
      const msg = {
        type: 'MSG_MOVE', player: 0, cardCode: 100, cardName: 'Monster',
        fromLocation: LOCATION.DECK, toLocation: LOCATION.HAND,
      } as any;
      const result = filterMessage(msg, 1, true) as any;
      expect(result.cardCode).toBe(100);
    });

    it('should treat EXTRA as private', () => {
      const msg = {
        type: 'MSG_MOVE', player: 0, cardCode: 100, cardName: 'Monster',
        fromLocation: LOCATION.EXTRA, toLocation: LOCATION.MZONE,
      } as any;
      expect((filterMessage(msg, 1) as any).cardCode).toBe(0);
    });
  });

  // === SELECT_* and routed messages ===

  describe('SELECT_* routing', () => {
    const selectTypes = [
      'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_CARD', 'SELECT_CHAIN',
      'SELECT_EFFECTYN', 'SELECT_YESNO', 'SELECT_PLACE', 'SELECT_DISFIELD',
      'SELECT_POSITION', 'SELECT_OPTION', 'SELECT_TRIBUTE', 'SELECT_SUM',
      'SELECT_UNSELECT_CARD', 'SELECT_COUNTER', 'SORT_CARD', 'SORT_CHAIN',
      'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_CARD', 'ANNOUNCE_NUMBER',
      'RPS_CHOICE', 'SELECT_TP',
    ];

    for (const type of selectTypes) {
      it(`should route ${type} to deciding player only`, () => {
        const msg = { type, player: 0 } as ServerMessage;
        expect(filterMessage(msg, 0)).toBe(msg);
        expect(filterMessage(msg, 1)).toBeNull();
      });

      it(`should not drop ${type} in omniscient mode`, () => {
        const msg = { type, player: 0 } as ServerMessage;
        expect(filterMessage(msg, 1, true)).toBe(msg);
      });
    }
  });

  // === MSG_HINT ===

  describe('MSG_HINT', () => {
    it('should drop hintType 10 (HINT_EFFECT) from opponent', () => {
      const msg = { type: 'MSG_HINT', hintType: 10, player: 0, value: 1, cardName: 'X' } as any;
      expect(filterMessage(msg, 0)).toBe(msg);
      expect(filterMessage(msg, 1)).toBeNull();
    });

    it('should pass hintType 3 (HINT_SELECTMSG) to both players', () => {
      const msg = { type: 'MSG_HINT', hintType: 3, player: 0, value: 1, cardName: 'X' } as any;
      expect(filterMessage(msg, 0)).toBe(msg);
      expect(filterMessage(msg, 1)).toBe(msg);
    });

    it('should not drop hintType 10 in omniscient mode', () => {
      const msg = { type: 'MSG_HINT', hintType: 10, player: 0, value: 1, cardName: 'X' } as any;
      expect(filterMessage(msg, 1, true)).toBe(msg);
    });
  });

  // === RPS_RESULT ===

  describe('RPS_RESULT', () => {
    const msg = {
      type: 'RPS_RESULT', player1Choice: 'ROCK', player2Choice: 'SCISSORS', winner: 0,
    } as any;

    it('should not swap for player 0', () => {
      const result = filterMessage(msg, 0) as any;
      expect(result.player1Choice).toBe('ROCK');
      expect(result.player2Choice).toBe('SCISSORS');
      expect(result.winner).toBe(0);
    });

    it('should swap choices and winner for player 1', () => {
      const result = filterMessage(msg, 1) as any;
      expect(result.player1Choice).toBe('SCISSORS');
      expect(result.player2Choice).toBe('ROCK');
      expect(result.winner).toBe(1);
    });

    it('should preserve null winner (draw)', () => {
      const drawMsg = { ...msg, winner: null } as any;
      const result = filterMessage(drawMsg, 1) as any;
      expect(result.winner).toBeNull();
    });
  });

  // === BOARD_STATE / STATE_SYNC ===

  describe('BOARD_STATE sanitization', () => {
    it('should remap players so [0]=self, [1]=opponent for player 0', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0) as any;
      expect(result.data.players[0].lp).toBe(8000); // self
      expect(result.data.players[1].lp).toBe(7000); // opponent
    });

    it('should remap players so [0]=self, [1]=opponent for player 1', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 1) as any;
      expect(result.data.players[0].lp).toBe(7000); // self (was P1)
      expect(result.data.players[1].lp).toBe(8000); // opponent (was P0)
    });

    it('should remap turnPlayer to relative', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      expect((filterMessage(msg, 0) as any).data.turnPlayer).toBe(0); // self
      expect((filterMessage(msg, 1) as any).data.turnPlayer).toBe(1); // opponent
    });

    it('should hide opponent HAND card codes', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0) as any;
      const oppHand = result.data.players[1].zones.find((z: any) => z.zoneId === 'HAND');
      expect(oppHand.cards.length).toBe(2); // count preserved
      expect(oppHand.cards[0].cardCode).toBeNull();
      expect(oppHand.cards[0].name).toBeNull();
    });

    it('should reveal own HAND card codes', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0) as any;
      const ownHand = result.data.players[0].zones.find((z: any) => z.zoneId === 'HAND');
      expect(ownHand.cards[0].cardCode).toBe(100);
    });

    it('should empty opponent DECK and EXTRA zones', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0) as any;
      const oppDeck = result.data.players[1].zones.find((z: any) => z.zoneId === 'DECK');
      const oppExtra = result.data.players[1].zones.find((z: any) => z.zoneId === 'EXTRA');
      expect(oppDeck.cards).toEqual([]);
      expect(oppExtra.cards).toEqual([]);
    });

    it('should sanitize opponent face-down field cards', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0) as any;
      const oppS2 = result.data.players[1].zones.find((z: any) => z.zoneId === 'S2');
      expect(oppS2.cards[0].cardCode).toBeNull();
      expect(oppS2.cards[0].name).toBeNull();
      expect(oppS2.cards[0].currentAtk).toBeUndefined();
      expect(oppS2.cards[0].currentDef).toBeUndefined();
      expect(oppS2.cards[0].position).toBe(POSITION.FACEDOWN_DEFENSE); // position preserved
    });

    it('should NOT sanitize opponent face-up field cards', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0) as any;
      const oppM2 = result.data.players[1].zones.find((z: any) => z.zoneId === 'M2');
      expect(oppM2.cards[0].cardCode).toBe(1300);
      expect(oppM2.cards[0].currentAtk).toBe(2500);
    });

    it('should pass opponent GY and BANISHED through', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0) as any;
      const oppGY = result.data.players[1].zones.find((z: any) => z.zoneId === 'GY');
      const oppBan = result.data.players[1].zones.find((z: any) => z.zoneId === 'BANISHED');
      expect(oppGY.cards[0].cardCode).toBe(1500);
      expect(oppBan.cards[0].cardCode).toBe(1600);
    });

    it('should skip sanitization in omniscient mode', () => {
      const msg = { type: 'BOARD_STATE', data: boardState() } as any;
      const result = filterMessage(msg, 0, true) as any;
      const oppHand = result.data.players[1].zones.find((z: any) => z.zoneId === 'HAND');
      expect(oppHand.cards[0].cardCode).toBe(900); // not hidden
      const oppDeck = result.data.players[1].zones.find((z: any) => z.zoneId === 'DECK');
      expect(oppDeck.cards.length).toBe(1); // not emptied
    });

    it('should handle player with empty zones array', () => {
      const data: BoardStatePayload = {
        turnPlayer: 0, turnCount: 1, phase: 'MAIN1',
        players: [
          { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
          { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
        ],
      };
      const msg = { type: 'BOARD_STATE', data } as any;
      const result = filterMessage(msg, 0) as any;
      expect(result).toBeTruthy();
      expect(result.data.players[0].zones).toEqual([]);
      expect(result.data.players[1].zones).toEqual([]);
    });
  });

  describe('STATE_SYNC', () => {
    it('should sanitize identically to BOARD_STATE', () => {
      const data = boardState();
      const bs = filterMessage({ type: 'BOARD_STATE', data } as any, 0) as any;
      const ss = filterMessage({ type: 'STATE_SYNC', data } as any, 0) as any;
      expect(ss.data).toEqual(bs.data);
    });
  });

  // === MSG_CONFIRM_CARDS ===

  describe('MSG_CONFIRM_CARDS', () => {
    it('should pass through to both players', () => {
      const msg = { type: 'MSG_CONFIRM_CARDS', player: 0, cards: [] } as any;
      expect(filterMessage(msg, 0)).toBe(msg);
      expect(filterMessage(msg, 1)).toBe(msg);
    });
  });
});
