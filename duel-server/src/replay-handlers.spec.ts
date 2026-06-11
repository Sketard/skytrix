import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Audit 2026-06-11 #10 — replayWorkerCount double-decrement (structural fix)
// =============================================================================
//
// Wave 2 fixed the symptoms (null conn.worker at parking, parked-crash exit
// branch); this pins the structural cause: the worker teardown idiom was
// hand-rolled ~6× with variations, and two paths could each release the same
// worker's pool slot. The invariant is now "every slot decrement flows
// through `releaseWorker` / `detachWorker`" — callers only manage their own
// pointer. Source-level pins (the module is process-global state behind a
// configureReplayHandlers boot call; not unit-instantiable without a full
// WS + worker harness).

describe('replay-handlers — releaseWorker/detachWorker slot discipline (audit #10)', () => {
  const SOURCE = readFileSync(join(HERE, 'replay-handlers.ts'), 'utf-8');

  it('onReplayWorkerDone() is called ONLY from releaseWorker and detachWorker', () => {
    // Call form `onReplayWorkerDone();` — the definition line does not match.
    const calls = SOURCE.match(/onReplayWorkerDone\(\);/g) ?? [];
    expect(calls.length, 'exactly 2 call sites: one in releaseWorker, one in detachWorker').toBe(2);

    // Both calls live inside the two helpers (between their definitions and
    // the next top-level function). A new hand-rolled decrement elsewhere
    // bumps the count above and fails the assert.
    const releaseIdx = SOURCE.indexOf('function releaseWorker(');
    const detachIdx = SOURCE.indexOf('function detachWorker(');
    const nextSectionIdx = SOURCE.indexOf('export async function handleReplayConnection');
    expect(releaseIdx).toBeGreaterThan(-1);
    expect(detachIdx).toBeGreaterThan(releaseIdx);
    expect(nextSectionIdx).toBeGreaterThan(detachIdx);
    let searchFrom = 0;
    for (const _ of calls) {
      const idx = SOURCE.indexOf('onReplayWorkerDone();', searchFrom);
      expect(idx, 'every onReplayWorkerDone() call must sit inside the helper block').toBeGreaterThan(releaseIdx);
      expect(idx).toBeLessThan(nextSectionIdx);
      searchFrom = idx + 1;
    }
  });

  it('releaseWorker detaches listeners BEFORE terminate (exit handler must not observe deliberate teardowns)', () => {
    const releaseIdx = SOURCE.indexOf('function releaseWorker(');
    const detachIdx = SOURCE.indexOf('function detachWorker(');
    const body = SOURCE.slice(releaseIdx, detachIdx);
    const removeIdx = body.indexOf('worker.removeAllListeners()');
    const terminateIdx = body.indexOf('worker.terminate()');
    expect(removeIdx).toBeGreaterThan(-1);
    expect(terminateIdx).toBeGreaterThan(removeIdx);
  });

  it('detachWorker is a TRANSFER — no removeAllListeners, no terminate', () => {
    const detachIdx = SOURCE.indexOf('function detachWorker(');
    const nextSectionIdx = SOURCE.indexOf('export async function handleReplayConnection');
    const body = SOURCE.slice(detachIdx, nextSectionIdx);
    expect(body).not.toContain('removeAllListeners');
    expect(body).not.toContain('terminate');
  });

  it('transitionForkToSolo hands off via detachWorker (worker survives in the ActiveDuelSession)', () => {
    const fnIdx = SOURCE.indexOf('function transitionForkToSolo(');
    const nextFnIdx = SOURCE.indexOf('function handleReplayForkContinue(');
    const body = SOURCE.slice(fnIdx, nextFnIdx);
    expect(body).toContain('detachWorker(worker)');
    expect(body, 'a transfer must never terminate the worker').not.toContain('releaseWorker(');
  });

  it('fork-warning parking nulls conn.worker when ownership moves to pendingForkWorkers (W2-e fix preserved)', () => {
    const parkIdx = SOURCE.indexOf('pendingForkWorkers.set(conn,');
    expect(parkIdx).toBeGreaterThan(-1);
    // The conn pointer must be nulled in the same block (within the next
    // few lines) so cleanupReplayConnection's conn.worker branch and the
    // pending branch stay mutually exclusive.
    const window = SOURCE.slice(parkIdx, parkIdx + 800);
    expect(window).toContain('conn.worker = null;');
  });
});
