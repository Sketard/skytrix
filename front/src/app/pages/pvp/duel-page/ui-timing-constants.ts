/**
 * UI-level timing constants — distinct from animation-constants.ts (which
 * gates orchestrator/handler durations through `ctx.scaledDuration`).
 * Values here are NOT speed-scaled — they govern dialog dismiss windows,
 * overlay close transitions, and DOM-level timeouts that match CSS keyframes.
 */

/** RPS result auto-dismiss (winner). */
export const RPS_DISMISS_WINNER_MS = 3000;

/** RPS result auto-dismiss (draw — slightly shorter, no celebration beat). */
export const RPS_DISMISS_DRAW_MS = 2000;

/** Zone-browser overlay slide-out duration before unmount. Matches the
 *  `.zone-browser--closing` CSS transition. */
export const ZONE_BROWSER_CLOSE_MS = 150;

/** Solo mode "switch player" debounce duration. Sized to the board-container
 *  opacity transition (`--transition-fast` 150ms) plus a 50ms margin. Used
 *  by BOTH the component `switching` signal (anti-double-click + opacity
 *  gate) AND the orchestrator `_switching` signal (anti-réentrance
 *  programmatique). Two signals for two distinct rôles, same timing. */
export const SOLO_SWITCH_PLAYER_MS = 200;
