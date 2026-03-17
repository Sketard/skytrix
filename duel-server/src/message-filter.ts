import type { ServerMessage, Player, BoardStatePayload, PlayerBoardState, CardOnField } from './ws-protocol.js';
import { LOCATION, POSITION } from './ws-protocol.js';

// =============================================================================
// Private Zone Detection
// =============================================================================

const PRIVATE_LOCATIONS: Set<number> = new Set([LOCATION.DECK, LOCATION.HAND, LOCATION.EXTRA]);

// =============================================================================
// Whitelist Message Filter — ADR-4: Default DROP policy
// =============================================================================

/**
 * Filters a ServerMessage for a specific player. Returns the filtered message
 * or null if the message should not be sent to this player.
 * Pure function — no side effects except console.error for unknown types.
 */
export function filterMessage(message: ServerMessage, forPlayer: Player): ServerMessage | null {
  switch (message.type) {
    // --- Sanitized game messages ---

    case 'MSG_DRAW':
      if (forPlayer !== message.player) {
        return { ...message, cards: message.cards.map(() => null) };
      }
      return message;

    case 'MSG_SHUFFLE_HAND':
      if (forPlayer !== message.player) {
        return { ...message, cards: message.cards.map(() => null) };
      }
      return message;

    case 'MSG_SHUFFLE_DECK':
      return message;

    case 'MSG_MOVE': {
      const isFromPrivate = PRIVATE_LOCATIONS.has(message.fromLocation);
      const isToPrivate = PRIVATE_LOCATIONS.has(message.toLocation);
      if ((isFromPrivate || isToPrivate) && forPlayer !== message.player) {
        return { ...message, cardCode: 0, cardName: '' };
      }
      return message;
    }

    // --- Routed to intended player only ---

    case 'MSG_HINT':
      // hintType 10 = HINT_EFFECT: leaks card codes via effect activation hints
      if (message.hintType === 10 && forPlayer !== message.player) return null;
      // hintType 3 = HINT_SELECTMSG: card name is fine for both players
      return message;

    case 'MSG_CONFIRM_CARDS':
      if (forPlayer !== message.player) return null;
      return message;

    // --- SELECT_* (20 types) + RPS_CHOICE: routed to deciding player only ---

    case 'SELECT_IDLECMD':
    case 'SELECT_BATTLECMD':
    case 'SELECT_CARD':
    case 'SELECT_CHAIN':
    case 'SELECT_EFFECTYN':
    case 'SELECT_YESNO':
    case 'SELECT_PLACE':
    case 'SELECT_DISFIELD':
    case 'SELECT_POSITION':
    case 'SELECT_OPTION':
    case 'SELECT_TRIBUTE':
    case 'SELECT_SUM':
    case 'SELECT_UNSELECT_CARD':
    case 'SELECT_COUNTER':
    case 'SORT_CARD':
    case 'SORT_CHAIN':
    case 'ANNOUNCE_RACE':
    case 'ANNOUNCE_ATTRIB':
    case 'ANNOUNCE_CARD':
    case 'ANNOUNCE_NUMBER':
      if (forPlayer !== message.player) return null;
      return message;

    case 'RPS_CHOICE':
      if (forPlayer !== message.player) return null;
      return message;

    // --- RPS_RESULT: perspective-corrected (swap choices + winner for player 1) ---

    case 'RPS_RESULT': {
      if (forPlayer === 0) return message;
      return {
        type: 'RPS_RESULT' as const,
        player1Choice: message.player2Choice,
        player2Choice: message.player1Choice,
        winner: message.winner === null ? null : (message.winner === 0 ? 1 : 0) as Player,
      };
    }

    // --- BOARD_STATE / STATE_SYNC: deep copy with opponent info sanitized ---

    case 'BOARD_STATE':
      return { type: 'BOARD_STATE', data: sanitizeBoardState(message.data, forPlayer) };

    case 'STATE_SYNC':
      return { type: 'STATE_SYNC', data: sanitizeBoardState(message.data, forPlayer) };

    // --- Passthrough: broadcast to both players unfiltered ---

    case 'MSG_DAMAGE':
    case 'MSG_RECOVER':
    case 'MSG_PAY_LPCOST':
    case 'MSG_CHAINING':
    case 'MSG_CHAIN_SOLVING':
    case 'MSG_CHAIN_SOLVED':
    case 'MSG_CHAIN_END':
    case 'MSG_CHAIN_NEGATED':
    case 'MSG_FLIP_SUMMONING':
    case 'MSG_CHANGE_POS':
    case 'MSG_SWAP':
    case 'MSG_BECOME_TARGET':
    case 'MSG_ATTACK':
    case 'MSG_BATTLE':
    case 'MSG_WIN':
    case 'DUEL_END':
    case 'TIMER_STATE':
    // NB: REMATCH_INVITATION, REMATCH_STARTING, REMATCH_CANCELLED are sent via
    // sendToPlayer() directly (not broadcastMessage), so these entries are defensive
    // passthrough — kept to prevent silent drops if routing changes in the future.
    case 'REMATCH_INVITATION':
    case 'REMATCH_STARTING':
    case 'REMATCH_CANCELLED':
    case 'WORKER_ERROR':
    case 'SESSION_TOKEN':
    case 'OPPONENT_DISCONNECTED':
    case 'OPPONENT_RECONNECTED':
    case 'WAITING_RESPONSE':
      return message;

    // --- Default: DROP unknown types (fail-safe: prefer missing display over info leak) ---

    default:
      console.error(`Dropped unknown message type: ${(message as { type: string }).type}`);
      return null;
  }
}

// =============================================================================
// Board State Sanitization
// =============================================================================

function sanitizeBoardState(data: BoardStatePayload, forPlayer: Player): BoardStatePayload {
  const opponentIndex: Player = forPlayer === 0 ? 1 : 0;

  // Swap players so [0] = recipient (self), [1] = sanitized opponent.
  // Remap turnPlayer from absolute OCGCore index to relative (0 = self, 1 = opponent).
  // TODO: Story 4.2 — MSG_* `player` fields still use absolute OCGCore indices.
  return {
    turnPlayer: data.turnPlayer === forPlayer ? 0 : 1,
    turnCount: data.turnCount,
    phase: data.phase,
    players: [
      data.players[forPlayer],
      sanitizeOpponentBoard(data.players[opponentIndex]),
    ],
  };
}

function sanitizeOpponentBoard(board: PlayerBoardState): PlayerBoardState {
  return {
    lp: board.lp,
    deckCount: board.deckCount,
    extraCount: board.extraCount,
    zones: board.zones.map(zone => {
      switch (zone.zoneId) {
        // Hand: cardCode → null (preserve count, hide identity)
        case 'HAND':
          return {
            zoneId: zone.zoneId,
            cards: zone.cards.map(c => ({ ...c, cardCode: null, name: null, overlayMaterials: [], counters: {} })),
          };

        // Extra deck: empty array (count available via extraCount)
        case 'EXTRA':
          return { zoneId: zone.zoneId, cards: [] };

        // Deck: always empty (count available via deckCount)
        case 'DECK':
          return { zoneId: zone.zoneId, cards: [] };

        // Field zones: sanitize face-down cards
        case 'M1': case 'M2': case 'M3': case 'M4': case 'M5':
        case 'EMZ_L': case 'EMZ_R':
        case 'S1': case 'S2': case 'S3': case 'S4': case 'S5':
        case 'FIELD':
          return {
            zoneId: zone.zoneId,
            cards: zone.cards.map(sanitizeFaceDownCard),
          };

        // GY, BANISHED: public info — pass through
        case 'GY':
        case 'BANISHED':
          return zone;

        default:
          return zone;
      }
    }),
  };
}

function sanitizeFaceDownCard(card: CardOnField): CardOnField {
  const isFaceDown = card.position === POSITION.FACEDOWN_ATTACK ||
    card.position === POSITION.FACEDOWN_DEFENSE;
  if (isFaceDown) {
    return {
      ...card,
      cardCode: null,
      name: null,
      currentAtk: undefined,
      currentDef: undefined,
      baseAtk: undefined,
      baseDef: undefined,
      currentLevel: undefined,
      baseLevel: undefined,
      currentRank: undefined,
      baseRank: undefined,
      currentAttribute: undefined,
      baseAttribute: undefined,
      currentRace: undefined,
      baseRace: undefined,
      currentLScale: undefined,
      currentRScale: undefined,
      baseLScale: undefined,
      baseRScale: undefined,
      isEffectNegated: undefined,
      equipTarget: undefined,
    };
  }
  return card;
}
