import { test, expect } from '@playwright/test';
import { setupReplaySession } from './replay-debug-driver';

/**
 * F9-bis verification spec — confirms that mid-chain seek restores
 * `activeChainLinks` + `chainPhase` from the `PreComputedState.chainSnapshot`.
 *
 * The bug pre-fix: seeking into a chain wipes `processor.reset()` and
 * never re-feeds the prior `MSG_CHAINING` events → chain overlay + chain
 * badges stay empty even though the target state is semantically inside
 * a chain.
 *
 * Verification strategy:
 *   1. Open a known replay that contains at least one multi-link chain.
 *   2. Scan the precomputed `boardStates` for a state where
 *      `chainSnapshot !== undefined` (the precompute embeds the snapshot
 *      on every state captured while `chainPhase !== 'idle'`).
 *   3. Seek to that index via the driver (same path the timeline click
 *      uses — fires `abortAndClean()` + `gameLogRebuildTick++`).
 *   4. Read the live `chainState()` from the processor and assert
 *      `activeChainLinks.length === chainSnapshot.links.length`,
 *      `chainPhase === chainSnapshot.phase`, and the resolving link is
 *      flipped when `currentSolvingChainIndex !== null`.
 *
 * Drive-by checks: also seek back to event 0 (no chain) and confirm the
 * overlay clears, so the F9-bis branch is not stuck-on.
 *
 * The reference replay is the EMZ exemplar from `debug-replay-example.spec.ts`
 * — it contains a 2-link Synchro chain that's been used for several
 * pipeline-regression specs. If the replay is missing or its precompute
 * surface no longer matches the assumptions, the spec fails-fast with a
 * clear message rather than spinning.
 */

const REPLAY_ID = 'a1eed2d6-5bad-486a-b743-9639b8049790';

test('F9-bis mid-chain seek restores chain overlay + badges', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const session = await setupReplaySession(ctx, {
    replayId: REPLAY_ID,
    perspective: 0,
    buildFirst: false,
    tag: 'f9-bis-mid-chain-seek',
  });

  try {
    // Wait for the precompute to settle — some replays are short. We poll
    // for a stable count instead of a fixed floor: when totalBoardStates
    // stops growing for ~3s, the precompute is done.
    let prevTotal = -1;
    let stableTicks = 0;
    while (stableTicks < 6) {
      const cur = await session.driver.totalBoardStates();
      if (cur === prevTotal) stableTicks++;
      else { stableTicks = 0; prevTotal = cur; }
      await session.page.waitForTimeout(500);
    }

    // Discover the first mid-chain state. We can't hard-code the index
    // because precompute timing depends on the OCG state machine — but
    // any state with `chainSnapshot !== null` is a valid target. Iterate
    // through the precomputed states and pick the first one carrying a
    // snapshot.
    const total = await session.driver.totalBoardStates();
    let midChainIdx = -1;
    let midChainSnapshot: Awaited<ReturnType<typeof session.driver.currentStateChainSnapshot>> = null;
    for (let i = 1; i < total; i++) {
      await session.driver.seek(i);
      const snap = await session.driver.currentStateChainSnapshot();
      if (snap) {
        midChainIdx = i;
        midChainSnapshot = snap;
        break;
      }
    }

    // Diagnostic log so the report carries this even if assertions pass.
    // eslint-disable-next-line no-console
    console.log(`[F9-bis] total states = ${total}, mid-chain idx = ${midChainIdx}`);

    if (midChainIdx < 0 || !midChainSnapshot) {
      throw new Error(
        `No PreComputedState with chainSnapshot found in the first ${total} states. ` +
        `Either the replay has no chains or the precompute is not embedding snapshots. ` +
        `Check that C2 (replay-precompute.ts) was applied correctly.`,
      );
    }

    await session.capture('found-mid-chain-state');

    // Snapshot the chain state from the live processor — should match
    // the precompute's embedded snapshot.
    const chainStateAfterSeek = await session.driver.chainState();

    // ───── F9-bis assertions ─────

    expect(chainStateAfterSeek.activeChainLinks.length).toBe(midChainSnapshot.links.length);
    expect(chainStateAfterSeek.phase).toBe(midChainSnapshot.phase);

    // currentSolvingChainIndex propagation: when the snapshot designates
    // an in-resolution link, the live processor must have flipped its
    // `resolving` flag (otherwise the in-resolution link would not be
    // visually distinguished — UX regression).
    if (midChainSnapshot.currentSolvingChainIndex !== null) {
      const solving = chainStateAfterSeek.activeChainLinks.find(
        l => l.chainIndex === midChainSnapshot!.currentSolvingChainIndex,
      );
      expect(solving).toBeDefined();
      expect(solving!.resolving).toBe(true);
    }

    // negatedIndices propagation
    for (const negIdx of midChainSnapshot.negatedIndices) {
      const link = chainStateAfterSeek.activeChainLinks.find(l => l.chainIndex === negIdx);
      expect(link?.negated).toBe(true);
    }

    // ───── Drive-by: seek to event 0 (outside any chain) ─────
    // The chain overlay must clear when we land back outside any chain.
    await session.driver.seek(0);
    await session.capture('after-seek-to-zero');
    const chainStateAtZero = await session.driver.chainState();
    expect(chainStateAtZero.activeChainLinks.length).toBe(0);
    expect(chainStateAtZero.phase).toBe('idle');

    // ───── Drive-by: re-seek to the mid-chain index (idempotency) ─────
    await session.driver.seek(midChainIdx);
    await session.capture('after-reseek-mid-chain');
    const chainStateReseek = await session.driver.chainState();
    expect(chainStateReseek.activeChainLinks.length).toBe(midChainSnapshot.links.length);
    expect(chainStateReseek.phase).toBe(midChainSnapshot.phase);

    // ───── Regression guard for the "all-states-share-same-array" bug
    //       (precompute defensive-copy fix, 2026-06-04) ─────
    // Without the [...container.activeChainLinks] copy, every flushed
    // chainSnapshot pointed at the SAME array, so by the time the
    // precompute finished pushing all N links, all N states' snapshots
    // displayed the FINAL link count instead of growing from 1 to N.
    // Walk every mid-chain state and assert that its links.length is
    // monotonically non-decreasing — a state that lights up before its
    // predecessor would surface the regression.
    let lastLinkCount = 0;
    for (let i = 0; i < total; i++) {
      await session.driver.seek(i);
      const snap = await session.driver.currentStateChainSnapshot();
      if (!snap) continue;
      expect(snap.links.length).toBeGreaterThanOrEqual(lastLinkCount);
      lastLinkCount = snap.links.length;
    }
  } finally {
    await session.finalize();
    await session.page.close().catch(() => undefined);
    await ctx.close();
  }
});
