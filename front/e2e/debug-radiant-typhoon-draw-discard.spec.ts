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

const REPLAY_ID = '18a55f97-7076-4716-9032-dcf88c9a86f4';
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
        // 2026-06-04 — extended DOM probe to investigate signal-vs-DOM
        // disconnect. Capture every direct visual child of the zone +
        // its key attrs (img.src, data-card-code, style.visibility,
        // style.opacity, classList).
        const inspectZone = (selector: string) => {
          const zone = document.querySelector<HTMLElement>(selector);
          if (!zone) return { exists: false };
          // Match any descendant with a card-like signature: img with src
          // ending in a numeric .jpg/.png, or any element with data-card-code.
          const imgs = Array.from(zone.querySelectorAll<HTMLImageElement>('img'));
          const imgDetails = imgs.map(img => {
            const src = img.src ?? '';
            const m = src.match(/\/(\d+)\.(jpg|png|webp)/);
            return {
              code: m ? m[1] : '?',
              src: src.slice(-40),
              visibility: img.style.visibility || 'visible',
              opacity: img.style.opacity || '',
              display: img.style.display || '',
              classes: img.className,
              hidden: img.hidden,
              parentTag: img.parentElement?.tagName ?? '',
              parentVisibility: img.parentElement?.style?.visibility || 'visible',
            };
          });
          // Any element with data-card-code attribute (may not be img — e.g.
          // float, card overlay component).
          const cardEls = Array.from(zone.querySelectorAll<HTMLElement>('[data-card-code]'));
          const cardDetails = cardEls.map(el => ({
            tag: el.tagName,
            code: el.dataset['cardCode'] ?? '?',
            visibility: el.style.visibility || 'visible',
            display: el.style.display || '',
            classes: el.className,
          }));
          // Outer HTML head (first 250 chars) for raw inspection.
          const html = zone.outerHTML.slice(0, 250);
          return {
            exists: true,
            imgCount: imgs.length,
            imgs: imgDetails,
            cardEls: cardDetails,
            zoneVisibility: zone.style.visibility || 'visible',
            zoneOpacity: zone.style.opacity || '',
            html,
          };
        };
        out['gy0'] = inspectZone('[data-zone="GY-0"]');
        out['s5'] = inspectZone('[data-zone="S5-0"]');
        // Also probe globally for any floating element whose dataset says it
        // belongs to S5-0 or GY-0 (the travel floats are NOT inside the zone).
        const allFloats = Array.from(document.querySelectorAll<HTMLElement>('[data-float-dst-key]'));
        out['floatsInDOM'] = allFloats.map(f => ({
          dst: f.dataset['floatDstKey'] ?? '?',
          code: f.dataset['cardCode'] ?? '?',
          visibility: f.style.visibility || 'visible',
          opacity: f.style.opacity || '',
        }));
        // Travel floats
        const w = window as unknown as { __skytrixDebug?: { snapshot?: () => { landedFloats?: Array<{ dstKey: string; cardCode?: string }>; inFlightFloats?: Array<{ dstKey: string; cardCode?: string }>; lockedZoneKeys?: string[] } } };
        const snap = w.__skytrixDebug?.snapshot?.();
        out['inFlight'] = snap?.inFlightFloats ?? [];
        out['landed'] = snap?.landedFloats ?? [];
        out['locks'] = snap?.lockedZoneKeys ?? [];
        // F-bug-radiant — expose chain + queue + buffer states for deadlock diagnosis.
        const fullSnap = w.__skytrixDebug?.snapshot?.() as Record<string, unknown> | undefined;
        out['qLen'] = (fullSnap?.['animationQueue'] as unknown[] | undefined)?.length ?? null;
        const chain = fullSnap?.['chain'] as { phase?: string; activeChainLinks?: unknown[] } | undefined;
        out['chainPhase'] = chain?.phase ?? null;
        out['chainLinks'] = chain?.activeChainLinks?.length ?? null;
        out['busy'] = (fullSnap?.['isAnimating'] ?? null);
        // Also probe the replay adapter directly for its `busy()` signal
        // and current step queue length — they're not in the standard
        // snapshot.
        const w2 = window as unknown as { __skytrixDebug?: { replay?: { isPlaying?: () => boolean; currentIndex?: () => number; totalBoardStates?: () => number } } };
        const r = w2.__skytrixDebug?.replay;
        out['replay'] = r ? {
          isPlaying: r.isPlaying?.() ?? null,
          currentIndex: r.currentIndex?.() ?? null,
          totalBoardStates: r.totalBoardStates?.() ?? null,
        } : null;
        return out;
      });
      denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'probe',
        text: `[PROBE] ${JSON.stringify(stats)}` });
    };

    const deadline = Date.now() + 60_000;
    let lastIdx = -1;
    while (Date.now() < deadline) {
      const idx = await session.driver.currentIndex();
      if (idx !== lastIdx) {
        denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'marker',
          text: `=== MARKER === currentIndex flipped to ${idx}` });
        lastIdx = idx;
      }
      await probe();
      // F-bug-radiant — must let the replay run long enough to reach
      // state 4 (MSG_CHAIN_END) so we can verify that `handleChainEnd`
      // drains the residual `_bufferedBoardEvents` (the post-resolution
      // MSG_MOVE for Radiant Typhoon Vision's self-destroy). Going to
      // startIdx+3 cut the run BEFORE CHAIN_END arrived; the buffered
      // MOVE never animated and the GY-0 lock leaked.
      if (idx >= startIdx + 8) break;
      // 2026-06-04 — faster probe to catch sub-frame DOM transitions
      // (every ~25ms during the bug window vs 80ms originally).
      await session.page.waitForTimeout(25);
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
