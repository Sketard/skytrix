import { PollDropWatchdog, type PollDropWatchdogState } from './poll-drop-watchdog';

/**
 * Unit tests for the POLL-DROP REGRESSION watchdog. Pure class — no TestBed,
 * no orchestrator. Timer behaviour driven by jasmine's mock clock.
 */
describe('PollDropWatchdog', () => {
  const DELAY = 1000;

  /** Mutable state the watchdog reads at fire time. */
  let state: PollDropWatchdogState;
  let fireCount: number;
  let watchdog: PollDropWatchdog;

  beforeEach(() => {
    jasmine.clock().install();
    state = { isResolving: true, queueLen: 0, isAnimating: false };
    fireCount = 0;
    watchdog = new PollDropWatchdog(() => state, () => { fireCount++; }, DELAY);
  });

  afterEach(() => jasmine.clock().uninstall());

  describe('shouldFire (pure decision)', () => {
    it('fires on a genuine stall: resolving + empty queue + not animating + not paused', () => {
      expect(PollDropWatchdog.shouldFire(
        { isResolving: true, queueLen: 0, isAnimating: false }, false)).toBeTrue();
    });

    it('does not fire when the chain is no longer resolving', () => {
      expect(PollDropWatchdog.shouldFire(
        { isResolving: false, queueLen: 0, isAnimating: false }, false)).toBeFalse();
    });

    it('does not fire when the queue re-filled', () => {
      expect(PollDropWatchdog.shouldFire(
        { isResolving: true, queueLen: 2, isAnimating: false }, false)).toBeFalse();
    });

    it('does not fire while still animating', () => {
      expect(PollDropWatchdog.shouldFire(
        { isResolving: true, queueLen: 0, isAnimating: true }, false)).toBeFalse();
    });

    it('does not fire while playback is paused', () => {
      expect(PollDropWatchdog.shouldFire(
        { isResolving: true, queueLen: 0, isAnimating: false }, true)).toBeFalse();
    });
  });

  describe('arm / clear', () => {
    it('fires onFire after the delay on a genuine stall', () => {
      watchdog.arm();
      expect(fireCount).toBe(0);
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(1);
    });

    it('does not fire if the state recovered before the timeout', () => {
      watchdog.arm();
      state.isResolving = false; // chain ended
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(0);
    });

    it('does not fire if the queue re-filled before the timeout', () => {
      watchdog.arm();
      state.queueLen = 3;
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(0);
    });

    it('clear() cancels a pending timer', () => {
      watchdog.arm();
      watchdog.clear();
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(0);
    });

    it('arm() replaces a prior timer (only one fire)', () => {
      watchdog.arm();
      jasmine.clock().tick(DELAY / 2);
      watchdog.arm(); // re-arm — resets the countdown
      jasmine.clock().tick(DELAY / 2 + 1); // not enough for the second timer
      expect(fireCount).toBe(0);
      jasmine.clock().tick(DELAY / 2);
      expect(fireCount).toBe(1);
    });

    it('isArmed reflects pending-timer state', () => {
      expect(watchdog.isArmed).toBeFalse();
      watchdog.arm();
      expect(watchdog.isArmed).toBeTrue();
      jasmine.clock().tick(DELAY + 1);
      expect(watchdog.isArmed).toBeFalse();
    });
  });

  describe('pause-awareness (the replay false-positive fix)', () => {
    it('arm() is a no-op while paused — no fire even on a genuine stall', () => {
      watchdog.setPaused(true);
      watchdog.arm();
      expect(watchdog.isArmed).toBeFalse();
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(0);
    });

    it('setPaused(true) clears a pending timer (pause mid-resolution)', () => {
      watchdog.arm();
      expect(watchdog.isArmed).toBeTrue();
      watchdog.setPaused(true);
      expect(watchdog.isArmed).toBeFalse();
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(0);
    });

    it('setPaused(false) re-arms when still mid-resolution with an empty queue', () => {
      watchdog.setPaused(true);
      // state stays resolving + empty + not animating
      watchdog.setPaused(false);
      expect(watchdog.isArmed).toBeTrue();
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(1);
    });

    it('setPaused(false) does NOT re-arm when the chain already ended while paused', () => {
      watchdog.setPaused(true);
      state.isResolving = false; // chain finished during the pause
      watchdog.setPaused(false);
      expect(watchdog.isArmed).toBeFalse();
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(0);
    });

    it('setPaused is a no-op when the flag is unchanged', () => {
      watchdog.arm();
      watchdog.setPaused(false); // already not paused
      expect(watchdog.isArmed).toBeTrue(); // timer untouched
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(1);
    });

    it('isPaused reflects the flag', () => {
      expect(watchdog.isPaused).toBeFalse();
      watchdog.setPaused(true);
      expect(watchdog.isPaused).toBeTrue();
      watchdog.setPaused(false);
      expect(watchdog.isPaused).toBeFalse();
    });

    it('a timer armed before pause does not fire if it elapses while paused', () => {
      // Defence in depth: even if a timer somehow survived into the paused
      // window, shouldFire() re-checks `paused` at fire time.
      watchdog.arm();
      watchdog.setPaused(true); // clears the timer in practice…
      // …but re-arm-while-paused is blocked, and shouldFire gates on paused:
      watchdog.arm(); // no-op (paused)
      jasmine.clock().tick(DELAY + 1);
      expect(fireCount).toBe(0);
    });
  });
});
