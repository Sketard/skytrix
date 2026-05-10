import { describe, it, expect, beforeEach } from 'vitest';
import {
  _tryAcquireSolverMutex,
  _releaseSolverMutex,
  _solverInFlightSize,
  _solverInFlightHas,
  _resetSolverInFlight,
} from './solver-handlers.js';

describe('solver-handlers — per-userId mutex (R7)', () => {
  beforeEach(() => {
    _resetSolverInFlight();
  });

  describe('tryAcquireSolverMutex', () => {
    it('returns true on first acquire and adds the userId to the in-flight set', () => {
      expect(_tryAcquireSolverMutex('alice')).toBe(true);
      expect(_solverInFlightHas('alice')).toBe(true);
      expect(_solverInFlightSize()).toBe(1);
    });

    it('returns false on a second acquire while the first is still held', () => {
      expect(_tryAcquireSolverMutex('alice')).toBe(true);
      expect(_tryAcquireSolverMutex('alice')).toBe(false);
      // Still exactly one entry — the failed acquire MUST NOT add a duplicate
      expect(_solverInFlightSize()).toBe(1);
    });

    it('closes the race where N concurrent SOLVER_STARTs read free at the same tick', () => {
      // Simulates the R7 bug surface: before this fix, two coroutines could
      // both pass the (now atomic) test-and-add synchronously. After the
      // fix, only the first synchronous call wins.
      const r1 = _tryAcquireSolverMutex('alice');
      const r2 = _tryAcquireSolverMutex('alice');
      const r3 = _tryAcquireSolverMutex('alice');
      expect(r1).toBe(true);
      expect(r2).toBe(false);
      expect(r3).toBe(false);
    });

    it('tracks userIds independently', () => {
      expect(_tryAcquireSolverMutex('alice')).toBe(true);
      expect(_tryAcquireSolverMutex('bob')).toBe(true);
      expect(_solverInFlightSize()).toBe(2);
      expect(_solverInFlightHas('alice')).toBe(true);
      expect(_solverInFlightHas('bob')).toBe(true);
    });
  });

  describe('releaseSolverMutex', () => {
    it('removes the userId so the next acquire succeeds', () => {
      _tryAcquireSolverMutex('alice');
      _releaseSolverMutex('alice');
      expect(_solverInFlightHas('alice')).toBe(false);
      expect(_tryAcquireSolverMutex('alice')).toBe(true);
    });

    it('is idempotent — releasing an unheld userId is a no-op', () => {
      // Defensive: if `handleSolverStart` early-returns before acquiring,
      // the finally block must not throw. Set.delete on a missing key
      // returns false silently — assert the invariant.
      expect(() => _releaseSolverMutex('never-acquired')).not.toThrow();
      expect(_solverInFlightSize()).toBe(0);
    });

    it('only releases the targeted userId', () => {
      _tryAcquireSolverMutex('alice');
      _tryAcquireSolverMutex('bob');
      _releaseSolverMutex('alice');
      expect(_solverInFlightHas('alice')).toBe(false);
      expect(_solverInFlightHas('bob')).toBe(true);
    });
  });

  describe('acquire-release cycles', () => {
    it('supports back-to-back solves for the same userId', () => {
      // Sequential SOLVER_STARTs (rate-limit aside): each cycle must fully
      // release so the next solve can start.
      for (let i = 0; i < 5; i++) {
        expect(_tryAcquireSolverMutex('alice')).toBe(true);
        _releaseSolverMutex('alice');
      }
      expect(_solverInFlightSize()).toBe(0);
    });
  });
});
