import { LOCATION, ServerMessage } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { isFaceUp, isDefense } from '../pvp-card.utils';
import { IDLE_ACTION, BATTLE_ACTION } from './idle-action-codes';

export interface DebugLogEntry {
  timestamp: number;
  category: 'event' | 'prompt' | 'response' | 'system';
  text: string;
}

const RPS_LABELS: Record<number, string> = { 1: 'Scissors', 2: 'Rock', 3: 'Paper' };

const IDLE_ACTION_LABELS: Record<number, string> = {
  [IDLE_ACTION.SUMMON]: 'Normal Summon',
  [IDLE_ACTION.SPECIAL_SUMMON]: 'Special Summon',
  [IDLE_ACTION.REPOSITION]: 'Change Position',
  [IDLE_ACTION.SET_MONSTER]: 'Set Monster',
  [IDLE_ACTION.SET_SPELLTP]: 'Set Spell/Trap',
  [IDLE_ACTION.ACTIVATE]: 'Activate Effect',
  [IDLE_ACTION.BATTLE_PHASE]: 'Battle Phase',
  [IDLE_ACTION.END_TURN]: 'End Turn',
};

const BATTLE_ACTION_LABELS: Record<number, string> = {
  [BATTLE_ACTION.ATTACK]: 'Attack',
  [BATTLE_ACTION.ACTIVATE]: 'Activate Effect',
  [BATTLE_ACTION.MAIN_PHASE_2]: 'Main Phase 2',
  [BATTLE_ACTION.END_TURN]: 'End Turn',
};

export const LOCATION_LABELS: Record<number, string> = {
  [LOCATION.HAND]: 'HAND',
  [LOCATION.DECK]: 'DECK',
  [LOCATION.GRAVE]: 'GY',
  [LOCATION.BANISHED]: 'BANISHED',
  [LOCATION.EXTRA]: 'EXTRA',
};

function zoneLabel(location: number, sequence: number): string {
  const zoneId = locationToZoneId(location, sequence);
  if (zoneId) return zoneId;
  return LOCATION_LABELS[location] ?? `LOC:${location}`;
}

function positionLabel(pos: number): string {
  const fu = isFaceUp(pos);
  const def = isDefense(pos);
  if (fu && !def) return 'ATK';
  if (fu && def) return 'DEF';
  if (!fu && def) return 'face-down DEF';
  return 'face-down ATK';
}

export function formatServerMessage(msg: ServerMessage): string | null {
  switch (msg.type) {
    // Game events
    case 'BOARD_STATE':
      return `Turn ${msg.data.turnCount} — P${msg.data.turnPlayer + 1}, Phase: ${msg.data.phase}`;
    case 'STATE_SYNC':
      return 'State resynchronized';
    case 'MSG_DRAW':
      return `P${msg.player + 1} drew ${msg.cards.length} card(s)`;
    case 'MSG_MOVE':
      return (
        `P${msg.player + 1}: ${msg.cardName || 'Unknown'} ` +
        `${zoneLabel(msg.fromLocation, msg.fromSequence)} → ${zoneLabel(msg.toLocation, msg.toSequence)} ` +
        `(${positionLabel(msg.toPosition)})`
      );
    case 'MSG_DAMAGE':
      return `P${msg.player + 1} took ${msg.amount} damage`;
    case 'MSG_RECOVER':
      return `P${msg.player + 1} recovered ${msg.amount} LP`;
    case 'MSG_PAY_LPCOST':
      return `P${msg.player + 1} paid ${msg.amount} LP`;
    case 'MSG_CHAINING':
      return `Chain ${msg.chainIndex + 1}: ${msg.cardName || 'Unknown'} activated by P${msg.player + 1}`;
    case 'MSG_CHAIN_SOLVING':
      return `Resolving chain link ${msg.chainIndex + 1}`;
    case 'MSG_CHAIN_SOLVED':
      return `Chain link ${msg.chainIndex + 1} resolved`;
    case 'MSG_CHAIN_END':
      return 'Chain resolved completely';
    case 'MSG_HINT': {
      const HINT_LABELS: Record<number, string> = {
        1: 'EVENT', 2: 'MESSAGE', 3: 'SELECTMSG', 4: 'OPSELECTED',
        5: 'EFFECT', 6: 'RACE', 7: 'ATTRIB', 8: 'CODE', 9: 'NUMBER', 10: 'CARD',
      };
      const label = HINT_LABELS[msg.hintType] ?? String(msg.hintType);
      return `Hint: ${label}(${msg.hintType}), value=${msg.value}, P${msg.player + 1}`;
    }
    case 'MSG_CONFIRM_CARDS':
      return `P${msg.player + 1} confirmed ${msg.cards.length} card(s)`;
    case 'MSG_SHUFFLE_HAND':
      return `P${msg.player + 1} hand shuffled`;
    case 'MSG_SHUFFLE_DECK':
      return `P${msg.player + 1} deck shuffled`;
    case 'MSG_FLIP_SUMMONING':
      return `P${msg.player + 1}: ${msg.cardName || 'Unknown'} flip summoned at ${zoneLabel(msg.location, msg.sequence)}`;
    case 'MSG_CHANGE_POS':
      return (
        `P${msg.player + 1}: ${msg.cardName || 'Unknown'} changed position ` +
        `(${positionLabel(msg.previousPosition)} → ${positionLabel(msg.currentPosition)})`
      );
    case 'MSG_SWAP':
      return `Cards swapped: ${msg.card1.name || 'Unknown'} ↔ ${msg.card2.name || 'Unknown'}`;
    case 'MSG_ATTACK':
      return msg.defenderPlayer === null
        ? `P${msg.attackerPlayer + 1} M${msg.attackerSequence + 1} direct attack`
        : `P${msg.attackerPlayer + 1} M${msg.attackerSequence + 1} attacks P${msg.defenderPlayer + 1} M${msg.defenderSequence! + 1}`;
    case 'MSG_BATTLE':
      return (
        `Battle: P${msg.attackerPlayer + 1} (${msg.attackerDamage}) vs ` +
        `P${msg.defenderPlayer + 1} (${msg.defenderDamage})`
      );
    case 'MSG_WIN': {
      const winReasons: Record<number, string> = { 0: 'LP', 1: 'deck-out', 2: 'effect' };
      return `P${msg.player + 1} wins! (reason: ${winReasons[msg.reason] ?? msg.reason})`;
    }

    // Prompts
    case 'SELECT_IDLECMD':
      return (
        `P${msg.player + 1} prompt: Idle command ` +
        `(${msg.summons.length} summons, ${msg.specialSummons.length} sps, ${msg.activations.length} activations...)`
      );
    case 'SELECT_BATTLECMD':
      return `P${msg.player + 1} prompt: Battle command (${msg.attacks.length} attacks, ${msg.activations.length} activations)`;
    case 'SELECT_CARD':
      return `P${msg.player + 1} prompt: Select ${msg.min}-${msg.max} card(s) from ${msg.cards.length} options`;
    case 'SELECT_CHAIN':
      return `P${msg.player + 1} prompt: Chain? (${msg.cards.length} options, forced=${msg.forced})`;
    case 'SELECT_EFFECTYN':
      return `P${msg.player + 1} prompt: Activate ${msg.cardName || 'Unknown'} effect?`;
    case 'SELECT_YESNO':
      return `P${msg.player + 1} prompt: Yes/No (desc=${msg.description})`;
    case 'SELECT_PLACE':
      return `P${msg.player + 1} prompt: Select ${msg.count} zone(s)`;
    case 'SELECT_DISFIELD':
      return `P${msg.player + 1} prompt: Select ${msg.count} field zone(s) to disable`;
    case 'SELECT_POSITION':
      return `P${msg.player + 1} prompt: Choose position for ${msg.cardName || 'Unknown'}`;
    case 'SELECT_OPTION':
      return `P${msg.player + 1} prompt: Choose from ${msg.options.length} options`;
    case 'SELECT_TRIBUTE':
      return `P${msg.player + 1} prompt: Tribute ${msg.min}-${msg.max} from ${msg.cards.length} cards`;
    case 'SELECT_SUM':
      return `P${msg.player + 1} prompt: Select cards for sum (${msg.mustSelect.length + msg.cards.length} options, ${msg.mustSelect.length} forced)`;
    case 'SELECT_UNSELECT_CARD':
      return `P${msg.player + 1} prompt: Select/unselect from ${msg.cards.length} cards`;
    case 'SELECT_COUNTER':
      return `P${msg.player + 1} prompt: Distribute ${msg.count} counters on ${msg.cards.length} cards`;
    case 'SORT_CARD':
      return `P${msg.player + 1} prompt: Sort ${msg.cards.length} cards (auto-selected)`;
    case 'SORT_CHAIN':
      return `P${msg.player + 1} prompt: Sort chain ${msg.cards.length} cards (auto-selected)`;
    case 'ANNOUNCE_RACE':
      return `P${msg.player + 1} prompt: Announce ${msg.count} type(s)`;
    case 'ANNOUNCE_ATTRIB':
      return `P${msg.player + 1} prompt: Announce ${msg.count} attribute(s)`;
    case 'ANNOUNCE_CARD':
      return `P${msg.player + 1} prompt: Announce card (auto-selected)`;
    case 'ANNOUNCE_NUMBER':
      return `P${msg.player + 1} prompt: Announce number from ${msg.options.length} options`;
    case 'RPS_CHOICE':
      return `P${msg.player + 1} prompt: Rock-Paper-Scissors`;

    // System messages
    case 'DUEL_END':
      return msg.winner !== null
        ? `Duel ended — Winner: P${msg.winner + 1} (${msg.reason})`
        : `Duel ended — Draw (${msg.reason})`;
    case 'RPS_RESULT':
      return (
        `RPS result: P1=${RPS_LABELS[msg.player1Choice] ?? '?'}, P2=${RPS_LABELS[msg.player2Choice] ?? '?'} → ` +
        `${msg.winner !== null ? `Winner: P${msg.winner + 1}` : 'Draw'}`
      );
    case 'OPPONENT_DISCONNECTED':
      return 'Opponent disconnected';
    case 'OPPONENT_RECONNECTED':
      return 'Opponent reconnected';
    case 'REMATCH_INVITATION':
      return 'Rematch invitation received';
    case 'REMATCH_STARTING':
      return 'Rematch starting...';
    case 'REMATCH_CANCELLED':
      return `Rematch cancelled (${msg.reason})`;
    case 'WORKER_ERROR':
      return `Worker error: ${msg.message}`;

    // Excluded
    case 'TIMER_STATE':
    case 'SESSION_TOKEN':
      return null;
    default:
      return null;
  }
}

export function formatPlayerResponse(promptType: string, data: Record<string, unknown>): string {
  switch (promptType) {
    case 'SELECT_IDLECMD': {
      const action = data['action'] as number;
      const index = data['index'] as number | null;
      const label = IDLE_ACTION_LABELS[action] ?? `Action ${action}`;
      return `→ Response: ${label} (index ${index})`;
    }
    case 'SELECT_BATTLECMD': {
      const action = data['action'] as number;
      const index = data['index'] as number | null;
      const label = BATTLE_ACTION_LABELS[action] ?? `Action ${action}`;
      return `→ Response: ${label} (index ${index})`;
    }
    case 'SELECT_CARD':
    case 'SELECT_TRIBUTE':
    case 'SELECT_SUM': {
      const indices = data['indices'] as number[] | undefined;
      return `→ Response: selected ${indices?.length ?? 0} card(s)`;
    }
    case 'SELECT_CHAIN': {
      const index = data['index'] as number | null;
      return index !== null ? `→ Response: chain index ${index}` : '→ Response: pass';
    }
    case 'SELECT_EFFECTYN':
    case 'SELECT_YESNO': {
      const yes = data['yes'] as boolean;
      return yes ? '→ Response: Yes' : '→ Response: No';
    }
    case 'SELECT_PLACE':
    case 'SELECT_DISFIELD': {
      const places = data['places'] as Array<{ player: number; location: number; sequence: number }> | undefined;
      const zones = places?.map(p => zoneLabel(p.location, p.sequence)).join(', ') ?? '?';
      return `→ Response: placed at ${zones}`;
    }
    case 'SELECT_POSITION': {
      const position = data['position'] as number;
      return `→ Response: ${positionLabel(position)}`;
    }
    case 'SELECT_OPTION': {
      const index = data['index'] as number;
      return `→ Response: option ${index}`;
    }
    case 'SELECT_COUNTER':
      return '→ Response: distributed counters';
    case 'SELECT_UNSELECT_CARD': {
      const index = data['index'] as number | null;
      return index !== null ? `→ Response: selected index ${index}` : '→ Response: finished';
    }
    case 'SORT_CARD':
    case 'SORT_CHAIN':
      return '→ Response: auto-sorted';
    case 'ANNOUNCE_RACE':
    case 'ANNOUNCE_ATTRIB':
    case 'ANNOUNCE_CARD':
    case 'ANNOUNCE_NUMBER': {
      const value = data['value'] as number;
      return `→ Response: announced ${value}`;
    }
    case 'RPS_CHOICE': {
      const choice = data['choice'] as number;
      return `→ Response: ${RPS_LABELS[choice] ?? '?'}`;
    }
    default:
      return `→ Response: ${promptType}`;
  }
}
