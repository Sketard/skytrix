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
 * **highest (most durable)** entry in the {@link SCOPE_HIERARCHY}.
 * Used by {@link ScopeResetDispatcher} so callers can express a reset
 * event by naming its top-most scope (the natural form: `RematchStarted`
 * invalidates `DUEL_LIFETIME` — and consequently every scope below it
 * by inclusion).
 *
 * Hardening (code-review #2 finding P9, 2026-05-26): a non-contiguous
 * input like `{SESSION_LIFETIME, CONNECTION_LIFETIME}` now expands to
 * `{SESSION, DUEL, CONNECTION, PERSPECTIVE}` — the missing `DUEL` is
 * filled in. Previous algorithm anchored on the deepest scope only,
 * which silently dropped any gap between the deepest entry and the
 * shallowest. Today's callers pass single-element sets so the change
 * is observation-equivalent for production; the new contract becomes
 * load-bearing when β.3 checkpoint payloads bundle multiple boundary
 * scopes.
 *
 * Returns a fresh set; the input is not mutated.
 */
export function expandInvalidatedScopes(
  scopes: ReadonlySet<ScopeCategory>,
): Set<ScopeCategory> {
  if (scopes.size === 0) return new Set();
  let shallowestIndex: number = SCOPE_HIERARCHY.length;
  for (const s of scopes) {
    const idx = SCOPE_HIERARCHY.indexOf(s);
    if (idx >= 0 && idx < shallowestIndex) shallowestIndex = idx;
  }
  const expanded = new Set<ScopeCategory>(scopes);
  for (let i = shallowestIndex + 1; i < SCOPE_HIERARCHY.length; i++) {
    expanded.add(SCOPE_HIERARCHY[i]);
  }
  return expanded;
}
