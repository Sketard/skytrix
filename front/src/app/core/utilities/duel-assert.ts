import { isDevMode } from '@angular/core';

/**
 * Unified assertion for dev-critical invariants.
 * Dev mode: throws. Prod: logs a warning (visible in devtools / error reporting).
 */
export function duelAssert(condition: boolean, site: string, msg: string): void {
  if (condition) return;
  const full = `[DUEL-ASSERT] ${site}: ${msg}`;
  if (isDevMode()) throw new Error(full);
  console.error(full);
}
