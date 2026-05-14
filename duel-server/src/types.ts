import type { ServerMessage, PlayerResponseMsg, SelectPromptType, Player, PreComputedState, ForkSanityFields } from './ws-protocol.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Constants
// =============================================================================

/**
 * Caps for inbound payloads. Split into HTTP body vs WS frame because the two
 * have very different worst-case sizes (audit finding M3).
 *
 * - `MAX_HTTP_BODY_SIZE` (16 KB) sizes `POST /api/duels`. The body is a JSON
 *   `{ player1, player2, soloMode?, skipShuffle?, turnTimeSecs? }` carrying
 *   2 decklists (main + extra arrays of card codes), playerIds, optional
 *   usernames + deckNames. Two 60+15 card decks ≈ 1.5–2 KB JSON; 16 KB
 *   leaves comfortable headroom for long Unicode usernames / deckNames /
 *   future fields without a re-tune.
 * - `MAX_WS_FRAME_SIZE` (4 KB) sizes inbound WS frames. Client→server traffic
 *   is bounded: the largest message is `PLAYER_RESPONSE` for a `SORT_CARD`
 *   over 60 cards, well under 1 KB. Keeping this tight is anti-DoS hygiene.
 */
export const MAX_HTTP_BODY_SIZE = 16384;
export const MAX_WS_FRAME_SIZE = 4096;
export const RECONNECT_GRACE_MS = 60_000;
export const WATCHDOG_TIMEOUT_MS = 30_000;
// 30s player-side cap for "click to roll". The auto-resolve still rolls a
// random 2D6 for that player (so a stalled opponent doesn't block the duel).
export const DICE_ROLL_TIMEOUT_MS = 30_000;
export const TURN_TIME_POOL_MS = 300_000;
export const TURN_TIME_INCREMENT_MS = 40_000;
export const INACTIVITY_TIMEOUT_MS = 120_000;
export const INACTIVITY_WARNING_BEFORE_MS = 20_000;
export const INACTIVITY_RACE_WINDOW_MS = 500;
export const BOTH_DISCONNECTED_CLEANUP_MS = 4 * 60 * 60 * 1000; // 4 hours
export const STATE_SYNC_RATE_LIMIT_MS = 5_000;
/** P0-3bis.3 hardening — minimum interval between consecutive
 *  CANCEL_PROMPT_SEQUENCE messages from the same player. Bounds the
 *  cost of a malicious flood (each cancel triggers a worker restore +
 *  prompt re-broadcast). 1s is well below human-paced rate but blocks
 *  scripted spam. */
export const CANCEL_PROMPT_RATE_LIMIT_MS = 1_000;
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
  const seen = new Set<number>();
  const out: number[] = [];
  for (const d of decks) {
    for (const c of d.main) if (c > 0 && !seen.has(c)) { seen.add(c); out.push(c); }
    for (const c of d.extra) if (c > 0 && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

/** Deduplicated non-zero card codes from a single player's deck — for live
 *  PvP image prefetch without leaking the opponent's decklist. */
export function extractCardCodesForPlayer(decks: readonly [Deck, Deck], playerIndex: 0 | 1): number[] {
  const d = decks[playerIndex];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const c of d.main) if (c > 0 && !seen.has(c)) { seen.add(c); out.push(c); }
  for (const c of d.extra) if (c > 0 && !seen.has(c)) { seen.add(c); out.push(c); }
  return out;
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
  durationSec: number;
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
// Pre-Duel First-Player Coordinator State (dice 2D6, since 2026-05-13)
// =============================================================================

export type SessionPhase =
  | 'WAITING_PLAYERS'
  | 'ROLLING_DICE'
  | 'DICE_RESOLVED'
  | 'CHOOSE_FIRST_PLAYER'
  | 'FIRST_PLAYER_RESOLVED'
  | 'DUELING';

/** Per-session state owned by `first-player-coordinator`. `rolls` is the
 *  pair of 2D6 rolls for each player (null until that player has confirmed
 *  readiness); `timers` collects every setTimeout so cleanup can clear them
 *  in one sweep; `round` increments on ties for diagnostics. */
export interface FirstPlayerState {
  rolls: [DiceRoll | null, DiceRoll | null];
  timers: ReturnType<typeof setTimeout>[];
  round: number;
}

/** A single 2D6 roll: two values in [1..6]. */
export type DiceRoll = readonly [number, number];

/** Sum convenience. */
export function diceSum(roll: DiceRoll): number {
  return roll[0] + roll[1];
}

export const FIRST_PLAYER_TIMEOUT_MS = 15_000;

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
  // L6: 3 nested setTimeout slots (inactivityTimer/warningTimer/raceWindowTimer)
  // collapsed into a single tagged slot owned by inactivity-timer.ts.
  inactivitySlot: import('./inactivity-timer.js').InactivitySlot | null;
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

/**
 * Server-owned in-flight duel state. Layered on top of `DuelSession` with
 * runtime fields (worker handle, RPS state, replay metadata, prompt cache,
 * timer context, chain-state tracker spread). Owned by the
 * `DuelSessionManager` instance in server.ts and mutated freely by the
 * message handlers / timer-management module / replay-handlers fork bridge.
 */
export interface ActiveDuelSession extends DuelSession {
  phase: SessionPhase;
  firstPlayerState: FirstPlayerState | null;
  /** Set when the SELECT_FIRST_PLAYER pick (or timeout default) resolves
   *  the pre-duel turn-order — i.e. on the transition into
   *  `FIRST_PLAYER_RESOLVED`. Allows `sendStateSnapshot` to re-emit the
   *  FIRST_PLAYER_RESULT broadcast for a client refreshing during the
   *  2.5s announce window. Reset alongside `firstPlayerState` by
   *  `disposeFirstPlayer`. */
  chosenFirstPlayer: 0 | 1 | null;
  worker: import('node:worker_threads').Worker | null;
  workerTerminated: boolean;
  awaitingResponse: [boolean, boolean];
  lastBoardState: import('./ws-protocol.js').ServerMessage | null;
  lastSentPrompt: [import('./ws-protocol.js').ServerMessage | null, import('./ws-protocol.js').ServerMessage | null];
  lastSentHint: [import('./ws-protocol.js').ServerMessage | null, import('./ws-protocol.js').ServerMessage | null];
  decks: [Deck, Deck];
  rematchRequested: [boolean, boolean];
  rematchTimeout: ReturnType<typeof setTimeout> | null;
  // Story 5.2 — Both-disconnect handling
  preservationTimer: ReturnType<typeof setTimeout> | null;
  bothDisconnected: boolean;
  combinedGraceTimer: ReturnType<typeof setTimeout> | null;
  storedDuelResult: import('./ws-protocol.js').ServerMessage | null;
  lastStateSyncAt: [number, number];
  /** P0-3bis.3 hardening — last CANCEL_PROMPT_SEQUENCE timestamp per
   *  player (epoch ms). Used by the cancel rate-limit. */
  lastCancelAt: [number, number];
  /** P0-3bis.3 — snapshot of the IDLECMD/BATTLECMD prompt at the
   *  moment the player committed via PLAYER_RESPONSE. The worker takes
   *  its WASM rollback snapshot at the same boundary. On
   *  CANCEL_PROMPT_SEQUENCE, the server re-broadcasts THIS prompt
   *  (not the latest `lastSentPrompt`, which has been overwritten by
   *  intermediate SELECT_PLACE / SELECT_TRIBUTE / SELECT_POSITION).
   *  Cleared when a fresh IDLECMD/BATTLECMD is broadcast (= new
   *  rollback boundary, so the previous snapshot is no longer
   *  relevant). */
  cancelTargetPrompt: [import('./ws-protocol.js').ServerMessage | null, import('./ws-protocol.js').ServerMessage | null];
  // M1 consolidation — turn timer context (formerly standalone Map)
  timerContext: TimerContext | null;
  soloMode: boolean;
  skipShuffle: boolean;
  turnTimeSecs: number;
  invalidResponseCount: [number, number];
  promptSentAt: [number, number];
  // Active chain links — tracked for reconnection state sync
  activeChainLinks: import('./ws-protocol.js').ServerMessage[];
  chainPhase: 'idle' | 'building' | 'resolving';
  negatedChainIndices: Set<number>;
  /** M22 — chainIndex of the link currently resolving. Set on MSG_CHAIN_SOLVING,
   *  cleared on MSG_CHAIN_SOLVED + MSG_CHAIN_END. Used to tag MSG_CONFIRM_CARDS. */
  currentSolvingChainIndex: number | null;
  // Replay: player metadata
  playerUsernames: [string, string];
  deckNames: [string, string];
  pendingReplayResult: string | null;
  forkConnectionTimeout: ReturnType<typeof setTimeout> | null;
}
