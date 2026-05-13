import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import type { DiceRoll } from './types.js';
import { diceSum, extractCardCodesForPlayer } from './types.js';

/**
 * Pre-duel first-player coordinator (2D6 dice mechanic, since 2026-05-13).
 *
 * Replaces the legacy RPS flow. Both players roll 2D6 simultaneously; the
 * higher sum wins, ties auto-reroll, the winner picks who starts. Hard cap
 * at MAX_ROUNDS prevents pathological draws blocking the duel forever.
 *
 * Phase transitions (mirror of types.ts SessionPhase):
 *
 *   ROLLING_DICE ─tie──> ROLLING_DICE (round+1, up to MAX_ROUNDS)
 *   ROLLING_DICE ─winner──> DICE_RESOLVED ─after suspense──> CHOOSE_FIRST_PLAYER
 *   CHOOSE_FIRST_PLAYER ─answer──> FIRST_PLAYER_RESOLVED ─after banner──> DUELING
 *
 * The module owns NO state of its own. Per-session timers live on
 * `session.firstPlayerState.timers`. The bridge into worker spawning
 * (`startDuelWithOrder`) is injected at boot via `configureFirstPlayerCoordinator`
 * — that callback flips the phase to DUELING, swaps decks if needed, and
 * posts INIT_DUEL to the worker.
 *
 * All timers used by this state machine are pushed into
 * `session.firstPlayerState.timers` so `disposeFirstPlayer()` cancels them
 * cleanly:
 *   - diceRollTimeoutMs auto-resolve (un-confirmed roll for one or both players)
 *   - 1.8s tie auto-reroll (winner === null → next round)
 *   - DICE_SUSPENSE_MS DICE_RESOLVED → CHOOSE_FIRST_PLAYER transition
 *   - firstPlayerTimeoutMs SELECT_FIRST_PLAYER auto-resolve (winner stays silent)
 *   - FINAL_BANNER_MS FIRST_PLAYER_RESOLVED → DUELING bridge
 *
 * The phase-guards inside each callback are kept as a belt-and-braces safety
 * net (the timer queue is unconditionally drained, but a callback that's
 * already in the JS task queue can still fire once after `clearTimeout` —
 * the guard short-circuits it).
 */

const MAX_ROUNDS = 10;
const DICE_TIE_REROLL_MS = 1_800;
const DICE_SUSPENSE_MS = 1_500;
const FINAL_BANNER_MS = 2_500;

export interface FirstPlayerCoordinatorConfig {
  /** Send a server message to one player. Routes through the host's WS layer. */
  sendToPlayer: (session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage) => void;
  /**
   * Apply per-player perspective filtering to a message (used for
   * DICE_RESULT so each player sees the right side as "player 1"). May
   * return null if the message is suppressed for that player — the caller
   * skips the send in that case.
   */
  filterMessage: (msg: ServerMessage, playerIndex: Player) => ServerMessage | null;
  /**
   * Bridge into worker spawning + duel start. Called once after the
   * winner has chosen turn order (or the first-player-timeout auto-picks
   * "go first"). Server.ts owns the actual Worker construction + INIT_DUEL.
   */
  startDuelWithOrder: (session: ActiveDuelSession, firstPlayer: 0 | 1) => void;
  /** Timeout before each dice round is auto-rolled for stalled players. */
  diceRollTimeoutMs: number;
  /** Timeout before SELECT_FIRST_PLAYER auto-resolves as "winner goes first". */
  firstPlayerTimeoutMs: number;
}

const configurable = createConfigurable<FirstPlayerCoordinatorConfig>('first-player-coordinator');
export const configureFirstPlayerCoordinator = configurable.configure;
export const isFirstPlayerCoordinatorConfigured = configurable.isConfigured;
const getCfg = configurable.get;

/** Rolls one 2D6 result. Each die is uniform [1..6]. */
function rollDice(): DiceRoll {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

/**
 * Clear all coordinator-tracked timers. Idempotent — safe to call from
 * `cleanupDuelSession`, `startRematch`, and the natural `startDuelWithOrder`
 * transition. Does NOT null out `session.firstPlayerState` — `disposeFirstPlayer`
 * does that as the cleanup entry point.
 */
function clearCoordinatorTimers(session: ActiveDuelSession): void {
  if (session.firstPlayerState) {
    for (const t of session.firstPlayerState.timers) clearTimeout(t);
    session.firstPlayerState.timers = [];
  }
}

/** Cleanup entry point — clears timers and nulls the firstPlayerState. */
export function disposeFirstPlayer(session: ActiveDuelSession): void {
  clearCoordinatorTimers(session);
  session.firstPlayerState = null;
}

/**
 * Enter (or re-enter, on a tie) the dice-rolling phase. Both players receive
 * `DICE_ROLL`. After `diceRollTimeoutMs` un-confirmed rolls are filled in
 * randomly so the round always resolves (we still roll random dice for the
 * stalled player — the value just isn't user-triggered).
 */
export function startFirstPlayerPhase(session: ActiveDuelSession, round = 0): void {
  const cfg = getCfg();
  session.phase = 'ROLLING_DICE';
  session.firstPlayerState = { rolls: [null, null], timers: [], round };
  session.awaitingResponse = [true, true];

  const prompt0: ServerMessage = { type: 'DICE_ROLL', player: 0 };
  const prompt1: ServerMessage = { type: 'DICE_ROLL', player: 1 };
  session.lastSentPrompt = [prompt0, prompt1];
  cfg.sendToPlayer(session, 0, prompt0);
  cfg.sendToPlayer(session, 1, prompt1);

  session.firstPlayerState.timers.push(setTimeout(() => {
    if (session.phase !== 'ROLLING_DICE' || !session.firstPlayerState) return;
    for (const p of [0, 1] as const) {
      if (session.firstPlayerState.rolls[p] === null) {
        session.firstPlayerState.rolls[p] = rollDice();
        session.awaitingResponse[p] = false;
      }
    }
    resolveDiceRound(session);
  }, cfg.diceRollTimeoutMs));
}

/**
 * Resolve a round. Three outcomes:
 *  - Different sums: declare winner via DICE_RESULT, schedule
 *    CHOOSE_FIRST_PLAYER prompt after DICE_SUSPENSE_MS.
 *  - Same sums, under `MAX_ROUNDS`: emit DICE_RESULT with winner=null,
 *    schedule the next round after DICE_TIE_REROLL_MS.
 *  - Same sums, at `MAX_ROUNDS`: force a random winner (else bad-faith
 *    players could draw the duel indefinitely).
 */
function resolveDiceRound(session: ActiveDuelSession): void {
  if (!session.firstPlayerState) return;
  const [r0, r1] = session.firstPlayerState.rolls;
  if (r0 === null || r1 === null) return;
  const round = session.firstPlayerState.round;
  const cfg = getCfg();

  const sum0 = diceSum(r0);
  const sum1 = diceSum(r1);
  let winner: Player | null = null;
  if (sum0 !== sum1) {
    winner = sum0 > sum1 ? 0 : 1;
  } else if (round + 1 >= MAX_ROUNDS) {
    winner = Math.random() < 0.5 ? 0 : 1;
  }

  const result: ServerMessage = {
    type: 'DICE_RESULT',
    dice0: [r0[0], r0[1]],
    dice1: [r1[0], r1[1]],
    sum0,
    sum1,
    winner,
  };
  for (const p of [0, 1] as const) {
    const filtered = cfg.filterMessage(result, p);
    if (filtered) cfg.sendToPlayer(session, p, filtered);
  }

  if (winner === null) {
    // Tie — auto-reroll. Timer tracked so dispose clears a stale re-entry.
    session.firstPlayerState.timers.push(setTimeout(() => {
      if (session.phase !== 'ROLLING_DICE') return;
      startFirstPlayerPhase(session, round + 1);
    }, DICE_TIE_REROLL_MS));
    return;
  }

  session.phase = 'DICE_RESOLVED';
  const diceWinner = winner;
  // Suspense before promoting to CHOOSE_FIRST_PLAYER — tracked so dispose
  // cancels it.
  session.firstPlayerState.timers.push(setTimeout(() => {
    if (session.phase !== 'DICE_RESOLVED') return;
    session.phase = 'CHOOSE_FIRST_PLAYER';
    session.awaitingResponse = [false, false];
    session.awaitingResponse[diceWinner] = true;
    const prompt: ServerMessage = { type: 'SELECT_FIRST_PLAYER', player: diceWinner };
    session.lastSentPrompt = [null, null];
    session.lastSentPrompt[diceWinner] = prompt;
    cfg.sendToPlayer(session, diceWinner, prompt);
    cfg.sendToPlayer(session, diceWinner === 0 ? 1 : 0, { type: 'WAITING_RESPONSE' });

    if (session.firstPlayerState) {
      session.firstPlayerState.timers.push(setTimeout(() => {
        if (session.phase !== 'CHOOSE_FIRST_PLAYER') return;
        // Stalled winner — auto-resolve as "winner goes first" (sensible
        // default; the loser doesn't get to pick if the winner ghosts).
        broadcastFinalAndBridge(session, diceWinner);
      }, cfg.firstPlayerTimeoutMs));
    }
  }, DICE_SUSPENSE_MS));
}

/**
 * Final transition: broadcast FIRST_PLAYER_RESULT (perspective-filtered),
 * flip phase, then schedule the bridge into the duel after the banner
 * window. Used by both the winner's explicit choice path and the
 * auto-resolve timeout path.
 */
function broadcastFinalAndBridge(session: ActiveDuelSession, firstPlayer: 0 | 1): void {
  const cfg = getCfg();
  // Phase 3.16: prefetch hint — give each player their own decklist's card
  // codes ahead of FIRST_PLAYER_RESULT so the 2.5s announce window doubles
  // as a browser image-cache warmup. session.decks is still in pre-swap
  // order at this point (the player-0/1 swap inside startDuelWithOrder
  // hasn't happened yet), and session.players[i].deck matches session.decks[i],
  // so player i receives the deck they actually own. No info leak: each side
  // gets only its own deck.
  cfg.sendToPlayer(session, 0, { type: 'DECK_PREFETCH', cardCodes: extractCardCodesForPlayer(session.decks, 0) });
  cfg.sendToPlayer(session, 1, { type: 'DECK_PREFETCH', cardCodes: extractCardCodesForPlayer(session.decks, 1) });
  cfg.sendToPlayer(session, 0, { type: 'FIRST_PLAYER_RESULT', goFirst: firstPlayer === 0 });
  cfg.sendToPlayer(session, 1, { type: 'FIRST_PLAYER_RESULT', goFirst: firstPlayer === 1 });
  session.phase = 'FIRST_PLAYER_RESOLVED';
  if (session.firstPlayerState) {
    session.firstPlayerState.timers.push(setTimeout(() => {
      if (session.phase !== 'FIRST_PLAYER_RESOLVED') return;
      cfg.startDuelWithOrder(session, firstPlayer);
    }, FINAL_BANNER_MS));
  }
}

/**
 * Dispatch a pre-duel player response. Returns `true` if the response was
 * handled (caller should not pass it to the OCGCore worker), `false`
 * otherwise.
 *
 * Two prompts are pre-duel: DICE_ROLL (during ROLLING_DICE) and
 * SELECT_FIRST_PLAYER (during CHOOSE_FIRST_PLAYER). Anything else falls
 * through.
 */
export function handlePreDuelResponse(
  session: ActiveDuelSession,
  playerIndex: 0 | 1,
  promptType: string,
  _data: Record<string, unknown>,
): boolean {
  if (session.phase === 'ROLLING_DICE' && promptType === 'DICE_ROLL' && session.firstPlayerState) {
    // Idempotent: re-confirmation by the same player is a no-op (the dice
    // were rolled server-side on the first confirmation; we don't reroll).
    if (session.firstPlayerState.rolls[playerIndex] !== null) return true;

    session.firstPlayerState.rolls[playerIndex] = rollDice();
    session.awaitingResponse[playerIndex] = false;
    session.lastSentPrompt[playerIndex] = null;

    if (session.firstPlayerState.rolls[0] !== null && session.firstPlayerState.rolls[1] !== null) {
      clearCoordinatorTimers(session);
      resolveDiceRound(session);
    }
    return true;
  }

  if (session.phase === 'CHOOSE_FIRST_PLAYER' && promptType === 'SELECT_FIRST_PLAYER' && session.firstPlayerState) {
    clearCoordinatorTimers(session);
    const goFirst = _data['goFirst'] === true;
    const firstPlayer: 0 | 1 = goFirst ? playerIndex : (playerIndex === 0 ? 1 : 0);
    session.awaitingResponse[playerIndex] = false;
    session.lastSentPrompt[playerIndex] = null;

    broadcastFinalAndBridge(session, firstPlayer);
    return true;
  }

  return false;
}
