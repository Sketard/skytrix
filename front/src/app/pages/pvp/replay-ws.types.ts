// =============================================================================
// replay-ws.types.ts — Client-side replay WebSocket types
// Re-exports replay types from duel-ws.types.ts (mirror of ws-protocol.ts)
// =============================================================================

export type {
  BoardStatePayload,
  ServerMessage,
  PreComputedState,
  ForkSanityFields,
  ReplayLoadMsg,
  ReplayForkMsg,
  ReplayForkContinueMsg,
  ReplayForkCancelMsg,
  ReplayBoardStatesMsg,
  ReplayMetadataMsg,
  ReplayErrorMsg,
  ReplayForkReadyMsg,
} from './duel-ws.types';

import type {
  ReplayBoardStatesMsg,
  ReplayMetadataMsg,
  ReplayErrorMsg,
  ReplayForkReadyMsg,
} from './duel-ws.types';

export type ReplayServerMessage = ReplayBoardStatesMsg | ReplayMetadataMsg | ReplayErrorMsg | ReplayForkReadyMsg;

export interface TurnMeta {
  turnNumber: number;
  startIndex: number;
  endIndex: number;
  p1LP: number;
  p2LP: number;
  eventCount: number;
}

export interface ReplayDebugLogEntry {
  eventIndex: number;
  category: 'event' | 'prompt' | 'response' | 'system';
  text: string;
  player?: 0 | 1;
}
