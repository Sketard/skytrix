import { test } from '@playwright/test';
import { setupReplaySession } from './replay-debug-driver';

/**
 * Diagnostic for the "discarded chain link card → second copy in hand gets
 * the badge" bug reported 2026-06-04. The replay at seek=7 has a Faimena
 * P0 activated from hand (CL2), its cost discards the activated copy, and
 * a second Faimena remains in hand. The badge for CL3 (= chainIndex 2 + 1)
 * incorrectly lands on the second copy.
 *
 * The diagnostic dumps:
 *   - the chain link's `location` + `sequence` (snapshot)
 *   - the current HAND-0 contents (cardCode + position)
 *   - the boardState players[0].zones["HAND"] to see what the renderer sees
 */

const REPLAY_ID = 'a1eed2d6-5bad-486a-b743-9639b8049790';

// Diagnostic spec — kept around for future F9-bis investigations but
// skipped by default. The test has no assertions (only console.log dumps)
// and the discard-fix is regression-pinned by `chain-badge.utils.spec.ts`
// + `pre-process-hand-counts.spec.ts`. To run it manually, flip
// `test.skip` → `test`.
test.skip('Diagnose discard chain link badge bug at seek=7', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const session = await setupReplaySession(ctx, {
    replayId: REPLAY_ID,
    perspective: 0,
    buildFirst: false,
    tag: 'f9-bis-discard-bug',
  });

  try {
    await session.driver.waitUntilPrecomputeStable();

    await session.driver.seek(7);
    await session.capture('at-seek-7');

    const chain = await session.driver.chainState();
    // eslint-disable-next-line no-console
    console.log('[DIAG] chain phase=' + chain.phase);
    for (const link of chain.activeChainLinks) {
      const hcac = (link as unknown as { handCopiesAtChaining?: number }).handCopiesAtChaining;
      // eslint-disable-next-line no-console
      console.log(`[DIAG]   link CL${link.chainIndex} (badge ${link.chainIndex + 1}): card=${link.cardName} (code=${link.cardCode}) player=${link.player} location=${link.location} sequence=${link.sequence} handCopiesAtChaining=${hcac ?? 'n/a'}`);
    }

    // Dump the rendered board's HAND-0 + HAND-1 contents so we can see
    // where each Faimena copy lives.
    const handContents = await session.page.evaluate(() => {
      const w = window as unknown as { __skytrixDebug?: { snapshot?: () => unknown } };
      const snap = w.__skytrixDebug?.snapshot?.() as { logicalState?: { players?: Array<{ zones?: Array<{ zoneId: string; cards: Array<{ cardCode: number; name?: string }> }> }> } } | null;
      const handZone = (player: 0 | 1) => {
        const zones = snap?.logicalState?.players?.[player]?.zones ?? [];
        const hand = zones.find(z => z.zoneId === 'HAND');
        return hand ? hand.cards.map((c, i) => `[${i}] ${c.name ?? '?'} (${c.cardCode})`) : ['<no HAND zone>'];
      };
      return { p0: handZone(0), p1: handZone(1) };
    });
    // eslint-disable-next-line no-console
    console.log('[DIAG] HAND-0 (own):');
    handContents.p0.forEach(line => console.log('[DIAG]   ' + line));  // eslint-disable-line no-console
    // eslint-disable-next-line no-console
    console.log('[DIAG] HAND-1 (opp):');
    handContents.p1.forEach(line => console.log('[DIAG]   ' + line));  // eslint-disable-line no-console

    // Also: GY contents to confirm the activated Faimena is there.
    const gyContents = await session.page.evaluate(() => {
      const w = window as unknown as { __skytrixDebug?: { snapshot?: () => unknown } };
      const snap = w.__skytrixDebug?.snapshot?.() as { logicalState?: { players?: Array<{ zones?: Array<{ zoneId: string; cards: Array<{ cardCode: number; name?: string }> }> }> } } | null;
      const gyZone = (player: 0 | 1) => {
        const zones = snap?.logicalState?.players?.[player]?.zones ?? [];
        const gy = zones.find(z => z.zoneId === 'GY');
        return gy ? gy.cards.map((c, i) => `[${i}] ${c.name ?? '?'} (${c.cardCode})`) : ['<no GY zone>'];
      };
      return { p0: gyZone(0), p1: gyZone(1) };
    });
    // eslint-disable-next-line no-console
    console.log('[DIAG] GY-0:');
    gyContents.p0.forEach(line => console.log('[DIAG]   ' + line));  // eslint-disable-line no-console
    // eslint-disable-next-line no-console
    console.log('[DIAG] GY-1:');
    gyContents.p1.forEach(line => console.log('[DIAG]   ' + line));  // eslint-disable-line no-console
  } finally {
    await session.finalize();
    await session.page.close().catch(() => undefined);
    await ctx.close();
  }
});
