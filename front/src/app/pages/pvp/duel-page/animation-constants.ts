/** Safety timeout for zone locks — auto-releases if commit/release is never called. */
export const LOCK_SAFETY_TIMEOUT_MS = 5000;

/** Maximum poll iterations when queue empties during chain resolution. */
export const CHAIN_POLL_CEILING = 30;

/** Initial delay (ms) for chain poll back-off. */
export const CHAIN_POLL_BASE_DELAY_MS = 50;

/** Maximum delay (ms) for chain poll exponential back-off. */
export const CHAIN_POLL_MAX_DELAY_MS = 500;

/** Queue collapse fires when queue length exceeds this threshold. */
export const QUEUE_COLLAPSE_THRESHOLD = 5;

/** Number of events kept at the tail after queue collapse. */
export const QUEUE_COLLAPSE_KEEP = 3;

/** Safety timeout (ms) for replayBuffer batch-end resolution. */
export const REPLAY_BUFFER_SAFETY_TIMEOUT_MS = 10_000;

/**
 * Stagger delay (ms) between events inside a `group` queue directive during
 * buffer replay. Small offset gives consecutive ghosts a visible lead-in
 * without serializing the whole group. Single-event groups ignore it.
 */
export const GROUP_STAGGER_MS = 50;

// =============================================================================
// Per-event timing budgets — base values consumed by `ctx.scaledDuration(base, min)`
// in animation-orchestrator handlers. The `_MIN` companion is the minimum the
// scaler may return when speedMultiplier reduces the budget (slow-playback toggle).
// All durations in milliseconds.
// =============================================================================

/** MSG_FLIP_SUMMONING + MSG_CHANGE_POS face-down→face-up zone flip pulse. */
export const POSITION_FLIP_MS = 300;

/** MSG_BECOME_TARGET zone outline pulse (handler returns this directly + uses
 *  it for the unset-targeted-keys timer). Not scaled by `scaledDuration`. */
export const BECOME_TARGET_PULSE_MS = 800;

/** MSG_CHAINING activation glow + post-activation hold. */
export const CHAIN_ACTIVATE_MS = 500;
export const CHAIN_ACTIVATE_MIN_MS = 250;

/** MSG_CHAINING fallback budget when no zone resolves (HAND-only or unknown). */
export const CHAIN_ACTIVATE_FALLBACK_MS = 400;

/** MSG_CHAIN_SOLVING multi-link banner pause budget + return value when
 *  resolution is deferred to let the banner play. */
export const CHAIN_BANNER_PAUSE_MS = 1000;
export const CHAIN_BANNER_DEFERRED_BUDGET_MS = 3000;

/** MSG_CHAIN_END settle budget — short pause before next event. */
export const CHAIN_END_SETTLE_MS = 100;

/** Tail breathing room appended to chain-solving cumulative timing. */
export const CHAIN_SOLVING_TAIL_MS = 300;

/** MSG_TOSS_COIN / MSG_TOSS_DICE toast display + hold budget. */
export const TOSS_TOAST_MS = 1200;

/** MSG_ADD_COUNTER / MSG_REMOVE_COUNTER zone pulse animation. */
export const COUNTER_PULSE_MS = 400;

/** MSG_SHUFFLE_SET_CARD per-card travel duration. */
export const SHUFFLE_SET_CARD_TRAVEL_MS = 400;
export const SHUFFLE_SET_CARD_TRAVEL_MIN_MS = 200;

/** MSG_SWAP travel duration (both directions, parallel). */
export const SWAP_TRAVEL_MS = 400;
export const SWAP_TRAVEL_MIN_MS = 200;

/** MSG_SWAP_GRAVE_DECK glow phase + DECK→GY travel phase. */
export const SWAP_GRAVE_DECK_GLOW_MS = 300;
export const SWAP_GRAVE_DECK_GLOW_MIN_MS = 150;
export const SWAP_GRAVE_DECK_TRAVEL_MS = 400;
export const SWAP_GRAVE_DECK_TRAVEL_MIN_MS = 200;

/** MSG_SHUFFLE_DECK pile-shake CSS animation budget. */
export const SHUFFLE_DECK_MS = 500;
export const SHUFFLE_DECK_MIN_MS = 250;

/** MSG_CHANGE_POS attack→defense Web Animation rotation duration. */
export const POSITION_ROTATE_MS = 300;
export const POSITION_ROTATE_MIN_MS = 150;

/**
 * Chain pulse + chain exit base duration. Both effects share the 600ms
 * envelope — exposed as one constant for `chainPulseDuration()` and
 * `chainExitDuration()` to consume identically. (L11)
 */
export const CHAIN_PULSE_BASE_MS = 600;

/**
 * Timeline-bar safety fallback for transition-end events that may never fire
 * (CSS transition cancelled, user nav, etc.). Hardcoded 300ms in the bar
 * matches the longest CSS transition declared on the bar element. (L18)
 */
export const TIMELINE_BAR_TRANSITION_FALLBACK_MS = 300;
