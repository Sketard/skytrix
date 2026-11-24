export type UserRole = 'USER' | 'ADMIN';

export interface PlayerInfo {
  id: number;
  pseudo: string;
  // Mirrors Spring's ShortUserDTO.role (Role enum: USER | ADMIN). Exposed so
  // the lobby can flag admin-owned rooms with the shield badge + reveal the
  // admin delete button on hover.
  role: UserRole;
}

export interface RoomDTO {
  id: number;
  roomCode: string;
  status: 'WAITING' | 'READY' | 'CREATING_DUEL' | 'ACTIVE' | 'ENDED' | 'CLOSED';
  player1: PlayerInfo;
  player2: PlayerInfo | null;
  duelId: string | null;
  wsToken: string | null;
  decklistId: number | null;
  createdAt: string;
  mode: RoomMode;
  // --- BOOSTER mode only (null otherwise) ---
  boosterSetName: string | null;
  boosterCount: number | null;
  minMainDeckSize: number | null;
  /** The player submitted a deck built from their pulls. */
  player1Ready: boolean;
  player2Ready: boolean;
}

/** STANDARD = each player brings a saved deck; BOOSTER = decks are built
 *  in the room from boosters opened there. */
export type RoomMode = 'STANDARD' | 'BOOSTER';

/** Settings of a booster room, chosen at creation. */
export interface BoosterRoomSettings {
  boosterSetName: string;
  boosterCount: number;
  minMainDeckSize: number;
}

/** Mirror of back BoosterService.CARDS_PER_BOOSTER. */
export const CARDS_PER_BOOSTER = 5;

/** Mirror of back RoomCleanupScheduler TTLs — the waiting-room countdown. */
export function roomTtlMinutes(mode: RoomMode | undefined): number {
  return mode === 'BOOSTER' ? 90 : 30;
}

export const SHARE_TEXT_TEMPLATE = (roomCode: string, baseUrl: string) =>
  `Duel me on skytrix! Join with code: ${roomCode} or tap: ${baseUrl}/pvp/duel/${roomCode}`;
