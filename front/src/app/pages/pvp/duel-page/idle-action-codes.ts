import { CardInfo, SelectBattleCmdMsg, SelectIdleCmdMsg } from '../duel-ws.types';

export const IDLE_ACTION = {
  SUMMON: 0,
  SPECIAL_SUMMON: 1,
  REPOSITION: 2,
  SET_MONSTER: 3,
  SET_SPELLTP: 4,
  ACTIVATE: 5,
  BATTLE_PHASE: 6,
  END_TURN: 7,
} as const;

export const BATTLE_ACTION = {
  ATTACK: 0,
  ACTIVATE: 1,
  MAIN_PHASE_2: 2,
  END_TURN: 3,
} as const;

export interface CardAction {
  label: string;
  actionCode: number;
  index: number;
}

export type ActionableCardsMap = Map<string, CardAction[]>;

function addToActionMap(
  map: ActionableCardsMap,
  cards: CardInfo[],
  label: string,
  actionCode: number,
): void {
  cards.forEach((card, idx) => {
    const key = `${card.location}-${card.sequence}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ label, actionCode, index: idx });
  });
}

export function buildActionableCardsFromIdle(msg: SelectIdleCmdMsg): ActionableCardsMap {
  const map = new Map<string, CardAction[]>();
  addToActionMap(map, msg.summons, 'Normal Summon', IDLE_ACTION.SUMMON);
  addToActionMap(map, msg.specialSummons, 'Special Summon', IDLE_ACTION.SPECIAL_SUMMON);
  addToActionMap(map, msg.repositions, 'Change Position', IDLE_ACTION.REPOSITION);
  addToActionMap(map, msg.setMonsters, 'Set', IDLE_ACTION.SET_MONSTER);
  addToActionMap(map, msg.activations, 'Activate Effect', IDLE_ACTION.ACTIVATE);
  addToActionMap(map, msg.setSpellTraps, 'Set', IDLE_ACTION.SET_SPELLTP);
  return map;
}

export function buildActionableCardsFromBattle(msg: SelectBattleCmdMsg): ActionableCardsMap {
  const map = new Map<string, CardAction[]>();
  addToActionMap(map, msg.attacks, 'Attack', BATTLE_ACTION.ATTACK);
  addToActionMap(map, msg.activations, 'Activate Effect', BATTLE_ACTION.ACTIVATE);
  return map;
}
