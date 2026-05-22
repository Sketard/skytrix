import { test } from '@playwright/test';
import { runReplayDebug } from './debug-replay-harness';

/**
 * Perf-audit run — plays replay a8859c98 end-to-end and captures a report
 * under `_bmad-output/debug-replay/<tag>/` (Markdown timeline + screenshots
 * + JSON snapshots). Phase 0.5 / Phase 1 of the perf chantier
 * (_bmad-output/planning-artifacts/perf-audit-instrumentation-chantier.md).
 *
 * buildFirst: false — points at the running ng serve on :4200.
 */

test('perf-audit replay a8859c98 — end to end', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const outDir = await runReplayDebug(ctx, {
      replayId: 'a8859c98-df53-4de3-bcdb-dd1a56176f86',
      perspective: 0,
      screenshotOn: ['travel skipped', 'POLL-DROP REGRESSION', 'WARN', 'error'],
      buildFirst: false,
      timeoutSec: 240,
    });
    console.log(`Report written to: ${outDir}`);
  } finally {
    await ctx.close();
  }
});
