/**
 * SOLO-side capture helper for the PvP↔Replay event stream parity test.
 *
 * Flow :
 *   1. POST `/api/duels/from-replay` (dev-only endpoint, see
 *      `duel-server/src/server.ts`) with the replayId. Server bootstraps
 *      a SOLO multiplex session seeded from the replay + attaches a
 *      tape player. Returns `{ duelId, wsTokens: [token0] }`.
 *   2. Inject `wsToken1` into sessionStorage at the expected key
 *      (`solo-duel-tokens-${duelId}`) so the front bootstrap reads it
 *      as if it came from a router-state navigation.
 *   3. Navigate to `/pvp/duel/${duelId}?solo=true`.
 *   4. The front opens 1 WS, sends the token, server starts the worker.
 *      The tape player auto-responds to every SELECT_*.
 *   5. Wait for the duel to end (MSG_WIN / DUEL_END pushed to stream).
 *   6. Capture `__skytrixDebug.captureEventStream()`.
 *
 * Used by `event-stream-parity.spec.ts` to capture the SOLO-side stream
 * for structural comparison against the replay-mode stream of the same
 * duel.
 */

import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, BACK_URL, ADMIN, loginViaUI } from '../helpers';

const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? 'dev-internal-key';
const DUEL_SERVER_URL = process.env['E2E_DUEL_SERVER_URL'] ?? 'http://localhost:3001';

export interface CaptureSoloStreamOptions {
  replayId: string;
  /** Max wait time for the duel to end after navigation. Default 60s —
   *  generous for replays with long resolutions even at tape speed. */
  endTimeoutMs?: number;
  /** Max wait for the client animation queue to drain AFTER tape
   *  exhaustion. Default 30s ; dense fixtures need minutes. */
  queueDrainTimeoutMs?: number;
}

export interface CapturedSoloStream {
  /** Raw `_eventStream` snapshot. Pass through `normalizeStream()`
   *  before comparing. */
  stream: readonly unknown[];
  /** The duelId the server allocated. */
  duelId: string;
  /** Number of events captured. */
  eventCount: number;
  /** Final winner if available (from snapshot.logicalState or MSG_WIN). */
  winner: number | null;
}

/**
 * Capture the EventStream from a SOLO multiplex run seeded from a replay.
 *
 * Opens a fresh page via the provided context. Caller is responsible for
 * closing the page (or letting the test runner do it on teardown).
 *
 * The "end" criterion is **tape player exhaustion** (every captured
 * playerResponse has been dispatched to the worker) + queue drain on the
 * client. NOT MSG_WIN — the original replay may have ended by surrender
 * or inactivity, and we want a consistent end criterion regardless.
 */
export async function captureSoloStream(
  ctx: BrowserContext,
  opts: CaptureSoloStreamOptions,
): Promise<CapturedSoloStream> {
  const endTimeout = opts.endTimeoutMs ?? 60_000;

  // Step 1 — POST /api/duels/from-replay
  const createResp = await ctx.request.post(`${DUEL_SERVER_URL}/api/duels/from-replay`, {
    headers: { 'X-Internal-Key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
    data: { replayId: opts.replayId },
  });
  if (!createResp.ok()) {
    throw new Error(
      `captureSoloStream: POST /api/duels/from-replay failed with ${createResp.status()}: ${await createResp.text()}`,
    );
  }
  const { duelId, wsTokens } = await createResp.json() as { duelId: string; wsTokens: string[] };
  if (!duelId || !wsTokens?.[0]) {
    throw new Error(`captureSoloStream: invalid response shape: ${JSON.stringify({ duelId, wsTokens })}`);
  }
  const wsToken1 = wsTokens[0];

  // Step 2 — Open a page, log in (cookies needed by AuthService), inject
  // the token into sessionStorage so the SOLO bootstrap reads it like
  // any other SOLO-via-QuickDuel run would.
  const page = await ctx.newPage();
  await loginViaUI(page, ADMIN);

  // Inject sessionStorage BEFORE navigating to the duel page — addInitScript
  // ensures the storage is set before any Angular code runs on the new URL.
  const soloTokensKey = `solo-duel-tokens-${duelId}`;
  await page.addInitScript(({ key, payload }: { key: string; payload: string }) => {
    sessionStorage.setItem(key, payload);
    // Étape 2 (2026-06-12) — dev-only 5× animation speed (see
    // devAnimSpeedMultiplier). The parity gate compares stream CONTENT,
    // not timing ; full-speed animations on dense fixtures (D/D/D :
    // 24 chains) made the SOLO leg take 10+ minutes.
    localStorage.setItem('duel-anim-speed', '0.2');
  }, { key: soloTokensKey, payload: JSON.stringify({ wsToken1, activePlayer: 0, decklistId: null }) });

  // Step 3 — Navigate to the duel
  await page.goto(`${BASE_URL}/pvp/duel/${duelId}?solo=true`);

  // Step 4 — Wait for the board to render (`__skytrixDebug` bound)
  await waitForDebugSurface(page);

  // Step 5 — Wait for tape exhaustion (server has dispatched all
  // captured responses to the worker). NOT MSG_WIN — see docstring.
  // Étape 2 — phase timers : the wall-clock is dominated by FIXED waits
  // (tape pacing × responses), not by animation durations — log the split
  // so speed-tuning targets the right knob.
  const tTapeStart = Date.now();
  await waitForTapeExhaustion(ctx, duelId, endTimeout);
  const tTapeDone = Date.now();

  // Belt-and-braces — wait for the queue to fully drain so the final
  // events have been pushed to the stream after the last tape response.
  // Dense fixtures (D/D/D: 24 chains queued at tape speed) need far more
  // than the original 10s — the client still ANIMATES everything the tape
  // raced through, and events only reach the stream at dispatch.
  await waitForQueueDrain(page, opts.queueDrainTimeoutMs ?? 30_000);
  const tDrained = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[parity:solo] timings tape=${((tTapeDone - tTapeStart) / 1000).toFixed(1)}s drain=${((tDrained - tTapeDone) / 1000).toFixed(1)}s`);

  // Step 6 — Capture the stream
  const stream = await page.evaluate(() => {
    const w = window as unknown as {
      __skytrixDebug?: { captureEventStream?: () => readonly unknown[] };
    };
    return w.__skytrixDebug?.captureEventStream?.() ?? [];
  });

  const winner = await page.evaluate(() => {
    const w = window as unknown as {
      __skytrixDebug?: { snapshot?: () => { logicalState: { winner?: number | null } } };
    };
    const snap = w.__skytrixDebug?.snapshot?.();
    return snap?.logicalState?.winner ?? null;
  });

  // v4 Phase 0 diagnostic — capture the preActivationBuffer + roomState
  // to verify the SOLO bootstrap reached `setBoardActive(true)` + drained
  // the parked initial-draw events. If the buffer is non-empty here, the
  // initial MSG_DRAW × 5 + cost MSG_MOVE were silently absorbed and never
  // pushed to _eventStream — root cause of the parity divergence.
  const diag = await page.evaluate(() => {
    const w = window as unknown as {
      __skytrixDebug?: {
        snapshot?: () => {
          preActivationBuffer?: ReadonlyArray<{ type: string }>;
          logicalState: { phase?: string };
        };
      };
    };
    const snap = w.__skytrixDebug?.snapshot?.();
    return {
      preActivationBuffer: snap?.preActivationBuffer ?? [],
      logicalPhase: snap?.logicalState?.phase ?? null,
    };
  });
  // eslint-disable-next-line no-console
  console.log(`[parity:solo] diagnostic preActivationBuffer=${JSON.stringify(diag.preActivationBuffer)} phase=${diag.logicalPhase}`);

  await page.close();

  return {
    stream,
    duelId,
    eventCount: stream.length,
    winner,
  };
}

async function waitForDebugSurface(page: Page, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const w = window as unknown as {
        __skytrixDebug?: { captureEventStream?: () => unknown };
      };
      return typeof w.__skytrixDebug?.captureEventStream === 'function';
    });
    if (ready) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`captureSoloStream: __skytrixDebug surface not bound within ${timeoutMs}ms`);
}

async function waitForTapeExhaustion(
  ctx: BrowserContext,
  duelId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastCursor = -1;
  let stallStart = Date.now();
  while (Date.now() < deadline) {
    const resp = await ctx.request.get(
      `${DUEL_SERVER_URL}/api/duels/${duelId}/tape-status`,
      { headers: { 'X-Internal-Key': INTERNAL_API_KEY } },
    );
    if (resp.status() === 404) {
      // Session ended + cleaned up — equivalent to "done" for our purposes.
      return;
    }
    if (!resp.ok()) {
      throw new Error(`waitForTapeExhaustion: tape-status returned ${resp.status()}`);
    }
    const { cursor, total, done, sessionEnded } = await resp.json() as {
      cursor: number; total: number; done: boolean; sessionEnded: boolean;
    };
    if (done || sessionEnded) return;
    // Track progress — if cursor hasn't advanced for 10s, the tape is
    // stalled (worker waiting for something the tape can't provide,
    // e.g. mismatch between captured responses and current prompt sequence).
    if (cursor !== lastCursor) {
      lastCursor = cursor;
      stallStart = Date.now();
    } else if (Date.now() - stallStart > 10_000) {
      throw new Error(
        `waitForTapeExhaustion: tape stalled at cursor ${cursor}/${total} for >10s — ` +
        `worker may be emitting prompts that don't match the captured response sequence.`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(
    `waitForTapeExhaustion: tape did not exhaust within ${timeoutMs}ms ` +
    `(last cursor ${lastCursor})`,
  );
}

async function waitForQueueDrain(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Étape 2 (2026-06-12) — STABILITY criterion, not an instant one. The
  // queue passes through `empty + idle` BETWEEN chains while the client is
  // still minutes behind the (already exhausted) tape — an instant check
  // captured the D/D/D at 122/858 stream events. Require the drained state
  // AND a stable stream length across 3 consecutive 1s probes.
  let stableCount = 0;
  let lastStreamLen = -1;
  while (Date.now() < deadline) {
    const probe = await page.evaluate(() => {
      const w = window as unknown as {
        __skytrixDebug?: {
          snapshot?: () => { animationQueue: unknown[]; chain: { phase: string } };
          captureEventStream?: () => readonly unknown[];
        };
      };
      const snap = w.__skytrixDebug?.snapshot?.();
      if (!snap) return null;
      return {
        drained: snap.animationQueue.length === 0 && snap.chain.phase === 'idle',
        streamLen: w.__skytrixDebug?.captureEventStream?.().length ?? -1,
      };
    });
    if (probe?.drained && probe.streamLen === lastStreamLen) {
      stableCount++;
      if (stableCount >= 3) return;
    } else {
      stableCount = 0;
    }
    lastStreamLen = probe?.streamLen ?? -1;
    await page.waitForTimeout(1_000);
  }
  // Not fatal — the stream may still be useful even if queue didn't drain
  // perfectly. The test will surface real divergences regardless.
}

/**
 * Convenience helper for the parity test : ensures the duel-server is
 * reachable and the from-replay endpoint exists. Call from `beforeAll`.
 */
export async function checkFromReplayEndpointAvailable(ctx: BrowserContext): Promise<void> {
  // Probe with an obviously-invalid replayId — we expect 400 or 404,
  // not 5xx or connection-refused. A 404 with code NOT_FOUND means the
  // endpoint is gated by IS_PRODUCTION → can't run the test against this
  // server.
  const probe = await ctx.request.post(`${DUEL_SERVER_URL}/api/duels/from-replay`, {
    headers: { 'X-Internal-Key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
    data: { replayId: '__parity-probe__' },
  });
  if (probe.status() === 404) {
    const body = await probe.json() as { code?: string };
    if (body.code === 'NOT_FOUND') {
      throw new Error(
        `captureSoloStream: /api/duels/from-replay is disabled (NODE_ENV=production). ` +
        `Run the duel-server with NODE_ENV != production to use the parity test.`,
      );
    }
    // REPLAY_NOT_FOUND — endpoint is up, expected.
    return;
  }
  // 502 REPLAY_FETCH_FAILED is also acceptable — Spring Boot returned 404 (not
  // 200) for the probe replayId, which our handler currently surfaces as 502.
  // Endpoint is reachable ; the actual fixture replay will be validated later.
  if (probe.status() === 502) {
    const body = await probe.json().catch(() => ({})) as { code?: string };
    if (body.code === 'REPLAY_FETCH_FAILED' || body.code === 'REPLAY_FETCH_ERROR') {
      return;
    }
  }
  if (probe.status() >= 500) {
    throw new Error(
      `captureSoloStream: /api/duels/from-replay returned ${probe.status()} — check duel-server logs`,
    );
  }
  // 400 = MISSING/INVALID — endpoint is reachable, expected.
}
