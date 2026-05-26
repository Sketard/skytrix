import { test } from '@playwright/test';
import { runReplayDebug } from './debug-replay-harness';

/**
 * Regression exemplar — investigation 2026-05-26 of two XYZ visual bugs
 * documented in `_bmad-output/planning-artifacts/deferred-effects-catalogue.md`
 * (cas #12 `xyz-leave-with-materials` and the pass 3 écarté
 * `xyz-summon-materials-via-extra` candidate for the future cas #13bis).
 *
 *  bug #1 — XYZ summon (seekTo=23): OCGCore routes materials through
 *    EXTRA (MZONE→EXTRA toSeq=7) before MSG_MOVE EXTRA→MZONE for the
 *    XYZ itself. The current router animates materials toward EXTRA
 *    via `leaveFieldNonDestroy` — user sees "matériaux vont vers
 *    l'extra deck". Pass 3 candidate, not yet a deferred rule.
 *  bug #2 — XYZ leaves with overlay materials (seekTo=26): OCGCore
 *    emits MSG_MOVE GRAVE→GRAVE reason=0x600 (REASON_RULE +
 *    REASON_LOST_TARGET) for each ex-material once the XYZ leaves
 *    MZONE — regardless of the reason (destroy, Link material,
 *    tribute, return-to-deck, banishment). The current router routes
 *    them via `pileToPile` (quasi-static travel with GLOW_GY) →
 *    "flash à tour de rôle dans le cimetière". Covered by cas #12 of
 *    the deferred-effects catalogue (§1bis), to be fixed in Phase β.
 *
 * Use this spec to verify the fixes in Phase β. Re-run will produce
 * fresh frames under `_bmad-output/debug-replay/2026-05-26-xyz-bug*-*`.
 * The directory is .gitignored — only this spec is checked in.
 */

const REPLAY = 'a8859c98-df53-4de3-bcdb-dd1a56176f86';

test('xyz bug #1 — summon (seekTo=23) — perspective 0', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const outDir = await runReplayDebug(ctx, {
      replayId: REPLAY,
      perspective: 0,
      fromEvent: 23,
      screenshotOn: ['MSG_MOVE', 'OVERLAY', 'overlay-show', 'XYZ', 'pvp-xyz-detach'],
      buildFirst: false,
      timeoutSec: 90,
      tag: '2026-05-26-xyz-bug1-summon-p0',
    });
    console.log(`Report: ${outDir}`);
  } finally {
    await ctx.close();
  }
});

test('xyz bug #2 — destroy (seekTo=26) — perspective 0', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const outDir = await runReplayDebug(ctx, {
      replayId: REPLAY,
      perspective: 0,
      fromEvent: 26,
      screenshotOn: ['MSG_MOVE', 'OVERLAY', 'preDestroy', 'overlay-detach', 'pvp-xyz-detach'],
      buildFirst: false,
      timeoutSec: 90,
      tag: '2026-05-26-xyz-bug2-destroy-p0',
    });
    console.log(`Report: ${outDir}`);
  } finally {
    await ctx.close();
  }
});
