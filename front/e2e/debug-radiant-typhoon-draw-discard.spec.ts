import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { setupReplaySession } from './replay-debug-driver';

/**
 * Ad-hoc debug spec — replay 11f6e3ec @ seekTo=2 (Radiant Typhoon Vision).
 *
 * User-reported (replay): "draws still land on the LEFT instead of right;
 * the discard MOVE→GY disappears from the GY; the spell that activated
 * the chain (Radiant Typhoon Vision) stays on the field AND ends up
 * locking GY-0".
 *
 * Sequence in this replay state:
 *   - MSG_CHAINING (Radiant Typhoon Vision activates from S5)
 *   - MSG_DRAW cards=2 (mid-game draw — post-fix should batch-reserve
 *     2 expansion slots upfront, no clearLandedTravels between)
 *   - MSG_SHUFFLE_HAND
 *   - MSG_MOVE HAND→GY  (the cost — discard from hand)
 *   - MSG_CHAIN_SOLVED
 *   - MSG_MOVE S5→GY    (Radiant Typhoon Vision self-destroys)
 *   - MSG_CHAIN_END
 *
 * Probes capture HAND DOM state, GY pile + landed-float prefixes, and
 * any in-flight float with a HAND or GY dstKey so we can pinpoint when
 * a float vanishes or a lock leaks.
 */

const REPLAY_ID = '11f6e3ec-d32b-45d3-9fb0-ded9e6d51fbd';
const SEEK_TO = 2;

const FULL_CAPTURE_PREFIXES = [
  '[ANIM:QUEUE]', '[ANIM:MOVE]', '[ANIM:DRAW]', '[ANIM:SHUFFLE]',
  '[ANIM:CHAIN]', '[ANIM:PROC]', '[ANIM:LP]', '[ANIM:RESOLVE]',
  '[ANIM:PIPELINE]', '[ANIM:RUNNER]', '[ANIM:REPLAY]', '[ANIM]',
  '[skytrix-debug]',
];

test('replay seek=2 Radiant Typhoon — draw 2 + discard sequence', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

  const denseLog: Array<{ t: number; type: string; text: string }> = [];
  const tStart = Date.now();

  const session = await setupReplaySession(ctx, {
    replayId: REPLAY_ID,
    perspective: 0,
    fromEvent: SEEK_TO,
    buildFirst: false,
    tag: 'radiant-typhoon-draw-discard',
  });

  session.page.on('console', msg => {
    const text = msg.text();
    if (FULL_CAPTURE_PREFIXES.some(p => text.includes(p))) {
      denseLog.push({ t: (Date.now() - tStart) / 1000, type: msg.type(), text });
    }
  });

  try {
    // Wait for precompute to settle.
    let prevTotal = -1;
    let stableTicks = 0;
    while (stableTicks < 6) {
      const cur = await session.driver.totalBoardStates();
      if (cur === prevTotal) stableTicks++;
      else { stableTicks = 0; prevTotal = cur; }
      await session.page.waitForTimeout(500);
    }

    const total = await session.driver.totalBoardStates();
    const startIdx = await session.driver.currentIndex();
    // eslint-disable-next-line no-console
    console.log(`[radiant] total=${total}, startIdx=${startIdx}`);

    // Inspect events at this state + the following few — verify we caught
    // the right window (MSG_CHAINING + MSG_DRAW + MSG_SHUFFLE_HAND +
    // MSG_MOVE HAND→GY ... MSG_MOVE S5→GY).
    for (let i = Math.max(0, startIdx); i < Math.min(total, startIdx + 6); i++) {
      await session.driver.seek(i);
      const events = await session.driver.currentStateEventTypes();
      // eslint-disable-next-line no-console
      console.log(`[radiant] state ${i} events=${JSON.stringify(events)}`);
    }

    await session.driver.seek(SEEK_TO);
    denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'marker',
      text: `=== MARKER === reseeking to ${SEEK_TO}, about to play` });

    await session.capture('baseline');
    await session.driver.playPause();

    // DOM probe: HAND-0 expansion/real counts + visibility-hidden +
    // realCodes; GY-0 pile count; landed/inFlight by zone prefix; any
    // float with dstKey starting with HAND-0 or GY-0.
    const probe = async () => {
      const stats = await session.page.evaluate(() => {
        const out: Record<string, unknown> = {};
        // HAND-0
        const handRow = document.querySelector<HTMLElement>('app-pvp-hand-row[data-zone="HAND-0"]');
        if (handRow) {
          const expansion = handRow.querySelectorAll('.hand-card--expansion').length;
          const real = handRow.querySelectorAll('.hand-card:not(.hand-card--expansion)').length;
          const hidden = Array.from(handRow.querySelectorAll<HTMLElement>('.hand-card'))
            .filter(el => el.style.visibility === 'hidden').length;
          const realCodes = Array.from(handRow.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--expansion)'))
            .map(el => el.dataset['cardCode'] ?? '?');
          out['hand0'] = { expansion, real, hidden, realCodes };
        }
        // GY-0 — find any zone container marked GY-0 (data-zone attr or zone-pile + GY)
        const gyZone = document.querySelector<HTMLElement>('[data-zone="GY-0"]');
        if (gyZone) {
          out['gy0DataZone'] = { exists: true, html: gyZone.outerHTML.slice(0, 200) };
        }
        // Travel floats
        const w = window as unknown as { __skytrixDebug?: { snapshot?: () => { landedFloats?: Array<{ dstKey: string; cardCode?: string }>; inFlightFloats?: Array<{ dstKey: string; cardCode?: string }>; lockedZoneKeys?: string[] } } };
        const snap = w.__skytrixDebug?.snapshot?.();
        out['inFlight'] = snap?.inFlightFloats ?? [];
        out['landed'] = snap?.landedFloats ?? [];
        out['locks'] = snap?.lockedZoneKeys ?? [];
        return out;
      });
      denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'probe',
        text: `[PROBE] ${JSON.stringify(stats)}` });
    };

    const deadline = Date.now() + 30_000;
    let lastIdx = -1;
    while (Date.now() < deadline) {
      const idx = await session.driver.currentIndex();
      if (idx !== lastIdx) {
        denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'marker',
          text: `=== MARKER === currentIndex flipped to ${idx}` });
        lastIdx = idx;
      }
      await probe();
      if (idx >= startIdx + 5) break;
      await session.page.waitForTimeout(80);
    }

    await session.capture(`after-play-idx${lastIdx}`);
    denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'marker',
      text: `=== MARKER === exiting bug window at idx=${lastIdx}` });

    const dumpPath = path.join(session.outDir, 'dense-log.txt');
    fs.writeFileSync(dumpPath, denseLog
      .map(l => `[t=${l.t.toFixed(3)}s][${l.type}] ${l.text}`)
      .join('\n'), 'utf8');

    // eslint-disable-next-line no-console
    console.log(`[radiant] dense log lines = ${denseLog.length}, written to ${dumpPath}`);
  } finally {
    await session.finalize();
    await session.page.close().catch(() => undefined);
    await ctx.close();
  }
});
