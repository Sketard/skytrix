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
  description?: string;
  cardName?: string;
  cardCode?: number;
  children?: CardAction[];
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
    map.get(key)!.push({ label, actionCode, index: idx, description: card.description, cardName: card.name, cardCode: card.cardCode });
  });
}

/**
 * Groups multiple "Activate Effect" entries for the same card into a single
 * entry with `children`. The sub-entries retain their descriptions and indices
 * so the correct response can still be dispatched.
 */
export function groupMenuActions(actions: CardAction[]): CardAction[] {
  const activateActions = actions.filter(a => a.label === 'Activate Effect');
  if (activateActions.length <= 1) return actions;

  const grouped: CardAction = {
    label: 'Activate Effect',
    actionCode: activateActions[0].actionCode,
    index: -1,
    children: activateActions,
  };

  let replaced = false;
  const result: CardAction[] = [];
  for (const action of actions) {
    if (action.label === 'Activate Effect') {
      if (!replaced) { result.push(grouped); replaced = true; }
    } else {
      result.push(action);
    }
  }
  return result;
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

/** Returns true if the action should use the gold glow (activate effect or special summon). */
export function isActivateAction(actionCode: number, promptType: 'SELECT_IDLECMD' | 'SELECT_BATTLECMD'): boolean {
  return promptType === 'SELECT_IDLECMD'
    ? actionCode === IDLE_ACTION.ACTIVATE || actionCode === IDLE_ACTION.SPECIAL_SUMMON
    : actionCode === BATTLE_ACTION.ACTIVATE;
}

/**
 * Groups pile actions by action type. Each group becomes a single entry
 * whose children are the individual cards that can perform that action.
 * Always uses children (even for a single card) so the prompt opens.
 */
export function groupPileActions(actions: CardAction[]): CardAction[] {
  const groups = new Map<string, CardAction[]>();
  for (const action of actions) {
    if (!groups.has(action.label)) groups.set(action.label, []);
    groups.get(action.label)!.push(action);
  }
  const result: CardAction[] = [];
  for (const [label, entries] of groups) {
    result.push({
      label,
      actionCode: entries[0].actionCode,
      index: -1,
      children: entries,
    });
  }
  return result;
}
