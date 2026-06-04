import { type BrowserContext } from '@playwright/test';
import { setupReplaySession } from './replay-debug-driver';

/**
 * Replay debug harness — produces a Markdown report + screenshots + JSON
 * snapshots for a given replay ID & perspective.
 *
 * **Legacy "play to end" wrapper.** Now a thin shell over the generic
 * `setupReplaySession` + `ReplayDebugDriver` toolkit in
 * `replay-debug-driver.ts`. Use the toolkit directly for any scenario
 * other than "open replay, play through to end" (see CLAUDE.md →
 * "Debugging Animations" for the scenario-based pattern).
 *
 * Two run modes:
 *   - `buildFirst: true`  (recommended) — runs `ng build` once, serves the
 *     static artifacts on a free port. ZERO HMR risk. ~30s overhead per spec
 *     file but constant across many replay runs in the same spec.
 *   - `buildFirst: false` — points at the user's running `ng serve` (the
 *     `BASE_URL` constant from helpers). Fast but risks HMR mid-replay
 *     truncating the capture.
 *
 * The harness writes everything to `_bmad-output/debug-replay/{date}-{tag}/`:
 *   - `report.md`       — Markdown timeline + warnings + key signals
 *   - `console.log`     — raw filtered console output with timestamps
 *   - `frames/`         — screenshots tagged with timestamp + label
 *   - `snapshots/`      — JSON dumps from window.__skytrixDebug.snapshot()
 *
 * Re-runs into the same `tag` overwrite. Use a unique tag (or default to a
 * timestamped folder) for archival.
 */

export interface ReplayDebugOptions {
  replayId: string;
  /** 0 = OCGCore player 0 (default). 1 = the opposite side. Bugs that only
   *  manifest from the opposite perspective (e.g. the EMZ data-zone bug
   *  fixed 2026-05-18) require explicit perspective=1 runs. */
  perspective?: 0 | 1;
  /** Skip to this event index before capturing. Saves wall-clock when the
   *  bug only manifests deep into a long replay. Uses the replay-page's
   *  `?seekTo=N` query param (the same mechanism the fork-return flow uses). */
  fromEvent?: number;
  /** Capture a screenshot + snapshot every time a console line containing
   *  the substring fires. Multiple substrings: pass as array. */
  screenshotOn?: string | string[];
  /** When true, runs `ng build` and serves the static output on a free port.
   *  Recommended for stable captures. Defaults to false. */
  buildFirst?: boolean;
  /** Output tag — folder name under `_bmad-output/debug-replay/`. */
  tag?: string;
  /** Max wall-clock seconds to wait for the replay to finish playing.
   *  Default 120s. */
  timeoutSec?: number;
}

/** The single entry point for the "play through to end" pattern. For
 *  scenario-based debugging (seek → toggle → assert), use
 *  `setupReplaySession` + `ReplayDebugDriver` directly. */
export async function runReplayDebug(ctx: BrowserContext, opts: ReplayDebugOptions): Promise<string> {
  const session = await setupReplaySession(ctx, {
    replayId: opts.replayId,
    perspective: opts.perspective,
    fromEvent: opts.fromEvent,
    buildFirst: opts.buildFirst,
    tag: opts.tag,
    screenshotOn: opts.screenshotOn,
  });

  try {
    await session.driver.playPause();
    const ended = await session.driver.waitForEndOverlay((opts.timeoutSec ?? 120) * 1000);
    await session.capture(ended ? 'final' : 'timeout');
  } finally {
    await session.finalize();
    await session.page.close().catch(() => undefined);
  }
  return session.outDir;
}

/** Marker so future spec files can grep their callsites. */
export const HARNESS_VERSION = '2.0.0';
