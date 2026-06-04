import { test } from '@playwright/test';
import { setupReplaySession } from './replay-debug-driver';

const REPLAY_ID = 'a1eed2d6-5bad-486a-b743-9639b8049790';

test('F9-bis diagnostic — dump chainSnapshot of every state', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const session = await setupReplaySession(ctx, {
    replayId: REPLAY_ID,
    perspective: 0,
    buildFirst: false,
    tag: 'f9-bis-diagnostic',
  });

  try {
    // Wait until precompute stable.
    let prevTotal = -1, stable = 0;
    while (stable < 6) {
      const cur = await session.driver.totalBoardStates();
      if (cur === prevTotal) stable++;
      else { stable = 0; prevTotal = cur; }
      await session.page.waitForTimeout(500);
    }

    const total = await session.driver.totalBoardStates();
    // eslint-disable-next-line no-console
    console.log(`[DIAG] total states = ${total}`);

    for (let i = 0; i < total; i++) {
      await session.driver.seek(i);
      const snap = await session.driver.currentStateChainSnapshot();
      const live = await session.driver.chainState();
      const events = await session.driver.currentStateEventTypes();
      const linkCount = snap ? snap.links.length : 0;
      const liveCount = live.activeChainLinks.length;
      // eslint-disable-next-line no-console
      console.log(`[DIAG] idx=${i} snapshot=${snap ? `phase=${snap.phase} links=${linkCount} negated=${JSON.stringify(snap.negatedIndices)} solving=${snap.currentSolvingChainIndex}` : 'null'} | live: phase=${live.phase} links=${liveCount}`);
      // eslint-disable-next-line no-console
      console.log(`[DIAG]    events: ${events.join(', ')}`);
      if (snap && snap.links.length > 0) {
        const labels = snap.links.map((l) => {
          const link = l as { chainIndex: number; cardName: string; player: number };
          return `CL${link.chainIndex}:${link.cardName}(P${link.player})`;
        }).join(' | ');
        // eslint-disable-next-line no-console
        console.log(`[DIAG]    └─ links: ${labels}`);
      }
    }

    // Now: jump to event 0 (boot-like), then to mid-chain, capture each
    await session.driver.seek(0);
    await session.capture('seek-0');
    const at0 = await session.driver.chainState();
    // eslint-disable-next-line no-console
    console.log(`[DIAG] at index 0: live.phase=${at0.phase} links=${at0.activeChainLinks.length}`);
  } finally {
    await session.finalize();
    await session.page.close().catch(() => undefined);
    await ctx.close();
  }
});
