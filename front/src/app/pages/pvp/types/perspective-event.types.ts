/**
 * γ commit 5 (2026-05-26) — `PerspectiveSwitched` event emitted on the
 * EventStream when `SoloDuelOrchestratorService.switchPerspective()`
 * flips `DuelContext.perspective()`. Cf. `phase-gamma-spec.md §4`.
 *
 * Purpose : materialise the perspective flip as an event the
 * `ScopeResetDispatcher` can observe, so the
 * `applyReset({PERSPECTIVE_LIFETIME})` cascade lands at a deterministic
 * point in the stream (between the last pre-switch event and the next
 * post-switch event). The visual projection (`rotate(180deg)` on
 * `.board-host`) is driven by the signal, NOT this event — the event
 * only controls the reset cascade.
 *
 * Scope of the reset triggered : strictly `PERSPECTIVE_LIFETIME`. The
 * chain machine, the locks, the LP tracker, the deferred effects, the
 * boundary processor — all CONNECTION_LIFETIME or DUEL_LIFETIME — survive
 * the switch. That's the structural invariant that eliminates the
 * `bug-solo-sequence.md` bug.
 *
 * Discriminator : `kind: 'perspective'`. The widened `StreamEvent`
 * union routes it past MSG_* consumers and past
 * `InternalTransportEvent` consumers (which are QueueRunner-specific,
 * not generic transport).
 *
 * Replay : NOT emitted. `ReplayPageComponent` has its own
 * `perspectiveIndex()` signal that pilots a separate visual flip ;
 * unifying the two is δ.
 */

export interface PerspectiveSwitchedEvent {
  kind: 'perspective';
  type: 'PerspectiveSwitched';
  from: 0 | 1;
  /** Always different from `from`. */
  to: 0 | 1;
}

export type PerspectiveEvent = PerspectiveSwitchedEvent;

/** Type guard for stream consumers. */
export function isPerspectiveEvent(e: unknown): e is PerspectiveEvent {
  return typeof e === 'object' && e !== null
    && (e as { kind?: unknown }).kind === 'perspective';
}
