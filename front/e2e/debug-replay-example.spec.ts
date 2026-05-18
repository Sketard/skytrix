import { test } from '@playwright/test';
import { runReplayDebug } from './debug-replay-harness';

/**
 * Example consumer of the replay debug harness. Copy this file when chasing
 * a new animation bug — change the replay ID, perspective, and trigger
 * substrings to suit. Each run produces a self-contained report under
 * `_bmad-output/debug-replay/<tag>/` (Markdown + screenshots + JSON
 * snapshots).
 *
 * Default mode is `buildFirst: false` for fast iteration on the user's
 * running ng serve. Switch to `buildFirst: true` for HMR-immune captures
 * (slower but reproducible). The replay below was used to diagnose the
 * EMZ data-zone perspective bug fixed 2026-05-18 — kept as a regression
 * exemplar.
 */

test('debug replay 5a2afd8e — perspective 1 (EMZ resolver bug exemplar)', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const outDir = await runReplayDebug(ctx, {
      replayId: '5a2afd8e-7cf3-4676-8a4b-91e6a21d96e9',
      perspective: 1,
      screenshotOn: ['travel skipped', 'POLL-DROP REGRESSION'],
      buildFirst: false,
      timeoutSec: 150,
      // Uncomment to skip straight to the 2nd Synchro window (~event 142 in
      // this replay) instead of playing from event 0. Adds ~5-10s of seek
      // settle time but skips ~75s of upfront playback.
      // fromEvent: 140,
    });
    console.log(`Report written to: ${outDir}`);
  } finally {
    await ctx.close();
  }
});
