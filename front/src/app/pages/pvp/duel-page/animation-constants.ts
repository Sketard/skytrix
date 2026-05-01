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
