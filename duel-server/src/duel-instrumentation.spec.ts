import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `ENABLED` is a module-load constant read from process.env. To exercise the
// enabled path we must stub the env BEFORE importing the module, then reset
// the module registry so a fresh evaluation picks up the stub. The no-op path
// is the default (DUEL_INSTRUMENT unset in the test env).

describe('duel-instrumentation', () => {
  describe('disabled by default (no-op contract)', () => {
    let instr: typeof import('./duel-instrumentation.js');

    beforeEach(async () => {
      vi.resetModules();
      delete process.env['DUEL_INSTRUMENT'];
      instr = await import('./duel-instrumentation.js');
      instr.reset();
    });

    it('reports disabled', () => {
      expect(instr.instrumentationEnabled()).toBe(false);
      expect(instr.snapshot().enabled).toBe(false);
    });

    it('time() runs the callback and returns its value', () => {
      const result = instr.time('getCardName', () => 42);
      expect(result).toBe(42);
    });

    it('time() records nothing when disabled', () => {
      instr.time('getCardName', () => 'x');
      instr.record('buildBoardState', 5_000_000n);
      for (const b of instr.snapshot().buckets) {
        expect(b.count).toBe(0);
        expect(b.msTotal).toBe(0);
      }
    });

    it('time() propagates exceptions', () => {
      expect(() => instr.time('duelProcess', () => { throw new Error('boom'); })).toThrow('boom');
    });

    it('snapshot exposes all eight buckets', () => {
      const buckets = instr.snapshot().buckets.map((b) => b.bucket).sort();
      expect(buckets).toEqual([
        'buildBoardState', 'duelProcess', 'filterMessage',
        'getCardName', 'preProcessHandCounts', 'preProcessOverlays',
        'serialize', 'workerColdStart',
      ]);
    });
  });

  describe('enabled (DUEL_INSTRUMENT=1)', () => {
    let instr: typeof import('./duel-instrumentation.js');

    beforeEach(async () => {
      vi.resetModules();
      vi.stubEnv('DUEL_INSTRUMENT', '1');
      instr = await import('./duel-instrumentation.js');
      instr.reset();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('reports enabled', () => {
      expect(instr.instrumentationEnabled()).toBe(true);
    });

    it('time() records a measured call and still returns its value', () => {
      const result = instr.time('getCardName', () => 7);
      expect(result).toBe(7);
      const bucket = instr.snapshot().buckets.find((b) => b.bucket === 'getCardName');
      expect(bucket?.count).toBe(1);
    });

    it('record() accumulates count, total, max', () => {
      instr.record('buildBoardState', 2_000_000n); // 2ms
      instr.record('buildBoardState', 8_000_000n); // 8ms
      const b = instr.snapshot().buckets.find((x) => x.bucket === 'buildBoardState')!;
      expect(b.count).toBe(2);
      expect(b.msTotal).toBeCloseTo(10, 1);
      expect(b.msMean).toBeCloseTo(5, 1);
      expect(b.msMax).toBeCloseTo(8, 1);
    });

    it('record() bins durations into the histogram', () => {
      instr.record('serialize', 500n);          // <1µs
      instr.record('serialize', 5_000_000n);    // 1-10ms
      instr.record('serialize', 80_000_000n);   // 50ms+
      const b = instr.snapshot().buckets.find((x) => x.bucket === 'serialize')!;
      const byLabel = Object.fromEntries(b.hist.map((h) => [h.label, h.count]));
      expect(byLabel['<1µs']).toBe(1);
      expect(byLabel['1-10ms']).toBe(1);
      expect(byLabel['50ms+']).toBe(1);
    });

    it('reset() clears all counters', () => {
      instr.record('duelProcess', 1_000_000n);
      instr.reset();
      const b = instr.snapshot().buckets.find((x) => x.bucket === 'duelProcess')!;
      expect(b.count).toBe(0);
    });

    it('time() records even when the callback throws', () => {
      expect(() => instr.time('filterMessage', () => { throw new Error('x'); })).toThrow();
      const b = instr.snapshot().buckets.find((x) => x.bucket === 'filterMessage')!;
      expect(b.count).toBe(1);
    });
  });
});
