import { describe, it, expect } from 'vitest';
import { maxEndedSessionAgeMs, selectExpiredEndedSessions } from './ended-session-sweeper.js';
import type { ActiveDuelSession } from './types.js';

/** Minimal session stub — the sweeper only reads `endedAt` (+ id for logs). */
function session(endedAt: number | null, duelId = 'd'): ActiveDuelSession {
  return { duelId, endedAt } as ActiveDuelSession;
}

describe('maxEndedSessionAgeMs', () => {
  it('is rematchExpiryMs × 4 when that exceeds the 10min floor', () => {
    // 5min × 4 = 20min > 10min floor
    expect(maxEndedSessionAgeMs(5 * 60 * 1000)).toBe(20 * 60 * 1000);
  });

  it('floors at 10min when rematchExpiryMs × 4 is below the floor', () => {
    // 1min × 4 = 4min < 10min floor
    expect(maxEndedSessionAgeMs(60 * 1000)).toBe(10 * 60 * 1000);
  });
});

describe('selectExpiredEndedSessions', () => {
  const MAX = 20 * 60 * 1000; // 20min
  const NOW = 1_000_000_000;

  it('never selects a live session (endedAt null), regardless of age', () => {
    const live = session(null);
    expect(selectExpiredEndedSessions([live], NOW, MAX)).toEqual([]);
  });

  it('does not select an ended session younger than the max age', () => {
    const fresh = session(NOW - (MAX - 1)); // 1ms shy of the threshold
    expect(selectExpiredEndedSessions([fresh], NOW, MAX)).toEqual([]);
  });

  it('does not select an ended session exactly at the max age (strict >)', () => {
    const edge = session(NOW - MAX);
    expect(selectExpiredEndedSessions([edge], NOW, MAX)).toEqual([]);
  });

  it('selects an ended session older than the max age', () => {
    const stale = session(NOW - (MAX + 1), 'stale');
    const result = selectExpiredEndedSessions([stale], NOW, MAX);
    expect(result.map((s) => s.duelId)).toEqual(['stale']);
  });

  it('filters a mixed batch to only the stale ended sessions', () => {
    const live = session(null, 'live');
    const fresh = session(NOW - 1000, 'fresh');
    const stale1 = session(NOW - (MAX + 5000), 'stale1');
    const stale2 = session(NOW - (MAX + 999999), 'stale2');
    const result = selectExpiredEndedSessions([live, fresh, stale1, stale2], NOW, MAX);
    expect(result.map((s) => s.duelId).sort()).toEqual(['stale1', 'stale2']);
  });
});
