/**
 * Payload passed to {@link BaseProjection.applyReset} when the reset is
 * triggered by a §3.6 checkpoint event (`STATE_SYNC`, `RematchStarted`).
 *
 * For non-checkpoint resets (`PerspectiveSwitched`, `ServerKicked`, …),
 * the payload is `undefined` and the projection re-initialises from its
 * declared initial state. Cf.
 * `_bmad-output/planning-artifacts/duel-session-chantier.md §3.5 + §3.6`.
 *
 * The concrete shape of {@link CheckpointPayload.body} is intentionally
 * left as an opaque `unknown` at the α.2 stage: each projection knows
 * which slice of the payload it cares about and narrows on its own.
 * The body's full schema will be pinned when the first consumer
 * (β.3 — projections consuming `STATE_SYNC`) lands.
 */
export interface CheckpointPayload {
  readonly source: 'STATE_SYNC' | 'RematchStarted';
  readonly body: unknown;
}
