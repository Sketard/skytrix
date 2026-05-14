import { DuelResult } from '../../enums/duel-result.enum';

export interface ReplayMetadata {
  playerUsernames: string[];
  deckNames: string[];
  turnCount: number;
  result: DuelResult;
  date: string;
  scriptsHash: string;
  ocgcoreVersion: string;
  durationSec?: number;
}

export interface ReplayDTO {
  id: string;
  player1Id: number;
  player2Id: number;
  metadata: ReplayMetadata;
  createdAt: string;
}
