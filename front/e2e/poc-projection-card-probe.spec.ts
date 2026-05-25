import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE_URL, ADMIN, loginViaUI } from './helpers';

/**
 * Tiny probe — once-only: discover the card DOM selector + rotateZ values
 * actually applied to cards in the running board. The U2 spec used assumed
 * selectors which matched nothing; this spec finds the truth.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POC_OUT = path.resolve(REPO_ROOT, '_bmad-output', 'poc-projection');
const REPLAY_ID = 'a8859c98-df53-4de3-bcdb-dd1a56176f86';

test('probe card DOM in running board', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginViaUI(page, ADMIN);
  await page.evaluate(() => {
    localStorage.setItem('replay.animationsEnabled', 'true');
    localStorage.setItem('replay.perspectiveIndex', '0');
  });
  await page.goto(`${BASE_URL}/pvp/replay/${REPLAY_ID}`);
  await page.waitForSelector('[data-zone]', { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const probe = await page.evaluate(() => {
    // Look at the player's hand zone — that's where cards live during draw phase.
    const playerHand = document.querySelector('[data-zone="HAND-0"], [data-zone*="HAND"]') as HTMLElement | null;
    const opponentHand = Array.from(document.querySelectorAll('[data-zone]')).find(z => (z as HTMLElement).getAttribute('data-zone')?.startsWith('HAND-')) as HTMLElement | null;

    const inspect = (root: HTMLElement | null, label: string) => {
      if (!root) return { label, found: false };
      // Walk children one level deep and report what we see.
      const direct = Array.from(root.children).slice(0, 5).map(c => {
        const el = c as HTMLElement;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: Array.from(el.classList).slice(0, 6),
          dataAttrs: Array.from(el.attributes).filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`),
          transform: cs.transform === 'none' ? '' : cs.transform,
          inlineTransform: el.style.transform,
        };
      });
      // Walk 2-3 levels to find what looks like card visuals.
      const allDescendants = Array.from(root.querySelectorAll('*')).slice(0, 12).map(c => {
        const el = c as HTMLElement;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          classes: Array.from(el.classList).slice(0, 6),
          transform: cs.transform === 'none' ? '' : cs.transform,
          rect: el.getBoundingClientRect(),
        };
      });
      return {
        label,
        found: true,
        rootZone: root.getAttribute('data-zone'),
        directChildren: direct,
        descendantsHead: allDescendants,
      };
    };

    // Probe HAND-0 (player) and HAND-1 (opponent) explicitly
    const hand0 = document.querySelector('[data-zone="HAND-0"]') as HTMLElement | null;
    const hand1 = document.querySelector('[data-zone="HAND-1"]') as HTMLElement | null;

    return {
      allDataZones: Array.from(document.querySelectorAll('[data-zone]')).slice(0, 8).map(z => (z as HTMLElement).getAttribute('data-zone')),
      hand0: inspect(hand0, 'HAND-0 (player)'),
      hand1: inspect(hand1, 'HAND-1 (opponent)'),
      // Look for elements that carry rotateZ(180deg) anywhere
      elementsWithRotateZ: Array.from(document.querySelectorAll('*')).filter(el => {
        const t = getComputedStyle(el as HTMLElement).transform;
        return t && t !== 'none' && (t.includes('matrix') || t.includes('rotate'));
      }).slice(0, 12).map(el => {
        const e = el as HTMLElement;
        return {
          tag: e.tagName.toLowerCase(),
          classes: Array.from(e.classList).slice(0, 6),
          dataZone: e.getAttribute('data-zone'),
          transform: getComputedStyle(e).transform,
          inOpponent: !!e.closest('.opponent-field'),
          inPlayer: !!e.closest('.player-field'),
        };
      }),
    };
  });

  fs.writeFileSync(path.join(POC_OUT, 'raw-card-probe.json'), JSON.stringify(probe, null, 2), 'utf-8');
  console.log('[probe] wrote ' + path.join(POC_OUT, 'raw-card-probe.json'));
});
