/**
 * Scope categories declared by every {@link BaseProjection} subclass.
 *
 * Cf. `_bmad-output/planning-artifacts/duel-session-chantier.md §3.5`.
 *
 * Order matters: the array literal below is the **hierarchy from most
 * durable to most volatile**. A reset event that invalidates a scope
 * implicitly invalidates every scope below it (see
 * {@link expandInvalidatedScopes}).
 */
export const SCOPE_HIERARCHY = [
  'SESSION_LIFETIME',
  'DUEL_LIFETIME',
  'CONNECTION_LIFETIME',
  'PERSPECTIVE_LIFETIME',
] as const;

export type ScopeCategory = (typeof SCOPE_HIERARCHY)[number];

/**
 * Expand a set of scopes to include every scope strictly below the
 * deepest entry in the {@link SCOPE_HIERARCHY}. Used by
 * {@link ScopeResetDispatcher} so callers can pass only the
 * top-most invalidated scope (the natural way to express a reset event:
 * `RematchStarted` invalidates `DUEL_LIFETIME` — and consequently
 * `CONNECTION_LIFETIME` + `PERSPECTIVE_LIFETIME` by inclusion).
 *
 * Returns a fresh set; the input is not mutated.
 */
export function expandInvalidatedScopes(
  scopes: ReadonlySet<ScopeCategory>,
): Set<ScopeCategory> {
  if (scopes.size === 0) return new Set();
  let deepestIndex = -1;
  for (const s of scopes) {
    const idx = SCOPE_HIERARCHY.indexOf(s);
    if (idx > deepestIndex) deepestIndex = idx;
  }
  const expanded = new Set<ScopeCategory>(scopes);
  for (let i = deepestIndex + 1; i < SCOPE_HIERARCHY.length; i++) {
    expanded.add(SCOPE_HIERARCHY[i]);
  }
  return expanded;
}
