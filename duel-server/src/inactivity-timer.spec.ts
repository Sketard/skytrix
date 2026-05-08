import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInactivityScheduler, type InactivityDeps, type InactivitySlot } from './inactivity-timer.js';
import type { Player } from './ws-protocol.js';

function makeDeps(overrides: Partial<InactivityDeps> = {}): InactivityDeps & {
  slots: Map<Player, InactivitySlot | null>;
  isDuelEndedFlag: { current: boolean };
  warnings: { player: Player; remainingSec: number }[];
  forfeits: Player[];
} {
  const slots = new Map<Player, InactivitySlot | null>();
  const isDuelEndedFlag = { current: false };
  const warnings: { player: Player; remainingSec: number }[] = [];
  const forfeits: Player[] = [];

  return {
    slots,
    isDuelEndedFlag,
    warnings,
    forfeits,
    isDuelEnded: () => isDuelEndedFlag.current,
    getSlot: (p) => slots.get(p) ?? null,
    setSlot: (p, slot) => slots.set(p, slot),
    sendWarning: (p, remainingSec) => warnings.push({ player: p, remainingSec }),
    forfeit: (p) => forfeits.push(p),
    warningDelayMs: 100_000,   // 100s — total - warningBefore
    warningBeforeMs: 20_000,   // 20s
    raceWindowMs: 500,         // 500ms
    ...overrides,
  };
}

describe('createInactivityScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('happy path — full sequence', () => {
    it('start → warning fires after warningDelayMs', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);

      expect(deps.warnings).toHaveLength(0);
      vi.advanceTimersByTime(99_999);
      expect(deps.warnings).toHaveLength(0);
      vi.advanceTimersByTime(1);

      expect(deps.warnings).toEqual([{ player: 0, remainingSec: 20 }]);
      expect(sched.peek(0)).toBe('forfeit');
    });

    it('warning → forfeit stage scheduled at warningBeforeMs', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(100_000); // warning fires

      expect(sched.peek(0)).toBe('forfeit');
      vi.advanceTimersByTime(20_000);
      // forfeit stage transitions to race
      expect(sched.peek(0)).toBe('race');
      expect(deps.forfeits).toHaveLength(0);
    });

    it('race → forfeit() called after raceWindowMs', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(120_000); // through warning + forfeit, now in race window
      expect(sched.peek(0)).toBe('race');

      vi.advanceTimersByTime(499);
      expect(deps.forfeits).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(deps.forfeits).toEqual([0]);
      expect(sched.peek(0)).toBe(null);
    });

    it('total time from start to forfeit = warningDelayMs + warningBeforeMs + raceWindowMs', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);

      vi.advanceTimersByTime(120_500 - 1);
      expect(deps.forfeits).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(deps.forfeits).toEqual([0]);
    });
  });

  describe('cancel', () => {
    it('cancel() before warning prevents the entire sequence', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(50_000);
      sched.cancel(0);

      vi.advanceTimersByTime(200_000);
      expect(deps.warnings).toHaveLength(0);
      expect(deps.forfeits).toHaveLength(0);
      expect(sched.peek(0)).toBe(null);
    });

    it('cancel() between warning and forfeit prevents forfeit', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(100_000); // warning fires
      expect(deps.warnings).toHaveLength(1);

      sched.cancel(0);
      vi.advanceTimersByTime(50_000);
      expect(deps.forfeits).toHaveLength(0);
    });

    it('cancel() during race window prevents forfeit (AC4 semantics)', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(120_000); // in race window
      expect(sched.peek(0)).toBe('race');

      vi.advanceTimersByTime(300); // 300ms into 500ms race window
      sched.cancel(0);
      vi.advanceTimersByTime(1000);
      expect(deps.forfeits).toHaveLength(0);
    });

    it('cancel() is idempotent — calling twice is safe', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      sched.cancel(0);
      sched.cancel(0); // no-op, no throw
      expect(sched.peek(0)).toBe(null);
    });

    it('cancel() on a player that never started is a no-op', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      expect(() => sched.cancel(1)).not.toThrow();
    });
  });

  describe('isDuelEnded short-circuits', () => {
    it('warning callback short-circuits if duel ended mid-delay', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(99_000);
      deps.isDuelEndedFlag.current = true;
      vi.advanceTimersByTime(1_000); // warning timer fires

      expect(deps.warnings).toHaveLength(0);
      expect(sched.peek(0)).toBe(null); // slot cleared even on short-circuit
    });

    it('forfeit short-circuits if duel ended after warning', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(100_000); // warning fires
      deps.isDuelEndedFlag.current = true;
      vi.advanceTimersByTime(20_000);

      expect(sched.peek(0)).toBe(null);
    });

    it('race short-circuits if duel ended just before forfeit fires', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(120_000); // in race window
      deps.isDuelEndedFlag.current = true;
      vi.advanceTimersByTime(500);

      expect(deps.forfeits).toHaveLength(0);
    });
  });

  describe('restart semantics', () => {
    it('start() during race resets back to warning stage', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(120_000); // in race
      expect(sched.peek(0)).toBe('race');
      const warningsAfterFirst = deps.warnings.length; // 1 — original cycle's warning fired at 100s

      sched.start(0); // restart
      expect(sched.peek(0)).toBe('warning');
      vi.advanceTimersByTime(99_999);
      expect(deps.warnings.length).toBe(warningsAfterFirst); // no new warning yet
      vi.advanceTimersByTime(1);
      expect(deps.warnings.length).toBe(warningsAfterFirst + 1);
    });

    it('start() cancels old timer — old forfeit must NOT fire', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(120_000); // in race
      sched.start(0); // restart immediately

      // Advance past where the OLD forfeit would have fired (race+raceWindowMs)
      vi.advanceTimersByTime(500);
      expect(deps.forfeits).toHaveLength(0);
    });
  });

  describe('two independent players', () => {
    it('start(0) and start(1) keep independent slots and stages', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      vi.advanceTimersByTime(100_000); // p0 in forfeit

      sched.start(1);
      expect(sched.peek(0)).toBe('forfeit');
      expect(sched.peek(1)).toBe('warning');
    });

    it('cancel(0) does not affect player 1', () => {
      const deps = makeDeps();
      const sched = createInactivityScheduler(deps);
      sched.start(0);
      sched.start(1);
      sched.cancel(0);

      vi.advanceTimersByTime(120_500);
      expect(deps.forfeits).toEqual([1]);
    });
  });
});
