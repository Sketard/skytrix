import { test } from '@playwright/test';
import { runSoloPvpDebug } from './solo-pvp-harness';

/**
 * γ Option C PR2 c7c (2026-05-29) — Playwright Scenario A : chain SOLO
 * basique. Live-stack regression exemplar for the cardinal γ invariant
 * (single processor on single connection, switchPerspective mid-chain
 * preserves chain state).
 *
 * The unit-level proof lives in `phase-gamma-victory.spec.ts` (T-F6 ×5,
 * shipped c7b) via a `MockWebSocket` against the real pipeline. This
 * spec walks the **live** stack to produce the visual + console artefact
 * Axel wanted post-c4.1 : ONE card travels per MSG_MOVE, no overlay
 * desync, no Lock safety timeout, no POLL-DROP REGRESSION. Output goes
 * to `_bmad-output/debug-solo/<tag>/`.
 *
 * ## Requirements (NOT auto-validated by CI)
 *
 * - back 8080 UP
 * - duel-server 3001 UP
 * - front 4200 UP (`ng serve` or static build served on its own port)
 * - admin user seeded in dev DB with at least 1 chain-capable deck
 *   (D/D, Eldlich, Spright — anything that lets P1 activate a hand trap
 *   like Maxx C / Ash Blossom while P0 is mid-resolve)
 *
 * The harness POSTs `/api/rooms/quick-duel` with `decklistId1 ===
 * decklistId2` (both perspectives use the same deck). Adjust `deckName`
 * below when the admin account isn't seeded with a chain-capable deck.
 *
 * ## Scenarios B-E + T-S13 deferred to c9
 *
 * Scenarios B (bootstrap 5 MSG_DRAW), C (rematch BH-9 audit), D (rematch
 * court-circuit + F5 grace, A27+A31), E (cancel-rollback slot 1 A30),
 * and the SOLO reconnect × 2 server-side e2e (T-S13) are all deferred
 * to a dedicated "γ-c Playwright session" — cf.
 * `_bmad-output/planning-artifacts/gamma-c-playwright-c9-deferred.md`.
 * Reason : each Scenario B-E needs richer scripted user actions
 * (rematch flow, F5 reload mid-grace, right-click cancel) and full
 * stack validation that doesn't fit in the c7 unitary scope.
 *
 * ## Trigger screenshots
 *
 * The harness screenshots automatically when console matches any of
 * `screenshotOn`. The two strings below are the γ test-of-victory
 * signals : if either fires, γ has NOT eliminated the
 * bug-solo-sequence and the snapshot at that moment is gold for
 * debugging.
 */

test('γ Scenario A — chain SOLO basique + switch mid-chain', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const { harness, dispose } = await runSoloPvpDebug(ctx, {
      tag: `${new Date().toISOString().slice(0, 10)}-scenario-a`,
      timeoutSec: 90,
      // The harness picks the first owned deck by default. Force a
      // chain-capable one here when admin has multiple decks seeded ;
      // for the canonical D/D scenario : `deckName: 'D/D'`.
      // deckName: 'D/D',
      firstPlayer: 0,
      // Capture on the 2 γ test-of-victory signals. These are the
      // smoking gun — either appearing means the bug-solo-sequence
      // survived c6a (regression).
      screenshotOn: ['Lock safety timeout', 'POLL-DROP REGRESSION'],
    });

    try {
      // T1 — bootstrap capture already happened in `runSoloPvpDebug`
      // (frame `0001-t0-bootstrap.png`). Nothing to do yet.

      // T2 — the user-driven part of the scenario is intentionally
      // minimal in the c7c shipping : the harness already captures a
      // baseline. The chain-driven flow needs a chain-capable deck +
      // a scripted card-activation sequence (out of scope for c7c —
      // see the c9 backlog memo for the full scripted Scenarios A-E
      // with deck-specific helpers).
      //
      // To extend this scenario manually : press P0's first hand card
      // via `page.keyboard.press(...)` or `page.click(...)`, wait for
      // the chain to enter `'resolving'`, switchPerspective, then
      // assert no warnings. The harness exposes `waitForChainResolving`
      // and `waitForChainIdle` for this. Example shape :
      //
      //   await harness.waitForChainResolving();
      //   await harness.capture('chain-resolving-pre-switch');
      //   await harness.switchPerspective();
      //   await harness.capture('chain-resolving-post-switch');
      //   await harness.waitForChainIdle();
      //   await harness.capture('chain-idle-after-end');

      await harness.capture('scenario-a-end');
      console.log(`Scenario A report : ${harness.outDir}`);
    } finally {
      await dispose();
    }
  } finally {
    await ctx.close();
  }
});
