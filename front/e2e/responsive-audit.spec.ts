import { test, expect } from '@playwright/test';
import { BACK_URL } from './helpers';
import { buildPageCatalog, DEFAULT_VIEWPORTS, runResponsiveAudit } from './responsive-audit-harness';

/**
 * Full responsive audit: 11 pages × 8 viewports = 88 captures + mechanical
 * findings. Viewports include 4 mobile (2 portrait + 2 landscape), 2 tablet,
 * 2 desktop. Output → `_bmad-output/responsive-audit-{ISO date}/`.
 *
 * Prereqs (stack must be up at the URLs in helpers.ts):
 *   - admin / admin authenticated
 *   - deck id 19 owned (Fireking)
 *   - at least one replay in the DB
 *
 * Wall-clock: ~5-8 minutes depending on the duel hydration latency.
 * Output is non-flaky: every failure is captured as a finding rather than
 * a thrown assertion — the whole point is to surface, not to gate.
 */

const DECK_ID = 19;
const DECK_NAME = 'Fireking';

// The harness manages its own screenshots; Playwright's per-test video /
// trace would add ~100+ webm files and slow the run. Off for this suite.
// Must be top-level (not inside describe) — a describe-scoped use() forces
// a new worker.
test.use({ video: 'off', trace: 'off', screenshot: 'off' });

test.describe('Responsive audit (visual + mechanical)', () => {
  test.setTimeout(30 * 60 * 1000); // 30 min ceiling — ~200 captures × ~5-7s

  test('full grid: 11 pages × 8 viewports', async ({ context }) => {
    // Fetch a replay id + create a fork-solo duel so the harness can capture
    // the in-game board. Both calls happen as the admin user (the context
    // will be authenticated when the harness logs in).

    // Step 1: replay id
    const loginRes = await context.request.post(`${BACK_URL}/api/login`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:admin').toString('base64') },
    });
    expect(loginRes.status(), 'admin login must succeed').toBe(200);

    const replaysRes = await context.request.get(`${BACK_URL}/api/replays?page=0&size=1`);
    expect(replaysRes.status(), 'GET /api/replays must succeed').toBe(200);
    const replays = await replaysRes.json();
    const replayId: string = replays.elements?.[0]?.id;
    expect(replayId, 'at least one replay required').toBeTruthy();
    console.log(`  Using replayId=${replayId}`);

    // Step 2: fork-solo room for the duel page
    // The quick-duel endpoint creates a solo duel with the same user on both
    // sides, returning a roomCode that resolves under /pvp/duel/{code}.
    let roomCode: string | undefined;
    try {
      const duelRes = await context.request.post(`${BACK_URL}/api/rooms/quick-duel`, {
        data: { decklistId1: DECK_ID, decklistId2: DECK_ID, firstPlayer: 0, skipShuffle: true, turnTimeSecs: 300 },
      });
      if (duelRes.status() === 200) {
        const duel = await duelRes.json();
        roomCode = duel.roomCode;
        console.log(`  Created fork-solo duel: roomCode=${roomCode}`);
      } else {
        console.warn(`  ⚠ quick-duel returned ${duelRes.status()} — duel page will be skipped`);
      }
    } catch (err) {
      console.warn(`  ⚠ quick-duel threw ${(err as Error).message} — duel page will be skipped`);
    }

    const catalog = buildPageCatalog({ replayId, deckId: DECK_ID, deckName: DECK_NAME, roomCode });

    const { outputDir, findings } = await runResponsiveAudit(context, catalog, DEFAULT_VIEWPORTS);

    console.log(`\n  → ${findings.length} captures written to ${outputDir}`);
    console.log(`  → Mechanical findings: see ${outputDir}/findings-mechanical.md`);
    console.log(`  → Visual review: walk through ${outputDir}/frames/`);

    // No throwing asserts here — every finding is intentionally captured.
    // The test passes as long as the harness ran to completion.
    expect(findings.length).toBeGreaterThan(0);
  });
});
