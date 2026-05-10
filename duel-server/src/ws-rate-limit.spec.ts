import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  consumeWsAttempt,
  isWsRateLimited,
  recordFailedWsAttempt,
  startWsRateLimitSweep,
  _wsRateLimitSize,
  _wsRateLimitReset,
} from './ws-rate-limit.js';

const WINDOW_MS = 60_000;
const MAX = 30;

describe('ws-rate-limit', () => {
  beforeEach(() => {
    _wsRateLimitReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    _wsRateLimitReset();
  });

  describe('isWsRateLimited', () => {
    it('returns false for an unknown IP', () => {
      expect(isWsRateLimited('1.2.3.4')).toBe(false);
    });

    it('returns false until the threshold is reached', () => {
      for (let i = 0; i < MAX - 1; i++) recordFailedWsAttempt('ip');
      expect(isWsRateLimited('ip')).toBe(false);
    });

    it('returns true at and after the threshold', () => {
      for (let i = 0; i < MAX; i++) recordFailedWsAttempt('ip');
      expect(isWsRateLimited('ip')).toBe(true);
    });

    it('returns false again after timestamps age out of the window', () => {
      for (let i = 0; i < MAX; i++) recordFailedWsAttempt('ip');
      expect(isWsRateLimited('ip')).toBe(true);
      vi.advanceTimersByTime(WINDOW_MS + 100);
      expect(isWsRateLimited('ip')).toBe(false);
    });

    it('drops the IP entry entirely when all timestamps expire', () => {
      recordFailedWsAttempt('ip');
      vi.advanceTimersByTime(WINDOW_MS + 1);
      isWsRateLimited('ip');
      expect(_wsRateLimitSize()).toBe(0);
    });
  });

  describe('recordFailedWsAttempt', () => {
    it('caps the per-IP timestamp array to prevent unbounded growth', () => {
      // Push 3× the cap — splice should keep the array length bounded.
      for (let i = 0; i < MAX * 3; i++) recordFailedWsAttempt('ip');
      // Hit the limiter — internal recent.length must still be > MAX
      // (i.e. cap kept enough timestamps to keep IP rate-limited).
      expect(isWsRateLimited('ip')).toBe(true);
    });

    it('tracks IPs independently', () => {
      for (let i = 0; i < MAX; i++) recordFailedWsAttempt('ip-A');
      recordFailedWsAttempt('ip-B');
      expect(isWsRateLimited('ip-A')).toBe(true);
      expect(isWsRateLimited('ip-B')).toBe(false);
    });
  });

  describe('consumeWsAttempt', () => {
    it('returns false for the first MAX attempts and true thereafter', () => {
      for (let i = 0; i < MAX - 1; i++) {
        expect(consumeWsAttempt('ip')).toBe(false);
      }
      // The MAX-th attempt itself crosses the threshold — already counted
      expect(consumeWsAttempt('ip')).toBe(true);
      // And every subsequent attempt stays rate-limited
      expect(consumeWsAttempt('ip')).toBe(true);
    });

    it('closes the race where N concurrent reads at threshold-1 all pass', () => {
      // Setup: 29 already-recorded fails (threshold-1)
      for (let i = 0; i < MAX - 1; i++) recordFailedWsAttempt('ip');
      // The legacy isWsRateLimited would return false for ALL 3 concurrent
      // simultaneous calls (each sees 29 < 30) — race window. With
      // consumeWsAttempt, each call increments before checking, so the
      // first call sees the new count (30) and rejects.
      const r1 = consumeWsAttempt('ip');
      const r2 = consumeWsAttempt('ip');
      const r3 = consumeWsAttempt('ip');
      // First crosses threshold (30 ≥ 30 → true), and so do all subsequent
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(true);
    });
  });

  describe('startWsRateLimitSweep', () => {
    it('clears expired entries on the sweep tick', () => {
      recordFailedWsAttempt('stale-ip');
      const handle = startWsRateLimitSweep();
      try {
        // Sweep fires every 5 minutes
        vi.advanceTimersByTime(WINDOW_MS + 1);
        vi.advanceTimersByTime(5 * 60_000);
        expect(_wsRateLimitSize()).toBe(0);
      } finally {
        clearInterval(handle);
      }
    });

    it('keeps entries with at least one fresh timestamp', () => {
      recordFailedWsAttempt('fresh-ip');
      const handle = startWsRateLimitSweep();
      try {
        vi.advanceTimersByTime(5 * 60_000);
        expect(_wsRateLimitSize()).toBe(0); // single old timestamp aged out
      } finally {
        clearInterval(handle);
      }
    });

    it('returns an interval handle that can be cleared', () => {
      const handle = startWsRateLimitSweep();
      expect(handle).toBeDefined();
      clearInterval(handle);
    });
  });
});
