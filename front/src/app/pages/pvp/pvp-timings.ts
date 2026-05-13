/**
 * Cross-component PvP UX timings (lobby, deck picker, dice arena, etc.).
 * Magic numbers grouped here so a tweak to "how long is the announce banner"
 * happens in one place and the server/client cadences stay aligned.
 *
 * For per-event animation budgets (orchestrator handlers), see
 * `duel-page/animation-constants.ts`.
 */

// ─── Lobby (room list) ─────────────────────────────────────────────────────

/** Flash duration for `.room-card--new` after an SSE `created` diff. */
export const NEW_ROOM_FLASH_MS = 700;

/** Polling fallback interval when the SSE lobby stream errors permanently. */
export const POLL_FALLBACK_INTERVAL_MS = 10_000;

// ─── Deck picker dialog ────────────────────────────────────────────────────

/** Min display time of the error banner before user can retry the fetch. */
export const DECK_FETCH_ERROR_TIMEOUT_MS = 5_000;

// ─── Dice arena (pre-duel, post-handshake) ─────────────────────────────────
//
// Server-authoritative timings live in `duel-server/src/first-player-coordinator.ts`
// (DICE_TIE_REROLL_MS=1800, DICE_SUSPENSE_MS=1500, FINAL_BANNER_MS=2500).
// The client mirrors them so the UI stays in lockstep with the server's
// state machine — if you tune one side, tune both.

/** Delay before auto-rolling once Stage 1 (`ready`) is entered. UX beat
 *  so users see the prompt instead of an instant snap to `rolling`. */
export const DICE_AUTO_ROLL_DELAY_MS = 600;

/** Dice tumble + fall animation duration. Mirror of the server's
 *  `DICE_TIE_REROLL_MS` so the visual lands in sync with the next
 *  prompt (or the SELECT_FIRST_PLAYER prompt on a winner). */
export const DICE_ROLL_ANIM_DURATION_MS = 1_800;

/** "You go first / second" announce banner duration. Mirror of the
 *  server's `FINAL_BANNER_MS`. */
export const DICE_FINAL_ANNOUNCE_MS = 2_500;
