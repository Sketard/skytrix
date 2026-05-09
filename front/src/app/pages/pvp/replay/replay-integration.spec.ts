/**
 * Replay-based integration tests: queue sequence assertions + rendered state verification.
 * Uses ReplayDuelAdapter as a real harness (no mocks) to verify end-to-end event wiring
 * and state correctness through realistic duel transitions.
 */
import { TestBed } from '@angular/core/testing';
import { ReplayDuelAdapter } from './replay-duel-adapter';
import { DuelLogger } from '../duel-page/duel-logger';
import { LOCATION, POSITION } from '../duel-ws.types';
import type {
  BoardStatePayload, PlayerBoardState, BoardZone, CardOnField,
  ServerMessage, Player, Position, ZoneId,
  MoveMsg, DrawMsg, DamageMsg, RecoverMsg, AttackMsg, BattleMsg, SetMsg,
  ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ChainEndMsg, ChainNegatedMsg,
  SelectCardMsg, SelectChainMsg, WaitingResponseMsg,
} from '../duel-ws.types';
import type { PreComputedState } from '../duel-ws.types';
import type { GameEvent } from '../types';
import type { QueueEntry } from '../duel-page/animation-data-source';

// ── Fixture helpers ──────────────────────────────────────────────────

function card(code: number, pos: Position = POSITION.FACEUP_ATTACK): CardOnField {
  return {
    cardCode: code, name: `Card${code}`, position: pos,
    overlayMaterials: [], counters: {},
    currentAtk: 1500, currentDef: 1200, baseAtk: 1500, baseDef: 1200,
  };
}

function zone(id: ZoneId, cards: CardOnField[] = []): BoardZone {
  return { zoneId: id, cards };
}

function player(overrides?: Partial<PlayerBoardState>): PlayerBoardState {
  return { lp: 8000, deckCount: 40, extraCount: 15, zones: [], ...overrides };
}

function bs(overrides?: Partial<BoardStatePayload>): BoardStatePayload {
  return {
    turnPlayer: 0, turnCount: 1, phase: 'MAIN1',
    players: [player(), player()],
    ...overrides,
  };
}

function state(overrides?: Partial<PreComputedState>): PreComputedState {
  return { boardState: bs(), events: [], label: '', responseCount: 0, ...overrides };
}

/** Drain all events from the adapter queue, returning their types. */
function drainQueue(adapter: ReplayDuelAdapter): QueueEntry[] {
  const entries: QueueEntry[] = [];
  let entry: QueueEntry | null;
  while ((entry = adapter.dequeueAnimation()) !== null) entries.push(entry);
  return entries;
}

function eventTypes(entries: QueueEntry[]): string[] {
  return entries.map(e => (e as GameEvent).type);
}

// ── Test suite ───────────────────────────────────────────────────────

describe('Replay Integration — Queue Sequences & Rendered State', () => {
  let adapter: ReplayDuelAdapter;
  let mockLogger: { log: jasmine.Spy; warn: jasmine.Spy };

  beforeEach(() => {
    mockLogger = { log: jasmine.createSpy('log'), warn: jasmine.createSpy('warn') };
    TestBed.configureTestingModule({
      providers: [
        ReplayDuelAdapter,
        { provide: DuelLogger, useValue: mockLogger },
      ],
    });
    adapter = TestBed.inject(ReplayDuelAdapter);
  });

  afterEach(() => adapter.ngOnDestroy());

  // ═══════════════════════════════════════════════════
  //  Scenario 1: Initial Draw (both players draw 5)
  // ═══════════════════════════════════════════════════

  describe('Scenario: Initial Draw', () => {
    const prevState = state();
    const drawP0: DrawMsg = { type: 'MSG_DRAW', player: 0 as Player, cards: [101, 102, 103, 104, 105] };
    const drawP1: DrawMsg = { type: 'MSG_DRAW', player: 1 as Player, cards: [201, 202, 203, 204, 205] };
    const nextBoardState = bs({
      players: [
        player({ deckCount: 35, zones: [zone('HAND', [card(101), card(102), card(103), card(104), card(105)]), zone('DECK')] }),
        player({ deckCount: 35, zones: [zone('HAND', [card(201), card(202), card(203), card(204), card(205)]), zone('DECK')] }),
      ],
    });
    const nextState = state({ events: [drawP0, drawP1], boardState: nextBoardState });

    it('should produce exactly 2 MSG_DRAW events in queue', () => {
      adapter.feedTransition(prevState, nextState);
      const entries = drainQueue(adapter);
      expect(eventTypes(entries)).toEqual(['MSG_DRAW', 'MSG_DRAW']);
    });

    it('should preserve draw player order (P0 then P1)', () => {
      adapter.feedTransition(prevState, nextState);
      const entries = drainQueue(adapter);
      expect((entries[0] as DrawMsg).player).toBe(0);
      expect((entries[1] as DrawMsg).player).toBe(1);
    });

    it('should update rendered deck counts after processing', () => {
      adapter.feedTransition(prevState, nextState);
      drainQueue(adapter);
      adapter.setAnimating(false);
      const rendered = adapter.boardStateView.renderedState();
      expect(rendered.players[0].deckCount).toBe(35);
      expect(rendered.players[1].deckCount).toBe(35);
    });

    it('should populate rendered HAND zones after processing', () => {
      adapter.feedTransition(prevState, nextState);
      drainQueue(adapter);
      adapter.setAnimating(false);
      const rendered = adapter.boardStateView.renderedState();
      const p0Hand = rendered.players[0].zones.find(z => z.zoneId === 'HAND');
      expect(p0Hand!.cards.length).toBe(5);
      expect(p0Hand!.cards[0].cardCode).toBe(101);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 2: Normal Summon (HAND → MZONE)
  // ═══════════════════════════════════════════════════

  describe('Scenario: Normal Summon', () => {
    const prevState = state({
      boardState: bs({
        players: [
          player({ zones: [zone('HAND', [card(100), card(200)]), zone('M3')] }),
          player(),
        ],
      }),
    });

    const moveMsg: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 100, cardName: 'Card100', player: 0 as Player,
      fromLocation: LOCATION.HAND, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.MZONE, toSequence: 2, toPosition: POSITION.FACEUP_ATTACK,
      isToken: false, reason: 0,
    };

    const nextBoardState = bs({
      players: [
        player({ zones: [zone('HAND', [card(200)]), zone('M3', [card(100)])] }),
        player(),
      ],
    });
    const nextState = state({ events: [moveMsg], boardState: nextBoardState });

    it('should produce exactly 1 MSG_MOVE event', () => {
      adapter.feedTransition(prevState, nextState);
      const entries = drainQueue(adapter);
      expect(eventTypes(entries)).toEqual(['MSG_MOVE']);
    });

    it('should have correct move details', () => {
      adapter.feedTransition(prevState, nextState);
      const move = drainQueue(adapter)[0] as MoveMsg;
      expect(move.fromLocation).toBe(LOCATION.HAND);
      expect(move.toLocation).toBe(LOCATION.MZONE);
      expect(move.toSequence).toBe(2);
      expect(move.cardCode).toBe(100);
    });

    it('should update rendered state: card in M3, removed from HAND', () => {
      adapter.feedTransition(prevState, nextState);
      drainQueue(adapter);
      adapter.setAnimating(false);
      const rendered = adapter.boardStateView.renderedState();
      const hand = rendered.players[0].zones.find(z => z.zoneId === 'HAND');
      const m3 = rendered.players[0].zones.find(z => z.zoneId === 'M3');
      expect(hand!.cards.length).toBe(1);
      expect(hand!.cards[0].cardCode).toBe(200);
      expect(m3!.cards[0].cardCode).toBe(100);
    });

    it('should set logicalState to nextBoardState after feedTransition', () => {
      adapter.feedTransition(prevState, nextState);
      const logical = adapter.boardStateView.logicalState();
      expect(logical).toEqual(nextBoardState);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 3: 2-Link Chain Resolution
  // ═══════════════════════════════════════════════════

  describe('Scenario: 2-Link Chain', () => {
    const chaining0: ChainingMsg = {
      type: 'MSG_CHAINING', chainIndex: 0, cardCode: 500, cardName: 'Spell',
      player: 1 as Player, location: LOCATION.SZONE, sequence: 1, description: 0,
    };
    const chaining1: ChainingMsg = {
      type: 'MSG_CHAINING', chainIndex: 1, cardCode: 600, cardName: 'Trap',
      player: 0 as Player, location: LOCATION.SZONE, sequence: 4, description: 0,
    };
    const solving1: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 };
    const moveDestroy: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 500, cardName: 'Spell', player: 1 as Player,
      fromLocation: LOCATION.SZONE, fromSequence: 1, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.GRAVE, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
      isToken: false, reason: 0,
    };
    const solved1: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 1 };
    const solving0: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 };
    const solved0: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 0 };
    const chainEnd: ChainEndMsg = { type: 'MSG_CHAIN_END' };

    const events = [chaining0, chaining1, solving1, moveDestroy, solved1, solving0, solved0, chainEnd];
    const nextState = state({ events, boardState: bs() });

    it('should produce chain events in correct LIFO resolution order', () => {
      adapter.feedTransition(state(), nextState);
      const types = eventTypes(drainQueue(adapter));
      expect(types).toEqual([
        'MSG_CHAINING', 'MSG_CHAINING',
        'MSG_CHAIN_SOLVING', 'MSG_MOVE', 'MSG_CHAIN_SOLVED',
        'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED',
        'MSG_CHAIN_END',
      ]);
    });

    it('should build 2 chain links during building phase', () => {
      adapter.feedTransition(state(), nextState);
      // After feeding, chain links are committed (CHAIN_SOLVING triggers commitPendingChainEntry)
      expect(adapter.activeChainLinks().length).toBe(2);
      expect(adapter.chainPhase()).toBe('building');
    });

    it('should return to idle after full chain resolution', () => {
      adapter.feedTransition(state(), nextState);
      drainQueue(adapter);
      adapter.setAnimating(false);
      expect(adapter.animationQueue().length).toBe(0);
      // Simulate orchestrator processing: applyChainEnd resets chain state
      adapter.applyChainEnd();
      expect(adapter.chainPhase()).toBe('idle');
      expect(adapter.activeChainLinks().length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 4: Attack + Destroy + Damage
  // ═══════════════════════════════════════════════════

  describe('Scenario: Attack + Destroy', () => {
    const prevState = state({
      boardState: bs({
        players: [
          player({ zones: [zone('M3', [card(100)])] }),
          player({ lp: 8000, zones: [zone('M2', [card(200)]), zone('GY')] }),
        ],
      }),
    });

    const attack: AttackMsg = {
      type: 'MSG_ATTACK', attackerPlayer: 0 as Player, attackerSequence: 2,
      defenderPlayer: 1 as Player, defenderSequence: 1,
    };
    const battle: BattleMsg = {
      type: 'MSG_BATTLE', attackerPlayer: 0 as Player, attackerSequence: 2, attackerDamage: 0,
      defenderPlayer: 1 as Player, defenderSequence: 1, defenderDamage: 500,
    };
    const destroy: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 200, cardName: 'Card200', player: 1 as Player,
      fromLocation: LOCATION.MZONE, fromSequence: 1, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.GRAVE, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
      isToken: false, reason: 1,
    };
    const damage: DamageMsg = { type: 'MSG_DAMAGE', player: 1 as Player, amount: 500 };

    const nextBoardState = bs({
      phase: 'BATTLE_START',
      players: [
        player({ zones: [zone('M3', [card(100)])] }),
        player({ lp: 7500, zones: [zone('M2'), zone('GY', [card(200)])] }),
      ],
    });
    const nextState = state({ events: [attack, battle, destroy, damage], boardState: nextBoardState });

    it('should produce attack sequence in correct order', () => {
      adapter.feedTransition(prevState, nextState);
      const types = eventTypes(drainQueue(adapter));
      expect(types).toEqual(['MSG_ATTACK', 'MSG_BATTLE', 'MSG_MOVE', 'MSG_DAMAGE']);
    });

    it('should update opponent LP in rendered state after processing', () => {
      adapter.feedTransition(prevState, nextState);
      drainQueue(adapter);
      adapter.setAnimating(false);
      expect(adapter.boardStateView.renderedState().players[1].lp).toBe(7500);
    });

    it('should move destroyed card to GY in rendered state', () => {
      adapter.feedTransition(prevState, nextState);
      drainQueue(adapter);
      adapter.setAnimating(false);
      const rendered = adapter.boardStateView.renderedState();
      const m2 = rendered.players[1].zones.find(z => z.zoneId === 'M2');
      const gy = rendered.players[1].zones.find(z => z.zoneId === 'GY');
      expect(m2!.cards.length).toBe(0);
      expect(gy!.cards[0].cardCode).toBe(200);
    });

    it('should preserve attacker on field', () => {
      adapter.feedTransition(prevState, nextState);
      drainQueue(adapter);
      adapter.setAnimating(false);
      const m3 = adapter.boardStateView.renderedState().players[0].zones.find(z => z.zoneId === 'M3');
      expect(m3!.cards[0].cardCode).toBe(100);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 5: Set Spell/Trap (HAND → SZONE face-down)
  // ═══════════════════════════════════════════════════

  describe('Scenario: Set Spell face-down', () => {
    const setMsg: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 300, cardName: 'Trap Card', player: 0 as Player,
      fromLocation: LOCATION.HAND, fromSequence: 1, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.SZONE, toSequence: 0, toPosition: POSITION.FACEDOWN_DEFENSE,
      isToken: false, reason: 0,
    };

    const nextBoardState = bs({
      players: [
        player({ zones: [
          zone('HAND', [card(100)]),
          zone('S1', [card(300, POSITION.FACEDOWN_DEFENSE)]),
        ] }),
        player(),
      ],
    });

    it('should produce MSG_MOVE with face-down destination', () => {
      adapter.feedTransition(state(), state({ events: [setMsg], boardState: nextBoardState }));
      const entries = drainQueue(adapter);
      expect(entries.length).toBe(1);
      const move = entries[0] as MoveMsg;
      expect(move.toPosition).toBe(POSITION.FACEDOWN_DEFENSE);
      expect(move.toLocation).toBe(LOCATION.SZONE);
    });

    it('should render card face-down in S1', () => {
      adapter.feedTransition(state(), state({ events: [setMsg], boardState: nextBoardState }));
      drainQueue(adapter);
      adapter.setAnimating(false);
      const s1 = adapter.boardStateView.renderedState().players[0].zones.find(z => z.zoneId === 'S1');
      expect(s1!.cards[0].position).toBe(POSITION.FACEDOWN_DEFENSE);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 6: Perspective swap with events
  // ═══════════════════════════════════════════════════

  describe('Scenario: Perspective swap with events', () => {
    it('should produce correct queue AND swapped rendered state when viewing as P1', () => {
      adapter.perspectiveIndex.set(1);

      const attack: AttackMsg = {
        type: 'MSG_ATTACK', attackerPlayer: 0 as Player, attackerSequence: 2,
        defenderPlayer: 1 as Player, defenderSequence: 1,
      };
      const damage: DamageMsg = { type: 'MSG_DAMAGE', player: 1 as Player, amount: 1000 };

      const nextBoardState = bs({
        turnPlayer: 0,
        players: [
          player({ zones: [zone('M3', [card(100)])] }),
          player({ lp: 7000 }),
        ],
      });

      adapter.feedTransition(state(), state({ events: [attack, damage], boardState: nextBoardState }));

      // Queue should still contain the events (not swapped — events use absolute player indices)
      const entries = drainQueue(adapter);
      expect(eventTypes(entries)).toEqual(['MSG_ATTACK', 'MSG_DAMAGE']);
      expect((entries[1] as DamageMsg).player).toBe(1); // absolute index preserved in events

      adapter.setAnimating(false);

      // Rendered state should be swapped: P1's data is now players[0]
      const rendered = adapter.boardStateView.renderedState();
      expect(rendered.players[0].lp).toBe(7000);  // P1 (self) at index 0
      expect(rendered.players[1].zones.find(z => z.zoneId === 'M3')!.cards[0].cardCode).toBe(100); // P0 (opp) at index 1
      expect(rendered.turnPlayer).toBe(1); // P0's turn → from P1's perspective = opponent = 1
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 7: Chain with MSG_CHAIN_NEGATED
  // ═══════════════════════════════════════════════════

  describe('Scenario: Chain with negation', () => {
    const chaining0: ChainingMsg = {
      type: 'MSG_CHAINING', chainIndex: 0, cardCode: 500, cardName: 'Spell',
      player: 1 as Player, location: LOCATION.SZONE, sequence: 0, description: 0,
    };
    const chaining1: ChainingMsg = {
      type: 'MSG_CHAINING', chainIndex: 1, cardCode: 600, cardName: 'Counter Trap',
      player: 0 as Player, location: LOCATION.SZONE, sequence: 3, description: 0,
    };
    const negated: ChainNegatedMsg = { type: 'MSG_CHAIN_NEGATED', chainIndex: 0 };
    const solving1: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 };
    const solved1: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 1 };
    const solving0: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 };
    const solved0: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 0 };
    const chainEnd: ChainEndMsg = { type: 'MSG_CHAIN_END' };

    const events = [chaining0, chaining1, negated, solving1, solved1, solving0, solved0, chainEnd];

    it('should NOT include MSG_CHAIN_NEGATED in the animation queue', () => {
      adapter.feedTransition(state(), state({ events, boardState: bs() }));
      const types = eventTypes(drainQueue(adapter));
      expect(types).not.toContain('MSG_CHAIN_NEGATED');
    });

    it('should include all other chain events in correct order', () => {
      adapter.feedTransition(state(), state({ events, boardState: bs() }));
      const types = eventTypes(drainQueue(adapter));
      expect(types).toEqual([
        'MSG_CHAINING', 'MSG_CHAINING',
        'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED',
        'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED',
        'MSG_CHAIN_END',
      ]);
    });

    it('should mark chain link 0 as negated in activeChainLinks', () => {
      adapter.feedTransition(state(), state({ events, boardState: bs() }));
      const links = adapter.activeChainLinks();
      const link0 = links.find(l => l.chainIndex === 0);
      const link1 = links.find(l => l.chainIndex === 1);
      expect(link0!.negated).toBeTrue();
      expect(link1!.negated).toBeFalse();
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 8: Phased transition with 2 decision points
  // ═══════════════════════════════════════════════════

  describe('Scenario: Phased transition with 2 decisions', () => {
    const selectCard1 = (): SelectCardMsg => ({
      type: 'SELECT_CARD', player: 0 as Player, min: 1, max: 1,
      cards: [{ cardCode: 100, name: 'Card A', player: 0 as Player, location: LOCATION.HAND, sequence: 0 }],
      cancelable: false,
    });
    const selectCard2 = (): SelectCardMsg => ({
      type: 'SELECT_CARD', player: 0 as Player, min: 1, max: 1,
      cards: [{ cardCode: 200, name: 'Card B', player: 0 as Player, location: LOCATION.HAND, sequence: 1 }],
      cancelable: false,
    });

    const move1: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 100, cardName: 'Card A', player: 0 as Player,
      fromLocation: LOCATION.HAND, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.MZONE, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
      isToken: false, reason: 0,
    };
    const move2: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 200, cardName: 'Card B', player: 0 as Player,
      fromLocation: LOCATION.HAND, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.SZONE, toSequence: 0, toPosition: POSITION.FACEDOWN_DEFENSE,
      isToken: false, reason: 0,
    };

    const events: ServerMessage[] = [move1, selectCard1(), move2, selectCard2()];
    const dec1 = { prompt: selectCard1(), response: { data: [0] }, player: 0 as Player, boardState: bs() };
    const dec2 = { prompt: selectCard2(), response: { data: [0] }, player: 0 as Player, boardState: bs() };

    it('should stop at first decision, resume, then stop at second', () => {
      const next = state({ events, decisions: [dec1, dec2], boardState: bs() });
      adapter.feedTransitionPhased(state(), next);

      // Step 1: animate (move1 + SELECT_CARD1) → queue has move1
      expect(adapter.animationQueue().length).toBeGreaterThan(0);
      drainQueue(adapter);
      adapter.setAnimating(false);

      // Decision 1
      expect(adapter.activePrompt()).toBeTruthy();
      expect(adapter.activePrompt()!.type).toBe('SELECT_CARD');
      adapter.resumeAfterPrompt();

      // Step 2: animate (move2 + SELECT_CARD2) → queue has move2
      expect(adapter.animationQueue().length).toBeGreaterThan(0);
      drainQueue(adapter);
      adapter.setAnimating(false);

      // Decision 2
      expect(adapter.activePrompt()).toBeTruthy();
      adapter.resumeAfterPrompt();

      // Done
      expect(adapter.busy()).toBeFalse();
      expect(adapter.activePrompt()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 9: Bounce (MZONE → HAND)
  // ═══════════════════════════════════════════════════

  describe('Scenario: Bounce (field to hand)', () => {
    const bounce: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 100, cardName: 'Card100', player: 1 as Player,
      fromLocation: LOCATION.MZONE, fromSequence: 2, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.HAND, toSequence: 3, toPosition: POSITION.FACEUP_ATTACK,
      isToken: false, reason: 0,
    };

    const nextBoardState = bs({
      players: [
        player(),
        player({ zones: [zone('M3'), zone('HAND', [card(900), card(1000), card(1100), card(100)])] }),
      ],
    });

    it('should produce MSG_MOVE from MZONE to HAND', () => {
      adapter.feedTransition(state(), state({ events: [bounce], boardState: nextBoardState }));
      const entries = drainQueue(adapter);
      expect(entries.length).toBe(1);
      const move = entries[0] as MoveMsg;
      expect(move.fromLocation).toBe(LOCATION.MZONE);
      expect(move.toLocation).toBe(LOCATION.HAND);
    });

    it('should render card back in HAND, field zone empty', () => {
      adapter.feedTransition(state(), state({ events: [bounce], boardState: nextBoardState }));
      drainQueue(adapter);
      adapter.setAnimating(false);
      const rendered = adapter.boardStateView.renderedState();
      const hand = rendered.players[1].zones.find(z => z.zoneId === 'HAND');
      const m3 = rendered.players[1].zones.find(z => z.zoneId === 'M3');
      expect(hand!.cards.length).toBe(4);
      expect(hand!.cards[3].cardCode).toBe(100);
      expect(m3!.cards.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 10: LP Recovery
  // ═══════════════════════════════════════════════════

  describe('Scenario: LP Recovery', () => {
    const recover: RecoverMsg = { type: 'MSG_RECOVER', player: 0 as Player, amount: 1500 };
    const nextBoardState = bs({
      players: [player({ lp: 9500 }), player()],
    });

    it('should produce MSG_RECOVER in queue', () => {
      adapter.feedTransition(state(), state({ events: [recover], boardState: nextBoardState }));
      expect(eventTypes(drainQueue(adapter))).toEqual(['MSG_RECOVER']);
    });

    it('should update LP to recovered value', () => {
      adapter.feedTransition(state(), state({ events: [recover], boardState: nextBoardState }));
      drainQueue(adapter);
      adapter.setAnimating(false);
      expect(adapter.boardStateView.renderedState().players[0].lp).toBe(9500);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 11: Consecutive empty SELECT_CHAIN auto-skip
  // ═══════════════════════════════════════════════════

  describe('Scenario: Consecutive empty SELECT_CHAIN auto-skip', () => {
    const emptyChain = (): SelectChainMsg => ({
      type: 'SELECT_CHAIN', player: 0 as Player, cards: [], forced: false,
      hintTiming: 0, hintTimingLabel: '',
    });

    const dec = (prompt: SelectChainMsg | SelectCardMsg) => ({
      prompt, response: { data: -1 }, player: 0 as Player, boardState: bs(),
    });

    it('should auto-skip all empty SELECT_CHAIN decisions without hanging', () => {
      const move: MoveMsg = {
        type: 'MSG_MOVE', cardCode: 100, cardName: 'Card', player: 0 as Player,
        fromLocation: LOCATION.HAND, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
        toLocation: LOCATION.MZONE, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
        isToken: false, reason: 0,
      };

      // 3 consecutive empty chain windows after one move event
      const events: ServerMessage[] = [move, emptyChain(), emptyChain(), emptyChain()];
      const decisions = [dec(emptyChain()), dec(emptyChain()), dec(emptyChain())];
      const next = state({ events, decisions, boardState: bs() });

      adapter.feedTransitionPhased(state(), next);

      // Drain the MSG_MOVE from first animate step
      expect(adapter.animationQueue().length).toBeGreaterThan(0);
      drainQueue(adapter);
      adapter.setAnimating(false);

      // All 3 empty SELECT_CHAIN should be auto-skipped → no prompt, done
      expect(adapter.activePrompt()).toBeNull();
      expect(adapter.busy()).toBeFalse();
    });

    it('should NOT skip SELECT_CHAIN with cards between empty ones', () => {
      const chainWithCards = (): SelectChainMsg => ({
        type: 'SELECT_CHAIN', player: 0 as Player, forced: false,
        cards: [{ cardCode: 500, name: 'Trap', player: 0 as Player, location: LOCATION.SZONE, sequence: 0 }],
        hintTiming: 0, hintTimingLabel: '',
      });

      const events: ServerMessage[] = [emptyChain(), chainWithCards(), emptyChain()];
      const decisions = [
        dec(emptyChain()),
        dec(chainWithCards()),
        dec(emptyChain()),
      ];
      const next = state({ events, decisions, boardState: bs() });

      adapter.feedTransitionPhased(state(), next);

      // First empty chain auto-skipped, second has cards → should prompt
      expect(adapter.activePrompt()).toBeTruthy();
      expect(adapter.activePrompt()!.type).toBe('SELECT_CHAIN');

      // Resume → third empty chain auto-skipped → done
      adapter.resumeAfterPrompt();
      expect(adapter.activePrompt()).toBeNull();
      expect(adapter.busy()).toBeFalse();
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 12: Decision count mismatch fallback
  // ═══════════════════════════════════════════════════

  describe('Scenario: Decision count mismatch fallback', () => {
    it('should fall back to non-phased when SELECT count != decisions count', () => {
      const move: MoveMsg = {
        type: 'MSG_MOVE', cardCode: 100, cardName: 'Card', player: 0 as Player,
        fromLocation: LOCATION.HAND, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
        toLocation: LOCATION.MZONE, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
        isToken: false, reason: 0,
      };
      const sc: SelectCardMsg = {
        type: 'SELECT_CARD', player: 0 as Player, min: 1, max: 1, cards: [], cancelable: false,
      };
      const sch: SelectChainMsg = {
        type: 'SELECT_CHAIN', player: 0 as Player, cards: [], forced: false,
        hintTiming: 0, hintTimingLabel: '',
      };

      // 2 SELECT_* events but only 1 decision → mismatch
      const events = [move, sc, sch];
      const decisions = [{ prompt: sc, response: { data: [0] }, player: 0 as Player }];
      const nextBoardState = bs({ turnCount: 5 });
      const next = state({ events, decisions, boardState: nextBoardState });

      adapter.feedTransitionPhased(state(), next);

      // Fallback: all events fed in a single non-phased step
      // The queue should have the MSG_MOVE (SELECT_* are not enqueued)
      const entries = drainQueue(adapter);
      expect(eventTypes(entries)).toEqual(['MSG_MOVE']);

      // No decision prompt (fallback skips phased decisions)
      adapter.setAnimating(false);
      expect(adapter.activePrompt()).toBeNull();

      // Board state should still be applied
      expect(adapter.boardStateView.renderedState().turnCount).toBe(5);

      // Should have logged a warning about the mismatch
      expect(mockLogger.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('DECISION-MISMATCH'), 2, 1,
      );
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 13: 3-link chain across 2 transitions
  // ═══════════════════════════════════════════════════

  describe('Scenario: 3-link chain across 2 transitions', () => {
    it('should preserve all chain links across transition boundary', () => {
      // Transition 1: Chain starts, 2 links built
      const chaining0: ChainingMsg = {
        type: 'MSG_CHAINING', chainIndex: 0, cardCode: 100, cardName: 'Spell',
        player: 0 as Player, location: LOCATION.SZONE, sequence: 0, description: 0,
      };
      const chaining1: ChainingMsg = {
        type: 'MSG_CHAINING', chainIndex: 1, cardCode: 200, cardName: 'Trap',
        player: 1 as Player, location: LOCATION.SZONE, sequence: 1, description: 0,
      };
      const waiting: WaitingResponseMsg = { type: 'WAITING_RESPONSE' };

      adapter.feedTransition(state(), state({
        events: [chaining0, chaining1, waiting],
        boardState: bs(),
      }));

      expect(adapter.chainPhase()).toBe('building');
      expect(adapter.activeChainLinks().length).toBe(2);

      // Transition 2: 3rd link added + resolution
      const chaining2: ChainingMsg = {
        type: 'MSG_CHAINING', chainIndex: 2, cardCode: 300, cardName: 'Counter',
        player: 0 as Player, location: LOCATION.SZONE, sequence: 2, description: 0,
      };
      const solving2: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 2 };
      const solved2: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 2 };
      const solving1: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 1 };
      const solved1: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 1 };
      const solving0: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 };
      const solved0: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 0 };
      const chainEnd: ChainEndMsg = { type: 'MSG_CHAIN_END' };

      adapter.feedTransition(state(), state({
        events: [chaining2, solving2, solved2, solving1, solved1, solving0, solved0, chainEnd],
        boardState: bs(),
      }));

      // After 2nd transition: all 3 links should be present
      expect(adapter.activeChainLinks().length).toBe(3);
      expect(adapter.activeChainLinks().map(l => l.chainIndex).sort()).toEqual([0, 1, 2]);

      // Queue should contain the full resolution sequence
      const types = eventTypes(drainQueue(adapter));
      expect(types).toContain('MSG_CHAINING');
      expect(types).toContain('MSG_CHAIN_SOLVING');
      expect(types).toContain('MSG_CHAIN_SOLVED');
      expect(types).toContain('MSG_CHAIN_END');
    });

    it('should reset chain to idle after applyChainEnd', () => {
      // Quick setup: build chain + resolve in one transition
      const ch: ChainingMsg = { type: 'MSG_CHAINING', chainIndex: 0, cardCode: 100, cardName: 'X', player: 0 as Player, location: LOCATION.SZONE, sequence: 0, description: 0 };
      const w: WaitingResponseMsg = { type: 'WAITING_RESPONSE' };
      const sv: ChainSolvingMsg = { type: 'MSG_CHAIN_SOLVING', chainIndex: 0 };
      const sd: ChainSolvedMsg = { type: 'MSG_CHAIN_SOLVED', chainIndex: 0 };
      const ce: ChainEndMsg = { type: 'MSG_CHAIN_END' };
      const events = [ch, w, sv, sd, ce];
      adapter.feedTransition(state(), state({ events, boardState: bs() }));
      // Simulate orchestrator processing: apply chain lifecycle
      adapter.applyChainSolving(0);
      adapter.applyChainSolved(0);
      adapter.applyChainEnd();
      drainQueue(adapter);
      adapter.setAnimating(false);

      // Next transition should see idle chain → full reset
      adapter.feedTransition(state(), state({ events: [], boardState: bs() }));
      expect(adapter.chainPhase()).toBe('idle');
      expect(adapter.activeChainLinks().length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 14: MSG_SET (set card on field)
  // ═══════════════════════════════════════════════════

  describe('Scenario: MSG_SET (set card on field)', () => {
    const setEvent: SetMsg = {
      type: 'MSG_SET', cardCode: 400, cardName: 'Trap Card',
      player: 0 as Player, location: LOCATION.SZONE, sequence: 2, position: POSITION.FACEDOWN_DEFENSE,
    };
    const moveToField: MoveMsg = {
      type: 'MSG_MOVE', cardCode: 400, cardName: 'Trap Card', player: 0 as Player,
      fromLocation: LOCATION.HAND, fromSequence: 1, fromPosition: POSITION.FACEUP_ATTACK,
      toLocation: LOCATION.SZONE, toSequence: 2, toPosition: POSITION.FACEDOWN_DEFENSE,
      isToken: false, reason: 0,
    };
    const nextBoardState = bs({
      players: [
        player({ zones: [
          zone('HAND', [card(100)]),
          zone('S3', [card(400, POSITION.FACEDOWN_DEFENSE)]),
        ] }),
        player(),
      ],
    });

    it('should include MSG_SET in the animation queue', () => {
      adapter.feedTransition(state(), state({ events: [moveToField, setEvent], boardState: nextBoardState }));
      const types = eventTypes(drainQueue(adapter));
      expect(types).toContain('MSG_SET');
      expect(types).toContain('MSG_MOVE');
    });

    it('should render the set card face-down after processing', () => {
      adapter.feedTransition(state(), state({ events: [moveToField, setEvent], boardState: nextBoardState }));
      drainQueue(adapter);
      adapter.setAnimating(false);
      const s3 = adapter.boardStateView.renderedState().players[0].zones.find(z => z.zoneId === 'S3');
      expect(s3!.cards[0].cardCode).toBe(400);
      expect(s3!.cards[0].position).toBe(POSITION.FACEDOWN_DEFENSE);
    });
  });

  // ═══════════════════════════════════════════════════
  //  Scenario 15: Multi-transition consistency
  // ═══════════════════════════════════════════════════

  describe('Scenario: Sequential transitions maintain state consistency', () => {
    it('should accumulate board changes across 2 transitions', () => {
      // Transition 1: Summon
      const summon: MoveMsg = {
        type: 'MSG_MOVE', cardCode: 100, cardName: 'Card100', player: 0 as Player,
        fromLocation: LOCATION.HAND, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
        toLocation: LOCATION.MZONE, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
        isToken: false, reason: 0,
      };
      const afterSummon = bs({
        players: [
          player({ deckCount: 39, zones: [zone('HAND', [card(200)]), zone('M1', [card(100)])] }),
          player(),
        ],
      });
      adapter.feedTransition(state(), state({ events: [summon], boardState: afterSummon }));
      drainQueue(adapter);
      adapter.setAnimating(false);

      // Transition 2: Attack
      const attack: AttackMsg = { type: 'MSG_ATTACK', attackerPlayer: 0 as Player, attackerSequence: 0, defenderPlayer: 1 as Player, defenderSequence: 0 };
      const dmg: DamageMsg = { type: 'MSG_DAMAGE', player: 1 as Player, amount: 1500 };
      const afterAttack = bs({
        phase: 'BATTLE_START',
        players: [
          player({ deckCount: 39, zones: [zone('HAND', [card(200)]), zone('M1', [card(100)])] }),
          player({ lp: 6500 }),
        ],
      });
      adapter.feedTransition(
        state({ boardState: afterSummon }),
        state({ events: [attack, dmg], boardState: afterAttack }),
      );
      drainQueue(adapter);
      adapter.setAnimating(false);

      // Final rendered state should reflect both transitions
      const rendered = adapter.boardStateView.renderedState();
      expect(rendered.players[0].zones.find(z => z.zoneId === 'M1')!.cards[0].cardCode).toBe(100);
      expect(rendered.players[0].zones.find(z => z.zoneId === 'HAND')!.cards.length).toBe(1);
      expect(rendered.players[1].lp).toBe(6500);
      expect(rendered.phase).toBe('BATTLE_START');
    });
  });
});
