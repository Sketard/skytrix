import { LOCATION } from '../duel-ws.types';
import type { SelectIdleCmdMsg, SelectBattleCmdMsg, CardInfo } from '../duel-ws.types';
import {
  IDLE_ACTION, BATTLE_ACTION,
  buildActionableCardsFromIdle, buildActionableCardsFromBattle,
  isActivateAction, groupMenuActions, groupPileActions,
  type CardAction,
} from './idle-action-codes';

const makeCard = (cardCode: number, location: number, sequence: number, opts?: Partial<CardInfo>): CardInfo => ({
  cardCode, name: `Card ${cardCode}`, player: 0, location: location as any, sequence, ...opts,
});

describe('idle-action-codes', () => {

  describe('IDLE_ACTION constant values', () => {
    it('should have stable numeric values matching server protocol', () => {
      expect(IDLE_ACTION.SUMMON).toBe(0);
      expect(IDLE_ACTION.SPECIAL_SUMMON).toBe(1);
      expect(IDLE_ACTION.REPOSITION).toBe(2);
      expect(IDLE_ACTION.SET_MONSTER).toBe(3);
      expect(IDLE_ACTION.SET_SPELLTP).toBe(4);
      expect(IDLE_ACTION.ACTIVATE).toBe(5);
    });
  });

  describe('BATTLE_ACTION constant values', () => {
    it('should have stable numeric values matching server protocol', () => {
      expect(BATTLE_ACTION.ACTIVATE).toBe(0);
      expect(BATTLE_ACTION.ATTACK).toBe(1);
    });
  });

  describe('buildActionableCardsFromIdle', () => {
    it('should build map keyed by location-sequence', () => {
      const msg: SelectIdleCmdMsg = {
        type: 'SELECT_IDLECMD', player: 0,
        summons: [makeCard(100, LOCATION.HAND, 0)],
        specialSummons: [], repositions: [], setMonsters: [],
        activations: [], setSpellTraps: [],
        canBattlePhase: true, canEndPhase: true,
      };
      const map = buildActionableCardsFromIdle(msg);
      expect(map.has(`${LOCATION.HAND}-0`)).toBeTrue();
      expect(map.get(`${LOCATION.HAND}-0`)![0].label).toBe('Normal Summon');
    });

    it('should group multiple actions for the same card', () => {
      const card = makeCard(200, LOCATION.HAND, 1);
      const msg: SelectIdleCmdMsg = {
        type: 'SELECT_IDLECMD', player: 0,
        summons: [card], specialSummons: [],
        repositions: [], setMonsters: [card],
        activations: [], setSpellTraps: [],
        canBattlePhase: false, canEndPhase: true,
      };
      const map = buildActionableCardsFromIdle(msg);
      const actions = map.get(`${LOCATION.HAND}-1`)!;
      expect(actions.length).toBe(2);
      expect(actions.map(a => a.label)).toEqual(['Normal Summon', 'Set']);
    });

    it('should return empty map for empty msg', () => {
      const msg: SelectIdleCmdMsg = {
        type: 'SELECT_IDLECMD', player: 0,
        summons: [], specialSummons: [], repositions: [],
        setMonsters: [], activations: [], setSpellTraps: [],
        canBattlePhase: false, canEndPhase: true,
      };
      expect(buildActionableCardsFromIdle(msg).size).toBe(0);
    });
  });

  describe('buildActionableCardsFromBattle', () => {
    it('should map attack and activate actions', () => {
      const msg: SelectBattleCmdMsg = {
        type: 'SELECT_BATTLECMD', player: 0,
        attacks: [makeCard(300, LOCATION.MZONE, 0)],
        activations: [makeCard(301, LOCATION.SZONE, 1)],
        canMainPhase2: true, canEndPhase: true,
      };
      const map = buildActionableCardsFromBattle(msg);
      expect(map.get(`${LOCATION.MZONE}-0`)![0].label).toBe('Attack');
      expect(map.get(`${LOCATION.SZONE}-1`)![0].label).toBe('Activate Effect');
    });

    it('should return empty map for empty msg', () => {
      const msg: SelectBattleCmdMsg = {
        type: 'SELECT_BATTLECMD', player: 0,
        attacks: [], activations: [],
        canMainPhase2: false, canEndPhase: true,
      };
      expect(buildActionableCardsFromBattle(msg).size).toBe(0);
    });

    it('should group both actions when same card appears in attacks and activations', () => {
      const card = makeCard(400, LOCATION.MZONE, 2);
      const msg: SelectBattleCmdMsg = {
        type: 'SELECT_BATTLECMD', player: 0,
        attacks: [card], activations: [card],
        canMainPhase2: true, canEndPhase: true,
      };
      const map = buildActionableCardsFromBattle(msg);
      const actions = map.get(`${LOCATION.MZONE}-2`)!;
      expect(actions.length).toBe(2);
      expect(actions.map(a => a.label)).toEqual(['Attack', 'Activate Effect']);
    });
  });

  describe('isActivateAction', () => {
    it('should return true for ACTIVATE in idle', () => {
      expect(isActivateAction(IDLE_ACTION.ACTIVATE, 'SELECT_IDLECMD')).toBeTrue();
    });

    it('should return true for SPECIAL_SUMMON in idle', () => {
      expect(isActivateAction(IDLE_ACTION.SPECIAL_SUMMON, 'SELECT_IDLECMD')).toBeTrue();
    });

    it('should return false for SUMMON in idle', () => {
      expect(isActivateAction(IDLE_ACTION.SUMMON, 'SELECT_IDLECMD')).toBeFalse();
    });

    it('should return true for ACTIVATE in battle', () => {
      expect(isActivateAction(BATTLE_ACTION.ACTIVATE, 'SELECT_BATTLECMD')).toBeTrue();
    });

    it('should return false for ATTACK in battle', () => {
      expect(isActivateAction(BATTLE_ACTION.ATTACK, 'SELECT_BATTLECMD')).toBeFalse();
    });
  });

  describe('groupMenuActions', () => {
    it('should not group when 0-1 activate actions', () => {
      const actions: CardAction[] = [
        { label: 'Normal Summon', actionCode: 0, index: 0 },
        { label: 'Activate Effect', actionCode: 5, index: 0 },
      ];
      expect(groupMenuActions(actions)).toEqual(actions);
    });

    it('should group multiple activate effects into children', () => {
      const actions: CardAction[] = [
        { label: 'Normal Summon', actionCode: 0, index: 0 },
        { label: 'Activate Effect', actionCode: 5, index: 0, description: 'Effect A' },
        { label: 'Activate Effect', actionCode: 5, index: 1, description: 'Effect B' },
        { label: 'Set', actionCode: 3, index: 0 },
      ];
      const result = groupMenuActions(actions);
      expect(result.length).toBe(3);
      expect(result[0].label).toBe('Normal Summon');
      expect(result[1].label).toBe('Activate Effect');
      expect(result[1].children!.length).toBe(2);
      expect(result[1].index).toBe(-1);
      expect(result[1].children![0].description).toBe('Effect A');
      expect(result[1].children![1].description).toBe('Effect B');
      expect(result[2].label).toBe('Set');
    });
  });

  describe('groupPileActions', () => {
    it('should group all actions by label with children', () => {
      const actions: CardAction[] = [
        { label: 'Activate Effect', actionCode: 5, index: 0, cardName: 'Card A' },
        { label: 'Activate Effect', actionCode: 5, index: 1, cardName: 'Card B' },
        { label: 'Special Summon', actionCode: 1, index: 0, cardName: 'Card C' },
      ];
      const result = groupPileActions(actions);
      expect(result.length).toBe(2);
      expect(result[0].label).toBe('Activate Effect');
      expect(result[0].children!.length).toBe(2);
      expect(result[1].label).toBe('Special Summon');
      expect(result[1].children!.length).toBe(1);
    });

    it('should always use children even for single card', () => {
      const actions: CardAction[] = [
        { label: 'Activate Effect', actionCode: 5, index: 0 },
      ];
      const result = groupPileActions(actions);
      expect(result[0].children!.length).toBe(1);
    });
  });
});
