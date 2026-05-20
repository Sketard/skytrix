import { TestBed } from '@angular/core/testing';
import { ReplayDuelAdapter } from './replay-duel-adapter';
import { DuelLogger } from '../duel-page/duel-logger';
import type {
  BoardStatePayload, DecisionMoment, Player, PreComputedState, ServerMessage,
  MoveMsg, DamageMsg, SelectCardMsg, SelectChainMsg, ChainingMsg, WaitingResponseMsg,
} from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';

function boardState(overrides?: Partial<BoardStatePayload>): BoardStatePayload {
  return {
    turnPlayer: 0, turnCount: 1, phase: 'MAIN1',
    players: [
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    ],
    ...overrides,
  };
}

function precomputed(overrides?: Partial<PreComputedState>): PreComputedState {
  return {
    boardState: boardState(), events: [], label: 'test', responseCount: 0,
    ...overrides,
  };
}

const msgMove = (): MoveMsg => ({
  type: 'MSG_MOVE', cardCode: 100, cardName: 'Card', player: 0 as Player,
  fromLocation: LOCATION.DECK, fromSequence: 0, fromPosition: POSITION.FACEUP_ATTACK,
  toLocation: LOCATION.HAND, toSequence: 0, toPosition: POSITION.FACEUP_ATTACK,
  isToken: false, reason: 0,
});

const msgDamage = (player: Player = 0 as Player, amount = 500): DamageMsg => ({
  type: 'MSG_DAMAGE', player, amount,
});

const selectCard = (): SelectCardMsg => ({
  type: 'SELECT_CARD', player: 0 as Player, min: 1, max: 1, cards: [
    { cardCode: 100, name: 'Card', player: 0 as Player, location: LOCATION.HAND, sequence: 0 },
  ], cancelable: false,
});

const selectChainEmpty = (): SelectChainMsg => ({
  type: 'SELECT_CHAIN', player: 0 as Player, cards: [], forced: false,
  hintTiming: 0, hintTimingLabel: '',
});

const selectChainWithCards = (): SelectChainMsg => ({
  type: 'SELECT_CHAIN', player: 0 as Player, cards: [
    { cardCode: 200, name: 'Trap', player: 0 as Player, location: LOCATION.SZONE, sequence: 0 },
  ], forced: false, hintTiming: 0, hintTimingLabel: '',
});

const decision = (prompt: ServerMessage, bs?: BoardStatePayload): DecisionMoment => ({
  prompt, response: { data: null }, player: 0, boardState: bs,
});

describe('ReplayDuelAdapter', () => {
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

  describe('initial state', () => {
    it('should start idle with no active decision', () => {
      expect(adapter.busy()).toBeFalse();
      expect(adapter.chainPhase()).toBe('idle');
      expect(adapter.activeChainLinks()).toEqual([]);
      expect(adapter.animationQueue()).toEqual([]);
      expect(adapter.pendingPrompt()).toBeNull();
      expect(adapter.activePrompt()).toBeNull();
      expect(adapter.activeResponse()).toBeNull();
    });
  });

  describe('feedTransition (no decisions)', () => {
    it('should feed events and become busy when queue has entries', () => {
      const prev = precomputed();
      const next = precomputed({ events: [msgMove()] });
      adapter.feedTransition(prev, next);
      expect(adapter.busy()).toBeTrue();
      expect(adapter.animationQueue().length).toBeGreaterThan(0);
    });

    it('should sync rendered and stay idle when no events', () => {
      const prev = precomputed();
      const next = precomputed({ events: [], boardState: boardState({ turnCount: 2 }) });
      adapter.feedTransition(prev, next);
      expect(adapter.busy()).toBeFalse();
      expect(adapter.boardStateView.renderedState().turnCount).toBe(2);
    });

    it('should set rendered state from next board state', () => {
      const prev = precomputed();
      const next = precomputed({ events: [], boardState: boardState({ turnCount: 5, phase: 'BATTLE_START' }) });
      adapter.feedTransition(prev, next);
      expect(adapter.boardStateView.renderedState().turnCount).toBe(5);
      expect(adapter.boardStateView.renderedState().phase).toBe('BATTLE_START');
    });
  });

  describe('perspective swap', () => {
    it('should not swap when perspectiveIndex is 0', () => {
      adapter.perspectiveIndex.set(0);
      const bs = boardState({
        turnPlayer: 0,
        players: [
          { lp: 5000, deckCount: 30, extraCount: 10, zones: [] },
          { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
        ],
      });
      adapter.feedTransition(precomputed(), precomputed({ events: [], boardState: bs }));
      expect(adapter.boardStateView.renderedState().players[0].lp).toBe(5000);
      expect(adapter.boardStateView.renderedState().players[1].lp).toBe(8000);
    });

    it('should swap players when perspectiveIndex is 1', () => {
      adapter.perspectiveIndex.set(1);
      const bs = boardState({
        turnPlayer: 0,
        players: [
          { lp: 5000, deckCount: 30, extraCount: 10, zones: [] },
          { lp: 7000, deckCount: 35, extraCount: 12, zones: [] },
        ],
      });
      adapter.feedTransition(precomputed(), precomputed({ events: [], boardState: bs }));
      // After swap: players[0] should be the original players[1]
      expect(adapter.boardStateView.renderedState().players[0].lp).toBe(7000);
      expect(adapter.boardStateView.renderedState().players[1].lp).toBe(5000);
    });

    it('should swap turnPlayer when perspectiveIndex is 1', () => {
      adapter.perspectiveIndex.set(1);
      const bs = boardState({ turnPlayer: 0 });
      adapter.feedTransition(precomputed(), precomputed({ events: [], boardState: bs }));
      expect(adapter.boardStateView.renderedState().turnPlayer).toBe(1);
    });

    // Regression: the per-event `boardStateAfter` snapshot (attached server-side
    // to BOARD_CHANGING events during chain resolution) must also be relativized.
    // Left un-swapped, perspective=1 replays render the board flipped for one
    // frame when the orchestrator calls updateLogical(event.boardStateAfter).
    it('should swap per-event boardStateAfter when perspectiveIndex is 1', () => {
      adapter.perspectiveIndex.set(1);
      const snapshot = boardState({
        turnPlayer: 0,
        players: [
          { lp: 5000, deckCount: 30, extraCount: 10, zones: [] },
          { lp: 7000, deckCount: 35, extraCount: 12, zones: [] },
        ],
      });
      const move = { ...msgMove(), boardStateAfter: snapshot } as ServerMessage;
      adapter.feedTransition(precomputed(), precomputed({ events: [move] }));
      const queued = adapter.animationQueue()[0] as { boardStateAfter?: BoardStatePayload };
      expect(queued.boardStateAfter).toBeDefined();
      expect(queued.boardStateAfter!.players[0].lp).toBe(7000);
      expect(queued.boardStateAfter!.players[1].lp).toBe(5000);
      expect(queued.boardStateAfter!.turnPlayer).toBe(1);
    });

    it('should leave per-event boardStateAfter untouched when perspectiveIndex is 0', () => {
      adapter.perspectiveIndex.set(0);
      const snapshot = boardState({
        turnPlayer: 0,
        players: [
          { lp: 5000, deckCount: 30, extraCount: 10, zones: [] },
          { lp: 7000, deckCount: 35, extraCount: 12, zones: [] },
        ],
      });
      const move = { ...msgMove(), boardStateAfter: snapshot } as ServerMessage;
      adapter.feedTransition(precomputed(), precomputed({ events: [move] }));
      const queued = adapter.animationQueue()[0] as { boardStateAfter?: BoardStatePayload };
      expect(queued.boardStateAfter!.players[0].lp).toBe(5000);
      expect(queued.boardStateAfter!.turnPlayer).toBe(0);
    });
  });

  describe('feedTransitionPhased (with decisions)', () => {
    it('should return done when no decisions', () => {
      const result = adapter.feedTransitionPhased(precomputed(), precomputed({ events: [] }));
      expect(result).toBe('done');
    });

    it('should build steps and stop at first decision prompt after queue drains', () => {
      const events: ServerMessage[] = [msgMove(), selectCard()];
      const decisions = [decision(selectCard(), boardState())];
      const next = precomputed({ events, decisions, boardState: boardState() });

      adapter.feedTransitionPhased(precomputed(), next);
      // First step produces a queue entry (MSG_MOVE) — drain it
      expect(adapter.animationQueue().length).toBeGreaterThan(0);
      while (adapter.dequeueAnimation()) {}
      adapter.setAnimating(false);
      // Now the decide step should be active
      expect(adapter.activePrompt()).toBeTruthy();
      expect(adapter.busy()).toBeTrue();
    });

    it('should auto-skip empty SELECT_CHAIN decisions', () => {
      const events: ServerMessage[] = [selectChainEmpty()];
      const decisions = [decision(selectChainEmpty())];
      const next = precomputed({ events, decisions });

      const result = adapter.feedTransitionPhased(precomputed(), next);
      // Empty SELECT_CHAIN should be auto-skipped
      expect(result).toBe('done');
      expect(adapter.activePrompt()).toBeNull();
    });

    it('should NOT skip SELECT_CHAIN with cards', () => {
      const events: ServerMessage[] = [selectChainWithCards()];
      const decisions = [decision(selectChainWithCards())];
      const next = precomputed({ events, decisions });

      const result = adapter.feedTransitionPhased(precomputed(), next);
      expect(result).toBe('prompt');
    });
  });

  describe('resumeAfterPrompt', () => {
    it('should clear active decision and continue step processing', () => {
      const events: ServerMessage[] = [selectCard()];
      const decisions = [decision(selectCard())];
      const next = precomputed({ events, decisions, boardState: boardState({ turnCount: 3 }) });

      adapter.feedTransitionPhased(precomputed(), next);
      expect(adapter.activePrompt()).toBeTruthy();

      adapter.resumeAfterPrompt();
      expect(adapter.activePrompt()).toBeNull();
      // Should have processed remaining steps and become idle
      expect(adapter.busy()).toBeFalse();
    });

    it('should be a no-op when no active decision', () => {
      adapter.resumeAfterPrompt();
      expect(adapter.busy()).toBeFalse();
    });
  });

  describe('setAnimating', () => {
    it('should advance step when set to false', () => {
      // Feed events that create a non-empty queue
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove(), msgDamage()] }));
      expect(adapter.busy()).toBeTrue();

      // Drain queue manually, then signal animation done
      while (adapter.dequeueAnimation()) {}
      adapter.setAnimating(false);
      // Should have advanced and become idle (no more steps)
      expect(adapter.busy()).toBeFalse();
    });
  });

  describe('AnimationDataSource delegation', () => {
    it('dequeueAnimation should dequeue from processor', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove()] }));
      const entry = adapter.dequeueAnimation();
      expect(entry).toBeTruthy();
    });

    it('prependToQueue should prepend entries', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgDamage()] }));
      adapter.prependToQueue([msgMove()]);
      expect(adapter.animationQueue().length).toBe(2);
    });

    it('removeAnimationAt should remove entry at given index', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove(), msgDamage(), msgDamage(1 as Player, 300)] }));
      const before = adapter.animationQueue().length;
      adapter.removeAnimationAt(1);
      expect(adapter.animationQueue().length).toBe(before - 1);
      // First and last entries remain; middle one removed
      expect((adapter.animationQueue()[0] as MoveMsg).type).toBe('MSG_MOVE');
      expect((adapter.animationQueue()[1] as DamageMsg).type).toBe('MSG_DAMAGE');
    });

    it('removeAnimationAt should handle first index', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove(), msgDamage()] }));
      adapter.removeAnimationAt(0);
      expect(adapter.animationQueue().length).toBe(1);
      expect((adapter.animationQueue()[0] as DamageMsg).type).toBe('MSG_DAMAGE');
    });

    it('removeAnimationAt should handle last index', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove(), msgDamage()] }));
      adapter.removeAnimationAt(1);
      expect(adapter.animationQueue().length).toBe(1);
      expect((adapter.animationQueue()[0] as MoveMsg).type).toBe('MSG_MOVE');
    });

    it('applyChainSolving should delegate to processor', () => {
      const chaining: ChainingMsg = {
        type: 'MSG_CHAINING', chainIndex: 0, cardCode: 100, cardName: 'Card',
        player: 0 as Player, location: LOCATION.HAND, sequence: 0, description: 0,
      };
      adapter.feedTransition(precomputed(), precomputed({ events: [chaining] }));
      adapter.applyChainSolving(0);
      expect(adapter.chainPhase()).toBe('resolving');
    });

    it('applyChainEnd should reset chain to idle', () => {
      const chaining: ChainingMsg = {
        type: 'MSG_CHAINING', chainIndex: 0, cardCode: 100, cardName: 'Card',
        player: 0 as Player, location: LOCATION.HAND, sequence: 0, description: 0,
      };
      adapter.feedTransition(precomputed(), precomputed({ events: [chaining] }));
      adapter.applyChainEnd();
      expect(adapter.chainPhase()).toBe('idle');
    });

    it('pendingPrompt should always be null', () => {
      expect(adapter.pendingPrompt()).toBeNull();
    });
  });

  describe('collapseRemainingSteps', () => {
    it('should feed all remaining animate steps and clear decisions', () => {
      const events: ServerMessage[] = [msgMove(), selectCard(), msgDamage()];
      const decisions = [decision(selectCard(), boardState())];
      const next = precomputed({
        events, decisions,
        boardState: boardState({ turnCount: 5 }),
      });

      adapter.feedTransitionPhased(precomputed(), next);
      // Drain the first animate step's queue
      while (adapter.dequeueAnimation()) {}
      adapter.setAnimating(false);
      // Now at prompt
      expect(adapter.activePrompt()).toBeTruthy();

      adapter.collapseRemainingSteps();
      expect(adapter.activePrompt()).toBeNull();
    });
  });

  describe('abort', () => {
    it('should reset all state', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove()] }));
      expect(adapter.busy()).toBeTrue();

      adapter.abort();
      expect(adapter.busy()).toBeFalse();
      expect(adapter.chainPhase()).toBe('idle');
      expect(adapter.animationQueue()).toEqual([]);
      expect(adapter.activePrompt()).toBeNull();
    });
  });

  describe('jumpToState', () => {
    it('should abort and set board state directly', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove()] }));
      const target = precomputed({ boardState: boardState({ turnCount: 10, phase: 'END' }) });

      adapter.jumpToState(target);
      expect(adapter.busy()).toBeFalse();
      expect(adapter.boardStateView.renderedState().turnCount).toBe(10);
      expect(adapter.boardStateView.renderedState().phase).toBe('END');
    });

    it('should respect perspective swap', () => {
      adapter.perspectiveIndex.set(1);
      const target = precomputed({
        boardState: boardState({
          turnPlayer: 0,
          players: [
            { lp: 3000, deckCount: 20, extraCount: 5, zones: [] },
            { lp: 6000, deckCount: 30, extraCount: 10, zones: [] },
          ],
        }),
      });

      adapter.jumpToState(target);
      // Swapped: players[0] is original players[1]
      expect(adapter.boardStateView.renderedState().players[0].lp).toBe(6000);
      expect(adapter.boardStateView.renderedState().players[1].lp).toBe(3000);
    });
  });

  describe('resetProcessorForTransition (via feedTransition)', () => {
    it('should preserve chain state across transitions when chain is active', () => {
      // First transition: start a chain with CHAINING + WAITING_RESPONSE to commit the entry
      const chaining: ChainingMsg = {
        type: 'MSG_CHAINING', chainIndex: 0, cardCode: 100, cardName: 'Card',
        player: 0 as Player, location: LOCATION.HAND, sequence: 0, description: 0,
      };
      const waiting: WaitingResponseMsg = { type: 'WAITING_RESPONSE' };
      adapter.feedTransition(precomputed(), precomputed({ events: [chaining, waiting] }));
      // Chain link is now committed (WAITING_RESPONSE triggers commitPendingChainEntry)
      expect(adapter.chainPhase()).toBe('building');
      expect(adapter.activeChainLinks().length).toBe(1);

      // Move to resolving
      adapter.applyChainSolving(0);
      expect(adapter.chainPhase()).toBe('resolving');

      // Second transition: chain should be preserved (resetQueue, not full reset)
      adapter.feedTransition(precomputed(), precomputed({ events: [msgDamage()] }));
      expect(adapter.chainPhase()).toBe('resolving');
      expect(adapter.activeChainLinks().length).toBe(1);
    });

    it('should full-reset processor when chain is idle', () => {
      adapter.feedTransition(precomputed(), precomputed({ events: [msgMove()] }));
      // Drain queue
      while (adapter.dequeueAnimation()) {}
      adapter.setAnimating(false);
      expect(adapter.chainPhase()).toBe('idle');

      // Next transition should full-reset
      adapter.feedTransition(precomputed(), precomputed({ events: [msgDamage()] }));
      // Queue should only have the new event, not leftovers
      expect(adapter.animationQueue().length).toBe(1);
    });
  });

  describe('computed signals from activeDecision', () => {
    it('should expose decision details via computed signals', () => {
      const prompt = selectCard();
      const dec: DecisionMoment = {
        prompt, response: { data: [0], timestamp: '2026-01-01T00:00:00Z' }, player: 1 as Player,
        hint: { hintType: 1, value: 42, cardName: 'Hint Card', hintAction: 'activate' },
        confirmedCards: [{ cardCode: 100, name: 'Card', player: 0, location: LOCATION.HAND, sequence: 0 }],
      };

      const events: ServerMessage[] = [selectCard()];
      const next = precomputed({ events, decisions: [dec] });
      adapter.feedTransitionPhased(precomputed(), next);

      expect(adapter.activePrompt()).toBeTruthy();
      expect(adapter.activeResponse()).toEqual([0]);
      expect(adapter.activePlayer()).toBe(1);
      expect(adapter.activeHint()!.hintType).toBe(1);
      expect(adapter.activeHint()!.cardName).toBe('Hint Card');
      expect(adapter.activeConfirmedCards()!.length).toBe(1);
      expect(adapter.activeTimestamp()).toBe('2026-01-01T00:00:00Z');
    });
  });
});
