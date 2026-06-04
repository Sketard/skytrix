import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { setupReplaySession } from './replay-debug-driver';

/**
 * Ad-hoc debug spec — replay 03a953d9 @ seekTo=13.
 *
 * User-reported symptom: at this seek point, a card draws & travels to
 * HAND but the destination slot appears empty after landing. A shuffle
 * animation plays, then a slot ends up empty, and finally the card
 * "pops" into existence.
 *
 * Precompute discovery (from the previous run):
 *   - state 13: SELECT_PLACE + MSG_MOVE
 *   - state 14: chain  (MSG_CHAINING / SELECT_CHAIN / MSG_CHAIN_SOLVING / MSG_CHAIN_SOLVED)
 *   - state 15: MSG_CHAIN_END
 *   - state 16: chain with tutor + SHUFFLE_HAND + SHUFFLE_DECK
 *               (MSG_CHAINING, MSG_CHAIN_SOLVING, SELECT_CARD, MSG_MOVE,
 *                MSG_CONFIRM_CARDS, MSG_SHUFFLE_HAND, MSG_SHUFFLE_DECK,
 *                MSG_CHAIN_SOLVED)
 *   - state 17: MSG_CHAIN_END
 *
 * State 16 is where the bug manifests — a card is tutored to HAND
 * (MSG_MOVE), then a shuffle happens. Hypothesis to verify with the
 * captured logs:
 *   - the hand batch slot reservation may not match the final shuffled
 *     position (slot reserved at draw time vs. real index after shuffle)
 *   - OR the MOVE→HAND lock is released before the shuffle's slot
 *     update lands, leaving a momentarily empty rendered slot.
 *
 * This spec ships a dense log dump rather than many screenshots — the
 * user explicitly wants logs over captures.
 */

const REPLAY_ID = '03a953d9-1904-473b-8d5b-5ede24c007e9';
const SEEK_TO = 14;

// Categories of log lines to collect verbatim in the bug-window dump.
// Anything matching at least one of these prefixes is fully kept (not
// filtered through the standard isInterestingMessage predicate, which
// drops a lot of useful low-level QUEUE/MOVE/SHUFFLE detail).
const FULL_CAPTURE_PREFIXES = [
  '[ANIM:QUEUE]',
  '[ANIM:MOVE]',
  '[ANIM:DRAW]',
  '[ANIM:SHUFFLE]',
  '[ANIM:CHAIN]',
  '[ANIM:PROC]',
  '[ANIM:LP]',
  '[ANIM:RESOLVE]',
  '[ANIM:PIPELINE]',
  '[ANIM:RUNNER]',
  '[ANIM:REPLAY]',
  '[ANIM]',
  '[skytrix-debug]',
];

test('seek=13 draw+shuffle slot leak — dense log dump', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

  // We attach our own dense log collector BEFORE setupReplaySession (which
  // also attaches one, but filtered). Both can coexist.
  const denseLog: Array<{ t: number; type: string; text: string }> = [];
  const tStart = Date.now();

  const session = await setupReplaySession(ctx, {
    replayId: REPLAY_ID,
    perspective: 0,
    fromEvent: SEEK_TO,
    buildFirst: false,
    tag: 'seek13-draw-shuffle',
    // No screenshotOn triggers — too noisy. We take a fixed small set of
    // captures explicitly below.
  });

  // Attach the dense collector on the page that setupReplaySession created.
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
    console.log(`[seek13] total=${total}, startIdx=${startIdx}`);

    // Baseline capture (seek to 13).
    await session.capture(`baseline-at-${startIdx}`);

    // Mark the log so we can find this section easily in the dump.
    denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'marker',
      text: `=== MARKER === entering bug window, about to play from idx ${startIdx} (target idx 16 = tutor + shuffle)` });

    // Play through the bug window. Default 1× playback rate. We let it
    // run until idx ≥ 18 (past the shuffle) OR ~25s wall-clock so we
    // also catch the batch-end / endHandBatch tail (expansion slot
    // teardown) AFTER processShuffleEvent's commitAll.
    await session.driver.playPause();

    // Probe the DOM every 80ms for:
    //   - handExpansionSlots count (real `.hand-card--expansion` elements)
    //   - real card count (`.hand-card:not(.hand-card--expansion)`)
    //   - landed floats count (window.__skytrixDebug.snapshot().landedFloats)
    //   - any `.hand-card` with style.visibility === 'hidden'
    //
    // This narrows the perceived "slot empty" window without spamming
    // captures: each probe is ONE log line.
    const probe = async () => {
      const stats = await session.page.evaluate(() => {
        const handRows = Array.from(document.querySelectorAll('app-pvp-hand-row'));
        const out: Array<Record<string, unknown>> = [];
        for (const row of handRows) {
          const expansion = row.querySelectorAll('.hand-card--expansion').length;
          const real = row.querySelectorAll('.hand-card:not(.hand-card--expansion)').length;
          const hidden = Array.from(row.querySelectorAll<HTMLElement>('.hand-card'))
            .filter(el => el.style.visibility === 'hidden').length;
          const realCodes = Array.from(row.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--expansion)'))
            .map(el => el.dataset['cardCode'] ?? '?');
          out.push({ row: row.getAttribute('data-zone') ?? '?', expansion, real, hidden, realCodes });
        }
        const w = window as unknown as { __skytrixDebug?: { snapshot?: () => { landedFloats?: unknown; inFlightFloats?: unknown; lockedZoneKeys?: unknown } } };
        const snap = w.__skytrixDebug?.snapshot?.();
        // Hunt for travel-float DOM nodes carrying cardCode 46796664 (the
        // tutored card). Surface their style.left/top vs viewport rect so we
        // can detect a `stabilizeFloat` teleportation bug — if styleLeft
        // (container-local-assumed) and rectLeft (viewport) drift by
        // containerLeft, the float jumped offscreen.
        const containerRect = document.querySelector('.board-host')?.getBoundingClientRect();
        const allDivs = Array.from(document.querySelectorAll<HTMLElement>('div'));
        const floatEls = allDivs.filter(el => {
          if (el.dataset['cardCode'] === '46796664') return true;
          const img = el.querySelector('img');
          if (img && (img.src.includes('46796664') || img.getAttribute('src')?.includes('46796664'))) return true;
          return false;
        }).filter(el => {
          // Drop the real hand-card matches — only keep travel-floats (no class hand-card)
          return !el.classList.contains('hand-card');
        });
        const floats = floatEls.map(el => {
          const r = el.getBoundingClientRect();
          return {
            styleLeft: el.style.left, styleTop: el.style.top,
            transform: el.style.transform,
            opacity: el.style.opacity || getComputedStyle(el).opacity,
            visibility: el.style.visibility || getComputedStyle(el).visibility,
            display: getComputedStyle(el).display,
            rectLeft: Math.round(r.left), rectTop: Math.round(r.top),
            rectW: Math.round(r.width), rectH: Math.round(r.height),
            visible: r.width > 0 && r.height > 0 && el.offsetParent !== null,
          };
        });
        return { hands: out, landed: snap?.landedFloats, inFlight: snap?.inFlightFloats,
          floats, containerLeft: Math.round(containerRect?.left ?? 0), containerTop: Math.round(containerRect?.top ?? 0) };
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
      if (idx >= 19) break;
      await session.page.waitForTimeout(80);
    }

    // Final state capture for visual reference.
    await session.capture(`after-play-idx${lastIdx}`);

    denseLog.push({ t: (Date.now() - tStart) / 1000, type: 'marker',
      text: `=== MARKER === exiting bug window at idx=${lastIdx}` });

    // Write the dense dump alongside the standard report.
    const dumpPath = path.join(session.outDir, 'dense-log.txt');
    fs.writeFileSync(dumpPath, denseLog
      .map(l => `[t=${l.t.toFixed(3)}s][${l.type}] ${l.text}`)
      .join('\n'), 'utf8');

    // Also write a windowed extract: only lines from when the first
    // [ANIM:QUEUE]/[ANIM:MOVE] for MSG_MOVE→HAND OR MSG_SHUFFLE_HAND fires.
    const focusStart = denseLog.findIndex(l =>
      l.text.includes('MSG_MOVE') && l.text.includes('HAND')
      || l.text.includes('MSG_SHUFFLE_HAND'));
    if (focusStart >= 0) {
      const focused = denseLog.slice(focusStart);
      fs.writeFileSync(path.join(session.outDir, 'focused-log.txt'), focused
        .map(l => `[t=${l.t.toFixed(3)}s][${l.type}] ${l.text}`)
        .join('\n'), 'utf8');
    }

    // eslint-disable-next-line no-console
    console.log(`[seek13] dense log lines = ${denseLog.length}, written to ${dumpPath}`);
  } finally {
    await session.finalize();
    await session.page.close().catch(() => undefined);
    await ctx.close();
  }
});
