/**
 * U15 (audit-4-modes-2026-06-01) — `ActiveDuelSession` factory + rematch reset.
 *
 * Before this module, the 35-field `ActiveDuelSession` was constructed by hand
 * in 2 places (`server.ts` POST `/api/duels` for PvP normal, `fork-handlers.ts`
 * `createForkSoloSession` for fork-solo) and reset by hand in a 3rd
 * (`server.ts` `startRematch`). The 3 sites drifted on `phase`, `startedAt`,
 * `worker`, `decks`, `forkMode`, `skipShuffle`, and the player-metadata
 * source — fork-handlers' ctor was a ~45-line copy of the PvP one with 5
 * field tweaks.
 *
 * Two helpers consolidate the shape:
 *
 *  - `createInitialSessionState(opts)` — single ctor for PvP normal + fork-solo.
 *    Mode-specific behaviour is parameterised (default `phase`/`startedAt`
 *    track the mode, but can be overridden).
 *
 *  - `resetSessionForRematch(session)` — wipes per-duel state (chain,
 *    awaitingResponse, lastBoardState, last*Prompt/Hint, rematch flags,
 *    timestamps, invalidResponseCount, gameLog) without touching the
 *    long-lived fields (`duelId`, `players`, `decks`, `soloMode`, `forkMode`,
 *    `skipShuffle`, `turnTimeSecs`, `playerUsernames`, `deckNames`). The
 *    `gameLog` is replaced with a fresh `createSessionGameLog()` so the
 *    new duel's journal does NOT bleed in from the previous one.
 *
 * The shape of `ActiveDuelSession` is preserved — callers still mutate
 * `session.X = …` everywhere. This module owns CONSTRUCTION and RESET only.
 */

import { emptyChainState } from './chain-state-tracker.js';
import { createSessionGameLog } from './session-game-log.js';
import type { Worker } from 'node:worker_threads';
import type { ActiveDuelSession, PlayerSession, Deck, SessionPhase } from './types.js';

export interface CreateInitialSessionStateOpts {
  /** Unique session identifier. */
  duelId: string;
  /** The 2 player slots. SOLO and fork-solo populate slot 1 with a
   *  reserved-but-never-connected mirror of slot 0 (`isReadyToStart`
   *  branches on `soloMode` to read slot 0 only). */
  players: [PlayerSession, PlayerSession];
  /** Per-player deck pair, ordered like `players`. */
  decks: [Deck, Deck];
  /** Whether this is a SOLO multiplex session (one socket plays both sides).
   *  Implied true by `forkMode: true`. */
  soloMode: boolean;
  /** Display usernames (for the replay metadata and the game-log header). */
  playerUsernames: [string, string];
  /** Display deck names (for the replay metadata). */
  deckNames: [string, string];

  // ── optional mode-specific overrides ─────────────────────────────────────
  /** Default `'WAITING_PLAYERS'` for PvP (no pre-duel dice yet), `'DUELING'`
   *  for fork-solo (fork derives from a replay seek point, no RPS). */
  phase?: SessionPhase;
  /** Default `null` for PvP (the dice flow sets it later), `Date.now()` for
   *  fork-solo (no pre-duel phase). Mode-derived when omitted. */
  startedAt?: number | null;
  /** Default `null` for PvP (worker spawn is deferred until RPS resolves);
   *  the fork-solo handler passes the worker it just spawned for replay
   *  reconstruction. */
  worker?: Worker | null;
  /** Whether to skip the engine's initial shuffle. Defaults to `false` for
   *  PvP normal (caller passes a value derived from the API request) and
   *  `true` for fork-solo (the reconstruction path is deterministic on the
   *  recorded seed, so no shuffle is needed). */
  skipShuffle?: boolean;
  /** Fork-solo only — set to `true` when constructed by `createForkSoloSession`.
   *  Implies `soloMode: true`. The runtime checks `session.forkMode` to skip
   *  rematch arm, replay persistence, and to tag the DUEL_END log entry. */
  forkMode?: boolean;
  /** Default `300`. The per-player turn-time pool in seconds. SOLO and
   *  fork-solo ignore it at the timer-management layer (turn timer is not
   *  armed when `shouldRunTurnTimer(session) === false`), but the field
   *  must be populated to keep the shape uniform. */
  turnTimeSecs?: number;
}

export function createInitialSessionState(opts: CreateInitialSessionStateOpts): ActiveDuelSession {
  const isFork = opts.forkMode === true;
  // U15 review-fix (audit-4-modes-2026-06-01) — enforce CLAUDE.md F5-bis
  // invariant: `forkMode: true` implies `soloMode: true` and is NEVER set
  // on a PvP normal session. Documented but unenforced pre-fix; a future
  // 3rd call-site (tutorial / practice mode) could violate it silently.
  if (isFork && !opts.soloMode) {
    throw new Error('createInitialSessionState: forkMode requires soloMode (CLAUDE.md F5-bis)');
  }
  const phase: SessionPhase = opts.phase ?? (isFork ? 'DUELING' : 'WAITING_PLAYERS');
  const startedAt = opts.startedAt !== undefined ? opts.startedAt : (isFork ? Date.now() : null);

  return {
    duelId: opts.duelId,
    phase,
    firstPlayerState: null,
    chosenFirstPlayer: null,
    players: opts.players,
    createdAt: Date.now(),
    startedAt,
    endedAt: null,
    worker: opts.worker ?? null,
    workerTerminated: false,
    awaitingResponse: [false, false],
    lastBoardState: null,
    lastSentPrompt: [null, null],
    lastSentHint: [null, null],
    decks: opts.decks,
    rematchRequested: [false, false],
    rematchTimeout: null,
    preservationTimer: null,
    bothDisconnected: false,
    combinedGraceTimer: null,
    storedDuelResult: null,
    lastStateSyncAt: [0, 0],
    lastCancelAt: [0, 0],
    cancelTargetPrompt: [null, null],
    timerContext: null,
    soloMode: opts.soloMode,
    forkMode: isFork,
    skipShuffle: opts.skipShuffle ?? isFork,
    turnTimeSecs: opts.turnTimeSecs ?? 300,
    invalidResponseCount: [0, 0],
    promptSentAt: [0, 0],
    ...emptyChainState(),
    playerUsernames: opts.playerUsernames,
    deckNames: opts.deckNames,
    pendingReplayResult: null,
    forkConnectionTimeout: null,
    gameLog: createSessionGameLog(),
  };
}

/**
 * Reset per-duel state on rematch. Mutates `session` in place to preserve the
 * stable identity (registered in `DuelSessionManager`, referenced by open WS
 * connections). Long-lived fields are NOT touched : `duelId`, `players`,
 * `decks`, `soloMode`, `forkMode`, `skipShuffle`, `turnTimeSecs`,
 * `playerUsernames`, `deckNames` all carry over.
 *
 * Per-player `inactivitySlot` is cleared by `clearAllDuelTimers`
 * (timer-management.ts) which the rematch path calls SEPARATELY after this
 * helper. Per-player `gracePeriodTimer` was historically only cleared by
 * `cleanupDuelSession` and by the reconnect path — meaning a rematch that
 * fires while a player is in grace period would leave the timer alive,
 * with its callback firing on the freshly-reset session. U15 audit-review
 * fix : clear `gracePeriodTimer` here too.
 *
 * `phase`, `firstPlayerState`, `chosenFirstPlayer` are NOT reset by this
 * helper :
 *   - `firstPlayerState` / `chosenFirstPlayer` are owned by
 *     `disposeFirstPlayer(session)`, which the rematch path MUST call
 *     BEFORE this helper (server.ts startRematch enforces the order).
 *   - `phase` is immediately re-written by `startFirstPlayerPhase` (PvP)
 *     or `startDuelWithOrder` (SOLO) the next tick — resetting it here
 *     would be cosmetic, and asymmetric with the pre-refactor behavior.
 *     The audit review accepted the asymmetry as parity-preserving
 *     (D1 acted 2026-06-02).
 *
 * MUST NOT be called on a `forkMode: true` session. Fork-solo is
 * exploratory one-shot and never reaches the rematch flow — see
 * CLAUDE.md F5-bis (`worker-lifecycle.ts:165` skips the rematch arm
 * when `session.forkMode`). The invariant is by-construction ; no
 * runtime assertion is added here to keep the helper pure (D2 acted
 * 2026-06-02). Calling it on a fork session would leave `forkMode: true`
 * intact but reset every per-duel field — a zombie state.
 *
 * Does NOT spawn a worker — `startDuelWithOrder` or the dice coordinator
 * handles that.
 */
export function resetSessionForRematch(session: ActiveDuelSession): void {
  session.worker = null;
  session.workerTerminated = true;
  session.awaitingResponse = [false, false];
  session.lastBoardState = null;
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];
  session.rematchRequested = [false, false];
  session.endedAt = null;
  session.startedAt = Date.now();
  session.bothDisconnected = false;
  session.storedDuelResult = null;
  session.lastStateSyncAt = [0, 0];
  session.lastCancelAt = [0, 0];
  session.cancelTargetPrompt = [null, null];
  session.invalidResponseCount = [0, 0];
  session.promptSentAt = [0, 0];
  // U15-review #5 — clear per-player grace timers. A rematch can fire while
  // a player is in the disconnect grace window ; without this, the timer
  // callback would tire on the freshly-reset session.
  for (const p of session.players) {
    if (p.gracePeriodTimer) {
      clearTimeout(p.gracePeriodTimer);
      p.gracePeriodTimer = null;
    }
  }
  Object.assign(session, emptyChainState());
  // Fresh builders for the rematch — the prior duel's entries must NOT bleed
  // into the new journal.
  session.gameLog = createSessionGameLog();
}
