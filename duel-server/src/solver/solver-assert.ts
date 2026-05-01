// =============================================================================
// solver-assert.ts — Lightweight invariant checker for solver code paths.
// Mirrors the `duelAssert` pattern from the frontend: throws in dev mode
// (NODE_ENV !== 'production'), console.errors in prod. Never silent.
//
// Use for invariants that MUST hold if the code is correct but are expensive
// or impossible to enforce via TypeScript types (e.g., "this child node has
// been visited at least once", "this mainPath contains only player actions").
// Fires produce structured logs with the call site tag for grep-ability.
// =============================================================================

const IS_DEV = process.env['NODE_ENV'] !== 'production';

/** Assert a solver invariant. Throws in dev, logs in prod. Never silent.
 *
 *  @param condition the invariant that must be truthy
 *  @param site short call-site tag for log grep (e.g. 'MCTSSolver.select')
 *  @param msg human-readable explanation of what was expected
 *  @param context optional structured data dumped with the failure */
export function solverAssert(
  condition: boolean,
  site: string,
  msg: string,
  context?: Record<string, unknown>,
): void {
  if (condition) return;
  const payload = { site, msg, ...(context ? { context } : {}) };
  if (IS_DEV) {
    console.error('[Solver] INVARIANT FAILED', payload);
    throw new Error(`[Solver] ${site}: ${msg}`);
  } else {
    console.error('[Solver] INVARIANT FAILED', payload);
  }
}
