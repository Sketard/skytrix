// =============================================================================
// game-oracle.ts — GameOracle interface & DuelHandle type
// =============================================================================

import type { ActivationLog, Action, DuelConfig, FieldState } from './solver-types.js';

// =============================================================================
// DuelHandle — Opaque identifier with action history for replay fallback
// =============================================================================

export interface DuelHandle {
  readonly id: number;
  readonly actionHistory: readonly Action[];
  readonly isActive: boolean;
}

// =============================================================================
// GameOracle — Abstraction over OCGCore for solver strategies
// =============================================================================

export interface GameOracle {
  createDuel(config: DuelConfig): DuelHandle;
  getLegalActions(handle: DuelHandle): Action[];
  applyAction(handle: DuelHandle, action: Action): void;
  fork(handle: DuelHandle): DuelHandle;
  getFieldState(handle: DuelHandle): FieldState;
  /** Returns the per-handle activation log accumulated during the current
   *  turn (cleared on NEW_TURN). Used by the scorer for OPT-aware evaluation
   *  and by the transposition table for verification key fingerprinting.
   *  Returns a defensive ReadonlyMap view — consumers must not mutate. */
  getActivationLog(handle: DuelHandle): ActivationLog;
  destroyDuel(handle: DuelHandle): void;
  destroyAll(): void;
  readonly snapshotAvailable: boolean;
}
