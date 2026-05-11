import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';

/**
 * Pre-duel RPS + turn-player selection.
 *
 * Owns the state-machine that runs between the moment both players are
 * connected (phase `WAITING_PLAYERS` → `RPS`) and the moment the OCGCore
 * worker is spawned (phase `DUELING`). Three transitions:
 *
 *   RPS ──draw──> RPS (round+1, up to MAX_RPS_ROUNDS)
 *   RPS ──winner──> CHOOSE_ORDER ──answer──> TP_RESULT ──after 1s──> DUELING
 *
 * The module owns NO state of its own. The per-session timer handles live
 * on `session.rpsState.timers`. The bridge into worker spawning
 * (`startDuelWithOrder`) is injected at boot via `configureRpsCoordinator`
 * — that callback is what flips the phase to DUELING, swaps decks if
 * needed, and posts INIT_DUEL to the worker.
 *
 * All four timers used by this state machine are pushed into
 * `session.rpsState.timers` so `disposeRps()` cancels them cleanly:
 *   - rpsTimeoutMs auto-resolve (un-answered round)
 *   - 2s draw-restart (winner === null → next round)
 *   - 1.5s RPS → CHOOSE_ORDER transition
 *   - tpTimeoutMs SELECT_TP auto-resolve
 *   - 1s TP_RESULT → DUELING bridge (startDuelWithOrder)
 * The phase-guards inside each callback are kept as a belt-and-braces
 * safety net (the timer queue is unconditionally drained, but a callback
 * that's already in the JS task queue can still fire once after
 * `clearTimeout` — the guard short-circuits it).
 */

const MAX_RPS_ROUNDS = 10;

export interface RpsCoordinatorConfig {
  /** Send a server message to one player. Routes through the host's WS layer. */
  sendToPlayer: (session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage) => void;
  /**
   * Apply per-player perspective filtering to a message (used for
   * RPS_RESULT so each player sees the right side as "player 1"). May
   * return null if the message is suppressed for that player — the
   * caller skips the send in that case.
   */
  filterMessage: (msg: ServerMessage, playerIndex: Player) => ServerMessage | null;
  /**
   * Bridge into worker spawning + duel start. Called once after the
   * winner has chosen turn order (or the TP-timeout auto-picks "go
   * first"). Server.ts owns the actual Worker construction + INIT_DUEL.
   */
  startDuelWithOrder: (session: ActiveDuelSession, firstPlayer: 0 | 1) => void;
  /** Timeout before each RPS round is auto-resolved with random choices. */
  rpsTimeoutMs: number;
  /** Timeout before SELECT_TP is auto-resolved as "go first". */
  tpTimeoutMs: number;
}

const configurable = createConfigurable<RpsCoordinatorConfig>('rps-coordinator');
export const configureRpsCoordinator = configurable.configure;
export const isRpsCoordinatorConfigured = configurable.isConfigured;
const getCfg = configurable.get;

/**
 * Clear all RPS-tracked timers. Idempotent — safe to call from
 * `cleanupDuelSession`, `startRematch`, and the natural `startDuelWithOrder`
 * transition. Does NOT null out `session.rpsState` — `disposeRps` does
 * that as the cleanup entry point.
 */
function clearRpsTimers(session: ActiveDuelSession): void {
  if (session.rpsState) {
    for (const t of session.rpsState.timers) clearTimeout(t);
    session.rpsState.timers = [];
  }
}

/** Cleanup entry point — clears timers and nulls the rpsState. */
export function disposeRps(session: ActiveDuelSession): void {
  clearRpsTimers(session);
  session.rpsState = null;
}

/**
 * Enter (or re-enter, on a draw) the RPS phase. Both players receive
 * `RPS_CHOICE`. After `rpsTimeoutMs` un-answered choices are filled in
 * randomly so the round always resolves.
 */
export function startRpsPhase(session: ActiveDuelSession, round = 0): void {
  const cfg = getCfg();
  session.phase = 'RPS';
  session.rpsState = { choices: [null, null], timers: [], round };
  session.awaitingResponse = [true, true];

  const rps0: ServerMessage = { type: 'RPS_CHOICE', player: 0 };
  const rps1: ServerMessage = { type: 'RPS_CHOICE', player: 1 };
  session.lastSentPrompt = [rps0, rps1];
  cfg.sendToPlayer(session, 0, rps0);
  cfg.sendToPlayer(session, 1, rps1);

  session.rpsState.timers.push(setTimeout(() => {
    if (session.phase !== 'RPS' || !session.rpsState) return;
    for (const p of [0, 1] as const) {
      if (session.rpsState.choices[p] === null) {
        session.rpsState.choices[p] = Math.floor(Math.random() * 3);
        session.awaitingResponse[p] = false;
      }
    }
    resolveRps(session);
  }, cfg.rpsTimeoutMs));
}

/**
 * Resolve a round. Three outcomes:
 *  - Different choices: declare winner via RPS_RESULT, schedule
 *    CHOOSE_ORDER prompt after 1.5s.
 *  - Same choices, under `MAX_RPS_ROUNDS`: emit RPS_RESULT with
 *    winner=null, schedule the next round after 2s.
 *  - Same choices, at `MAX_RPS_ROUNDS`: force a random winner (else
 *    bad-faith players could draw the duel indefinitely).
 *
 * `winner` references the OCGCore index of the side that wins.
 */
function resolveRps(session: ActiveDuelSession): void {
  if (!session.rpsState) return;
  const [c0, c1] = session.rpsState.choices;
  if (c0 === null || c1 === null) return;
  const round = session.rpsState.round;
  const cfg = getCfg();

  // 0=Rock, 1=Paper, 2=Scissors — rock beats scissors, scissors beats paper, paper beats rock.
  let winner: Player | null = null;
  if (c0 !== c1) {
    winner = ((c1 + 1) % 3 === c0) ? 0 : 1;
  } else if (round + 1 >= MAX_RPS_ROUNDS) {
    winner = Math.random() < 0.5 ? 0 : 1;
  }

  const result: ServerMessage = { type: 'RPS_RESULT', player1Choice: c0, player2Choice: c1, winner };
  for (const p of [0, 1] as const) {
    const filtered = cfg.filterMessage(result, p);
    if (filtered) cfg.sendToPlayer(session, p, filtered);
  }

  if (winner === null) {
    // Draw — schedule the next round. The timer is tracked in
    // rpsState.timers so `disposeRps()` clears it cleanly (a stale
    // restart firing after cleanup would re-enter the RPS state machine
    // on a session that's mid-teardown).
    session.rpsState.timers.push(setTimeout(() => {
      if (session.phase !== 'RPS') return;
      startRpsPhase(session, round + 1);
    }, 2000));
    return;
  }

  const rpsWinner = winner;
  // 1.5s suspense before promoting to CHOOSE_ORDER — tracked so dispose
  // cancels it.
  session.rpsState.timers.push(setTimeout(() => {
    if (session.phase !== 'RPS') return;
    session.phase = 'CHOOSE_ORDER';
    session.awaitingResponse = [false, false];
    session.awaitingResponse[rpsWinner] = true;
    const tpMsg: ServerMessage = { type: 'SELECT_TP', player: rpsWinner };
    session.lastSentPrompt = [null, null];
    session.lastSentPrompt[rpsWinner] = tpMsg;
    cfg.sendToPlayer(session, rpsWinner, tpMsg);
    cfg.sendToPlayer(session, rpsWinner === 0 ? 1 : 0, { type: 'WAITING_RESPONSE' });

    if (session.rpsState) {
      session.rpsState.timers.push(setTimeout(() => {
        if (session.phase !== 'CHOOSE_ORDER') return;
        cfg.sendToPlayer(session, 0, { type: 'TP_RESULT', goFirst: rpsWinner === 0 });
        cfg.sendToPlayer(session, 1, { type: 'TP_RESULT', goFirst: rpsWinner === 1 });
        session.phase = 'TP_RESULT';
        if (session.rpsState) {
          session.rpsState.timers.push(setTimeout(() => {
            if (session.phase !== 'TP_RESULT') return;
            cfg.startDuelWithOrder(session, rpsWinner);
          }, 1000));
        }
      }, cfg.tpTimeoutMs));
    }
  }, 1500));
}

/**
 * Dispatch a pre-duel player response. Returns `true` if the response
 * was handled (caller should not pass it to the OCGCore worker),
 * `false` otherwise.
 *
 * Two prompts are pre-duel: RPS_CHOICE (during RPS) and SELECT_TP
 * (during CHOOSE_ORDER). Anything else falls through.
 */
export function handlePreDuelResponse(
  session: ActiveDuelSession,
  playerIndex: 0 | 1,
  promptType: string,
  data: Record<string, unknown>,
): boolean {
  const cfg = getCfg();

  if (session.phase === 'RPS' && promptType === 'RPS_CHOICE' && session.rpsState) {
    const choice = data['choice'] as number;
    if (typeof choice !== 'number' || choice < 0 || choice > 2) return true;
    if (session.rpsState.choices[playerIndex] !== null) return true;

    session.rpsState.choices[playerIndex] = choice;
    session.awaitingResponse[playerIndex] = false;
    session.lastSentPrompt[playerIndex] = null;

    if (session.rpsState.choices[0] !== null && session.rpsState.choices[1] !== null) {
      clearRpsTimers(session);
      resolveRps(session);
    }
    return true;
  }

  if (session.phase === 'CHOOSE_ORDER' && promptType === 'SELECT_TP' && session.rpsState) {
    clearRpsTimers(session);
    const goFirst = data['goFirst'] === true;
    const firstPlayer: 0 | 1 = goFirst ? playerIndex : (playerIndex === 0 ? 1 : 0);
    session.awaitingResponse[playerIndex] = false;
    session.lastSentPrompt[playerIndex] = null;

    cfg.sendToPlayer(session, 0, { type: 'TP_RESULT', goFirst: firstPlayer === 0 });
    cfg.sendToPlayer(session, 1, { type: 'TP_RESULT', goFirst: firstPlayer === 1 });
    session.phase = 'TP_RESULT';
    session.rpsState.timers.push(setTimeout(() => {
      if (session.phase !== 'TP_RESULT') return;
      cfg.startDuelWithOrder(session, firstPlayer);
    }, 1000));
    return true;
  }

  return false;
}
