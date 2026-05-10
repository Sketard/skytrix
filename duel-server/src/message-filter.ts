import type { ServerMessage, Player, BoardStatePayload, PlayerBoardState, CardOnField } from './ws-protocol.js';
import { LOCATION, POSITION } from './ws-protocol.js';
import * as logger from './logger.js';

// =============================================================================
// Private Zone Detection
// =============================================================================

const PRIVATE_LOCATIONS: Set<number> = new Set([LOCATION.DECK, LOCATION.HAND, LOCATION.EXTRA]);

// =============================================================================
// MSG_HINT info-leak whitelist (audit finding M6)
// =============================================================================

/**
 * Public hintTypes — payload is a system string ID, bitmask label, or number.
 * Never carries a card code, safe to broadcast to both players.
 *
 * See `duel-worker.ts:transformMessage HINT case` for the produced shape:
 * - 1 = HINT_EVENT     (sysStr ID → hintAction)
 * - 2 = HINT_MESSAGE   (sysStr ID → hintAction)
 * - 6 = HINT_RACE      (race bitmask → label)
 * - 7 = HINT_ATTRIB    (attr bitmask → label)
 * - 9 = HINT_NUMBER    (raw number → string)
 *
 * Every other hintType (3, 4, 5, 8, 10, 13, 15 + any future/unknown value)
 * may carry a card code (cardName populated) and is routed to the deciding
 * player only. Default-DROP for unknown values mirrors the unknown-message
 * fail-safe at the bottom of `filterMessageInner` — same policy: prefer
 * missing display over an info leak.
 */
const SAFE_PUBLIC_HINT_TYPES: ReadonlySet<number> = new Set([1, 2, 6, 7, 9]);

// =============================================================================
// Whitelist Message Filter — ADR-4: Default DROP policy
// =============================================================================

/**
 * Filters a ServerMessage for a specific player. Returns the filtered message
 * or null if the message should not be sent to this player.
 * Pure function — no side effects except logger.error for unknown types.
 *
 * @param omniscient When true, skips routing drops (SELECT_*, non-public
 *   MSG_HINT, MSG_CONFIRM_CARDS are returned instead of null) and field sanitization
 *   (card codes, hand contents, face-down stats preserved). Perspective
 *   transformations (RPS_RESULT swap, BOARD_STATE player remapping) still apply.
 *   Default DROP for unknown message types is NOT bypassed.
 *   Used by replay pre-computation (Story 3.3) to produce omniscient view.
 */
export function filterMessage(message: ServerMessage, forPlayer: Player, omniscient = false): ServerMessage | null {
  const result = filterMessageInner(message, forPlayer, omniscient);
  // Sanitize any `boardStateAfter` snapshot attached by the live duel loop or
  // replay precompute. Without this, an opponent would see the other player's
  // hand/deck via the attached full-state snapshot. In omniscient mode
  // (replay), sanitizeBoardState passes private info through but still
  // remaps turnPlayer to the perspective index.
  if (result && 'boardStateAfter' in result && result.boardStateAfter) {
    return { ...result, boardStateAfter: sanitizeBoardState(result.boardStateAfter, forPlayer, omniscient) } as ServerMessage;
  }
  return result;
}

function filterMessageInner(message: ServerMessage, forPlayer: Player, omniscient: boolean): ServerMessage | null {
  switch (message.type) {
    // --- Sanitized game messages (omniscient: skip field nulling) ---

    case 'MSG_DRAW':
    case 'MSG_SHUFFLE_HAND':
      if (!omniscient && forPlayer !== message.player) {
        return { ...message, cards: message.cards.map(() => null) };
      }
      return message;

    case 'MSG_SHUFFLE_DECK':
      return message;

    case 'MSG_MOVE': {
      const isFromPrivate = PRIVATE_LOCATIONS.has(message.fromLocation);
      const isToPrivate = PRIVATE_LOCATIONS.has(message.toLocation);
      if (!omniscient && (isFromPrivate || isToPrivate) && forPlayer !== message.player) {
        return { ...message, cardCode: 0, cardName: '' };
      }
      return message;
    }

    // --- Routed to intended player only (omniscient: never drop) ---

    case 'MSG_HINT':
      // Whitelist (M6): public hintTypes broadcast to both players; everything
      // else (card-code-carrying or unknown) is routed to the deciding player
      // only. Replay precompute keeps full visibility via omniscient.
      if (omniscient) return message;
      if (forPlayer === message.player) return message;
      if (SAFE_PUBLIC_HINT_TYPES.has(message.hintType)) return message;
      return null;

    case 'MSG_CONFIRM_CARDS':
      if (!omniscient && message.private && forPlayer !== message.player) {
        return { ...message, cards: message.cards.map(c => ({ ...c, cardCode: 0, name: '' })) };
      }
      return message;

    // --- SELECT_* (20 types) + RPS_CHOICE: routed to deciding player only (omniscient: never drop) ---

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
      if (!omniscient && forPlayer !== message.player) return null;
      return message;

    case 'RPS_CHOICE':
    case 'SELECT_TP':
      if (!omniscient && forPlayer !== message.player) return null;
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
      return { type: 'BOARD_STATE', data: sanitizeBoardState(message.data, forPlayer, omniscient) };

    case 'STATE_SYNC':
      return { type: 'STATE_SYNC', data: sanitizeBoardState(message.data, forPlayer, omniscient) };

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
    case 'MSG_SET':
    case 'MSG_SWAP':
    case 'MSG_BECOME_TARGET':
    case 'MSG_ATTACK':
    case 'MSG_BATTLE':
    case 'MSG_TOSS_COIN':
    case 'MSG_TOSS_DICE':
    case 'MSG_EQUIP':
    case 'MSG_ADD_COUNTER':
    case 'MSG_REMOVE_COUNTER':
    case 'MSG_SHUFFLE_SET_CARD':
    case 'MSG_SWAP_GRAVE_DECK':
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
    case 'TP_RESULT':
    case 'DUEL_STARTING':
    case 'CHAIN_STATE':
      return message;

    // --- Default: DROP unknown types (fail-safe: prefer missing display over info leak) ---
    // The drop is intentional even in omniscient mode — a new MSG_* added
    // upstream without a matching case here will surface as a logger.error
    // in tests + dev. Better to lose visibility on one event type than to
    // forward an unsanitized payload that might leak opponent hand/deck.

    default:
      logger.error('Dropped unknown message type', { type: (message as { type: string }).type });
      return null;
  }
}

// =============================================================================
// Board State Sanitization
// =============================================================================

function sanitizeBoardState(data: BoardStatePayload, forPlayer: Player, omniscient: boolean): BoardStatePayload {
  const opponentIndex: Player = forPlayer === 0 ? 1 : 0;

  // Swap players so [0] = recipient (self), [1] = opponent (sanitized unless omniscient).
  // Remap turnPlayer from absolute OCGCore index to relative (0 = self, 1 = opponent).
  // TODO: Story 4.2 — MSG_* `player` fields still use absolute OCGCore indices.
  return {
    turnPlayer: data.turnPlayer === forPlayer ? 0 : 1,
    turnCount: data.turnCount,
    phase: data.phase,
    players: [
      data.players[forPlayer],
      omniscient ? data.players[opponentIndex] : sanitizeOpponentBoard(data.players[opponentIndex]),
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
      currentType: undefined,
      baseType: undefined,
      isLink: undefined,
      isEffectNegated: undefined,
      linkedCards: undefined,
    };
  }
  return card;
}
