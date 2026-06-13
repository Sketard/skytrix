/**
 * Cluster tutor D/D/D diagnostic (2026-06-12) — MOVE DECK→HAND r=64 lost
 * on the SOLO side at tape 100ms (plays fine at 250ms — pacing-dependent).
 *
 * Wire-vs-wire objectivation showed BOTH wires agree
 * (MOVE → CONFIRM → SHUFFLE_HAND → SHUFFLE_DECK → SOLVED → CHAIN_END,
 * CONFIRM tagged chainIndex=0 on both since f8004451) — the loss is
 * client-side. The solo raw dump dispatches [SH, SD, CONFIRM] without the
 * MOVE, which FIFO + builder semantics cannot produce from a buffer of
 * [MOVE, CONFIRM, SH, SD] — so something wipes/reorders the chain buffer.
 *
 * This spec replays the SOLO leg at the FAILING pacing (100ms) with the
 * full verbose log set and dumps console + final stream to
 * _bmad-output/debug-solo/ddd-tutor-window/ for offline correlation
 * around the 4 Dark Contract search windows (Copernicus 46796664,
 * Gryphon 28406301, Headhunt 91781484, Eternal Darkness 9030160).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { BASE_URL, ADMIN, loginViaUI } from '../helpers';

const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? 'dev-internal-key';
const DUEL_SERVER_URL = process.env['E2E_DUEL_SERVER_URL'] ?? 'http://localhost:3001';
const REPLAY_ID = '03a953d9-1904-473b-8d5b-5ede24c007e9';
const OUT_DIR = resolve(__dirname, '../../../_bmad-output/debug-solo/ddd-tutor-window');

test('D/D/D tutor window diagnostic — tape 100ms, full verbose logs', async ({ browser }) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleLines: string[] = [];
  const t0 = Date.now();
  const stamp = (): string => ((Date.now() - t0) / 1000).toFixed(2).padStart(7);
  page.on('console', msg => { consoleLines.push(`[${stamp()}] ${msg.text()}`); });
  page.on('pageerror', err => { consoleLines.push(`[${stamp()}] [PAGEERROR] ${err.message}\n${err.stack ?? ''}`); });

  // 1. from-replay SOLO duel at the FAILING tape pacing (100ms).
  const createResp = await ctx.request.post(`${DUEL_SERVER_URL}/api/duels/from-replay`, {
    headers: { 'X-Internal-Key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
    data: { replayId: REPLAY_ID, responseDelayMs: 100 },
  });
  if (!createResp.ok()) throw new Error(`from-replay failed: ${createResp.status()}`);
  const { duelId, wsTokens } = await createResp.json() as { duelId: string; wsTokens: string[] };

  // 2. Login + tokens + verbose categories + anim-speed 1 (catch-up on this
  //    fixture is bounded by safety guards, which 0.2 stretches ×7.5).
  await loginViaUI(page, ADMIN);
  await page.addInitScript(({ key, payload }: { key: string; payload: string }) => {
    sessionStorage.setItem(key, payload);
    localStorage.setItem('duel-log-categories', 'PIPELINE,QUEUE,CHAIN,PROC,RUNNER,REPLAY,MOVE');
    localStorage.setItem('duel-anim-speed', '1');
  }, {
    key: `solo-duel-tokens-${duelId}`,
    payload: JSON.stringify({ wsToken1: wsTokens[0], activePlayer: 0, decklistId: null }),
  });

  // 3. Open the duel.
  await page.goto(`${BASE_URL}/pvp/duel/${duelId}?solo=true`);
  await page.waitForFunction(() =>
    !!(window as unknown as { __skytrixDebug?: unknown }).__skytrixDebug, undefined, { timeout: 30_000 });

  // 4. Tape exhaustion then stable drain.
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('tape did not exhaust in time');
    const st = await ctx.request.get(`${DUEL_SERVER_URL}/api/duels/${duelId}/tape-status`,
      { headers: { 'X-Internal-Key': INTERNAL_API_KEY } });
    if (st.status() === 404) break;
    const body = await st.json() as { cursor: number; total: number };
    if (body.cursor >= body.total) break;
    await page.waitForTimeout(2_000);
  }
  let stable = 0;
  let lastLen = -1;
  const drainDeadline = Date.now() + 300_000;
  while (stable < 5 && Date.now() < drainDeadline) {
    const probe = await page.evaluate(() => {
      const w = window as unknown as {
        __skytrixDebug?: {
          snapshot?: () => { animationQueue: unknown[]; chain: { phase: string } };
          captureEventStream?: () => readonly unknown[];
        };
      };
      return {
        queueLen: w.__skytrixDebug?.snapshot?.().animationQueue.length ?? -1,
        streamLen: w.__skytrixDebug?.captureEventStream?.().length ?? -1,
      };
    });
    stable = probe.streamLen === lastLen && probe.queueLen === 0 ? stable + 1 : 0;
    lastLen = probe.streamLen;
    await page.waitForTimeout(2_000);
  }

  // 5. Dump everything for offline analysis.
  const finals = await page.evaluate(() => {
    const w = window as unknown as {
      __skytrixDebug?: { snapshot?: () => unknown; captureEventStream?: () => readonly unknown[] };
    };
    return {
      stream: w.__skytrixDebug?.captureEventStream?.() ?? [],
      snapshot: w.__skytrixDebug?.snapshot?.() ?? null,
    };
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/console.log`, consoleLines.join('\n'));
  writeFileSync(`${OUT_DIR}/stream.json`, JSON.stringify(finals.stream));
  writeFileSync(`${OUT_DIR}/end-snapshot.json`, JSON.stringify(finals.snapshot, null, 2));

  const tutorMoves = (finals.stream as Array<{ type?: string; cardCode?: number; fromLocation?: number; toLocation?: number; reason?: number }>)
    .filter(e => e.type === 'MSG_MOVE' && e.fromLocation === 1 && e.toLocation === 2 && e.reason === 64)
    .map(e => e.cardCode);
  // eslint-disable-next-line no-console
  console.log(`[ddd-tutor-diag] duelId=${duelId} streamLen=${finals.stream.length} tutorMovesDispatched=${JSON.stringify(tutorMoves)} consoleLines=${consoleLines.length}`);

  await page.close();
  await ctx.close();
});
