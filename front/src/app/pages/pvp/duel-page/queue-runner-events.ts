// =============================================================================
// queue-runner-events.ts — InternalTransportEvent union (α.3, 2026-05-25)
// -----------------------------------------------------------------------------
// Discriminated union describing the **notable lifecycle transitions** of
// the `QueueRunner`. The runner emits these through the optional
// `QueueRunnerDeps.onInternalEvent` callback so an upper layer (today: no
// consumer; α.5: the orchestrator's `eventStream`; β+: projections) can
// observe the runner without reaching into its private flags.
//
// Cf. duel-session-chantier.md §3.3 (transport events on the flux) +
// duel-session-chantier-critiques.md §R2 (verdict: "QueueRunner conservé +
// wrapper léger — +1 callback onInternalEvent").
//
// **Scope** of every event payload: `PERSPECTIVE_LIFETIME`. They describe
// where the runner is in its current cycle; a `requestStop()` (reset)
// erases the relevant history by construction.
//
// **What's NOT in this union** (yet):
//   · `AnimationStarted` / `AnimationCompleted` per business event — those
//     live one layer up (the orchestrator's `handleEntry` knows the YGO
//     message type). The runner is YGO-blind.
//   · `await-signal-installed/resolved` — currently no consumer needs the
//     directive-level trace, the runner's own `RUNNER` log category covers it.
// Adding a member here is cheap; over-populating the union is not.
// =============================================================================

export type InternalTransportEvent =
  /** The runner just flipped `_isRunning` from false → true (fresh cycle). */
  | { kind: 'runner-started'; at: number }
  /** The runner just flipped `_isRunning` from true → false (cycle ended). */
  | { kind: 'runner-stopped'; at: number }
  /**
   * The post-finalize `.finally` block detected a non-empty queue with no
   * legitimate wait and re-entered the loop. `queueLen` is the queue
   * length at rescue time; `noProgressCount` is the number of consecutive
   * rescues that have made no progress (resets to 0 when the queue shrinks).
   */
  | {
      kind: 'rescue-fired';
      queueLen: number;
      noProgressCount: number;
      at: number;
    }
  /**
   * The anti-runaway ceiling was hit (`RESCUE_NO_PROGRESS_CEILING + 1`
   * consecutive no-progress rescues). The runner gives up the rescue and
   * waits for the next user / WS event to re-sync. The `logger.warn` site
   * is unchanged; this event surfaces the same condition structurally.
   */
  | { kind: 'rescue-abandoned'; queueLen: number; at: number }
  /**
   * The POLL-DROP REGRESSION watchdog was just armed because finalize
   * fired during `chainPhase === 'resolving'`. The watchdog fires
   * `POLL_DROP_REGRESSION_WATCHDOG_MS` later if no event-driven re-wake
   * arrives (cf. CLAUDE.md "Polling Removal — Regression Surface").
   */
  | { kind: 'watchdog-armed'; at: number };
