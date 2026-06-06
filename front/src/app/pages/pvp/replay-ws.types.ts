// =============================================================================
// replay-ws.types.ts — Client-side replay WebSocket types
// Re-exports replay types from duel-ws.types.ts (mirror of ws-protocol.ts)
// =============================================================================

export type {
  BoardStatePayload,
  ServerMessage,
  ForkSanityFields,
  ReplayLoadMsg,
  ReplayForkMsg,
  ReplayForkContinueMsg,
  ReplayForkCancelMsg,
  ReplayMetadataMsg,
  ReplayErrorMsg,
  ReplayForkReadyMsg,
  ReplayStreamChunkMsg,
  ReplayStreamInitMsg,
  ReplayStreamAutoResponse,
  ReplayStreamNavEntry,
} from './duel-ws.types';

import type {
  ReplayMetadataMsg,
  ReplayErrorMsg,
  ReplayForkReadyMsg,
  ReplayStreamChunkMsg,
  ReplayStreamInitMsg,
} from './duel-ws.types';

export type ReplayServerMessage =
  | ReplayMetadataMsg | ReplayErrorMsg | ReplayForkReadyMsg
  | ReplayStreamChunkMsg | ReplayStreamInitMsg;

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
