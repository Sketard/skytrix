/**
 * Post-F10 unification visual pass (2026-06-12) — anti-unmasking sweep.
 *
 * The F10 cadence alignment (commit c0b47657) removed the replay-side
 * tier-2 `syncRendered` that the per-flush BOARD_STATE used to trigger
 * before MSG_CHAINING. If any animation handler silently relied on that
 * aggressive sync to rescue a missing commit, the residue now shows as
 * `renderedState !== logicalState` once playback ends and the queue is
 * idle. This spec plays the most event-dense replays of Axel's DB
 * end-to-end (animations ON — the real pipeline) and asserts the
 * rendered/logical convergence at the end, plus zero console warnings
 * worth flagging in the session report.
 *
 * Fixture set picked 2026-06-12 from the local DB (responses DESC) :
 * the D/D/D "Imported R&D" raw-replay import is the stress king
 * (830 stream messages, 24 chains, 273 prompts).
 *
 * Run : PW_AUTO_STACK=1 npx playwright test e2e/debug/post-f10-visual-pass.spec.ts --timeout=1500000
 * (replays must exist in the isolated DB — `node scripts/dev-stack.mjs sync-db`)
 */

import { test, expect } from '@playwright/test';
import { setupReplaySession } from '../replay-debug-driver';

interface PassFixture {
  id: string;
  label: string;
  /** Rough prompt count (drives the wall-clock budget : ~1.2s each). */
  prompts: number;
}

const FIXTURES: readonly PassFixture[] = [
  { id: '03a953d9-1904-473b-8d5b-5ede24c007e9', label: 'ddd-imported-rnd', prompts: 273 },
  { id: '68a50639-40cb-43d3-9e2e-a8510236e96b', label: 'radiant-vs-archdemon-156', prompts: 157 },
  { id: 'd2db3e0d-34c9-42c7-af91-069128deb898', label: 'regenese-153', prompts: 154 },
  { id: 'ba08f69a-11f2-4186-9d6b-81011ad3c194', label: 'radiant-vs-archdemon-98', prompts: 99 },
  { id: '324c86aa-27c6-4448-9794-97d3f7edc4e1', label: 'hero-masque-67', prompts: 68 },
];

interface EndSnapshot {
  chain: { phase: string; activeLinks: readonly unknown[] };
  locks: readonly string[];
  animationQueue: readonly unknown[];
  logicalState: { players: unknown[]; turnCount: number; phase: string };
  renderedState: { players: unknown[]; turnCount: number; phase: string };
}

/** The zones[] array order is NOT significant (consumers read by zoneId ;
 *  logical comes from the server BS order, rendered accretes via commits).
 *  Sort it so the deep-equal compares content, not accidents of ordering. */
function normalizeState(state: { players: unknown[] }): unknown {
  return {
    ...state,
    players: state.players.map(p => {
      const player = p as { zones?: { zoneId: string }[] };
      return {
        ...player,
        zones: player.zones ? [...player.zones].sort((a, b) => a.zoneId.localeCompare(b.zoneId)) : player.zones,
      };
    }),
  };
}

for (const f of FIXTURES) {
  test(`post-F10 — ${f.label} plays to the end with rendered ≡ logical`, async ({ browser }) => {
    // Prompt auto-dismiss is a fixed 1.2s — budget generously.
    test.setTimeout(Math.max(300_000, f.prompts * 1_700 + 180_000));
    const ctx = await browser.newContext();
    const session = await setupReplaySession(ctx, {
      replayId: f.id,
      perspective: 0,
      tag: `post-f10-${f.label}`,
    });
    try {
      await session.driver.waitForBoardStates(3);
      // F10-bis — debug-only fast prompts : 100ms instead of the product
      // 1.2s, so the 273-prompt D/D/D plays in ~2 min instead of ~10.
      await session.driver.setPromptDelay(100);
      if (!(await session.driver.isPlaying())) {
        await session.driver.playPause();
      }

      // End criterion : cursor on the last nav entry AND animation queue
      // drained AND playback no longer running. Deliberately NOT
      // isPlaying-only (the F21 family showed how that lies).
      const deadline = Date.now() + f.prompts * 1_600 + 120_000;
      let snap: EndSnapshot | null = null;
      for (;;) {
        if (Date.now() > deadline) throw new Error(`playback did not reach the end for ${f.label}`);
        const cur = await session.driver.currentIndex();
        const tot = await session.driver.totalBoardStates();
        if (tot > 0 && cur >= tot - 1) {
          snap = await session.driver.fullSnapshot() as EndSnapshot;
          if (snap.animationQueue.length === 0) break;
        }
        await session.page.waitForTimeout(1_000);
      }
      await session.capture('end-state');

      // Soft report : a stream that ends mid-chain leaves phase != idle
      // (known P2 "mock MSG_WIN skips processor.reset") — log, don't fail.
      if (snap.chain.phase !== 'idle') {
        // eslint-disable-next-line no-console
        console.warn(`[post-f10:${f.label}] ends with chainPhase=${snap.chain.phase} links=${snap.chain.activeLinks.length} (known P2 if mid-chain end)`);
      }

      // Hard asserts — the anti-unmasking contract :
      // no zombie locks, and rendered has converged onto logical.
      expect(snap.locks, 'no lock may survive the end of playback').toEqual([]);
      if (snap.chain.phase === 'idle') {
        expect(normalizeState(snap.renderedState), 'rendered must equal logical at idle end')
          .toEqual(normalizeState(snap.logicalState));
      } else {
        // Mid-chain end : zones may legitimately lag. Still pin the
        // global metadata so a gross desync cannot hide.
        expect(snap.renderedState.turnCount, 'turnCount desync at mid-chain end').toBe(snap.logicalState.turnCount);
      }
    } finally {
      await session.finalize();
      await session.page.close();
      await ctx.close();
    }
  });
}
