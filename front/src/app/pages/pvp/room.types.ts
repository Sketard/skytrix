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
  status: 'WAITING' | 'CREATING_DUEL' | 'ACTIVE' | 'ENDED' | 'CLOSED';
  player1: PlayerInfo;
  player2: PlayerInfo | null;
  duelId: string | null;
  wsToken: string | null;
  decklistId: number | null;
  createdAt: string;
}

export const SHARE_TEXT_TEMPLATE = (roomCode: string, baseUrl: string) =>
  `Duel me on skytrix! Join with code: ${roomCode} or tap: ${baseUrl}/pvp/duel/${roomCode}`;
