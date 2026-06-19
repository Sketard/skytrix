import { CardInstance, ZoneId as SimZoneId } from './engine/board-models';
import { CardDetail } from '../../../core/model/card-detail';
import { CardImageDTO } from '../../../core/model/dto/card-image-dto';
import { BoardStatePayload, POSITION, Position } from '../duel-ws.types';
import { cardInstancesToBoardStatePayload, emptySimBoard } from './card-instances-to-payload';

// --- Test fixtures ---------------------------------------------------------

function makeCardDetail(passcode?: number, name?: string): CardDetail {
  const detail = new CardDetail();
  detail.card.passcode = passcode;
  detail.card.name = name;
  return detail;
}

let instanceCounter = 0;
function makeInstance(opts: {
  passcode?: number;
  name?: string;
  faceDown?: boolean;
  position?: 'ATK' | 'DEF';
  overlayMaterials?: CardInstance[];
} = {}): CardInstance {
  return {
    instanceId: `ci-${instanceCounter++}`,
    card: makeCardDetail(opts.passcode, opts.name),
    image: {} as CardImageDTO,
    faceDown: opts.faceDown ?? false,
    position: opts.position ?? 'ATK',
    overlayMaterials: opts.overlayMaterials,
  };
}

function place(board: Record<SimZoneId, CardInstance[]>, zone: SimZoneId, ...cards: CardInstance[]): void {
  board[zone] = cards;
}

function zoneOf(payload: BoardStatePayload, pvpZoneId: string) {
  return payload.players[0].zones.find(z => z.zoneId === pvpZoneId);
}

describe('cardInstancesToBoardStatePayload', () => {
  it('maps an empty sim board to a valid payload with empty player-0 zones and an inert slot 1', () => {
    const payload = cardInstancesToBoardStatePayload(emptySimBoard(), 8000);

    expect(payload.turnPlayer).toBe(0);
    expect(payload.turnCount).toBe(1);
    expect(payload.phase).toBe('MAIN1');
    expect(payload.players.length).toBe(2);

    // slot 0 — the player
    expect(payload.players[0].lp).toBe(8000);
    // every field zone present, all empty
    for (const z of payload.players[0].zones) {
      expect(z.cards).toEqual([]);
    }

    // slot 1 — inert
    expect(payload.players[1].lp).toBe(8000);
    expect(payload.players[1].deckCount).toBe(0);
    expect(payload.players[1].extraCount).toBe(0);
    expect(payload.players[1].zones).toEqual([]);
  });

  it('builds a FRESH inert slot-1 per call (no aliasing across payloads)', () => {
    // Review finding: a shared module-level inert constant would alias the same
    // zones[] array across every payload; a downstream mutation/commit on
    // players[1] would bleed across calls. Pin that each call is independent.
    const a = cardInstancesToBoardStatePayload(emptySimBoard(), 8000);
    const b = cardInstancesToBoardStatePayload(emptySimBoard(), 8000);

    expect(a.players[1]).not.toBe(b.players[1]);
    expect(a.players[1].zones).not.toBe(b.players[1].zones);
  });

  describe('ZoneId mapping (sim → PvP)', () => {
    const cases: Array<[SimZoneId, string]> = [
      [SimZoneId.MONSTER_1, 'M1'],
      [SimZoneId.MONSTER_5, 'M5'],
      [SimZoneId.SPELL_TRAP_1, 'S1'],
      [SimZoneId.SPELL_TRAP_5, 'S5'],
      [SimZoneId.EXTRA_MONSTER_L, 'EMZ_L'],
      [SimZoneId.EXTRA_MONSTER_R, 'EMZ_R'],
      [SimZoneId.FIELD_SPELL, 'FIELD'],
      [SimZoneId.GRAVEYARD, 'GY'],
      [SimZoneId.BANISH, 'BANISHED'],
      [SimZoneId.HAND, 'HAND'],
    ];

    for (const [sim, pvp] of cases) {
      it(`maps ${sim} → ${pvp}`, () => {
        const board = emptySimBoard();
        const card = makeInstance({ passcode: 1234, name: 'Test' });
        place(board, sim, card);

        const payload = cardInstancesToBoardStatePayload(board, 8000);
        const zone = zoneOf(payload, pvp);
        expect(zone).withContext(`${pvp} zone present`).toBeTruthy();
        expect(zone!.cards.length).toBe(1);
        expect(zone!.cards[0].cardCode).toBe(1234);
      });
    }

    it('exposes DECK as a count only (no DECK BoardZone — board reads deckCount)', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.MAIN_DECK, makeInstance(), makeInstance(), makeInstance());

      const payload = cardInstancesToBoardStatePayload(board, 8000);

      expect(payload.players[0].deckCount).toBe(3);
      expect(zoneOf(payload, 'DECK')).toBeUndefined();
    });

    it('emits EXTRA as a real pile zone AND sets extraCount (board renders EXTRA from cards.length, not extraCount)', () => {
      // Review finding: the board renders EXTRA as a `pile-faceup` zone reading
      // BoardZone.cards.length (unlike DECK which reads the scalar deckCount).
      // Omitting the EXTRA zone made the Extra Deck pile render empty.
      const board = emptySimBoard();
      place(board, SimZoneId.EXTRA_DECK,
        makeInstance({ passcode: 10 }),
        makeInstance({ passcode: 20 }),
      );

      const payload = cardInstancesToBoardStatePayload(board, 8000);

      const extra = zoneOf(payload, 'EXTRA');
      expect(extra).withContext('EXTRA zone must be emitted').toBeTruthy();
      expect(extra!.cards.map(c => c.cardCode)).toEqual([10, 20]);
      expect(payload.players[0].extraCount).toBe(2);
    });
  });

  describe('position bitmask (4 cases)', () => {
    const cases: Array<[boolean, 'ATK' | 'DEF', Position]> = [
      [false, 'ATK', POSITION.FACEUP_ATTACK],   // 0x1
      [false, 'DEF', POSITION.FACEUP_DEFENSE],  // 0x4
      [true, 'ATK', POSITION.FACEDOWN_ATTACK],  // 0x2
      [true, 'DEF', POSITION.FACEDOWN_DEFENSE], // 0x8
    ];

    for (const [faceDown, position, expected] of cases) {
      it(`faceDown=${faceDown} position=${position} → 0x${expected.toString(16)}`, () => {
        const board = emptySimBoard();
        place(board, SimZoneId.MONSTER_1, makeInstance({ faceDown, position, passcode: 7 }));

        const payload = cardInstancesToBoardStatePayload(board, 8000);
        expect(zoneOf(payload, 'M1')!.cards[0].position).toBe(expected);
      });
    }

    it('never produces undefined/NaN position', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.MONSTER_2, makeInstance());

      const pos = cardInstancesToBoardStatePayload(board, 8000).players[0].zones
        .find(z => z.zoneId === 'M2')!.cards[0].position;
      expect(pos).toBeDefined();
      expect(Number.isNaN(pos)).toBe(false);
    });
  });

  describe('overlayMaterials invariant — ALWAYS an array', () => {
    it('emits [] when overlayMaterials is undefined', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.MONSTER_1, makeInstance({ overlayMaterials: undefined }));

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'M1')!.cards[0];
      expect(card.overlayMaterials).toEqual([]);
      expect(Array.isArray(card.overlayMaterials)).toBe(true);
    });

    it('emits the material passcodes when overlayMaterials present', () => {
      const board = emptySimBoard();
      const xyz = makeInstance({
        passcode: 100,
        overlayMaterials: [
          makeInstance({ passcode: 11 }),
          makeInstance({ passcode: 22 }),
        ],
      });
      place(board, SimZoneId.MONSTER_3, xyz);

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'M3')!.cards[0];
      expect(card.overlayMaterials).toEqual([11, 22]);
    });

    it('emits 0 for a material with no passcode (never undefined inside the array)', () => {
      const board = emptySimBoard();
      const xyz = makeInstance({
        passcode: 100,
        overlayMaterials: [makeInstance({ passcode: undefined })],
      });
      place(board, SimZoneId.MONSTER_3, xyz);

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'M3')!.cards[0];
      expect(card.overlayMaterials).toEqual([0]);
    });
  });

  describe('counters (free-mode mini-bar, #11)', () => {
    it('projects the counter map onto the matching card by instanceId', () => {
      const board = emptySimBoard();
      const a = makeInstance({ passcode: 1 });
      place(board, SimZoneId.MONSTER_1, a);
      const counters = new Map([[a.instanceId, 3]]);

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000, counters), 'M1')!.cards[0];
      expect(card.counters).toEqual({ counter: 3 });
    });

    it('emits empty counters for a card with no counter entry', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.MONSTER_1, makeInstance({ passcode: 1 }));

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000, new Map()), 'M1')!.cards[0];
      expect(card.counters).toEqual({});
    });
  });

  describe('hard invariants on swap inter-types (#2 — no legality check)', () => {
    it('a monster placed in an S-zone still produces a valid CardOnField', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.SPELL_TRAP_3, makeInstance({ passcode: 555, name: 'Monster', position: 'DEF' }));

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'S3')!.cards[0];
      expect(card.position).toBe(POSITION.FACEUP_DEFENSE);
      expect(card.overlayMaterials).toEqual([]);
      expect(card.cardCode).toBe(555);
    });
  });

  describe('cardCode / name null handling', () => {
    it('emits null cardCode and null name when passcode/name absent', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.MONSTER_1, makeInstance({ passcode: undefined, name: undefined }));

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'M1')!.cards[0];
      expect(card.cardCode).toBeNull();
      expect(card.name).toBeNull();
    });

    it('carries cardCode and name when present', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.MONSTER_1, makeInstance({ passcode: 89631139, name: 'Blue-Eyes' }));

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'M1')!.cards[0];
      expect(card.cardCode).toBe(89631139);
      expect(card.name).toBe('Blue-Eyes');
    });

    it('always emits empty counters in v1', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.MONSTER_1, makeInstance({ passcode: 1 }));

      const card = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'M1')!.cards[0];
      expect(card.counters).toEqual({});
    });
  });

  describe('HAND ordering', () => {
    it('preserves hand insertion order', () => {
      const board = emptySimBoard();
      place(board, SimZoneId.HAND,
        makeInstance({ passcode: 1 }),
        makeInstance({ passcode: 2 }),
        makeInstance({ passcode: 3 }),
      );

      const hand = zoneOf(cardInstancesToBoardStatePayload(board, 8000), 'HAND')!;
      expect(hand.cards.map(c => c.cardCode)).toEqual([1, 2, 3]);
    });
  });

  describe('LP', () => {
    it('reflects the passed LP on player 0', () => {
      expect(cardInstancesToBoardStatePayload(emptySimBoard(), 4200).players[0].lp).toBe(4200);
    });
  });
});
