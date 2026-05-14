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
 * State machine entry points (named steps, in firing order):
 *   1. startFirstPlayerPhase       — DICE_ROLL prompts.
 *   2. resolveDiceRound            — emit DICE_RESULT, route tie | winner.
 *   3. scheduleTieReroll           — tie path → re-enter step 1 after pause.
 *   4. promoteToChooseFirstPlayer  — winner path → SELECT_FIRST_PLAYER prompt.
 *   5. scheduleFirstPlayerTimeout  — auto-resolve if winner stays silent.
 *   6. broadcastFinalAndBridge     — FIRST_PLAYER_RESULT + bridge to duel.
 *
 * Phase guards inside each scheduled callback are kept as a belt-and-braces
 * safety net (the timer queue is unconditionally drained, but a callback
 * already in the JS task queue can still fire once after `clearTimeout` —
 * the guard short-circuits it).
 */

// All durations are exported so the spec can reference them by name instead
// of hard-coding the same magic numbers in two places — a tweak silently
// breaks the test if the spec lags behind.
export const MAX_ROUNDS = 10;
export const DICE_TIE_REROLL_MS = 1_800;
export const DICE_SUSPENSE_MS = 1_500;
export const FINAL_BANNER_MS = 2_500;

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

interface ChooseFirstPlayerData {
  goFirst?: boolean;
}

const configurable = createConfigurable<FirstPlayerCoordinatorConfig>('first-player-coordinator');
export const configureFirstPlayerCoordinator = configurable.configure;
export const isFirstPlayerCoordinatorConfigured = configurable.isConfigured;
const getCfg = configurable.get;

/** Rolls one 2D6 result. Each die is uniform [1..6]. */
function rollDice(): DiceRoll {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

function pushTimer(session: ActiveDuelSession, t: ReturnType<typeof setTimeout>): void {
  session.firstPlayerState?.timers.push(t);
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
  session.chosenFirstPlayer = null;
}

// ───── Step 1: enter ROLLING_DICE, prompt both players ──────────────────────
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

  pushTimer(session, setTimeout(() => autoFillStalledRolls(session), cfg.diceRollTimeoutMs));
}

function autoFillStalledRolls(session: ActiveDuelSession): void {
  if (session.phase !== 'ROLLING_DICE' || !session.firstPlayerState) return;
  for (const p of [0, 1] as const) {
    if (session.firstPlayerState.rolls[p] === null) {
      session.firstPlayerState.rolls[p] = rollDice();
      session.awaitingResponse[p] = false;
    }
  }
  resolveDiceRound(session);
}

// ───── Step 2: resolve the round, route to tie or winner branch ─────────────
function resolveDiceRound(session: ActiveDuelSession): void {
  if (!session.firstPlayerState) return;
  const [r0, r1] = session.firstPlayerState.rolls;
  if (r0 === null || r1 === null) return;
  const round = session.firstPlayerState.round;

  const sum0 = diceSum(r0);
  const sum1 = diceSum(r1);
  const winner = decideWinner(sum0, sum1, round);

  broadcastDiceResult(session, r0, r1, sum0, sum1, winner);

  if (winner === null) {
    scheduleTieReroll(session, round);
    return;
  }
  scheduleChooseFirstPlayerPromotion(session, winner);
}

function decideWinner(sum0: number, sum1: number, round: number): Player | null {
  if (sum0 !== sum1) return sum0 > sum1 ? 0 : 1;
  // Hard cap on consecutive ties — else bad-faith players could draw the
  // duel indefinitely. Force a random winner at the ceiling.
  if (round + 1 >= MAX_ROUNDS) return Math.random() < 0.5 ? 0 : 1;
  return null;
}

function broadcastDiceResult(
  session: ActiveDuelSession,
  r0: DiceRoll, r1: DiceRoll,
  sum0: number, sum1: number,
  winner: Player | null,
): void {
  const cfg = getCfg();
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
}

// ───── Step 3: tie path — reroll after a pause ──────────────────────────────
function scheduleTieReroll(session: ActiveDuelSession, round: number): void {
  pushTimer(session, setTimeout(() => {
    if (session.phase !== 'ROLLING_DICE') return;
    startFirstPlayerPhase(session, round + 1);
  }, DICE_TIE_REROLL_MS));
}

// ───── Step 4: winner path — promote to CHOOSE_FIRST_PLAYER after suspense ─
function scheduleChooseFirstPlayerPromotion(session: ActiveDuelSession, winner: 0 | 1): void {
  session.phase = 'DICE_RESOLVED';
  pushTimer(session, setTimeout(() => promoteToChooseFirstPlayer(session, winner), DICE_SUSPENSE_MS));
}

function promoteToChooseFirstPlayer(session: ActiveDuelSession, winner: 0 | 1): void {
  if (session.phase !== 'DICE_RESOLVED') return;
  const cfg = getCfg();
  session.phase = 'CHOOSE_FIRST_PLAYER';
  session.awaitingResponse = [false, false];
  session.awaitingResponse[winner] = true;
  const prompt: ServerMessage = { type: 'SELECT_FIRST_PLAYER', player: winner };
  session.lastSentPrompt = [null, null];
  session.lastSentPrompt[winner] = prompt;
  cfg.sendToPlayer(session, winner, prompt);
  cfg.sendToPlayer(session, winner === 0 ? 1 : 0, { type: 'WAITING_RESPONSE' });
  scheduleFirstPlayerTimeout(session, winner);
}

// ───── Step 5: auto-resolve if winner stays silent ──────────────────────────
function scheduleFirstPlayerTimeout(session: ActiveDuelSession, winner: 0 | 1): void {
  const cfg = getCfg();
  pushTimer(session, setTimeout(() => {
    if (session.phase !== 'CHOOSE_FIRST_PLAYER') return;
    // Sensible default — the loser doesn't get to pick if the winner ghosts.
    broadcastFinalAndBridge(session, winner);
  }, cfg.firstPlayerTimeoutMs));
}

// ───── Step 6: final banner + bridge to OCGCore duel ────────────────────────
function broadcastFinalAndBridge(session: ActiveDuelSession, firstPlayer: 0 | 1): void {
  const cfg = getCfg();
  // Phase 3.16 warmup: ship each side's own cardCodes RIGHT BEFORE the
  // FIRST_PLAYER_RESULT banner so the front-end has the full
  // FINAL_BANNER_MS (2.5s) to prime the image cache before DUEL_STARTING
  // bridges into the board. No info leak — each side gets only its deck.
  // (Regression note: silently dropped during the 2026-05-13 audit
  // "dead-code purge" — restore mandatory or hand cards render blank.)
  cfg.sendToPlayer(session, 0, { type: 'DECK_PREFETCH', cardCodes: extractCardCodesForPlayer(session.decks, 0) });
  cfg.sendToPlayer(session, 1, { type: 'DECK_PREFETCH', cardCodes: extractCardCodesForPlayer(session.decks, 1) });
  cfg.sendToPlayer(session, 0, { type: 'FIRST_PLAYER_RESULT', goFirst: firstPlayer === 0 });
  cfg.sendToPlayer(session, 1, { type: 'FIRST_PLAYER_RESULT', goFirst: firstPlayer === 1 });
  session.phase = 'FIRST_PLAYER_RESOLVED';
  session.chosenFirstPlayer = firstPlayer;
  pushTimer(session, setTimeout(() => {
    if (session.phase !== 'FIRST_PLAYER_RESOLVED') return;
    cfg.startDuelWithOrder(session, firstPlayer);
  }, FINAL_BANNER_MS));
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
  data: Record<string, unknown>,
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
    const goFirst = (data as ChooseFirstPlayerData).goFirst === true;
    const firstPlayer: 0 | 1 = goFirst ? playerIndex : (playerIndex === 0 ? 1 : 0);
    session.awaitingResponse[playerIndex] = false;
    session.lastSentPrompt[playerIndex] = null;

    broadcastFinalAndBridge(session, firstPlayer);
    return true;
  }

  return false;
}
