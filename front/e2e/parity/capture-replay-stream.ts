/**
 * Replay-side capture helper for the PvP↔Replay event stream parity test.
 *
 * Wraps `setupReplaySession` + the existing `ReplayDebugDriver` so the
 * parity spec can :
 *   1. Open a replay in the viewer.
 *   2. Play it to completion (skip-to-end if `fast=true`, normal playback
 *      otherwise).
 *   3. Capture the `_eventStream` accumulated during playback.
 *   4. Tear down cleanly.
 *
 * The capture is a snapshot of `AnimationOrchestratorService.eventStream()`
 * at the moment the duel has ended (DUEL_END / MSG_WIN observed by the
 * orchestrator and pushed to the stream). The stream is then passed
 * through `normalizeStream()` for structural comparison.
 *
 * v0 of the test uses `fast=true` (skip-to-end) because :
 *   - It's the only mode that's robust against viewport timing variations.
 *   - Normal playback would take minutes per fixture, blocking CI.
 *   - The stream content is independent of playback speed by design.
 *
 * If a future test wants to compare normal-playback streams (e.g. to
 * exercise the auto-advance scheduler), pass `fast=false`.
 */

import { type BrowserContext } from '@playwright/test';
import { setupReplaySession, type ReplayDebugSession } from '../replay-debug-driver';

export interface CaptureReplayStreamOptions {
  replayId: string;
  /** 0 (default) = OCGCore P0. 1 = the opposite side. */
  perspective?: 0 | 1;
  /** If true (default), skip-to-end via `driver.skipEnd()`. If false, run
   *  normal auto-playback to the natural end (much slower). */
  fast?: boolean;
  /** Output folder under `_bmad-output/debug-replay/`. Defaults to a
   *  parity-prefixed timestamped folder. */
  tag?: string;
  /** Max wait time after triggering end before reading the stream.
   *  Default 30s — generous because some replays have long final
   *  resolutions even at skip-to-end. */
  endTimeoutMs?: number;
}

export interface CapturedReplayStream {
  /** The raw `_eventStream` snapshot. Pass through `normalizeStream()`
   *  before comparing. */
  stream: readonly unknown[];
  /** Final `currentIndex` reached. */
  finalIndex: number;
  /** `boardStates.length - 1` from the precompute. Use to assert we
   *  actually reached the end. */
  totalStates: number;
  /** Number of events captured (useful for log breadcrumbs). */
  eventCount: number;
  /** Reference to the session for callers wanting to do additional
   *  inspection before finalize(). */
  session: ReplayDebugSession;
}

/**
 * Capture the EventStream from a replay run. Caller MUST call
 * `result.session.finalize()` then close the BrowserContext when done.
 */
export async function captureReplayStream(
  ctx: BrowserContext,
  opts: CaptureReplayStreamOptions,
): Promise<CapturedReplayStream> {
  const session = await setupReplaySession(ctx, {
    replayId: opts.replayId,
    perspective: opts.perspective ?? 0,
    tag: opts.tag ?? `parity-replay-${opts.replayId.slice(0, 8)}`,
  });

  const driver = session.driver;
  const fast = opts.fast ?? true;
  const endTimeout = opts.endTimeoutMs ?? 30_000;

  // Wait for board states to be loaded enough to seek (precompute streams
  // chunks, so we may need to wait a moment). Short replays may have as
  // few as 5-7 states, hence the low minimum threshold.
  await waitForBoardStates(session, 3);

  if (fast) {
    // Disable animations to skip the visual pipeline. The orchestrator
    // still runs through every event (so `_eventStream` accumulates
    // the full duel content), but each animation completes ~instantly.
    // Then start auto-playback : the replay loops through every state.
    // This gives a more reliable "drain" than `skipEnd()` because the
    // playback engine handles the precompute streaming + queue draining
    // for us (Replay-as-max-rate-PvP doctrine).
    // Keep animations ENABLED — disabling them makes the transport use
    // `adapter.jumpToState()` which aborts the processor + wipes the
    // event stream we want to capture. Instead we play through with
    // animations on and let the queue runner drain naturally. The
    // replay uses `feedTransition` / `feedTransitionPhased` which
    // pushes events through `processor.processMessage` → orchestrator
    // queue → `pushToStream` as the runner dequeues them. The trade-off
    // is wall-clock time (~30-60s per replay) — acceptable for a v0
    // harness, can be optimised later by injecting a "fast playback"
    // mode that keeps animations on but at 4x speed.
    if (!(await driver.isPlaying())) {
      await driver.playPause();
    }
    await waitForNaturalEnd(session, endTimeout);
  } else {
    // Normal playback to the end. Loops on `isPlaying` + `currentIndex`
    // to detect natural completion.
    await driver.playPause(); // start playback
    await waitForNaturalEnd(session, endTimeout);
  }

  // Even with skipEnd, the pipeline may still have a few async animations
  // flushing. Wait for the queue to drain.
  await waitForQueueDrain(session, endTimeout);

  // Capture the stream snapshot.
  const stream = await session.page.evaluate(() => {
    const w = window as unknown as {
      __skytrixDebug?: { captureEventStream?: () => readonly unknown[] };
    };
    return w.__skytrixDebug?.captureEventStream?.() ?? [];
  });

  const finalIndex = await driver.currentIndex();
  const totalStates = await driver.totalBoardStates();

  return {
    stream,
    finalIndex,
    totalStates,
    eventCount: stream.length,
    session,
  };
}

async function waitForBoardStates(
  session: ReplayDebugSession,
  minStates: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const total = await session.driver.totalBoardStates();
    if (total >= minStates) return;
    await session.page.waitForTimeout(100);
  }
  throw new Error(
    `captureReplayStream: only ${await session.driver.totalBoardStates()} board states after ${timeoutMs}ms`,
  );
}

async function waitForNaturalEnd(session: ReplayDebugSession, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const playing = await session.driver.isPlaying();
    if (!playing) {
      const cur = await session.driver.currentIndex();
      const tot = await session.driver.totalBoardStates();
      if (cur >= tot - 1) return;
    }
    await session.page.waitForTimeout(200);
  }
  throw new Error(`captureReplayStream: playback did not end within ${timeoutMs}ms`);
}

/**
 * Wait for `__skytrixDebug.snapshot().animationQueue` to be empty AND
 * `chain.phase === 'idle'`. Belt-and-braces — after skipEnd both are
 * usually true within a few ms, but we don't want to capture a stream
 * that's still being mutated.
 */
async function waitForQueueDrain(session: ReplayDebugSession, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const drained = await session.page.evaluate(() => {
      const w = window as unknown as {
        __skytrixDebug?: { snapshot?: () => { animationQueue: unknown[]; chain: { phase: string } } };
      };
      const snap = w.__skytrixDebug?.snapshot?.();
      if (!snap) return false;
      return snap.animationQueue.length === 0 && snap.chain.phase === 'idle';
    });
    if (drained) return;
    await session.page.waitForTimeout(100);
  }
  throw new Error(`captureReplayStream: queue did not drain within ${timeoutMs}ms`);
}
