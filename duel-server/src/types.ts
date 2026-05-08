import type { ServerMessage, PlayerResponseMsg, SelectPromptType, Player, PreComputedState, ForkSanityFields } from './ws-protocol.js';
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
export const REPLAY_WORKER_WATCHDOG_MS = 30_000;
export const REPLAY_CACHE_TTL_MS = 600_000; // 10 min
export const ANIMATIONS_DONE_TIMEOUT_MS = 30_000; // safety: start timer even if client never sends ANIMATIONS_DONE
export const MAX_REPLAY_WORKERS = 3;

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
// Worker Mode
// =============================================================================

export type WorkerMode = 'pvp' | 'replay' | 'solo';

// =============================================================================
// Main -> Worker Thread Messages
// =============================================================================

export interface Deck {
  main: number[];
  extra: number[];
}

/** Deduplicated non-zero card codes from both decklists — for omniscient
 *  prefetch (replay precompute). DO NOT use for live PvP DUEL_STARTING:
 *  sending the union to both players leaks the opponent's decklist. Use
 *  `extractCardCodesForPlayer` instead. */
export function extractCardCodes(decks: readonly [Deck, Deck]): number[] {
  return [...new Set(decks.flatMap(d => [...d.main, ...d.extra]).filter(c => c > 0))];
}

/** Deduplicated non-zero card codes from a single player's deck — for live
 *  PvP image prefetch without leaking the opponent's decklist. */
export function extractCardCodesForPlayer(decks: readonly [Deck, Deck], playerIndex: 0 | 1): number[] {
  const d = decks[playerIndex];
  return [...new Set([...d.main, ...d.extra].filter(c => c > 0))];
}

export interface InitDuelMessage {
  type: 'INIT_DUEL';
  duelId: string;
  decks: [Deck, Deck];
  playerUsernames: [string, string];
  deckNames: [string, string];
  skipRps?: boolean;
  skipShuffle?: boolean;
  scriptsHash: string;
  ocgcoreVersion: string;
}

export interface EmitReplayDataMessage {
  type: 'EMIT_REPLAY_DATA';
}

export interface PlayerResponseMessage {
  type: 'PLAYER_RESPONSE';
  playerIndex: 0 | 1;
  promptType: SelectPromptType;
  data: PlayerResponseMsg['data'];
}

export interface InitReplayMessage {
  type: 'INIT_REPLAY';
  duelId: string;
  seed: string[];
  decks: [Deck, Deck];
  playerResponses: CapturedResponse[];
  metadata: ReplayMetadata;
}

export type { ForkSanityFields } from './ws-protocol.js';

export interface InitForkMessage {
  type: 'INIT_FORK';
  duelId: string;
  seed: string[];
  decks: [Deck, Deck];
  playerResponses: CapturedResponse[];
  targetResponseCount: number;
  expectedState: ForkSanityFields;
  scriptsHash: string;
  ocgcoreVersion: string;
}

export interface ForkResumeMessage {
  type: 'FORK_RESUME';
}

/** P0-3bis.3 — main thread asks the worker to roll back to its
 *  most recent IDLECMD/BATTLECMD snapshot and re-emit the original prompt. */
export interface CancelPromptSequenceMessage {
  type: 'CANCEL_PROMPT_SEQUENCE';
  playerIndex: 0 | 1;
}

export type MainToWorkerMessage = InitDuelMessage | PlayerResponseMessage | EmitReplayDataMessage | InitReplayMessage | InitForkMessage | ForkResumeMessage | CancelPromptSequenceMessage;

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
  playerIndex: 0 | 1;
}

export interface CapturedResponse {
  data: unknown;
  timestamp?: string;
}

export interface ReplayMetadata {
  playerUsernames: [string, string];
  deckNames: [string, string];
  turnCount: number;
  result: string | null;
  date: string;
  scriptsHash: string;
  ocgcoreVersion: string;
}

export interface WorkerReplayPayload {
  seed: string[];
  decks: [Deck, Deck];
  playerResponses: CapturedResponse[];
  metadata: ReplayMetadata;
}

export interface WorkerReplayData {
  type: 'WORKER_REPLAY_DATA';
  duelId: string;
  payload: WorkerReplayPayload;
}

export interface WorkerReplayBoardStates {
  type: 'WORKER_REPLAY_BOARD_STATES';
  duelId: string;
  turnNumber: number;
  states: PreComputedState[];
}

export interface WorkerReplayComplete {
  type: 'WORKER_REPLAY_COMPLETE';
  duelId: string;
}

export interface WorkerReplayError {
  type: 'WORKER_REPLAY_ERROR';
  duelId: string;
  code: string;
  message: string;
}

export interface WorkerForkReady {
  type: 'WORKER_FORK_READY';
  duelId: string;
  sanityResult: { match: boolean; details?: string };
}

export interface WorkerForkError {
  type: 'WORKER_FORK_ERROR';
  duelId: string;
  code: string;
  message: string;
}

/** P0-3bis.3 — worker tells the main thread "rollback applied; re-send the
 *  cached IDLECMD/BATTLECMD prompt to player N WITHOUT counting it as
 *  an invalid response (this is a cancel, not a RETRY)". */
export interface WorkerCancelDoneMessage {
  type: 'WORKER_CANCEL_DONE';
  duelId: string;
  playerIndex: 0 | 1;
}

export type WorkerToMainMessage =
  | WorkerDuelCreated
  | WorkerMessage
  | WorkerError
  | WorkerRetry
  | WorkerCancelDoneMessage
  | WorkerReplayData
  | WorkerReplayBoardStates
  | WorkerReplayComplete
  | WorkerReplayError
  | WorkerForkReady
  | WorkerForkError;

// =============================================================================
// Pre-Duel RPS State
// =============================================================================

export type SessionPhase = 'WAITING_PLAYERS' | 'RPS' | 'CHOOSE_ORDER' | 'TP_RESULT' | 'DUELING';

export interface RpsState {
  choices: [number | null, number | null];
  timers: ReturnType<typeof setTimeout>[];
  round: number;
}

export const TP_TIMEOUT_MS = 30_000;

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
  /** Player awaiting ANIMATIONS_DONE before the timer starts. null = timer starts immediately. */
  pendingPlayer: Player | null;
  pendingTimeout: ReturnType<typeof setTimeout> | null;
}

export interface DuelSession {
  duelId: string;
  players: [PlayerSession, PlayerSession];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}
