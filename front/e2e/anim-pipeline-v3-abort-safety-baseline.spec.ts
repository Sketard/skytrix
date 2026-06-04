import { test, expect } from '@playwright/test';
import { setupReplaySession } from './replay-debug-driver';

/**
 * Anim pipeline v3 — abort safety BASELINE spec.
 *
 * Reproduces the canonical bug captured in
 * `console-export-2026-6-4_13-57-59.log` (lines 706-733) : clicking
 * `togglePerspective` in replay while a chain is being built (locks
 * `HAND-0` + `GY-0` posted mid-MSG_MOVE) throws 3 asserts in cascade :
 *
 *   1. `advanceStep:done` — locks survived `resetForReplaySeek`
 *      (`replay-duel-adapter.ts:246`)
 *   2. `LOCK_SAFETY_TIMEOUT` for `HAND-0` ~7.5s later
 *   3. `LOCK_SAFETY_TIMEOUT` for `GY-0` ~7.5s later
 *
 *   Plus a `DEP overlay-show:chain-2 timed out` ~5s later (DeferredEffect
 *   never resolved).
 *
 * Strategy : open the canonical replay
 * (`a1eed2d6-5bad-486a-b743-9639b8049790`), scan precompute for the
 * first mid-chain state with at least 2 active links (matches the log's
 * "chain-2" deferred), seek there, IMMEDIATELY toggle perspective.
 *
 * **Pre-v3 expected behavior** : at least one error matching
 * `/locks still active|Lock safety timeout|timed out after 5000ms/` is
 * captured in `session.lines`.
 *
 * **Post-v3 expected behavior** : ZERO matching errors. The spec
 * starts as `test.fail()`-marked so the suite passes today and starts
 * failing the moment v3 lands a real fix — at which point flip to
 * `test()` to assert the new invariant.
 *
 * NOTE — this spec REQUIRES the `a1eed2d6` replay in the back's DB.
 * Sync via `node scripts/dev-stack.mjs sync-db` (Windows) before running
 * against the isolated stack, or run against the canonical stack with
 * the user's existing data.
 */

const REPLAY_ID = 'a1eed2d6-5bad-486a-b743-9639b8049790';

const ERROR_MARKERS = [
  'locks still active',
  'Lock safety timeout',
  'timed out after 5000ms',
];

test('v3 baseline — togglePerspective mid-chain in replay throws cascading asserts (PRE-FIX)', async ({ browser }) => {
  test.setTimeout(180_000);
  // Pre-v3 the bug throws : we EXPECT failure so CI is green until the
  // fix lands. Flip to `test(...)` (drop the .fail) once v3 Phase 4 is
  // shipped — the assertion below will then assert the FIX (0 errors).
  test.fail(true, 'pre-v3 bug — flip to test() once v3 lands');

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const session = await setupReplaySession(ctx, {
    replayId: REPLAY_ID,
    perspective: 0,
    buildFirst: false,
    tag: 'v3-abort-safety-baseline',
  });

  try {
    await session.driver.waitUntilPrecomputeStable();

    // Find the first state with chainSnapshot.links.length >= 2 — the
    // log's "chain-2" deferred + the cascade only fires when a second
    // link triggers another overlay-show registration mid-build.
    const total = await session.driver.totalBoardStates();
    let targetIdx = -1;
    for (let i = 1; i < total; i++) {
      await session.driver.seek(i);
      const snap = await session.driver.currentStateChainSnapshot();
      if (snap && snap.links.length >= 2) {
        targetIdx = i;
        break;
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[v3-baseline] total=${total} target mid-chain idx=${targetIdx}`);

    if (targetIdx < 0) {
      throw new Error(
        `No PreComputedState with >=2 chain links found. Either the ` +
        `replay does not contain a multi-link chain or the precompute is ` +
        `not embedding chainSnapshot (F9-bis precompute may be missing).`,
      );
    }

    await session.capture('seek-to-mid-chain');

    // Window where the bug fires : seek lands, processor.restoreChainState
    // runs, then click toggle. The next abortAndClean cascades through
    // requestStop → setRunning(false) → advanceStep → assertNoLocks.
    const errCountBefore = session.lines.filter(l => l.type === 'error').length;

    await session.driver.togglePerspective();
    await session.capture('after-toggle-perspective');

    // Wait > LOCK_SAFETY_TIMEOUT_MS (7.5s) so the two LOCK_SAFETY_TIMEOUT
    // asserts have a chance to fire if they're going to. Also covers the
    // DEP overlay-show:chain-2 timeout (5s).
    await session.page.waitForTimeout(8500);
    await session.capture('after-safety-window');

    const newErrors = session.lines
      .slice(errCountBefore)
      .filter(l => l.type === 'error')
      .filter(l => ERROR_MARKERS.some(marker => l.text.includes(marker)));

    // eslint-disable-next-line no-console
    console.log(`[v3-baseline] captured ${newErrors.length} v3-related error lines after toggle:`);
    for (const e of newErrors) {
      // eslint-disable-next-line no-console
      console.log(`[v3-baseline]   t=${e.t.toFixed(2)}s ${e.text.slice(0, 200)}`);
    }

    // POST-V3 ASSERTION : the cascade no longer fires. Currently this
    // assertion FAILS (caught by `test.fail`) — that is the pre-fix
    // baseline. When v3 ships, flip `test.fail(true)` → drop it, and
    // the spec becomes a regression guard.
    expect(newErrors).toEqual([]);
  } finally {
    await session.finalize();
    await session.page.close().catch(() => undefined);
    await ctx.close();
  }
});
