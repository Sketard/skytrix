import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * POC — Couche de projection (Demi-jour 1).
 *
 * Hors-Skytrix : page HTML statique injectée via page.setContent(). Aucune
 * dépendance au stack dev (back/duel-server/front ng serve). Ce spec teste
 * UNIQUEMENT le comportement de Web Animations API + transform CSS parent.
 *
 * Spec source : _bmad-output/planning-artifacts/poc-projection-spec.md §4
 * Sortie JSON : _bmad-output/poc-projection/raw-{scenario}.json
 * Rapport     : _bmad-output/poc-projection/day1-findings.md (écrit manuellement
 *               après lecture des JSON par l'humain ou l'agent)
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POC_OUT = path.resolve(REPO_ROOT, '_bmad-output', 'poc-projection');
fs.mkdirSync(POC_OUT, { recursive: true });

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>POC projection</title>
<style>
  html, body { margin: 0; padding: 0; background: #222; }
  #container { position: relative; width: 800px; height: 600px; background: #eee; transform-origin: 400px 300px; }
  #src   { position: absolute; left: 50px;  top: 50px;  width: 80px; height: 120px; background: red; }
  #dst   { position: absolute; left: 650px; top: 450px; width: 80px; height: 120px; background: green; opacity: 0.3; }
  #float { position: absolute; left: 50px;  top: 50px;  width: 80px; height: 120px; background: blue; }
</style></head>
<body>
  <div id="container">
    <div id="src"></div>
    <div id="dst"></div>
    <div id="float"></div>
  </div>
</body></html>`;

interface Sample {
  pct: number;
  t: number;
  rect: { x: number; y: number; w: number; h: number };
}

interface ScenarioResult {
  scenario: string;
  durationMs: number;
  samples: Sample[];
  fps: { avg: number; min: number; max: number; frames: number };
  finalRect: { x: number; y: number; w: number; h: number };
  expectedFinalRect?: { x: number; y: number; w: number; h: number };
  notes: string[];
  extra?: Record<string, unknown>;
}

async function writeResult(name: string, result: ScenarioResult, browserName: string = 'chromium') {
  const p = path.join(POC_OUT, `raw-${name}-${browserName}.json`);
  fs.writeFileSync(p, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`[POC] wrote ${p}`);
}

async function setupPage(page: Page) {
  await page.setContent(PAGE_HTML, { waitUntil: 'load' });
  // Instrument rAF deltas for FPS.
  await page.evaluate(() => {
    (window as any).__rafSamples = [] as number[];
    let last = performance.now();
    function tick(now: number) {
      const dt = now - last;
      last = now;
      (window as any).__rafSamples.push(dt);
      (window as any).__rafReq = requestAnimationFrame(tick);
    }
    (window as any).__rafReq = requestAnimationFrame(tick);
    (window as any).__stopRaf = () => cancelAnimationFrame((window as any).__rafReq);
    (window as any).__resetRaf = () => { (window as any).__rafSamples = []; };
  });
}

async function captureRect(page: Page, sel: string): Promise<{ x: number; y: number; w: number; h: number }> {
  return await page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
}

async function getFps(page: Page): Promise<{ avg: number; min: number; max: number; frames: number }> {
  return await page.evaluate(() => {
    const s = (window as any).__rafSamples as number[];
    if (!s.length) return { avg: 0, min: 0, max: 0, frames: 0 };
    // Ignore the first sample (rAF prime, often large).
    const valid = s.slice(1).filter(dt => dt > 0 && dt < 200);
    if (!valid.length) return { avg: 0, min: 0, max: 0, frames: s.length };
    const avgDt = valid.reduce((a, b) => a + b, 0) / valid.length;
    const minDt = Math.min(...valid);
    const maxDt = Math.max(...valid);
    return {
      avg: 1000 / avgDt,
      min: 1000 / maxDt,
      max: 1000 / minDt,
      frames: valid.length,
    };
  });
}

async function sampleAt(page: Page, durationMs: number, percent: number, started: number): Promise<Sample> {
  const targetT = started + durationMs * (percent / 100);
  const wait = Math.max(0, targetT - performance.now());
  // We can't sync Node's performance.now with the browser, so wait via page.waitForTimeout from now.
  // Replace with browser-side wait that resolves at requested timestamp.
  const sample = await page.evaluate(async (ms) => {
    if (ms > 0) await new Promise(r => setTimeout(r, ms));
    const el = document.querySelector('#float') as HTMLElement;
    const r = el.getBoundingClientRect();
    return { t: performance.now(), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  }, wait);
  return { pct: percent, t: sample.t, rect: sample.rect };
}

const DURATION = 4000;

/* -------------------------------------------------------------------------- */
/* T1 — Reference: plain WAAPI travel, no parent transform                    */
/* -------------------------------------------------------------------------- */
test('T1 — reference travel no parent transform', async ({ page }, testInfo) => {
  await setupPage(page);
  const startedBrowser: number = await page.evaluate((dur) => {
    const fl = document.querySelector('#float') as HTMLElement;
    const anim = fl.animate(
      [
        { transform: 'translate(0px, 0px)' },
        { transform: 'translate(600px, 400px)' },
      ],
      { duration: dur, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
    );
    (window as any).__anim = anim;
    (window as any).__resetRaf?.();
    return performance.now();
  }, DURATION);

  const samples: Sample[] = [];
  for (const p of [25, 50, 75, 100]) {
    const s = await sampleAtBrowser(page, DURATION, p, startedBrowser);
    samples.push(s);
  }
  await page.waitForTimeout(50);
  const finalRect = await captureRect(page, '#float');
  const fps = await getFps(page);

  const result: ScenarioResult = {
    scenario: 'T1',
    durationMs: DURATION,
    samples,
    fps,
    finalRect,
    // float starts at (50,50) in container which is at (0,0) in viewport
    // translate(600,400) → ends at viewport (650, 450)
    expectedFinalRect: { x: 650, y: 450, w: 80, h: 120 },
    notes: [
      'No parent transform. Reference baseline. Float should land at (650,450) ± 1px.',
    ],
  };
  await writeResult('T1', result, testInfo.project.name);
});

/* Helper: sample at a percent of duration, using the browser's clock. */
async function sampleAtBrowser(page: Page, dur: number, percent: number, started: number): Promise<Sample> {
  return await page.evaluate(
    async ({ dur, percent, started }) => {
      const targetT = started + dur * (percent / 100);
      const wait = Math.max(0, targetT - performance.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const el = document.querySelector('#float') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { pct: percent, t: performance.now(), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    },
    { dur, percent, started }
  );
}

/* -------------------------------------------------------------------------- */
/* T2 — Same as T1, but parent rotates 180° at 50%                            */
/* -------------------------------------------------------------------------- */
test('T2 — rotate parent 180deg mid-animation', async ({ page }, testInfo) => {
  await setupPage(page);
  const startedBrowser: number = await page.evaluate((dur) => {
    const fl = document.querySelector('#float') as HTMLElement;
    fl.animate(
      [
        { transform: 'translate(0px, 0px)' },
        { transform: 'translate(600px, 400px)' },
      ],
      { duration: dur, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
    );
    (window as any).__resetRaf?.();
    return performance.now();
  }, DURATION);

  // Sample at 25% (no transform yet)
  const s25 = await sampleAtBrowser(page, DURATION, 25, startedBrowser);

  // At 50%, apply rotate(180deg) to container
  const flipApplied: { t: number; rectBefore: any; rectAfter: any } = await page.evaluate(
    async ({ dur, started }) => {
      const targetT = started + dur * 0.5;
      const wait = Math.max(0, targetT - performance.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const fl = document.querySelector('#float') as HTMLElement;
      const ct = document.querySelector('#container') as HTMLElement;
      const before = fl.getBoundingClientRect();
      ct.style.transform = 'rotate(180deg)';
      const after = fl.getBoundingClientRect();
      return { t: performance.now(), rectBefore: { x: before.x, y: before.y, w: before.width, h: before.height }, rectAfter: { x: after.x, y: after.y, w: after.width, h: after.height } };
    },
    { dur: DURATION, started: startedBrowser }
  );

  const s50 = { pct: 50, t: flipApplied.t, rect: flipApplied.rectAfter };
  const s75 = await sampleAtBrowser(page, DURATION, 75, startedBrowser);
  const s100 = await sampleAtBrowser(page, DURATION, 100, startedBrowser);

  await page.waitForTimeout(50);
  const finalRect = await captureRect(page, '#float');
  const fps = await getFps(page);

  // After rotate(180) the container's local frame is flipped. The float was
  // animated to translate(600,400) IN THE LOCAL FRAME. So the float should
  // land at the destination's flipped viewport position.
  // Container occupies viewport (0,0)→(800,600). After rotate(180) around
  // (400,300), local (650,450) → viewport (150, 150) - 80/120 corner offsets.
  // dst element at local (650,450,80,120) → after rotate its TL corner viewport
  // = (800-650-80, 600-450-120) = (70, 30). float should land near (70,30).

  const result: ScenarioResult = {
    scenario: 'T2',
    durationMs: DURATION,
    samples: [s25, s50, s75, s100],
    fps,
    finalRect,
    expectedFinalRect: { x: 70, y: 30, w: 80, h: 120 },
    notes: [
      'Parent rotate(180deg) applied at 50%.',
      'WAAPI does NOT recompute keyframes — animation keeps running in local frame.',
      'Visually, float should land at flipped-dst (≈70,30) NOT viewport-dst (≈650,450).',
      `rectBefore-flip @ 50% = (${flipApplied.rectBefore.x.toFixed(0)},${flipApplied.rectBefore.y.toFixed(0)})`,
      `rectAfter-flip  @ 50% = (${flipApplied.rectAfter.x.toFixed(0)},${flipApplied.rectAfter.y.toFixed(0)})`,
      'If rectBefore != rectAfter at the same percent → flip is a visible jump (expected).',
    ],
    extra: { rectBeforeFlip: flipApplied.rectBefore, rectAfterFlip: flipApplied.rectAfter },
  };
  await writeResult('T2', result, testInfo.project.name);
});

/* -------------------------------------------------------------------------- */
/* T3 — setKeyframes mid-animation                                            */
/* -------------------------------------------------------------------------- */
test('T3 — setKeyframes mid-animation', async ({ page }, testInfo) => {
  await setupPage(page);
  const startedBrowser: number = await page.evaluate((dur) => {
    const fl = document.querySelector('#float') as HTMLElement;
    const anim = fl.animate(
      [
        { transform: 'translate(0px, 0px)' },
        { transform: 'translate(600px, 400px)' },
      ],
      { duration: dur, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
    );
    (window as any).__anim = anim;
    (window as any).__resetRaf?.();
    return performance.now();
  }, DURATION);

  const s25 = await sampleAtBrowser(page, DURATION, 25, startedBrowser);

  // At 50%, apply rotate(180) AND setKeyframes to new viewport destination.
  // Goal: after rotate, the float currently sits at viewport (X,Y). We want it
  // to continue to dst's NEW visual viewport position (≈70,30 TL). We compute
  // what local translate produces viewport (70,30) under rotate(180):
  //   local→viewport(rotate180 around 400,300) = (800-localX-w, 600-localY-h) (TL after rotate of TR after rotate of original)
  //   Actually rotate around center (400,300) maps local(x,y) topleft to
  //   viewport TL = (2*400 - (x + w), 2*300 - (y + h)) for a rectangle.
  //   We want viewport TL = (70,30) for an 80x120 float: local TL ≈ (650,450).
  //   Translate needed from float origin (local 50,50) = (600,400). Same.
  //   So setKeyframes would only differ if the target moved — here it's the
  //   same numerically. We instead test that setKeyframes is callable and
  //   that easing/currentTime survive.

  const setKeyframesResult: { ok: boolean; error: string | null; currentTimeBefore: number; currentTimeAfter: number; jumpRect: any; postRect: any } = await page.evaluate(
    async ({ dur, started }) => {
      const targetT = started + dur * 0.5;
      const wait = Math.max(0, targetT - performance.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const fl = document.querySelector('#float') as HTMLElement;
      const ct = document.querySelector('#container') as HTMLElement;
      const anim = (window as any).__anim as Animation;
      const ctBefore = (typeof anim.currentTime === 'number' ? anim.currentTime : Number(anim.currentTime || 0)) as number;
      ct.style.transform = 'rotate(180deg)';
      let ok = false;
      let error: string | null = null;
      try {
        (anim.effect as KeyframeEffect).setKeyframes([
          { transform: 'translate(0px, 0px)' },
          { transform: 'translate(600px, 400px)' },
        ]);
        ok = true;
      } catch (e: any) {
        error = String(e?.message || e);
      }
      const ctAfter = (typeof anim.currentTime === 'number' ? anim.currentTime : Number(anim.currentTime || 0)) as number;
      const jr = fl.getBoundingClientRect();
      await new Promise(r => requestAnimationFrame(() => r(null)));
      const pr = fl.getBoundingClientRect();
      return {
        ok,
        error,
        currentTimeBefore: ctBefore,
        currentTimeAfter: ctAfter,
        jumpRect: { x: jr.x, y: jr.y, w: jr.width, h: jr.height },
        postRect: { x: pr.x, y: pr.y, w: pr.width, h: pr.height },
      };
    },
    { dur: DURATION, started: startedBrowser }
  );

  const s50 = { pct: 50, t: performance.now(), rect: setKeyframesResult.postRect };
  const s75 = await sampleAtBrowser(page, DURATION, 75, startedBrowser);
  const s100 = await sampleAtBrowser(page, DURATION, 100, startedBrowser);

  await page.waitForTimeout(50);
  const finalRect = await captureRect(page, '#float');
  const fps = await getFps(page);

  const result: ScenarioResult = {
    scenario: 'T3',
    durationMs: DURATION,
    samples: [s25, s50, s75, s100],
    fps,
    finalRect,
    expectedFinalRect: { x: 70, y: 30, w: 80, h: 120 },
    notes: [
      'setKeyframes() called at 50% with rotate(180) container transform.',
      `setKeyframes callable: ${setKeyframesResult.ok}${setKeyframesResult.error ? ' (err: ' + setKeyframesResult.error + ')' : ''}.`,
      `currentTime preserved: before=${setKeyframesResult.currentTimeBefore.toFixed(0)}, after=${setKeyframesResult.currentTimeAfter.toFixed(0)} → ${Math.abs(setKeyframesResult.currentTimeBefore - setKeyframesResult.currentTimeAfter) < 10 ? 'YES' : 'NO'}.`,
      'Jump-vs-post rects compared to detect easing restart (visual snap).',
    ],
    extra: setKeyframesResult,
  };
  await writeResult('T3', result, testInfo.project.name);
});

/* -------------------------------------------------------------------------- */
/* T4 — Cancel + replay strategy                                              */
/* -------------------------------------------------------------------------- */
test('T4 — cancel + replay from current position', async ({ page }, testInfo) => {
  await setupPage(page);
  const startedBrowser: number = await page.evaluate((dur) => {
    const fl = document.querySelector('#float') as HTMLElement;
    const anim = fl.animate(
      [
        { transform: 'translate(0px, 0px)' },
        { transform: 'translate(600px, 400px)' },
      ],
      { duration: dur, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
    );
    (window as any).__anim = anim;
    (window as any).__resetRaf?.();
    return performance.now();
  }, DURATION);

  const s25 = await sampleAtBrowser(page, DURATION, 25, startedBrowser);

  // At 50%, cancel, read current viewport rect, apply transform, compute new
  // animation from current rect → flipped destination, kick off.
  const cancelResult: { gapFrames: number; rectAtCancel: any; rectAfterApply: any; rectAfterReplay: any; replayMs: number } = await page.evaluate(
    async ({ dur, started }) => {
      const targetT = started + dur * 0.5;
      const wait = Math.max(0, targetT - performance.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const fl = document.querySelector('#float') as HTMLElement;
      const ct = document.querySelector('#container') as HTMLElement;
      const anim = (window as any).__anim as Animation;

      // Compute current local translate from the rect under no-transform.
      const rectAtCancel = fl.getBoundingClientRect();
      anim.cancel();

      // Count rAF frames between cancel and replay launch
      let gap = 0;
      const startGap = performance.now();
      ct.style.transform = 'rotate(180deg)';
      // Apply inline transform to freeze at current visible position.
      // After container rotates, the float (same local pos) is now at a different
      // viewport position. To avoid a jump, we set the float's inline transform
      // to compensate so it stays at rectAtCancel.
      // But realistically we just relaunch animation from current local pos.
      const rectAfterApply = fl.getBoundingClientRect();

      // Wait one rAF to measure timing precision.
      await new Promise<void>(r => requestAnimationFrame(() => { gap++; r(); }));
      const replayStart = performance.now();

      // Relaunch animation. The current animated value was translate(~300,~200)
      // (50% of 600,400 with easing - close to 50% with material easing).
      // For the POC we just replay from translate(300,200) to (600,400) over
      // the remaining duration.
      const remaining = dur - dur * 0.5;
      fl.animate(
        [
          { transform: 'translate(300px, 200px)' },
          { transform: 'translate(600px, 400px)' },
        ],
        { duration: remaining, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
      );

      // First-frame after replay rect.
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      const rectAfterReplay = fl.getBoundingClientRect();

      return {
        gapFrames: gap,
        rectAtCancel: { x: rectAtCancel.x, y: rectAtCancel.y, w: rectAtCancel.width, h: rectAtCancel.height },
        rectAfterApply: { x: rectAfterApply.x, y: rectAfterApply.y, w: rectAfterApply.width, h: rectAfterApply.height },
        rectAfterReplay: { x: rectAfterReplay.x, y: rectAfterReplay.y, w: rectAfterReplay.width, h: rectAfterReplay.height },
        replayMs: replayStart - startGap,
      };
    },
    { dur: DURATION, started: startedBrowser }
  );

  const s50 = { pct: 50, t: performance.now(), rect: cancelResult.rectAfterReplay };
  const s75 = await sampleAtBrowser(page, DURATION, 75, startedBrowser);
  const s100 = await sampleAtBrowser(page, DURATION, 100, startedBrowser);

  await page.waitForTimeout(50);
  const finalRect = await captureRect(page, '#float');
  const fps = await getFps(page);

  const result: ScenarioResult = {
    scenario: 'T4',
    durationMs: DURATION,
    samples: [s25, s50, s75, s100],
    fps,
    finalRect,
    expectedFinalRect: { x: 70, y: 30, w: 80, h: 120 },
    notes: [
      `Gap frames between cancel and replay: ${cancelResult.gapFrames}`,
      `Time cost cancel→replay: ${cancelResult.replayMs.toFixed(2)}ms`,
      `rect@cancel viewport=(${cancelResult.rectAtCancel.x.toFixed(0)},${cancelResult.rectAtCancel.y.toFixed(0)})`,
      `rect after transform applied viewport=(${cancelResult.rectAfterApply.x.toFixed(0)},${cancelResult.rectAfterApply.y.toFixed(0)})`,
      `rect after replay first frame viewport=(${cancelResult.rectAfterReplay.x.toFixed(0)},${cancelResult.rectAfterReplay.y.toFixed(0)})`,
      'Jump visible iff |rectAfterApply.viewport - rectAtCancel.viewport| > a few px.',
    ],
    extra: cancelResult,
  };
  await writeResult('T4', result, testInfo.project.name);
});

/* -------------------------------------------------------------------------- */
/* T5 — Stress: 10 floats × random flip every 500ms                           */
/* -------------------------------------------------------------------------- */
test('T5 — stress 10 floats × random flip 500ms', async ({ page }, testInfo) => {
  await page.setContent(PAGE_HTML, { waitUntil: 'load' });
  await page.evaluate(() => {
    const ct = document.querySelector('#container') as HTMLElement;
    // Remove the single float, add 10 floats
    document.querySelector('#float')!.remove();
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.id = 'f' + i;
      el.style.cssText = `position:absolute;left:${50 + i * 5}px;top:${50 + i * 5}px;width:60px;height:90px;background:hsl(${i * 36},80%,50%)`;
      ct.appendChild(el);
    }
    (window as any).__rafSamples = [];
    let last = performance.now();
    function tick(now: number) {
      const dt = now - last;
      last = now;
      (window as any).__rafSamples.push(dt);
      (window as any).__rafReq = requestAnimationFrame(tick);
    }
    (window as any).__rafReq = requestAnimationFrame(tick);
  });

  const stress = await page.evaluate(async () => {
    const ct = document.querySelector('#container') as HTMLElement;
    const TOTAL_MS = 6000; // run for 6s
    const FLIP_INTERVAL = 500;
    const ANIM_DURATION = 2000;
    let flips = 0;
    let animsKicked = 0;

    // Kick a new wave of animations every 2s
    const kickWave = () => {
      for (let i = 0; i < 10; i++) {
        const el = document.getElementById('f' + i)!;
        const dx = Math.random() * 600;
        const dy = Math.random() * 400;
        el.animate(
          [
            { transform: el.style.transform || 'translate(0,0)' },
            { transform: `translate(${dx}px, ${dy}px)` },
          ],
          { duration: ANIM_DURATION, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
        );
        animsKicked++;
      }
    };

    kickWave();
    const start = performance.now();

    let flipTimer = setInterval(() => {
      ct.style.transform = Math.random() > 0.5 ? 'rotate(180deg)' : 'rotate(0deg)';
      flips++;
    }, FLIP_INTERVAL);
    let waveTimer = setInterval(kickWave, ANIM_DURATION);

    while (performance.now() - start < TOTAL_MS) {
      await new Promise(r => setTimeout(r, 100));
    }
    clearInterval(flipTimer);
    clearInterval(waveTimer);

    return { flips, animsKicked, totalMs: performance.now() - start };
  });

  const fps = await getFps(page);
  const result: ScenarioResult = {
    scenario: 'T5',
    durationMs: 6000,
    samples: [],
    fps,
    finalRect: { x: 0, y: 0, w: 0, h: 0 },
    notes: [
      `Flips applied: ${stress.flips}`,
      `Animations kicked: ${stress.animsKicked}`,
      `Wall clock: ${stress.totalMs.toFixed(0)}ms`,
      'Stability heuristic: fps.avg ≥ 55 = stable, < 30 = unacceptable.',
    ],
    extra: stress,
  };
  await writeResult('T5', result, testInfo.project.name);
});

/* -------------------------------------------------------------------------- */
/* T6 — Container-relative coords (S3 strategy)                               */
/* -------------------------------------------------------------------------- */
test('T6 — container-relative coords (S3)', async ({ page }, testInfo) => {
  await setupPage(page);

  // Key difference from T2: float is positioned at translate(srcX, srcY) WITHIN
  // the container (already there in the static HTML), and the animation
  // translates between container-local positions. Because the container's
  // rotate is in CSS, the browser auto-recomputes the viewport projection.
  const startedBrowser: number = await page.evaluate((dur) => {
    const fl = document.querySelector('#float') as HTMLElement;
    // Float is in container coords. We animate via translate but the
    // values are deltas in container space — identical to T1 numerically,
    // BUT the float is parented inside #container so the parent rotate
    // applies through CSS transform composition.
    fl.animate(
      [
        { transform: 'translate(0px, 0px)' },
        { transform: 'translate(600px, 400px)' },
      ],
      { duration: dur, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
    );
    (window as any).__resetRaf?.();
    return performance.now();
  }, DURATION);

  const s25 = await sampleAtBrowser(page, DURATION, 25, startedBrowser);

  // At 50%, just apply rotate. No animation manipulation.
  const flipApplied: { rectBefore: any; rectAfter: any } = await page.evaluate(
    async ({ dur, started }) => {
      const targetT = started + dur * 0.5;
      const wait = Math.max(0, targetT - performance.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const fl = document.querySelector('#float') as HTMLElement;
      const ct = document.querySelector('#container') as HTMLElement;
      const before = fl.getBoundingClientRect();
      ct.style.transform = 'rotate(180deg)';
      const after = fl.getBoundingClientRect();
      return {
        rectBefore: { x: before.x, y: before.y, w: before.width, h: before.height },
        rectAfter: { x: after.x, y: after.y, w: after.width, h: after.height },
      };
    },
    { dur: DURATION, started: startedBrowser }
  );

  const s50 = { pct: 50, t: performance.now(), rect: flipApplied.rectAfter };
  const s75 = await sampleAtBrowser(page, DURATION, 75, startedBrowser);
  const s100 = await sampleAtBrowser(page, DURATION, 100, startedBrowser);

  await page.waitForTimeout(50);
  const finalRect = await captureRect(page, '#float');
  const fps = await getFps(page);

  // In T6, since float is inside the rotated container, the final visible
  // position should be at the flipped dst (≈70,30).
  // CAUTION : in our setup T2 == T6 numerically because float is also inside
  // the container in T2. The KEY DIFFERENCE for the real engine is whether
  // animation values are in viewport or container coords. In this isolated
  // POC, both T2 and T6 use container-local translate values, so both should
  // behave identically. T6 is the "intentional" case where this is the
  // correct mental model; T2 is the case where the engine THINKS it's
  // working in viewport coords (a real-Skytrix subtlety the POC must surface).

  const result: ScenarioResult = {
    scenario: 'T6',
    durationMs: DURATION,
    samples: [s25, s50, s75, s100],
    fps,
    finalRect,
    expectedFinalRect: { x: 70, y: 30, w: 80, h: 120 },
    notes: [
      'Container-relative coords. Float parented inside #container. Animation values are container-local translate.',
      'Hypothesis (H-T6): browser auto-recomputes viewport projection on parent rotate; no JS coordination needed.',
      `rectBefore-flip @ 50% viewport = (${flipApplied.rectBefore.x.toFixed(0)},${flipApplied.rectBefore.y.toFixed(0)})`,
      `rectAfter-flip  @ 50% viewport = (${flipApplied.rectAfter.x.toFixed(0)},${flipApplied.rectAfter.y.toFixed(0)})`,
      'IMPORTANT: in this isolated POC, T6 ≡ T2 numerically because both use container-local translate. The semantic distinction (viewport vs container coords) matters at the engine API level, not the WAAPI behavior level.',
      'Verdict for T6 depends on: does the visible jump between rectBefore and rectAfter feel like an acceptable "switch event" or a bug? In a real switch UX, this is the entire perspective flip — expected to be instant.',
    ],
    extra: flipApplied,
  };
  await writeResult('T6', result, testInfo.project.name);
});
