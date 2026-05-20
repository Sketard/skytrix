/** Safety timeout for zone locks — auto-releases if commit/release is never called. */
export const LOCK_SAFETY_TIMEOUT_MS = 5000;

/**
 * POLL-DROP REGRESSION watchdog timeout (ms).
 *
 * Armed by AnimationOrchestratorService when the queue finalizes while
 * `chainPhase === 'resolving'` — the state where the dropped poll
 * back-off mechanism would have engaged. If the chain is still resolving
 * and the queue is still empty after this delay, fires a high-visibility
 * `console.error('[POLL-DROP REGRESSION] ...')` + `duelAssert` in dev.
 *
 * Generous (10s) on purpose: legitimate event-driven re-wakes (WS message
 * arrival, advanceStep, chainOverlayReady signal) all complete in <2s in
 * normal play. A 10s stall is unambiguously pathological.
 *
 * See CLAUDE.md "Polling Removal — Regression Surface".
 */
export const POLL_DROP_REGRESSION_WATCHDOG_MS = 10_000;

/**
 * Ceiling for consecutive no-progress rescues in `processAnimationQueue`'s
 * finally block. The rescue re-launches the queue when the inner loop exits
 * with entries still queued; if a seek/abort race leaves undispatchable
 * entries, the rescue would loop forever ("infinite rescue" on sub-event
 * click during playback). Past this many rescues WITHOUT the queue
 * shrinking, the rescue bails. Small (3) — a healthy rescue drains at
 * least one entry per pass, so >3 stalls is unambiguously a runaway.
 */
export const RESCUE_NO_PROGRESS_CEILING = 3;

/** Queue collapse fires when queue length exceeds this threshold. */
export const QUEUE_COLLAPSE_THRESHOLD = 5;

/** Number of events kept at the tail after queue collapse. */
export const QUEUE_COLLAPSE_KEEP = 3;

/** Safety timeout (ms) for replayBuffer batch-end resolution. */
export const REPLAY_BUFFER_SAFETY_TIMEOUT_MS = 10_000;

/** Beat between board activation (`setBoardActive(true)` after the dice arena
 *  dismisses) and the drain of pre-activation buffered events. Lets the eye
 *  find the freshly revealed board zones before the first card animation —
 *  without this beat the initial 5-card MSG_DRAW fires the same frame the
 *  arena fades, so the cards appear to be in hand "instantly". 500ms matches
 *  the TCG-digital convention (Master Duel, Duel Links). Scaled by
 *  `ctx.scaledDuration` so slow-playback proportionally stretches the beat. */
export const BOARD_BREATHE_MS = 500;
export const BOARD_BREATHE_MIN_MS = 200;

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

/** Vertical cascade offset (px) between stacked target floats above a pile.
 *  Tight stack — only a sliver of the card beneath shows, so the cascade
 *  reads as a single grouped indicator rather than spread fan. */
export const TARGET_PILE_FLOAT_CASCADE_Y_PX = 14;

/** Horizontal cascade offset (px) between stacked target floats above a pile. */
export const TARGET_PILE_FLOAT_CASCADE_X_PX = 4;

/** Stagger delay (ms) between consecutive target floats in a cascade. Sized
 *  so the user sees a full narrative beat per card: float appears + reticle
 *  pulses in (~600ms appear anim) + brief settle, THEN the next card arrives
 *  and demotes the previous reticle. */
export const TARGET_PILE_FLOAT_STAGGER_MS = 700;

/** Entry transition duration (ms) for a target pile float — opacity 0→1 +
 *  scale/translateY ease-in. Applied as inline `transition: ...` on creation. */
export const TARGET_PILE_FLOAT_ENTER_MS = 250;

/** Fade-out duration (ms) when target pile floats are cleaned up. */
export const TARGET_PILE_FLOAT_FADE_OUT_MS = 150;

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

/** MSG_EQUIP target line draw + fade animation total budget. Drawn at 40% of
 *  the budget, fades out at 30%. */
export const EQUIP_LINE_MS = 500;
export const EQUIP_LINE_MIN_MS = 250;

/** Initial-draw pairing poll: how long to wait for the second player's draw
 *  before falling back to single-player draw. ATTEMPTS × POLL_MS = ~200ms. */
export const INITIAL_DRAW_PAIRING_ATTEMPTS = 5;
export const INITIAL_DRAW_PAIRING_POLL_MS = 40;

// =============================================================================
// CardTravelEngine timing ratios — fractions of the travel `duration` that
// govern when secondary effects fire relative to the main A→B keyframes.
// =============================================================================

/** Fraction of travel duration at which the mid-travel face flip swaps the
 *  image src — anchored on the 90° edge-on point of the keyframe rotation. */
export const TRAVEL_FLIP_MIDPOINT_FRACTION = 0.45;

/** Fraction of travel duration the departure glow stays visible on the
 *  source element (lead-in). */
export const TRAVEL_DEPARTURE_GLOW_FRACTION = 0.15;

/** Fraction of travel duration at which the impact drop-shadow turns on. */
export const TRAVEL_IMPACT_GLOW_ON_FRACTION = 0.75;

/** Fraction of travel duration the impact drop-shadow stays on before clearing. */
export const TRAVEL_IMPACT_GLOW_HOLD_FRACTION = 0.25;

/** Fraction of travel duration at which soft/banish landings trigger the
 *  zoneImpactEffect (radial glow + dark sink). */
export const TRAVEL_LANDING_IMPACT_FRACTION = 0.70;
