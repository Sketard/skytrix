// =============================================================================
// game-log-builder.spec.ts — unit coverage for the pure GameLogBuilder.
// One test per I/O & Edge-Case Matrix row of the validation-prototype spec.
// Hand-built PreComputedState[] fixtures — no network, no engine.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { buildGameLog, isExtraDeckSummon } from './game-log-builder.js';
import type {
  GameLogEntry,
  SeparatorEntry,
  MoveEntry,
  RngEntry,
  CombatEntry,
  ActionEntry,
} from './game-log-types.js';
import type { PreComputedState } from '../ws-protocol-replay.js';
import type { ServerMessage } from '../ws-protocol.js';
import { LOCATION } from '../ws-protocol-shared.js';
import type { BoardStatePayload } from '../ws-protocol-shared.js';

// -----------------------------------------------------------------------------
// Fixture helpers
// -----------------------------------------------------------------------------
// O5 / C2 contract: the board snapshot is ALREADY relative-to-viewer — the
// builder never swaps it. So this fixture builds a RELATIVE board: `players[0]`
// is "you", `players[1]` is the opponent, regardless of `perspective`.
function board(
  turnCount: number,
  phase: BoardStatePayload['phase'],
  lpYou = 8000,
  lpOpp = 8000,
): BoardStatePayload {
  const player = (lp: number): BoardStatePayload['players'][0] => ({
    lp,
    deckCount: 40,
    extraCount: 15,
    zones: [],
  });
  return {
    turnPlayer: 0,
    turnCount,
    phase,
    players: [player(lpYou), player(lpOpp)],
  };
}

function state(
  bs: BoardStatePayload,
  events: ServerMessage[],
): PreComputedState {
  return { boardState: bs, events, label: '', responseCount: 0 };
}

// -----------------------------------------------------------------------------
// Type-narrowing helpers
// -----------------------------------------------------------------------------
const separators = (e: GameLogEntry[]): SeparatorEntry[] =>
  e.filter((x): x is SeparatorEntry => x.block === 'separator');
const moves = (e: GameLogEntry[]): MoveEntry[] =>
  e.filter((x): x is MoveEntry => x.block === 'move');
const rngs = (e: GameLogEntry[]): RngEntry[] =>
  e.filter((x): x is RngEntry => x.block === 'rng');
const combats = (e: GameLogEntry[]): CombatEntry[] =>
  e.filter((x): x is CombatEntry => x.block === 'combat');
const actions = (e: GameLogEntry[]): ActionEntry[] =>
  e.filter((x): x is ActionEntry => x.block === 'action');

// =============================================================================
describe('GameLogBuilder — five-block grammar', () => {
  it('Turn boundary → a turn separator with both LP (relativized)', () => {
    const states = [
      state(board(1, 'MAIN1', 8000, 7000), []),
      state(board(2, 'DRAW', 6000, 7000), []),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const turns = separators(entries).filter(s => s.kind === 'turn');
    expect(turns).toHaveLength(2);
    expect(turns[0].turnNumber).toBe(1);
    expect(turns[0].lp).toEqual([8000, 7000]);
    expect(turns[1].lp).toEqual([6000, 7000]);
  });

  it('The builder never swaps the board — LP passes through in the order given', () => {
    // O5 / C2: the board snapshot is relative-to-viewer; the builder takes
    // `players[]` verbatim. The turn-separator LP is therefore perspective-
    // INDEPENDENT — that independence IS the fix. Feed the same relative
    // board for perspective 0 and 1 and assert an identical, verbatim result.
    for (const perspective of [0, 1] as const) {
      const states = [state(board(1, 'MAIN1', 8000, 3000), [])];
      const entries = buildGameLog({ states, perspective });
      const turn = separators(entries).find(s => s.kind === 'turn');
      // [lpYou, lpOpp] passed through unchanged — no swap, both perspectives.
      expect(turn?.lp).toEqual([8000, 3000]);
    }
  });

  it('Phase boundary → a phase separator on phase change', () => {
    const states = [
      state(board(1, 'DRAW'), []),
      state(board(1, 'MAIN1'), []),
      state(board(1, 'MAIN1'), []), // no change → no extra separator
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const phases = separators(entries).filter(s => s.kind === 'phase');
    // O9 — the builder emits stable i18n KEYS, not French strings.
    expect(phases.map(p => p.labelKey)).toEqual([
      'gameLog.phase.draw',
      'gameLog.phase.main1',
    ]);
  });

  it('Effect-driven draw → activation row with source + description + drawn sub-rows', () => {
    const chaining: ServerMessage = {
      type: 'MSG_CHAINING',
      cardCode: 111,
      cardName: 'Pot of Greed',
      player: 0,
      location: LOCATION.SZONE,
      sequence: 0,
      chainIndex: 0,
      description: 0,
    };
    const draw: ServerMessage = { type: 'MSG_DRAW', player: 0, cards: [222, 333] };
    // Opening hands first (so the effect draw is not mistaken for them).
    const states = [
      state(board(1, 'MAIN1'), [
        openingDraw(0),
        openingDraw(1),
        chaining,
        draw,
      ]),
    ];
    const entries = buildGameLog({
      states,
      perspective: 0,
      resolveDescription: () => 'Draw 2 cards.',
    });
    const activation = moves(entries).find(m => m.chainLink === 1);
    expect(activation).toBeDefined();
    expect(activation!.source?.cardName).toBe('Pot of Greed');
    expect(activation!.description).toBe('Draw 2 cards.');
    expect(activation!.movedCards).toHaveLength(2);
    expect(activation!.movedCards[0].verb).toBe('gameLog.verb.draw');
  });

  it('Draw-phase draw → move row with no source, no description', () => {
    const states = [
      state(board(1, 'DRAW'), [
        openingDraw(0),
        openingDraw(1),
        { type: 'MSG_DRAW', player: 0, cards: [999] },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const drawPhase = moves(entries).find(m => m.variant === 'draw-phase');
    expect(drawPhase).toBeDefined();
    expect(drawPhase!.source).toBeNull();
    expect(drawPhase!.description).toBeNull();
    expect(drawPhase!.movedCards[0].verb).toBe('gameLog.verb.draw');
  });

  it('Hidden moved card → sub-row marked not revealed', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        openingDraw(0),
        openingDraw(1),
        // opponent draws — OCGCore hides identity (cardCode null)
        { type: 'MSG_DRAW', player: 1, cards: [null] },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const drawPhase = moves(entries).find(m => m.variant === 'draw-phase');
    expect(drawPhase!.movedCards[0].card.revealed).toBe(false);
    expect(drawPhase!.movedCards[0].card.cardCode).toBeNull();
  });

  it('Chain of N links → start / activation rows / resolution / end', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        chain(0, 100, 'Card A'),
        chain(1, 200, 'Card B'),
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 },
        { type: 'MSG_CHAIN_END' },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const seps = separators(entries).map(s => s.kind);
    expect(seps).toContain('chain-start');
    expect(seps).toContain('chain-resolve');
    expect(seps).toContain('chain-end');
    // Two activation rows (links 1, 2) then one resolution row for the
    // single resolving link (chainIndex 1 → chainLink 2).
    const links = moves(entries).filter(m => m.chainLink);
    expect(links.map(l => l.chainLink)).toEqual([1, 2, 2]);
  });

  it('Resolution rows → one per resolving link, reusing source + chainLink', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        chain(0, 100, 'Card A'),
        chain(1, 200, 'Card B'),
        // Chains resolve last-link-first: link 1 then link 0.
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 },
        { type: 'MSG_CHAIN_SOLVED', chainIndex: 1 },
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 },
        { type: 'MSG_CHAIN_SOLVED', chainIndex: 0 },
        { type: 'MSG_CHAIN_END' },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    // 2 activations + 2 resolution rows.
    const chainMoves = moves(entries).filter(m => m.chainLink);
    expect(chainMoves.map(m => m.chainLink)).toEqual([1, 2, 2, 1]);
    // The resolution rows (last two) reuse the activating card's source.
    const resA = chainMoves[2]; // resolution for chainIndex 1 → Card B
    const resB = chainMoves[3]; // resolution for chainIndex 0 → Card A
    expect(resA.source?.cardName).toBe('Card B');
    expect(resB.source?.cardName).toBe('Card A');
  });

  it('Resolution-time event attaches to the currently-resolving link', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        chain(0, 100, 'Card A'),
        chain(1, 200, 'Card B'),
        // Link 1 (the highest activation) resolves first. A draw fired now
        // must land on link 1's resolution row, NOT link 0's.
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 },
        { type: 'MSG_DRAW', player: 0, cards: [777] },
        { type: 'MSG_CHAIN_SOLVED', chainIndex: 1 },
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 },
        { type: 'MSG_DRAW', player: 0, cards: [888] },
        { type: 'MSG_CHAIN_SOLVED', chainIndex: 0 },
        { type: 'MSG_CHAIN_END' },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const chainMoves = moves(entries).filter(m => m.chainLink);
    // [activation L1, activation L2, resolution L2, resolution L1]
    const resLink2 = chainMoves[2];
    const resLink1 = chainMoves[3];
    expect(resLink2.movedCards.map(c => c.card.cardCode)).toEqual([777]);
    expect(resLink1.movedCards.map(c => c.card.cardCode)).toEqual([888]);
  });

  it('Chain state is reset at a turn boundary (H3)', () => {
    const states = [
      // Turn 1 — a chain opens but never closes (malformed / interrupted).
      state(board(1, 'MAIN1'), [chain(0, 100, 'Card A')]),
      // Turn 2 — a draw must NOT attach to turn 1's stale activation row.
      state(board(2, 'DRAW'), [{ type: 'MSG_DRAW', player: 0, cards: [555] }]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    // The turn-2 draw is a standalone draw-phase row, not a chain sub-row.
    const drawPhase = moves(entries).find(m => m.variant === 'draw-phase');
    expect(drawPhase).toBeDefined();
    expect(drawPhase!.movedCards[0].card.cardCode).toBe(555);
    // The turn-1 activation row stayed empty (no leak).
    const activation = moves(entries).find(m => m.chainLink === 1);
    expect(activation!.movedCards).toHaveLength(0);
  });

  it('Negated link → that link\'s row flagged negated', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        chain(0, 100, 'Card A'),
        chain(1, 200, 'Card B'),
        { type: 'MSG_CHAIN_NEGATED', chainIndex: 0 },
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 },
        { type: 'MSG_CHAIN_END' },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const link1 = moves(entries).find(m => m.chainLink === 1);
    const link2 = moves(entries).find(m => m.chainLink === 2);
    expect(link1!.negated).toBe(true);
    expect(link2!.negated).toBeUndefined();
  });

  it('Extra-Deck summon → reason decoded as a Link summon verb', () => {
    expect(isExtraDeckSummon(0x80)).toBe(true); // REASON_LINK
    expect(isExtraDeckSummon(0x800)).toBe(false); // REASON_SUMMON (normal)
    const states = [
      state(board(1, 'MAIN1'), [
        openingDraw(0),
        openingDraw(1),
        {
          type: 'MSG_MOVE',
          cardCode: 500,
          cardName: 'Link Monster',
          player: 0,
          toPlayer: 0,
          fromLocation: LOCATION.EXTRA,
          fromSequence: 0,
          fromPosition: 1,
          toLocation: LOCATION.MZONE,
          toSequence: 5, // EMZ
          toPosition: 1,
          isToken: false,
          reason: 0x80, // REASON_LINK
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const summon = moves(entries).find(m =>
      m.movedCards.some(c => c.verb === 'gameLog.verb.linkSummon'),
    );
    expect(summon).toBeDefined();
    const cell = summon!.movedCards[0].destCell;
    expect(cell?.row).toBe('EMZ');
  });

  it('RNG → coin toss row with Face/Pile results', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        chain(0, 100, 'Cup of Ace'),
        { type: 'MSG_TOSS_COIN', player: 0, results: [true, false] },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const coin = rngs(entries).find(r => r.rng === 'coin');
    // O9 — coin results are i18n keys (`gameLog.rng.heads/tails`).
    expect(coin?.results).toEqual(['gameLog.rng.heads', 'gameLog.rng.tails']);
  });

  it('RNG → dice roll row with numeric results', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        { type: 'MSG_TOSS_DICE', player: 1, results: [4] },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const dice = rngs(entries).find(r => r.rng === 'dice');
    expect(dice?.results).toEqual(['4']);
    expect(dice?.player).toBe(1); // opponent, relativized
  });

  it('Combat → direct attack has no defender', () => {
    const states = [
      state(board(1, 'BATTLE'), [
        {
          type: 'MSG_ATTACK',
          attackerPlayer: 0,
          attackerSequence: 0,
          defenderPlayer: null,
          defenderSequence: null,
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const attack = combats(entries).find(c => c.combat === 'attack');
    expect(attack?.defender).toBeUndefined();
    expect(attack?.directLabel).toBeDefined();
  });

  it('Combat → battle calc reports LP loss for the damaged player only', () => {
    const states = [
      state(board(1, 'BATTLE'), [
        {
          type: 'MSG_BATTLE',
          attackerPlayer: 0,
          attackerSequence: 0,
          attackerDamage: 0,
          defenderPlayer: 1,
          defenderSequence: 0,
          defenderDamage: 500,
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const battle = combats(entries).find(c => c.combat === 'battle');
    // Only the defender lost LP → exactly one lpLoss entry, no '0' entry.
    expect(battle?.lpLoss).toEqual([{ player: 1, amount: 500 }]);
  });

  it('Combat → a 0-damage battle reports no LP loss', () => {
    const states = [
      state(board(1, 'BATTLE'), [
        {
          type: 'MSG_BATTLE',
          attackerPlayer: 0,
          attackerSequence: 0,
          attackerDamage: 0,
          defenderPlayer: 1,
          defenderSequence: 0,
          defenderDamage: 0,
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const battle = combats(entries).find(c => c.combat === 'battle');
    expect(battle?.lpLoss).toEqual([]);
  });

  it('Action → add counter row with signed badge', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        {
          type: 'MSG_ADD_COUNTER',
          counterType: 1,
          player: 0,
          location: LOCATION.MZONE,
          sequence: 0,
          count: 2,
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const counter = actions(entries).find(a => a.action === 'counter-add');
    expect(counter?.counterBadge).toBe('+2');
  });

  it('Duel end → a single duel-over separator carrying winner + reason', () => {
    const states = [
      state(board(5, 'END'), [{ type: 'MSG_WIN', player: 0, reason: 0 }]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const over = separators(entries).filter(s => s.kind === 'duel-over');
    // O9 — STRUCTURED kind: `winnerSide` (relative) + a `reasonKey` i18n key;
    // the renderer composes the winner line + the reason line.
    expect(over).toHaveLength(1);
    expect(over[0].winnerSide).toBe(0); // viewer won
    expect(over[0].reasonKey).toBe('gameLog.winReason.lpZero');
  });

  it('Initial 5-card draw → initial-hand variant, no source', () => {
    const states = [
      state(board(1, 'DRAW'), [openingDraw(0), openingDraw(1)]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const hands = moves(entries).filter(m => m.variant === 'initial-hand');
    expect(hands).toHaveLength(2);
    expect(hands[0].source).toBeNull();
    expect(hands[0].movedCards).toHaveLength(5);
  });

  it('A one-sided opening draw does not mis-classify a later effect draw', () => {
    const states = [
      // Only ONE opening draw lands during setup (turn 1).
      state(board(1, 'DRAW'), [openingDraw(0)]),
      // A later turn-3 effect draw of 5+ cards must NOT become initial-hand.
      state(board(3, 'MAIN1'), [
        { type: 'MSG_DRAW', player: 0, cards: [11, 22, 33, 44, 55] },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const hands = moves(entries).filter(m => m.variant === 'initial-hand');
    // Only the genuine setup-turn draw is an opening hand.
    expect(hands).toHaveLength(1);
  });

  it('Draw inside a chain is never an opening-hand row', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        chain(0, 100, 'Reload'),
        // A 5-card effect draw during a chain — not an opening hand.
        { type: 'MSG_DRAW', player: 0, cards: [1, 2, 3, 4, 5] },
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 },
        { type: 'MSG_CHAIN_END' },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const hands = moves(entries).filter(m => m.variant === 'initial-hand');
    expect(hands).toHaveLength(0);
  });

  it('Move to the Extra Deck → "Retour à l\'Extra" verb, EXTRA destZone', () => {
    const states = [
      state(board(2, 'MAIN1'), [
        {
          type: 'MSG_MOVE',
          cardCode: 700,
          cardName: 'Pendulum Monster',
          player: 0,
          toPlayer: 0,
          fromLocation: LOCATION.MZONE,
          fromSequence: 0,
          fromPosition: 1,
          toLocation: LOCATION.EXTRA,
          toSequence: 0,
          toPosition: 1,
          isToken: false,
          reason: 0x1, // REASON_DESTROY
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const move = moves(entries).find(m =>
      m.movedCards.some(c => c.destZone === 'gameLog.zone.extra'),
    );
    expect(move).toBeDefined();
    expect(move!.movedCards[0].verb).toBe('gameLog.verb.returnExtra');
  });

  it('SZONE sequence 5 → the singleton Field Spell cell, not an "S6"', () => {
    const states = [
      state(board(2, 'MAIN1'), [
        {
          type: 'MSG_MOVE',
          cardCode: 800,
          cardName: 'Field Spell',
          player: 0,
          toPlayer: 0,
          fromLocation: LOCATION.HAND,
          fromSequence: 0,
          fromPosition: 1,
          toLocation: LOCATION.SZONE,
          toSequence: 5, // Field Spell zone
          toPosition: 1,
          isToken: false,
          reason: 0,
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const move = moves(entries).find(m => m.movedCards.length > 0);
    const cell = move!.movedCards[0].destCell;
    expect(cell?.row).toBe('FIELD');
    expect(cell?.sequence).toBe(0);
  });

  it('MZONE move with no summon bit → neutral "Déplacement", not a summon', () => {
    const states = [
      state(board(2, 'MAIN1'), [
        {
          type: 'MSG_MOVE',
          cardCode: 900,
          cardName: 'Controlled Monster',
          player: 1,
          toPlayer: 0, // control swap — moves to the other player's MZONE
          fromLocation: LOCATION.MZONE,
          fromSequence: 0,
          fromPosition: 1,
          toLocation: LOCATION.MZONE,
          toSequence: 1,
          toPosition: 1,
          isToken: false,
          reason: 0, // no summon bit at all
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const move = moves(entries).find(m => m.movedCards.length > 0);
    expect(move!.movedCards[0].verb).toBe('gameLog.verb.move');
  });

  it('Shuffle events → shuffle action rows (hand + deck)', () => {
    const states = [
      state(board(2, 'MAIN1'), [
        { type: 'MSG_SHUFFLE_HAND', player: 0, cards: [1, 2, 3] },
        { type: 'MSG_SHUFFLE_DECK', player: 1 },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const shuffles = actions(entries).filter(a => a.action === 'shuffle');
    expect(shuffles).toHaveLength(2);
    // O9 — action labels are i18n keys.
    expect(shuffles[0].labelKey).toBe('gameLog.action.shuffleHand');
    expect(shuffles[1].labelKey).toBe('gameLog.action.shuffleDeck');
    expect(shuffles[1].player).toBe(1); // opponent, relativized
  });

  it('Swap event → an Échange action row', () => {
    const card = {
      cardCode: 1,
      name: 'X',
      player: 0 as const,
      location: LOCATION.MZONE,
      sequence: 0,
    };
    const states = [
      state(board(2, 'MAIN1'), [
        { type: 'MSG_SWAP', card1: card, card2: { ...card, sequence: 1 } },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const swap = actions(entries).find(a => a.action === 'swap');
    expect(swap).toBeDefined();
    expect(swap!.labelKey).toBe('gameLog.action.swap');
  });

  it('MSG_BECOME_TARGET resolves an opponent-half card under perspective 1 (O5)', () => {
    // O5 / C2 regression test — the bug this catches: the builder used to
    // index a relative-to-viewer board with an ABSOLUTE player. Here the
    // viewer is P1, so the relative board's `players[1]` is the absolute-P0
    // player. A MSG_BECOME_TARGET at absolute player 0 must relativise to
    // relative index 1 and resolve the card sitting there.
    const bs = board(1, 'MAIN1');
    // Place a card in the opponent's MZONE M1 — relative `players[1]` is the
    // opponent for a P1 viewer (absolute P0).
    bs.players[1].zones = [
      { zoneId: 'M1', cards: [cardOnField(424242, 'Targeted Monster')] },
    ];
    const states = [
      state(bs, [
        chain(0, 100, 'Targeting Effect'),
        {
          type: 'MSG_BECOME_TARGET',
          cards: [
            { player: 0, location: LOCATION.MZONE, sequence: 0 },
          ],
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 1 });
    const activation = moves(entries).find(m => m.chainLink === 1);
    expect(activation?.targets).toBeDefined();
    expect(activation!.targets).toHaveLength(1);
    expect(activation!.targets![0].revealed).toBe(true);
    expect(activation!.targets![0].cardCode).toBe(424242);
    expect(activation!.targets![0].cardName).toBe('Targeted Monster');
  });

  it('resolveDescription is keyed by the raw description code, not chainIndex', () => {
    const seen: number[] = [];
    const states = [
      state(board(1, 'MAIN1'), [
        {
          type: 'MSG_CHAINING',
          cardCode: 111,
          cardName: 'Effect Card',
          player: 0,
          location: LOCATION.SZONE,
          sequence: 0,
          chainIndex: 0,
          description: 4242, // raw description code
        },
        { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 },
        { type: 'MSG_CHAIN_END' },
      ]),
    ];
    buildGameLog({
      states,
      perspective: 0,
      resolveDescription: code => {
        seen.push(code);
        return `desc-${code}`;
      },
    });
    // The resolver received the description CODE (4242), not chainIndex (0).
    expect(seen).toContain(4242);
    expect(seen).not.toContain(0);
  });

  it('uses the server-resolved descriptionText (live PvP — no resolver)', () => {
    // Live PvP feeds the builder with NO `resolveDescription` (the browser has
    // no cards.cdb). The worker has already resolved the text into
    // `descriptionText` — the builder must read it straight off the event.
    const states = [
      state(board(1, 'MAIN1'), [
        {
          type: 'MSG_CHAINING',
          cardCode: 111,
          cardName: 'Effect Card',
          player: 0,
          location: LOCATION.SZONE,
          sequence: 0,
          chainIndex: 0,
          description: 1160,
          descriptionText: 'Activate it as a Pendulum Spell',
        },
      ]),
    ];
    const entries = buildGameLog({ states, perspective: 0 });
    const activation = moves(entries).find(m => m.chainLink === 1);
    expect(activation!.description).toBe('Activate it as a Pendulum Spell');
  });

  it('descriptionText wins over the resolveDescription fallback', () => {
    const states = [
      state(board(1, 'MAIN1'), [
        {
          type: 'MSG_CHAINING',
          cardCode: 111,
          cardName: 'Effect Card',
          player: 0,
          location: LOCATION.SZONE,
          sequence: 0,
          chainIndex: 0,
          description: 4242,
          descriptionText: 'server-resolved',
        },
      ]),
    ];
    const entries = buildGameLog({
      states,
      perspective: 0,
      resolveDescription: () => 'cli-resolved',
    });
    const activation = moves(entries).find(m => m.chainLink === 1);
    expect(activation!.description).toBe('server-resolved');
  });
});

// -----------------------------------------------------------------------------
// Local fixture builders
// -----------------------------------------------------------------------------
function openingDraw(player: 0 | 1): ServerMessage {
  return { type: 'MSG_DRAW', player, cards: [1, 2, 3, 4, 5] };
}

/** A minimal on-field card — only the fields `resolveBoardCard` reads. */
function cardOnField(
  cardCode: number,
  name: string,
): BoardStatePayload['players'][0]['zones'][0]['cards'][0] {
  return {
    cardCode,
    name,
    position: 1,
    overlayMaterials: [],
    counters: {},
  };
}

function chain(
  chainIndex: number,
  cardCode: number,
  cardName: string,
): ServerMessage {
  return {
    type: 'MSG_CHAINING',
    cardCode,
    cardName,
    player: chainIndex % 2 === 0 ? 0 : 1,
    location: LOCATION.SZONE,
    sequence: 0,
    chainIndex,
    description: 0,
  };
}
