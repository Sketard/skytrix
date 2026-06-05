/**
 * SOLO↔Replay event stream parity test — Phase 0 of chantier v4
 * (anim-pipeline-v4-replay-unification).
 *
 * For each replay fixture, runs the same duel twice :
 *   1. In SOLO multiplex mode via the dev-only `/api/duels/from-replay`
 *      endpoint with a server-side tape player auto-responding from the
 *      replay's captured playerResponses.
 *   2. In Replay mode via the regular replay viewer + ReplayDuelAdapter.
 *
 * Then captures the `AnimationOrchestratorService._eventStream` from
 * both runs, normalizes them (strips ref/timestamp/traceId/lpDelta +
 * filters animation flux + internal transport events), and asserts they
 * are structurally equal.
 *
 * The first divergence — if any — is printed with a context window via
 * `findFirstDivergence()` so the failure is actionable rather than
 * dumping a 50-page JSON diff.
 *
 * Expected outcome of the FIRST run (2026-06-05) : we don't know if the
 * 2 streams are already identical or if there are pre-existing
 * divergences. Each fixture's failure becomes a finding that informs
 * either (a) a bug fix or (b) an addition to the normalize filter list.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { captureSoloStream, checkFromReplayEndpointAvailable } from './capture-solo-stream';
import { captureReplayStream } from './capture-replay-stream';
import { normalizeStream, findFirstDivergence } from './normalize-stream';

// Playwright loads spec files via pirates in CJS mode (see playwright.config.ts
// comment) so `__dirname` is defined globally. `import.meta.url` throws here.
const PARITY_DUMP_DIR = resolve(__dirname, '../../../_bmad-output/debug-replay/parity-dump');

interface ParityFixture {
  id: string;
  replayId: string;
  description: string;
  /** If known, the perspective to use for replay capture. SOLO always
   *  bootstraps from P0 → use perspective 0 on the replay too for direct
   *  comparison. */
  replayPerspective: 0 | 1;
}

/**
 * v0 fixture set — starts with ONE simple duel to validate the harness.
 * Add more fixtures incrementally as the test stabilises (see parity
 * spec doc § Pré-requis B for the target 5-6 cas-tordus).
 */
const PARITY_FIXTURES: readonly ParityFixture[] = [
  {
    id: 'radiant-typhoon-vision-discard',
    // Axel-suggested fixture for v0 harness validation. This is a
    // well-understood scenario (debug-radiant-typhoon-draw-discard
    // tests already exist around it ; Options G+H + F10 doctrine all
    // exercise this duel). Discard cost + self-destroy chain — a
    // good stress test for the harness across chain-resolving events.
    replayId: '18a55f97-7076-4716-9032-dcf88c9a86f4',
    description: 'Radiant Typhoon Vision discard cost + self-destroy chain.',
    replayPerspective: 0,
  },
];

test.describe('SOLO↔Replay event stream parity', () => {
  test.beforeAll(async ({ browser }) => {
    // Probe the from-replay endpoint once at startup so all per-fixture
    // tests get a clear error early if it's disabled (production gate).
    const ctx = await browser.newContext();
    try {
      await checkFromReplayEndpointAvailable(ctx);
    } finally {
      await ctx.close();
    }
  });

  for (const fixture of PARITY_FIXTURES) {
    test(`${fixture.id} — streams structurally identical`, async ({ browser }) => {
      // Two separate contexts so the runs don't share auth state or
      // localStorage. Reduces interference from one capture polluting
      // the other.
      const soloCtx = await browser.newContext();
      const replayCtx = await browser.newContext();

      try {
        // Run in parallel — each path is independent. Cuts wall-clock
        // roughly in half. If one throws, the other still completes
        // before Promise.all rejects.
        const [soloResult, replayResult] = await Promise.all([
          captureSoloStream(soloCtx, { replayId: fixture.replayId }),
          captureReplayStream(replayCtx, {
            replayId: fixture.replayId,
            perspective: fixture.replayPerspective,
            tag: `parity-${fixture.id}-replay`,
          }),
        ]);

        // eslint-disable-next-line no-console
        console.log(
          `[parity:${fixture.id}] SOLO captured ${soloResult.eventCount} events, ` +
          `Replay captured ${replayResult.eventCount} events`,
        );

        const soloNormalized = normalizeStream(soloResult.stream);
        const replayNormalized = normalizeStream(replayResult.stream);

        // Dump the normalized streams + raw streams to disk so divergence
        // analysis doesn't depend on re-running the test. Useful when the
        // divergence is several events deep and the console diff isn't
        // enough to reason about it.
        try {
          mkdirSync(PARITY_DUMP_DIR, { recursive: true });
          const base = `${PARITY_DUMP_DIR}/${fixture.id}`;
          writeFileSync(`${base}-solo-normalized.json`, JSON.stringify(soloNormalized, null, 2));
          writeFileSync(`${base}-replay-normalized.json`, JSON.stringify(replayNormalized, null, 2));
          writeFileSync(`${base}-solo-raw.json`, JSON.stringify(soloResult.stream, null, 2));
          writeFileSync(`${base}-replay-raw.json`, JSON.stringify(replayResult.stream, null, 2));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[parity:${fixture.id}] dump failed: ${(e as Error).message}`);
        }

        // Find the first structural divergence — gives a precise,
        // actionable error message before Playwright dumps the full diff.
        const divergence = findFirstDivergence(soloNormalized, replayNormalized);
        if (divergence) {
          // eslint-disable-next-line no-console
          console.log(`\n[parity:${fixture.id}] DIVERGENCE\n${divergence.context}\n`);
        }

        // Finalize the replay session AFTER the comparison so the report.md
        // file captures the divergence message too.
        await replayResult.session.finalize();

        // The actual assertion — toEqual gives the full structured diff
        // in the test failure UI, complementing the divergence printout.
        expect(replayNormalized).toEqual(soloNormalized);
      } finally {
        await soloCtx.close();
        await replayCtx.close();
      }
    });
  }
});
