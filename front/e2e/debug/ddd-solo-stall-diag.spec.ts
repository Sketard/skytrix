/**
 * Étape 2 diagnostic (2026-06-12) — D/D/D SOLO client stall.
 *
 * The parity harness showed the SOLO client of the D/D/D from-replay duel
 * stops producing stream events at 122 while the server emitted 557
 * messages (tape fully exhausted 272/272, queue empty + chainPhase=idle,
 * STABLE, preActivationBuffer empty). ~435 messages never reach the
 * animation queue. This spec replays the SOLO leg alone with the PIPELINE
 * log category enabled and counts each pipeline stage from the console :
 *
 *   server EMIT (duel.log) → ws.recv → processMessage in → stream push
 *
 * The stage where the count collapses is the drop site. Console dump
 * goes to _bmad-output/debug-solo/ddd-stall-diag/.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { BASE_URL, ADMIN, loginViaUI } from '../helpers';

const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? 'dev-internal-key';
const DUEL_SERVER_URL = process.env['E2E_DUEL_SERVER_URL'] ?? 'http://localhost:3001';
const REPLAY_ID = '03a953d9-1904-473b-8d5b-5ede24c007e9';
const OUT_DIR = resolve(__dirname, '../../../_bmad-output/debug-solo/ddd-stall-diag');

test('D/D/D SOLO stall diagnostic — count pipeline stages', async ({ browser }) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleLines: string[] = [];
  page.on('console', msg => { consoleLines.push(msg.text()); });
  page.on('pageerror', err => { consoleLines.push(`[PAGEERROR] ${err.message}`); });

  // 1. Create the from-replay SOLO duel (250ms tape pacing — same as parity).
  const createResp = await ctx.request.post(`${DUEL_SERVER_URL}/api/duels/from-replay`, {
    headers: { 'X-Internal-Key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
    data: { replayId: REPLAY_ID },
  });
  if (!createResp.ok()) throw new Error(`from-replay failed: ${createResp.status()}`);
  const { duelId, wsTokens } = await createResp.json() as { duelId: string; wsTokens: string[] };

  // 2. Login + inject tokens + ENABLE the verbose pipeline categories.
  await loginViaUI(page, ADMIN);
  await page.addInitScript(({ key, payload }: { key: string; payload: string }) => {
    sessionStorage.setItem(key, payload);
    localStorage.setItem('duel-log-categories', 'PIPELINE,QUEUE,CHAIN,PROC,RUNNER');
    localStorage.setItem('duel-anim-speed', '0.2');
  }, {
    key: `solo-duel-tokens-${duelId}`,
    payload: JSON.stringify({ wsToken1: wsTokens[0], activePlayer: 0, decklistId: null }),
  });

  // 3. Open the duel.
  await page.goto(`${BASE_URL}/pvp/duel/${duelId}?solo=true`);
  await page.waitForFunction(() =>
    !!(window as unknown as { __skytrixDebug?: unknown }).__skytrixDebug, undefined, { timeout: 30_000 });

  // 4. Wait for tape exhaustion (server-side), then stable client drain.
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('tape did not exhaust in time');
    const st = await ctx.request.get(`${DUEL_SERVER_URL}/api/duels/${duelId}/tape-status`,
      { headers: { 'X-Internal-Key': INTERNAL_API_KEY } });
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

  // 5. Count the stages from the captured console.
  const count = (re: RegExp): number => consoleLines.filter(l => re.test(l)).length;
  const recv = count(/ws\.recv type=/);
  const procIn = count(/processMessage in:/);
  const enqueueDelta = count(/processMessage out:/);
  const parks = count(/preActivationDrain:park/);
  const buffering = count(/Buffering .* during chain resolution/);
  const warnLines = consoleLines.filter(l => /\[warning\]|WARN|Lock safety|rescue|POLL-DROP|skipped/i.test(l)).slice(0, 40);

  const snap = await page.evaluate(() => {
    const w = window as unknown as {
      __skytrixDebug?: { snapshot?: () => unknown; captureEventStream?: () => readonly unknown[] };
    };
    return {
      streamLen: w.__skytrixDebug?.captureEventStream?.().length ?? -1,
      snapshot: w.__skytrixDebug?.snapshot?.() ?? null,
    };
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/console.log`, consoleLines.join('\n'));
  writeFileSync(`${OUT_DIR}/summary.json`, JSON.stringify({
    duelId, recv, procIn, enqueueDelta, parks, buffering, streamLen: snap.streamLen, warnLines,
  }, null, 2));
  writeFileSync(`${OUT_DIR}/end-snapshot.json`, JSON.stringify(snap.snapshot, null, 2));

  // eslint-disable-next-line no-console
  console.log(`[ddd-diag] duelId=${duelId} ws.recv=${recv} processMessageIn=${procIn} out=${enqueueDelta} parks=${parks} buffering=${buffering} streamLen=${snap.streamLen}`);

  await page.close();
  await ctx.close();
});
