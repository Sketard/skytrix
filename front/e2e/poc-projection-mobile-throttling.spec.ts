import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * J3 — Mobile throttling test : reprend T5 du J1 (stress 10 floats ×
 * random flip 500ms) sous CPU throttling 4× via CDP. Mesure FPS dégradé.
 *
 * Critère §7 spec : FPS ≥ 30 sur mobile Chrome avec throttling 4×.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POC_OUT = path.resolve(REPO_ROOT, '_bmad-output', 'poc-projection');

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>POC throttled</title>
<style>
  html, body { margin: 0; padding: 0; background: #222; }
  #container { position: relative; width: 800px; height: 600px; background: #eee; transform-origin: 400px 300px; }
</style></head>
<body><div id="container"></div></body></html>`;

async function runStress(page: Page): Promise<{ flips: number; animsKicked: number; totalMs: number }> {
  await page.evaluate(() => {
    const ct = document.querySelector('#container') as HTMLElement;
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

  return await page.evaluate(async () => {
    const ct = document.querySelector('#container') as HTMLElement;
    const TOTAL_MS = 6000;
    const FLIP_INTERVAL = 500;
    const ANIM_DURATION = 2000;
    let flips = 0;
    let animsKicked = 0;
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
    const flipTimer = setInterval(() => {
      ct.style.transform = Math.random() > 0.5 ? 'rotate(180deg)' : 'rotate(0deg)';
      flips++;
    }, FLIP_INTERVAL);
    const waveTimer = setInterval(kickWave, ANIM_DURATION);
    while (performance.now() - start < TOTAL_MS) {
      await new Promise(r => setTimeout(r, 100));
    }
    clearInterval(flipTimer);
    clearInterval(waveTimer);
    return { flips, animsKicked, totalMs: performance.now() - start };
  });
}

async function getFps(page: Page) {
  return await page.evaluate(() => {
    const s = (window as any).__rafSamples as number[];
    const valid = s.slice(1).filter((dt: number) => dt > 0 && dt < 1000);
    if (!valid.length) return { avg: 0, min: 0, max: 0, frames: 0 };
    const avgDt = valid.reduce((a: number, b: number) => a + b, 0) / valid.length;
    return {
      avg: 1000 / avgDt,
      min: 1000 / Math.max(...valid),
      max: 1000 / Math.min(...valid),
      frames: valid.length,
    };
  });
}

test('T5-throttle — stress 10 floats with CDP CPU throttling 4x', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.setContent(PAGE_HTML, { waitUntil: 'load' });
  // CDP throttle (chromium only).
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const stress = await runStress(page);
  const fps = await getFps(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const result = {
    throttling: '4x CPU',
    scenario: 'T5-throttle',
    durationMs: 6000,
    fps,
    flips: stress.flips,
    animsKicked: stress.animsKicked,
    notes: [
      `Stability threshold per spec §7: fps avg ≥ 30 = OK on mobile, < 30 = unacceptable.`,
      `Observed: fps avg = ${fps.avg.toFixed(1)}, fps min = ${fps.min.toFixed(1)}, frames captured = ${fps.frames}.`,
    ],
  };
  fs.writeFileSync(path.join(POC_OUT, 'raw-T5-throttle-chromium.json'), JSON.stringify(result, null, 2), 'utf-8');
  console.log('[T5-throttle] avg=' + fps.avg.toFixed(1) + ' min=' + fps.min.toFixed(1));
});
