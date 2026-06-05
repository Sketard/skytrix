/**
 * SOLO bootstrap deadlock harness — Axel reports the SOLO duel page
 * stays stuck on "starting new duel..." after the ANIMATIONS_READY +
 * F1 review patches landed. Server logs show the worker spawns and
 * emits MSG_DRAW × 2 + SELECT_CHAIN + BOARD_STATE; the client snapshot
 * shows EMPTY_DUEL_STATE. The gap is somewhere between WS receive and
 * pipeline dispatch.
 *
 * This harness :
 *   1. Spins up a SOLO duel via /api/duels/from-replay (dev-only),
 *      seeded from the radiant-typhoon-vision-discard fixture.
 *   2. Hooks `page.on('websocket')` to capture EVERY frame in both
 *      directions with timestamps.
 *   3. Hooks `page.on('console')` and `page.on('pageerror')` to capture
 *      all errors / warnings.
 *   4. Polls `__skytrixDebug.snapshot()` every 500ms for 20s.
 *   5. Dumps everything to `_bmad-output/debug-replay/solo-bootstrap-deadlock/`
 *      so the developer can read the raw evidence.
 *
 * Run :
 *   PW_AUTO_STACK=1 E2E_DUEL_SERVER_URL=http://localhost:13001 \
 *     npx playwright test e2e/debug/solo-bootstrap-deadlock.spec.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { BASE_URL, ADMIN, loginViaUI } from '../helpers';

const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? 'dev-internal-key';
const DUEL_SERVER_URL = process.env['E2E_DUEL_SERVER_URL'] ?? 'http://localhost:3001';

// Default fixture — same as parity test
const DEFAULT_REPLAY_ID = '18a55f97-7076-4716-9032-dcf88c9a86f4';

interface WsFrame {
  direction: 'in' | 'out';
  timestampMs: number;
  /** Raw text (if JSON, kept verbatim). */
  payload: string;
  /** Parsed `type` field if the payload was JSON. */
  type?: string;
}

interface ConsoleMessage {
  timestampMs: number;
  level: string;
  text: string;
  location?: { url: string; lineNumber: number };
}

interface SnapshotPoll {
  timestampMs: number;
  snapshot: Record<string, unknown>;
}

interface DebugCapture {
  startedAt: number;
  duelId: string;
  wsFrames: WsFrame[];
  consoleMessages: ConsoleMessage[];
  pageErrors: { timestampMs: number; message: string; stack?: string }[];
  snapshots: SnapshotPoll[];
}

export interface SoloBootstrapDeadlockOptions {
  /** Replay ID to seed the SOLO duel from. Defaults to the radiant-typhoon
   *  fixture used by the parity test. */
  replayId?: string;
  /** Capture window after navigation, in ms. Default 20s. */
  captureMs?: number;
  /** Snapshot poll interval, in ms. Default 500. */
  pollIntervalMs?: number;
  /** Output tag. */
  tag?: string;
}

export async function runSoloBootstrapDeadlockHarness(
  ctx: BrowserContext,
  opts: SoloBootstrapDeadlockOptions = {},
): Promise<string> {
  const replayId = opts.replayId ?? DEFAULT_REPLAY_ID;
  const captureMs = opts.captureMs ?? 20_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const tag = opts.tag ?? 'solo-bootstrap-deadlock';

  const outDir = resolve(__dirname, '../../../_bmad-output/debug-replay', tag);
  mkdirSync(outDir, { recursive: true });

  // Step 1 — POST /api/duels/from-replay
  // eslint-disable-next-line no-console
  console.log(`[harness] POST ${DUEL_SERVER_URL}/api/duels/from-replay { replayId: ${replayId} }`);
  const createResp = await ctx.request.post(`${DUEL_SERVER_URL}/api/duels/from-replay`, {
    headers: { 'X-Internal-Key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
    data: { replayId },
  });
  if (!createResp.ok()) {
    throw new Error(
      `harness: POST /api/duels/from-replay failed with ${createResp.status()}: ${await createResp.text()}`,
    );
  }
  const { duelId, wsTokens } = await createResp.json() as { duelId: string; wsTokens: string[] };
  if (!duelId || !wsTokens?.[0]) {
    throw new Error(`harness: invalid response shape: ${JSON.stringify({ duelId, wsTokens })}`);
  }
  const wsToken1 = wsTokens[0];

  // eslint-disable-next-line no-console
  console.log(`[harness] duelId=${duelId} wsToken1=${wsToken1.slice(0, 8)}...`);

  // Step 2 — Open a page, log in, inject session storage
  const page = await ctx.newPage();
  await loginViaUI(page, ADMIN);

  const soloTokensKey = `solo-duel-tokens-${duelId}`;
  await page.addInitScript(({ key, payload }: { key: string; payload: string }) => {
    sessionStorage.setItem(key, payload);
  }, { key: soloTokensKey, payload: JSON.stringify({ wsToken1, activePlayer: 0, decklistId: null }) });

  const startedAt = Date.now();
  const capture: DebugCapture = {
    startedAt,
    duelId,
    wsFrames: [],
    consoleMessages: [],
    pageErrors: [],
    snapshots: [],
  };

  // Hook WS frames BEFORE navigation
  page.on('websocket', (ws) => {
    const url = ws.url();
    // eslint-disable-next-line no-console
    console.log(`[harness] WS opened: ${url}`);
    ws.on('framereceived', (frame) => {
      const payload = frame.payload as string;
      let type: string | undefined;
      try { type = (JSON.parse(payload) as { type?: string }).type; } catch { /* not JSON */ }
      capture.wsFrames.push({
        direction: 'in',
        timestampMs: Date.now() - startedAt,
        payload,
        type,
      });
    });
    ws.on('framesent', (frame) => {
      const payload = frame.payload as string;
      let type: string | undefined;
      try { type = (JSON.parse(payload) as { type?: string }).type; } catch { /* not JSON */ }
      capture.wsFrames.push({
        direction: 'out',
        timestampMs: Date.now() - startedAt,
        payload,
        type,
      });
    });
    ws.on('close', () => {
      // eslint-disable-next-line no-console
      console.log(`[harness] WS closed`);
    });
  });

  // Hook console messages
  page.on('console', (msg) => {
    const loc = msg.location();
    capture.consoleMessages.push({
      timestampMs: Date.now() - startedAt,
      level: msg.type(),
      text: msg.text(),
      location: loc.url ? { url: loc.url, lineNumber: loc.lineNumber } : undefined,
    });
  });

  // Hook page errors (uncaught exceptions)
  page.on('pageerror', (err) => {
    capture.pageErrors.push({
      timestampMs: Date.now() - startedAt,
      message: err.message,
      stack: err.stack,
    });
  });

  // Step 3 — Navigate
  // eslint-disable-next-line no-console
  console.log(`[harness] navigating to ${BASE_URL}/pvp/duel/${duelId}?solo=true`);
  await page.goto(`${BASE_URL}/pvp/duel/${duelId}?solo=true`);

  // Step 4 — Poll snapshot every pollIntervalMs for captureMs total
  const deadline = startedAt + captureMs;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => {
      try {
        const w = window as unknown as { __skytrixDebug?: { snapshot?: () => Record<string, unknown> } };
        return w.__skytrixDebug?.snapshot?.() ?? null;
      } catch (e) {
        return { __captureError: (e as Error).message };
      }
    });
    if (snap !== null) {
      capture.snapshots.push({
        timestampMs: Date.now() - startedAt,
        snapshot: snap as Record<string, unknown>,
      });
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  // eslint-disable-next-line no-console
  console.log(`[harness] capture window done — ${capture.wsFrames.length} WS frames, ${capture.consoleMessages.length} console messages, ${capture.pageErrors.length} page errors, ${capture.snapshots.length} snapshots`);

  // Dump everything
  writeFileSync(resolve(outDir, 'ws-frames.json'), JSON.stringify(capture.wsFrames, null, 2));
  writeFileSync(resolve(outDir, 'console-messages.json'), JSON.stringify(capture.consoleMessages, null, 2));
  writeFileSync(resolve(outDir, 'page-errors.json'), JSON.stringify(capture.pageErrors, null, 2));
  writeFileSync(resolve(outDir, 'snapshots.json'), JSON.stringify(capture.snapshots, null, 2));

  // Final screenshot for visual confirmation
  await page.screenshot({ path: resolve(outDir, 'final.png'), fullPage: false });

  // Summary
  const summary = buildSummary(capture);
  writeFileSync(resolve(outDir, 'summary.md'), summary);

  await page.close();
  return outDir;
}

function buildSummary(capture: DebugCapture): string {
  const lines: string[] = [];
  lines.push('# SOLO bootstrap deadlock harness report');
  lines.push('');
  lines.push(`- **duelId** : ${capture.duelId}`);
  lines.push(`- **WS frames** : ${capture.wsFrames.length}`);
  lines.push(`- **Console messages** : ${capture.consoleMessages.length}`);
  lines.push(`- **Page errors** : ${capture.pageErrors.length}`);
  lines.push(`- **Snapshots polled** : ${capture.snapshots.length}`);
  lines.push('');

  // Frames by direction × type
  const frameTypes: Record<string, { in: number; out: number }> = {};
  for (const f of capture.wsFrames) {
    const type = f.type ?? '(unknown)';
    frameTypes[type] ??= { in: 0, out: 0 };
    frameTypes[type][f.direction]++;
  }
  lines.push('## WS frames by type × direction');
  lines.push('');
  lines.push('| Type | ↓ in | ↑ out |');
  lines.push('|---|---|---|');
  for (const type of Object.keys(frameTypes).sort()) {
    lines.push(`| ${type} | ${frameTypes[type].in} | ${frameTypes[type].out} |`);
  }
  lines.push('');

  // WS frame timeline (first 60 frames)
  lines.push('## WS frame timeline (first 60)');
  lines.push('');
  lines.push('| t (ms) | dir | type | payload (50 char preview) |');
  lines.push('|---|---|---|---|');
  for (const f of capture.wsFrames.slice(0, 60)) {
    const preview = f.payload.length > 50 ? f.payload.slice(0, 50) + '…' : f.payload;
    lines.push(`| ${f.timestampMs} | ${f.direction === 'in' ? '↓' : '↑'} | ${f.type ?? '?'} | \`${preview.replace(/\|/g, '\\|')}\` |`);
  }
  lines.push('');

  // Page errors
  if (capture.pageErrors.length > 0) {
    lines.push('## Page errors (uncaught exceptions)');
    lines.push('');
    for (const e of capture.pageErrors) {
      lines.push(`### ${e.timestampMs}ms — ${e.message}`);
      lines.push('');
      lines.push('```');
      lines.push(e.stack ?? '(no stack)');
      lines.push('```');
      lines.push('');
    }
  } else {
    lines.push('## Page errors');
    lines.push('');
    lines.push('_None._');
    lines.push('');
  }

  // Console errors + warnings
  const errors = capture.consoleMessages.filter(m => m.level === 'error');
  const warnings = capture.consoleMessages.filter(m => m.level === 'warning' || m.level === 'warn');
  lines.push(`## Console errors (${errors.length})`);
  lines.push('');
  for (const e of errors.slice(0, 30)) {
    lines.push(`- **${e.timestampMs}ms** : ${e.text}`);
    if (e.location) lines.push(`  - at ${e.location.url}:${e.location.lineNumber}`);
  }
  lines.push('');
  lines.push(`## Console warnings (${warnings.length}) — first 30`);
  lines.push('');
  for (const w of warnings.slice(0, 30)) {
    lines.push(`- **${w.timestampMs}ms** : ${w.text}`);
  }
  lines.push('');

  // Final snapshot
  const lastSnapshot = capture.snapshots[capture.snapshots.length - 1];
  if (lastSnapshot) {
    lines.push('## Final snapshot (last polled)');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(lastSnapshot.snapshot, null, 2).slice(0, 2000));
    lines.push('```');
  }

  return lines.join('\n');
}
