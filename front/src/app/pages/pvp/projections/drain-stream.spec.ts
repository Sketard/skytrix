import { TestBed } from '@angular/core/testing';
import { computed, Injector, runInInjectionContext, signal } from '@angular/core';

import { drainStream, type StreamCursor } from './drain-stream';

/**
 * Regression guard for the O(1) `eventStream` refactor (`0ec7bf9d`). The
 * orchestrator stores events in a mutable array + a monotonic version signal,
 * and exposes them via a `computed` that returns the SAME array reference on
 * every bump. Without `{ equal: () => false }` on that computed, Angular's
 * default `Object.is` equality treats the value as unchanged and skips the
 * downstream `drainStream` effect after the first emit — silently freezing
 * the game log + every projection.
 *
 * These tests reproduce the production wiring (stable-ref computed consumed
 * by `drainStream`) so the freeze can never come back unnoticed.
 */
describe('drainStream', () => {
  function makeStableRefStream<E>(equalAlwaysFalse: boolean): {
    data: E[];
    bump: () => void;
    stream: ReturnType<typeof computed<readonly E[]>>;
  } {
    const data: E[] = [];
    // why: test-local stand-in for the orchestrator's `_eventStreamVersion`
    // — reproduces the stable-ref computed wiring in isolation, not a pipeline signal.
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    const version = signal(0);
    const opts = equalAlwaysFalse ? { equal: () => false } : undefined;
    const stream = computed<readonly E[]>(() => {
      version();
      return data;
    }, opts);
    return { data, bump: () => version.update(v => v + 1), stream };
  }

  it('drains every push when the computed returns a stable ref with equal:()=>false', () => {
    const injector = TestBed.inject(Injector);
    const { data, bump, stream } = makeStableRefStream<number>(true);
    const cursor: StreamCursor = { value: 0 };
    const consumed: number[] = [];

    runInInjectionContext(injector, () => {
      drainStream(stream, cursor, e => consumed.push(e), injector);
    });
    TestBed.tick();

    data.push(10);
    bump();
    TestBed.tick();
    data.push(20);
    bump();
    TestBed.tick();
    data.push(30);
    bump();
    TestBed.tick();

    expect(consumed).toEqual([10, 20, 30]);
  });

  it('regression: a stable-ref computed WITHOUT equal:()=>false freezes after the first emit', () => {
    const injector = TestBed.inject(Injector);
    const { data, bump, stream } = makeStableRefStream<number>(false);
    const cursor: StreamCursor = { value: 0 };
    const consumed: number[] = [];

    runInInjectionContext(injector, () => {
      drainStream(stream, cursor, e => consumed.push(e), injector);
    });
    TestBed.tick();

    data.push(10);
    bump();
    TestBed.tick();
    data.push(20);
    bump();
    TestBed.tick();

    // Documents the footgun the production computed must avoid: the default
    // Object.is equality suppresses propagation, so nothing drains.
    expect(consumed).toEqual([]);
  });

  it('re-syncs the cursor on an in-place wipe (length = 0) and resumes from 0', () => {
    const injector = TestBed.inject(Injector);
    const { data, bump, stream } = makeStableRefStream<number>(true);
    const cursor: StreamCursor = { value: 0 };
    const consumed: number[] = [];

    runInInjectionContext(injector, () => {
      drainStream(stream, cursor, e => consumed.push(e), injector);
    });
    TestBed.tick();

    data.push(1);
    data.push(2);
    bump();
    TestBed.tick();
    expect(consumed).toEqual([1, 2]);
    expect(cursor.value).toBe(2);

    // Wipe in place (orchestrator `resetAllState`) — observed in its own flush.
    data.length = 0;
    bump();
    TestBed.tick();
    expect(cursor.value).toBe(0);

    // New duel events restart from index 0.
    data.push(7);
    bump();
    TestBed.tick();
    expect(consumed).toEqual([1, 2, 7]);
  });
});
