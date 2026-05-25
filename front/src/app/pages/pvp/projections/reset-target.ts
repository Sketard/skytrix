import type { CheckpointPayload } from './checkpoint-payload';
import type { ScopeCategory } from './scope';

/**
 * The minimal contract every flux-state holder (manager, projection,
 * processor) MUST implement to participate in the
 * {@link ScopeResetDispatcher} fan-out.
 *
 * Cf. `_bmad-output/planning-artifacts/duel-session-chantier.md §3.5`.
 *
 * Two members only:
 *  - `scope` — declares which scope category this target lives in
 *    (`SESSION_LIFETIME` | `DUEL_LIFETIME` | `CONNECTION_LIFETIME` |
 *    `PERSPECTIVE_LIFETIME`).
 *  - `applyReset(scopes, payload?)` — invoked by the dispatcher when one
 *    of the target's scopes is invalidated. `scopes` is the **expanded**
 *    set (cascades already applied) so the target can use a `has()`
 *    check to decide which slice of its state to clear.
 *
 * **Why split from {@link BaseProjection}?** A {@link BaseProjection}
 * promises three things: `scope`, `value: Signal<T>`, and `applyEvent`.
 * That contract fits a **deterministic read-only view of the flux** —
 * the future ~10 projections enumerated in §3.9 (overlayVisible,
 * targetedZoneKeys, etc.) which will land in β.3.
 *
 * The existing managers (`ChainResolutionManager`, `LpAnimationTracker`,
 * `BattleAnimationTracker`, `DuelGameLogService`) are not yet
 * projections at that purity — they mix YGO business behaviour
 * (processLpEvent, processAttackEvent, etc.), transport state (timers,
 * buffers), and exposed signals in the same class. They need the reset
 * machinery now (cf. §3.5 — bug SOLO mid-chain) without committing to
 * the full projection contract. `ResetTarget` is the slimmest interface
 * that lets them participate in the dispatcher.
 *
 * Conversion plan (cf. duel-session-chantier-implementation-plan.md):
 *  - α.4 (this PR onwards) — managers implement `ResetTarget`.
 *  - β.3 (later) — the read-only signals get extracted as proper
 *    `BaseProjection<T>` subclasses, separate from the manager that
 *    writes them.
 */
export interface ResetTarget {
  readonly scope: ScopeCategory;
  applyReset(
    invalidatedScopes: ReadonlySet<ScopeCategory>,
    checkpointPayload?: CheckpointPayload,
  ): void;
}
