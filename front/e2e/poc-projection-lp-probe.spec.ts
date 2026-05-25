import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE_URL, ADMIN, loginViaUI } from './helpers';

/**
 * Mini-probe J3 — corrige une erreur d'interprétation J2 :
 * j'avais conclu que les LP "8000" ne flippaient pas parce qu'ils étaient
 * stables visuellement. Mais "8000" est symétrique 180°, donc l'observation
 * visuelle ne discrimine pas. Ici on mesure le rect du composant
 * <app-pvp-player-card> avant/après flip pour trancher mode A vs mode B.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POC_OUT = path.resolve(REPO_ROOT, '_bmad-output', 'poc-projection');
const REPLAY_ID = 'a8859c98-df53-4de3-bcdb-dd1a56176f86';

test('LP badge / player-card flip probe', async ({ page }) => {
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
    const probeOne = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { selector: sel, found: false };
      const r = el.getBoundingClientRect();
      // Walk parent chain to confirm inside .board-host
      const chain: string[] = [];
      let cur: HTMLElement | null = el.parentElement;
      let depth = 0;
      let inBoardHost = false;
      while (cur && depth < 6) {
        if (cur.classList.contains('board-host')) inBoardHost = true;
        chain.push(`${cur.tagName.toLowerCase()}${cur.classList.length ? '.' + Array.from(cur.classList).slice(0, 2).join('.') : ''}`);
        cur = cur.parentElement;
        depth++;
      }
      return {
        selector: sel,
        found: true,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        chain: chain.join(' > '),
        inBoardHost,
      };
    };

    const before = {
      playerCardPlayer: probeOne('app-pvp-player-card[side="player"]'),
      playerCardOpponent: probeOne('app-pvp-player-card[side="opponent"]'),
      lpBadgeAll: Array.from(document.querySelectorAll('app-pvp-lp-badge')).map((el, i) => {
        const e = el as HTMLElement;
        const r = e.getBoundingClientRect();
        return {
          i,
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
          insidePlayerCard: !!e.closest('app-pvp-player-card[side="player"]'),
          insideOpponentCard: !!e.closest('app-pvp-player-card[side="opponent"]'),
          textNow: e.textContent?.slice(0, 30).trim(),
        };
      }),
    };

    // Apply flip
    const bh = document.querySelector('.board-host') as HTMLElement | null;
    if (bh) {
      bh.style.transformOrigin = 'center center';
      bh.style.transform = 'rotate(180deg)';
    }
    return before;
  });

  // Second pass after flip
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const probeOne = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { selector: sel, found: false };
      const r = el.getBoundingClientRect();
      return {
        selector: sel,
        found: true,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    };
    return {
      playerCardPlayer: probeOne('app-pvp-player-card[side="player"]'),
      playerCardOpponent: probeOne('app-pvp-player-card[side="opponent"]'),
      lpBadgeAll: Array.from(document.querySelectorAll('app-pvp-lp-badge')).map((el, i) => {
        const e = el as HTMLElement;
        const r = e.getBoundingClientRect();
        return { i, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }),
    };
  });

  await page.screenshot({ path: path.join(POC_OUT, 'screenshots', 'lp-probe-after.png'), fullPage: false });

  fs.writeFileSync(
    path.join(POC_OUT, 'raw-lp-probe.json'),
    JSON.stringify({ before: probe, after }, null, 2),
    'utf-8'
  );
});
