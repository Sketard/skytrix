// =============================================================================
// game-oracle.ts — GameOracle interface & DuelHandle type
// =============================================================================

import type { Action, DuelConfig, FieldState } from './solver-types.js';

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
  destroyDuel(handle: DuelHandle): void;
  destroyAll(): void;
  readonly snapshotAvailable: boolean;
}
