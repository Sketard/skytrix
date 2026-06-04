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

/**
 * Timeout (ms) past which an open `DeferredEffect` is closed with
 * `EffectAbandoned(reason='timeout')`. Generous (5s) and fixed at
 * β.2a — pre-measurement; β.2b will revisit (DP-3) if T-I2 or e2e
 * SOLO slow-playback shows clipping. NOT scaled by `speedMultiplier`
 * today: the deferred lifecycle is logical (a chain cost can be slow
 * to animate, but it still resolves), and a speed-scaled timeout
 * would hide an actually stuck rule under slow playback. Cf.
 * `_bmad-output/planning-artifacts/beta-2-deferred-effect-processor-spec.md §2.3`.
 */
export const DEFERRED_TIMEOUT_MS = 5_000;

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

// --- Field-confirm reveal (MSG_CONFIRM_CARDS for a card Set face-down on the
//     field from the deck — public info, shown briefly to both players) ---
/** Each rotateY flip (face-down→up, then up→down) of the reveal overlay. */
export const FIELD_REVEAL_FLIP_MS = 320;
export const FIELD_REVEAL_FLIP_MIN_MS = 160;
/** Rise/settle of the reveal overlay above the board zone. */
export const FIELD_REVEAL_LIFT_MS = 220;
export const FIELD_REVEAL_LIFT_MIN_MS = 110;
/** One glow pulse — two are played back-to-back while the card is face-up. */
export const FIELD_REVEAL_GLOW_MS = 360;
export const FIELD_REVEAL_GLOW_MIN_MS = 180;
/** Hold on the fully-revealed face-up card before flipping back down. */
export const FIELD_REVEAL_HOLD_MS = 260;
export const FIELD_REVEAL_HOLD_MIN_MS = 130;

// --- Pile-confirm reveal (MSG_CONFIRM_CARDS for a card revealed from a pile
//     zone — deck top, GY or Banished — to prove a cost / condition). Pile
//     zones render only their top card, so a card-shaped overlay lifts out of
//     the pile, shows the face, then fades. Shared by `confirmCardsOnDeck`
//     and `confirmCardsOnPile`. ---
/** Rise of the reveal overlay out of the pile. */
export const PILE_REVEAL_LIFT_MS = 250;
export const PILE_REVEAL_LIFT_MIN_MS = 125;
/** Hold on the lifted, face-up card before it fades. */
export const PILE_REVEAL_HOLD_MS = 800;
export const PILE_REVEAL_HOLD_MIN_MS = 400;
/** Fade-out of the overlay back into the pile. */
export const PILE_REVEAL_FADE_MS = 200;
export const PILE_REVEAL_FADE_MIN_MS = 100;
/** Highlight glow applied to the lifted card while it is readable. */
export const PILE_REVEAL_HIGHLIGHT_MS = 600;
export const PILE_REVEAL_HIGHLIGHT_MIN_MS = 300;
/** Vertical lift distance (px). The sign is applied per side at the call
 *  site — own piles sit at the bottom (lift up = negative), opponent piles
 *  at the top (lift down = positive). */
export const PILE_REVEAL_LIFT_OFFSET_PX = 60;

// --- Opponent hand-card reveal (MSG_CHAINING for a card the opponent
//     activates from their hand) — the card flips face-up while easing out
//     of the fan so the viewer can read it, then eases back (staying
//     face-up). The activation flash plays while it is detached + readable.
/** Flip face-up + detach-from-fan ease-out, and the ease-back. */
export const HAND_REVEAL_DETACH_MS = 280;
export const HAND_REVEAL_DETACH_MIN_MS = 140;

// --- Hand-confirm reveal (MSG_CONFIRM_CARDS for a card confirmed in hand —
//     opponent-perspective floats flip face-up so the viewer can read them). ---
/** rotateY flip of an opponent-perspective hand float to its face. */
export const HAND_CONFIRM_FLIP_MS = 300;
export const HAND_CONFIRM_FLIP_MIN_MS = 150;
/** Hold on the revealed hand float before it returns to the fan. */
export const HAND_CONFIRM_HOLD_MS = 200;
export const HAND_CONFIRM_HOLD_MIN_MS = 100;

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

/** Chain overlay "breathing room" — extra hold after an entry / pulse anim
 *  so the user has time to perceive the card before the next link pushes
 *  it (building) or before the prompt opens (animate → decide replay edge).
 *  Inserted between the visual end of the per-card animation and the
 *  clearing of the index that gates `overlayActive`. Cf. chat
 *  2026-06-03 "breathing room après animations card". */
export const OVERLAY_ANIM_HOLD_MS = 400;
export const OVERLAY_ANIM_HOLD_MIN_MS = 200;

// --- Opponent effect bubble (Surface 2 — `<app-effect-bubble>`) ---------------
/** How long the effect bubble holds a content before fading out (Lot 3b). */
export const EFFECT_BUBBLE_MS = 3500;
export const EFFECT_BUBBLE_MIN_MS = 1750;
/** Enter (fade+slide) / exit (fade) transition of the effect bubble. Kept in
 *  lockstep with the SCSS `--transition-normal` token (250ms) the bubble's
 *  CSS transition uses — the JS fade timer must not tear the overlay down
 *  before the CSS exit transition completes. */
export const EFFECT_BUBBLE_FADE_MS = 250;
export const EFFECT_BUBBLE_FADE_MIN_MS = 125;
/** Anti-flicker floor: minimum time a bubble content stays visible before a
 *  newer activation may replace it — coalesces a rapid chain burst into
 *  "first link briefly → last link" instead of a 3-frame strobe (Lot 3b). */
export const EFFECT_BUBBLE_MIN_VISIBLE_MS = 700;

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
