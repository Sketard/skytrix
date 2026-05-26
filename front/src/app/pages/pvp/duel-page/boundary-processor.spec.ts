import type { BoundaryEvent } from '../types';
import type { BoardStatePayload, ChainingMsg, ServerMessage } from '../duel-ws.types';
import { BoundaryProcessor } from './boundary-processor';

const chaining = (chainIndex: number): ChainingMsg => ({
  type: 'MSG_CHAINING', chainIndex, cardCode: 100, cardName: `Card ${chainIndex}`,
  player: 0, location: 0x02 /* HAND */, sequence: 0, description: 0,
});
const chainEnd = (): ServerMessage => ({ type: 'MSG_CHAIN_END' }) as ServerMessage;
const msgMove = (): ServerMessage => ({ type: 'MSG_MOVE' } as unknown as ServerMessage);

// Minimal BoardStatePayload — only the fields the BP actually reads.
const boardState = (
  turnCount: number,
  turnPlayer: 0 | 1,
  phase: BoardStatePayload['phase'],
): BoardStatePayload => ({
  turnCount, turnPlayer, phase,
  players: [
    { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
  ],
});

describe('BoundaryProcessor', () => {
  let emitted: BoundaryEvent[];
  let bp: BoundaryProcessor;

  beforeEach(() => {
    emitted = [];
    bp = new BoundaryProcessor(e => emitted.push(e));
  });

  describe('Chain boundaries', () => {
    it('emits ChainStarted on first MSG_CHAINING and ChainEnded on MSG_CHAIN_END', () => {
      bp.observeMessage(chaining(0));
      bp.observeMessage(chainEnd());
      expect(emitted).toEqual([
        { kind: 'boundary', type: 'ChainStarted', chainId: 0 },
        { kind: 'boundary', type: 'ChainEnded', chainId: 0 },
      ]);
    });

    it('does NOT re-open on subsequent MSG_CHAINING during the same chain', () => {
      bp.observeMessage(chaining(0));
      bp.observeMessage(chaining(1));
      bp.observeMessage(chaining(2));
      const opens = emitted.filter(e => e.type === 'ChainStarted');
      expect(opens.length).toBe(1);
      expect((opens[0] as { chainId: number }).chainId).toBe(0);
    });

    it('preserves the opening chainId across multi-link chains in ChainEnded', () => {
      bp.observeMessage(chaining(0));
      bp.observeMessage(chaining(1));
      bp.observeMessage(chaining(2));
      bp.observeMessage(chainEnd());
      const closes = emitted.filter(e => e.type === 'ChainEnded');
      expect(closes.length).toBe(1);
      expect((closes[0] as { chainId: number }).chainId).toBe(0);
    });

    it('ignores unrelated messages between MSG_CHAINING and MSG_CHAIN_END', () => {
      bp.observeMessage(chaining(0));
      bp.observeMessage(msgMove());
      bp.observeMessage(chainEnd());
      const types = emitted.map(e => e.type);
      expect(types).toEqual(['ChainStarted', 'ChainEnded']);
    });

    it('self-heals on MSG_CHAIN_END without an open chain (orphan close)', () => {
      // No throw — the BP emits a synthetic ChainEnded(-1) so the
      // journal stays consistent (a duelAssert here would crash
      // legitimate queue-routing tests that feed isolated MSG_CHAIN_END;
      // the warn channel surfaces the anomaly in DevHub instead).
      expect(() => bp.observeMessage(chainEnd())).not.toThrow();
      expect(emitted).toEqual([
        { kind: 'boundary', type: 'ChainEnded', chainId: -1 },
      ]);
    });

    it('opens fresh after a clean ChainStarted/ChainEnded cycle', () => {
      bp.observeMessage(chaining(0));
      bp.observeMessage(chainEnd());
      bp.observeMessage(chaining(5));
      bp.observeMessage(chainEnd());
      const types = emitted.map(e => e.type);
      expect(types).toEqual(['ChainStarted', 'ChainEnded', 'ChainStarted', 'ChainEnded']);
      expect((emitted[2] as { chainId: number }).chainId).toBe(5);
    });
  });

  describe('Turn/Phase boundaries — first BOARD_STATE (Option 4)', () => {
    it('emits TurnStarted + PhaseStarted without any preceding *Ended', () => {
      bp.observeBoardState(boardState(1, 0, 'DRAW'));
      expect(emitted).toEqual([
        { kind: 'boundary', type: 'TurnStarted', turnNumber: 1, player: 0 },
        { kind: 'boundary', type: 'PhaseStarted', phase: 'DRAW' },
      ]);
    });
  });

  describe('Turn/Phase boundaries — deltas', () => {
    it('emits PhaseEnded + PhaseStarted when phase changes within the same turn', () => {
      bp.observeBoardState(boardState(1, 0, 'DRAW'));
      emitted.length = 0;
      bp.observeBoardState(boardState(1, 0, 'MAIN1'));
      expect(emitted).toEqual([
        { kind: 'boundary', type: 'PhaseEnded', phase: 'DRAW' },
        { kind: 'boundary', type: 'PhaseStarted', phase: 'MAIN1' },
      ]);
    });

    it('emits PhaseEnded + TurnEnded + TurnStarted + PhaseStarted when turn flips', () => {
      bp.observeBoardState(boardState(1, 0, 'END'));
      emitted.length = 0;
      bp.observeBoardState(boardState(2, 1, 'DRAW'));
      expect(emitted.map(e => e.type)).toEqual([
        'PhaseEnded', 'TurnEnded', 'TurnStarted', 'PhaseStarted',
      ]);
      expect(emitted[2]).toEqual({
        kind: 'boundary', type: 'TurnStarted', turnNumber: 2, player: 1,
      });
    });

    it('emits no boundary if neither turn nor phase changed', () => {
      bp.observeBoardState(boardState(1, 0, 'MAIN1'));
      emitted.length = 0;
      bp.observeBoardState(boardState(1, 0, 'MAIN1'));
      expect(emitted).toEqual([]);
    });

    it('treats same turnCount + different turnPlayer as a turn flip', () => {
      // Defensive — turnCount should always increment when player flips,
      // but the BP guards on (count XOR player) delta to catch desync.
      bp.observeBoardState(boardState(1, 0, 'MAIN1'));
      emitted.length = 0;
      bp.observeBoardState(boardState(1, 1, 'MAIN1'));
      expect(emitted.map(e => e.type)).toEqual([
        'PhaseEnded', 'TurnEnded', 'TurnStarted', 'PhaseStarted',
      ]);
    });
  });

  describe('forceClosure', () => {
    it('emits *Ended for every open group in Chain → Phase → Turn order', () => {
      bp.observeBoardState(boardState(2, 1, 'MAIN1'));
      bp.observeMessage(chaining(3));
      emitted.length = 0;
      bp.forceClosure('STATE_SYNC');
      expect(emitted.map(e => e.type)).toEqual([
        'ChainEnded', 'PhaseEnded', 'TurnEnded',
      ]);
      expect(emitted[0]).toEqual({ kind: 'boundary', type: 'ChainEnded', chainId: 3 });
      expect(emitted[1]).toEqual({ kind: 'boundary', type: 'PhaseEnded', phase: 'MAIN1' });
      expect(emitted[2]).toEqual({ kind: 'boundary', type: 'TurnEnded', turnNumber: 2 });
    });

    it('is a no-op when no groups are open', () => {
      bp.forceClosure('DuelEnded');
      expect(emitted).toEqual([]);
    });

    it('only emits for the groups that are actually open', () => {
      // Chain open, no boardState yet
      bp.observeMessage(chaining(7));
      emitted.length = 0;
      bp.forceClosure('RematchStarted');
      expect(emitted).toEqual([
        { kind: 'boundary', type: 'ChainEnded', chainId: 7 },
      ]);
    });

    it('post-closure, the BP is ready to open new groups', () => {
      bp.observeBoardState(boardState(1, 0, 'DRAW'));
      bp.forceClosure('DuelEnded');
      emitted.length = 0;
      bp.observeBoardState(boardState(1, 0, 'DRAW'));
      expect(emitted.map(e => e.type)).toEqual(['TurnStarted', 'PhaseStarted']);
    });
  });

  describe('silentReset', () => {
    it('drops state WITHOUT emitting any boundary', () => {
      bp.observeBoardState(boardState(1, 0, 'DRAW'));
      bp.observeMessage(chaining(0));
      emitted.length = 0;
      bp.silentReset();
      expect(emitted).toEqual([]);
      expect(bp.hasOpenChain()).toBeFalse();
      expect(bp.hasOpenTurn()).toBeFalse();
    });

    it('after silentReset, the next BOARD_STATE re-opens TurnStarted (no Ended for the dropped turn)', () => {
      bp.observeBoardState(boardState(1, 0, 'DRAW'));
      bp.silentReset();
      emitted.length = 0;
      bp.observeBoardState(boardState(1, 0, 'DRAW'));
      // Same as first-BOARD_STATE case — TurnStarted + PhaseStarted only.
      expect(emitted.map(e => e.type)).toEqual(['TurnStarted', 'PhaseStarted']);
    });
  });
});
