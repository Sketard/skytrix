import type { ServerMessage, PlayerResponseMsg, SelectPromptType, Player } from './ws-protocol.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Constants
// =============================================================================

export const MAX_PAYLOAD_SIZE = 4096;
export const RECONNECT_GRACE_MS = 60_000;
export const WATCHDOG_TIMEOUT_MS = 30_000;
export const RPS_TIMEOUT_MS = 30_000;
export const TURN_TIME_POOL_MS = 300_000;
export const TURN_TIME_INCREMENT_MS = 40_000;
export const INACTIVITY_TIMEOUT_MS = 120_000;
export const INACTIVITY_WARNING_BEFORE_MS = 20_000;
export const INACTIVITY_RACE_WINDOW_MS = 500;
export const BOTH_DISCONNECTED_CLEANUP_MS = 4 * 60 * 60 * 1000; // 4 hours
export const STATE_SYNC_RATE_LIMIT_MS = 5_000;

// =============================================================================
// Data Layer Types
// =============================================================================

export interface CardDB {
  db: Database.Database;
  stmt: Database.Statement;
  nameStmt: Database.Statement;
  descStmt: Database.Statement;
}

export interface ScriptDB {
  startupScripts: Map<string, string>;
  basePath: string;
}

// =============================================================================
// Main -> Worker Thread Messages
// =============================================================================

export interface Deck {
  main: number[];
  extra: number[];
}

export interface InitDuelMessage {
  type: 'INIT_DUEL';
  duelId: string;
  decks: [Deck, Deck];
  skipRps?: boolean;
  skipShuffle?: boolean;
}

export interface PlayerResponseMessage {
  type: 'PLAYER_RESPONSE';
  playerIndex: 0 | 1;
  promptType: SelectPromptType;
  data: PlayerResponseMsg['data'];
}

export type MainToWorkerMessage = InitDuelMessage | PlayerResponseMessage;

// =============================================================================
// Worker -> Main Thread Messages
// =============================================================================

export interface WorkerDuelCreated {
  type: 'WORKER_DUEL_CREATED';
  duelId: string;
}

export interface WorkerMessage {
  type: 'WORKER_MESSAGE';
  duelId: string;
  message: ServerMessage;
}

export interface WorkerError {
  type: 'WORKER_ERROR';
  duelId: string;
  error: string;
}

export interface WorkerRetry {
  type: 'WORKER_RETRY';
  duelId: string;
}

export type WorkerToMainMessage =
  | WorkerDuelCreated
  | WorkerMessage
  | WorkerError
  | WorkerRetry;

// =============================================================================
// Session State
// =============================================================================

export interface PlayerSession {
  playerId: string;
  playerIndex: 0 | 1;
  ws: import('ws').WebSocket | null;
  connected: boolean;
  disconnectedAt: number | null;
  reconnectToken: string | null;
  // Per-player timers (M1 consolidation — formerly standalone Maps)
  gracePeriodTimer: ReturnType<typeof setTimeout> | null;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  warningTimer: ReturnType<typeof setTimeout> | null;
  raceWindowTimer: ReturnType<typeof setTimeout> | null;
}

export interface TimerContext {
  pools: [number, number];
  running: boolean;
  activePlayer: Player;
  intervalRef: ReturnType<typeof setInterval> | null;
  lastTickMs: number;
  turnCount: number;
}

export interface DuelSession {
  duelId: string;
  players: [PlayerSession, PlayerSession];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}
