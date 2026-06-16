import type { ActiveDuelSession } from './types.js';

/**
 * Defense-in-depth sweep of sessions that ended but were never cleaned up.
 *
 * The NOMINAL teardown is fully covered already : every path that sets
 * `endedAt` either drops the session immediately (`cleanupDuelSession`) or
 * arms the shared `rematchTimeout` slot (`handleDuelEnd` → `onRematchExpired`
 * for PvP, `onForkSessionExpired` for fork) which fires `cleanupDuelSession`
 * after `REMATCH_EXPIRY_MS`. There is no known path that leaks an ended
 * session today.
 *
 * This sweeper is a STRUCTURAL backstop, not the mechanism : it catches an
 * ended session whose nominal timer was cleared-but-never-rearmed by some
 * future race or refactor (the kind of bug `handleDuelEnd`'s "callers MUST
 * guard" comment warns about). `MAX_ENDED_SESSION_AGE_MS` is set FAR above
 * `REMATCH_EXPIRY_MS` so this can never preempt the legitimate rematch grace
 * window — if it ever fires, it means the nominal path failed, which is
 * worth the `logger.warn` it emits.
 *
 * Pure decision split from the I/O : `selectExpiredEndedSessions` decides
 * WHICH sessions are stale (testable without a clock or the manager) ;
 * `server.ts` owns the interval + the `cleanupDuelSession` call (which
 * touches WS / worker / timers).
 */

/** REMATCH_EXPIRY_MS × 4, floored at 10min. Backstop margin — see module doc. */
export function maxEndedSessionAgeMs(rematchExpiryMs: number): number {
  return Math.max(rematchExpiryMs * 4, 10 * 60 * 1000);
}

/**
 * Returns the subset of `sessions` that ended longer than `maxAgeMs` ago.
 * A session qualifies iff `endedAt !== null && now - endedAt > maxAgeMs`.
 * Sessions still live (`endedAt === null`) are never selected.
 */
export function selectExpiredEndedSessions(
  sessions: readonly ActiveDuelSession[],
  now: number,
  maxAgeMs: number,
): ActiveDuelSession[] {
  return sessions.filter(
    (s) => s.endedAt !== null && now - s.endedAt > maxAgeMs,
  );
}
