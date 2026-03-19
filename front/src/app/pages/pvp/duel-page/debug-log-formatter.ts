import { LOCATION, ServerMessage } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { isFaceUp, isDefense } from '../pvp-card.utils';
import { IDLE_ACTION, BATTLE_ACTION } from './idle-action-codes';

export interface DebugLogEntry {
  timestamp: number;
  category: 'event' | 'prompt' | 'response' | 'system';
  text: string;
  player?: 0 | 1;
}

// =============================================================================
// Helpers
// =============================================================================

const SEP = ' \u00b7 '; // middle dot separator

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

const HINT_PREFIX: Record<number, string> = {
  1: 'Timing', 2: 'Info', 3: 'Context', 4: 'Opponent chose',
  5: 'Effect of', 6: 'Race', 7: 'Attribute', 8: 'Effect of', 9: 'Number', 10: 'Effect of',
  13: 'Effect of', 15: 'Effect of',
};

const WIN_REASONS: Record<number, string> = { 0: 'LP', 1: 'deck-out', 2: 'effect' };

function p(player: number): string {
  return `P${player + 1}`;
}

function zoneLabel(location: number, sequence: number): string {
  return locationToZoneId(location, sequence) ?? LOCATION_LABELS[location] ?? `LOC:${location}`;
}

function positionLabel(pos: number): string {
  const fu = isFaceUp(pos);
  const def = isDefense(pos);
  if (fu && !def) return 'ATK';
  if (fu && def) return 'DEF';
  if (!fu && def) return 'face-down DEF';
  return 'face-down ATK';
}

function cards(n: number): string {
  return n === 1 ? '1 card' : `${n} cards`;
}

function zones(n: number): string {
  return n === 1 ? '1 zone' : `${n} zones`;
}

function cardName(name: string | undefined): string {
  return name || '?';
}

// =============================================================================
// Server messages
// =============================================================================

export function formatServerMessage(msg: ServerMessage): string | null {
  switch (msg.type) {
    // -- Game events --
    case 'BOARD_STATE':
      return `${p(msg.data.turnPlayer)}${SEP}Turn ${msg.data.turnCount}, ${msg.data.phase}`;
    case 'STATE_SYNC':
      return 'State resynchronized';
    case 'MSG_DRAW':
      return `${p(msg.player)}${SEP}drew ${cards(msg.cards.length)}`;
    case 'MSG_MOVE':
      return (
        `${p(msg.player)}${SEP}${cardName(msg.cardName)} ` +
        `${zoneLabel(msg.fromLocation, msg.fromSequence)} \u2192 ${zoneLabel(msg.toLocation, msg.toSequence)} ` +
        `(${positionLabel(msg.toPosition)})`
      );
    case 'MSG_DAMAGE':
      return `${p(msg.player)}${SEP}took ${msg.amount} damage`;
    case 'MSG_RECOVER':
      return `${p(msg.player)}${SEP}recovered ${msg.amount} LP`;
    case 'MSG_PAY_LPCOST':
      return `${p(msg.player)}${SEP}paid ${msg.amount} LP`;
    case 'MSG_CHAINING':
      return `${p(msg.player)}${SEP}chain ${msg.chainIndex + 1}: ${cardName(msg.cardName)} activated`;
    case 'MSG_CHAIN_SOLVING':
      return `Resolving chain link ${msg.chainIndex + 1}`;
    case 'MSG_CHAIN_SOLVED':
      return `Chain link ${msg.chainIndex + 1} resolved`;
    case 'MSG_CHAIN_END':
      return 'Chain resolved completely';
    case 'MSG_HINT': {
      const prefix = HINT_PREFIX[msg.hintType] ?? `hint(${msg.hintType})`;
      const detail = msg.cardName || msg.hintAction || `value=${msg.value}`;
      return `${p(msg.player)}${SEP}${prefix}: ${detail}`;
    }
    case 'MSG_CONFIRM_CARDS': {
      const names = msg.cards.map((c: { name?: string }) => cardName(c.name)).join(', ');
      return `${p(msg.player)}${SEP}confirmed: ${names}`;
    }
    case 'MSG_SHUFFLE_HAND':
      return `${p(msg.player)}${SEP}hand shuffled`;
    case 'MSG_SHUFFLE_DECK':
      return `${p(msg.player)}${SEP}deck shuffled`;
    case 'MSG_FLIP_SUMMONING':
      return `${p(msg.player)}${SEP}${cardName(msg.cardName)} flip summoned at ${zoneLabel(msg.location, msg.sequence)}`;
    case 'MSG_CHANGE_POS':
      return (
        `${p(msg.player)}${SEP}${cardName(msg.cardName)} ` +
        `${positionLabel(msg.previousPosition)} \u2192 ${positionLabel(msg.currentPosition)}`
      );
    case 'MSG_SWAP':
      return `${cardName(msg.card1.name)} \u2194 ${cardName(msg.card2.name)}`;
    case 'MSG_ATTACK':
      return msg.defenderPlayer === null
        ? `${p(msg.attackerPlayer)}${SEP}M${msg.attackerSequence + 1} direct attack`
        : `${p(msg.attackerPlayer)} vs ${p(msg.defenderPlayer)}${SEP}M${msg.attackerSequence + 1} attacks M${msg.defenderSequence! + 1}`;
    case 'MSG_BATTLE':
      return `${p(msg.attackerPlayer)} vs ${p(msg.defenderPlayer)}${SEP}battle ${msg.attackerDamage} vs ${msg.defenderDamage}`;
    case 'MSG_WIN':
      return `${p(msg.player)}${SEP}wins (${WIN_REASONS[msg.reason] ?? msg.reason})`;

    // -- Prompts --
    case 'SELECT_IDLECMD':
      return (
        `${p(msg.player)}${SEP}MP available actions ` +
        `(${msg.summons.length} summons, ${msg.specialSummons.length} sps, ${msg.activations.length} activations)`
      );
    case 'SELECT_BATTLECMD':
      return `${p(msg.player)}${SEP}BP available actions (${msg.attacks.length} attacks, ${msg.activations.length} activations)`;
    case 'SELECT_CARD':
      return `${p(msg.player)}${SEP}select ${msg.min}-${msg.max} from ${cards(msg.cards.length)}`;
    case 'SELECT_CHAIN':
      return `${p(msg.player)}${SEP}chain? (${cards(msg.cards.length)}, forced=${msg.forced})`;
    case 'SELECT_EFFECTYN':
      return `${p(msg.player)}${SEP}activate ${cardName(msg.cardName)} effect?`;
    case 'SELECT_YESNO': {
      const desc = msg.descriptionText || `desc=${msg.description}`;
      return `${p(msg.player)}${SEP}yes/no: ${desc}`;
    }
    case 'SELECT_PLACE':
      return `${p(msg.player)}${SEP}select ${zones(msg.count)}`;
    case 'SELECT_DISFIELD':
      return `${p(msg.player)}${SEP}disable ${zones(msg.count)}`;
    case 'SELECT_POSITION':
      return `${p(msg.player)}${SEP}choose position for ${cardName(msg.cardName)}`;
    case 'SELECT_OPTION': {
      const descs = (msg.descriptions as string[])?.filter(Boolean);
      if (descs?.length) return `${p(msg.player)}${SEP}choose: ${descs.map(d => `"${d}"`).join(' / ')}`;
      return `${p(msg.player)}${SEP}choose from ${msg.options.length} options`;
    }
    case 'SELECT_TRIBUTE':
      return `${p(msg.player)}${SEP}tribute ${msg.min}-${msg.max} from ${cards(msg.cards.length)}`;
    case 'SELECT_SUM':
      return `${p(msg.player)}${SEP}select for sum (${cards(msg.mustSelect.length + msg.cards.length)}, ${msg.mustSelect.length} forced)`;
    case 'SELECT_UNSELECT_CARD':
      return `${p(msg.player)}${SEP}select/unselect from ${cards(msg.cards.length)}`;
    case 'SELECT_COUNTER':
      return `${p(msg.player)}${SEP}distribute ${msg.count} counters on ${cards(msg.cards.length)}`;
    case 'SORT_CARD':
      return `${p(msg.player)}${SEP}sort ${cards(msg.cards.length)} (auto)`;
    case 'SORT_CHAIN':
      return `${p(msg.player)}${SEP}sort chain ${cards(msg.cards.length)} (auto)`;
    case 'ANNOUNCE_RACE':
      return `${p(msg.player)}${SEP}announce ${msg.count} type(s)`;
    case 'ANNOUNCE_ATTRIB':
      return `${p(msg.player)}${SEP}announce ${msg.count} attribute(s)`;
    case 'ANNOUNCE_CARD':
      return `${p(msg.player)}${SEP}announce card (auto)`;
    case 'ANNOUNCE_NUMBER':
      return `${p(msg.player)}${SEP}announce number from ${msg.options.length} options`;
    case 'RPS_CHOICE':
      return `${p(msg.player)}${SEP}rock-paper-scissors`;
    case 'SELECT_TP':
      return `${p(msg.player)}${SEP}choose turn order`;

    // -- System --
    case 'DUEL_END':
      return msg.winner !== null
        ? `Duel ended \u2014 ${p(msg.winner)} wins (${msg.reason})`
        : `Duel ended \u2014 draw (${msg.reason})`;
    case 'RPS_RESULT':
      return (
        `RPS: ${p(0)}=${RPS_LABELS[msg.player1Choice] ?? '?'}, ${p(1)}=${RPS_LABELS[msg.player2Choice] ?? '?'} \u2192 ` +
        `${msg.winner !== null ? `${p(msg.winner)} wins` : 'draw'}`
      );
    case 'TP_RESULT':
      return `Turn order: ${msg.goFirst ? 'You go first' : 'You go second'}`;
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

    // -- Excluded --
    case 'TIMER_STATE':
    case 'SESSION_TOKEN':
      return null;
    default:
      return null;
  }
}

// =============================================================================
// Player responses
// =============================================================================

export function formatPlayerResponse(promptType: string, data: Record<string, unknown>): string {
  switch (promptType) {
    case 'SELECT_IDLECMD': {
      const action = data['action'] as number;
      const index = data['index'] as number | null;
      const label = IDLE_ACTION_LABELS[action] ?? `Action ${action}`;
      return `\u2192 ${label} (index ${index})`;
    }
    case 'SELECT_BATTLECMD': {
      const action = data['action'] as number;
      const index = data['index'] as number | null;
      const label = BATTLE_ACTION_LABELS[action] ?? `Action ${action}`;
      return `\u2192 ${label} (index ${index})`;
    }
    case 'SELECT_CARD':
    case 'SELECT_TRIBUTE':
    case 'SELECT_SUM': {
      const indices = data['indices'] as number[] | undefined;
      return `\u2192 selected ${cards(indices?.length ?? 0)}`;
    }
    case 'SELECT_CHAIN': {
      const index = data['index'] as number | null;
      return index !== null ? `\u2192 chain index ${index}` : '\u2192 pass';
    }
    case 'SELECT_EFFECTYN':
    case 'SELECT_YESNO': {
      const yes = data['yes'] as boolean;
      return yes ? '\u2192 yes' : '\u2192 no';
    }
    case 'SELECT_PLACE':
    case 'SELECT_DISFIELD': {
      const places = data['places'] as Array<{ player: number; location: number; sequence: number }> | undefined;
      const zoneList = places?.map(pl => zoneLabel(pl.location, pl.sequence)).join(', ') ?? '?';
      return `\u2192 placed at ${zoneList}`;
    }
    case 'SELECT_POSITION': {
      const position = data['position'] as number;
      return `\u2192 ${positionLabel(position)}`;
    }
    case 'SELECT_OPTION': {
      const index = data['index'] as number;
      return `\u2192 option ${index}`;
    }
    case 'SELECT_COUNTER':
      return '\u2192 distributed counters';
    case 'SELECT_UNSELECT_CARD': {
      const index = data['index'] as number | null;
      return index !== null ? `\u2192 selected index ${index}` : '\u2192 finished';
    }
    case 'SORT_CARD':
    case 'SORT_CHAIN':
      return '\u2192 auto-sorted';
    case 'ANNOUNCE_RACE':
    case 'ANNOUNCE_ATTRIB':
    case 'ANNOUNCE_CARD':
    case 'ANNOUNCE_NUMBER': {
      const value = data['value'] as number;
      return `\u2192 announced ${value}`;
    }
    case 'RPS_CHOICE': {
      const choice = data['choice'] as number;
      return `\u2192 ${RPS_LABELS[choice] ?? '?'}`;
    }
    case 'SELECT_TP': {
      const goFirst = data['goFirst'] as boolean;
      return `\u2192 ${goFirst ? 'Go First' : 'Go Second'}`;
    }
    default:
      return `\u2192 ${promptType}`;
  }
}
