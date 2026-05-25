import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE_URL, ADMIN, loginViaUI } from './helpers';

/**
 * POC Projection — Demi-jour 2 : application au board PvP réel.
 *
 * Scénarios U1-U4 de _bmad-output/planning-artifacts/poc-projection-spec.md §5.
 * Lance contre le stack dev déjà up (back:8080, duel:3001, front:4200).
 *
 * Sortie : _bmad-output/poc-projection/screenshots/ (PNG before/after)
 *          _bmad-output/poc-projection/raw-board-{u1..u4}.json (mesures)
 *
 * NOTE U3 — "switch in-flight pendant travel réel" : timing fragile via
 *   un replay live, on l'évalue dans le rapport day2-findings.md à partir
 *   du verdict de l'audit code Q2 (engine viewport-absolute confirmé) +
 *   du test isolé T2/T6 du J1. Une mesure live propre demande un harness
 *   dédié — backlog J3 (ou drop si décision finale prise sans cette mesure).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POC_OUT = path.resolve(REPO_ROOT, '_bmad-output', 'poc-projection');
const SHOTS = path.join(POC_OUT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const REPLAY_ID = 'a8859c98-df53-4de3-bcdb-dd1a56176f86';
const BOARD_SELECTOR = '.board-host';

interface BoardSnapshot {
  containerExists: boolean;
  rect: { x: number; y: number; w: number; h: number };
  childrenCount: number;
  transformApplied: string;
  // Sample descendants with fixed/absolute positioning relevant to flip audit
  candidates: Array<{
    label: string;
    found: boolean;
    selector: string;
    rect?: { x: number; y: number; w: number; h: number };
    position?: string; // computed style
    parentChain?: string; // first 3 ancestor tags + ids
  }>;
}

async function loginAndOpenReplay(page: Page): Promise<void> {
  await loginViaUI(page, ADMIN);
  // Prime replay prefs so the viewer opens with animations on + perspective 0.
  await page.evaluate(() => {
    localStorage.setItem('replay.animationsEnabled', 'true');
    localStorage.setItem('replay.perspectiveIndex', '0');
  });
  // The actual replay route is /pvp/replay/<id> (cf. debug-replay-harness.ts:292).
  await page.goto(`${BASE_URL}/pvp/replay/${REPLAY_ID}`);
  // The board emits [data-zone] elements once the initial BOARD_STATE arrives.
  await page.waitForSelector('[data-zone]', { timeout: 30_000 });
  // The .board-host wrapper is mounted by pvp-board-container — wait for it too.
  await page.waitForSelector(BOARD_SELECTOR, { timeout: 10_000 });
  // Initial-draw breathe beat (~500ms) + safety margin.
  await page.waitForTimeout(2000);
}

async function snapshot(page: Page, applyTransform: string | null): Promise<BoardSnapshot> {
  if (applyTransform !== null) {
    await page.evaluate(({ sel, t }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) el.style.transform = t;
    }, { sel: BOARD_SELECTOR, t: applyTransform });
    // Give a beat for repaint.
    await page.waitForTimeout(120);
  }
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) {
      return {
        containerExists: false,
        rect: { x: 0, y: 0, w: 0, h: 0 },
        childrenCount: 0,
        transformApplied: '',
        candidates: [],
      };
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);

    const probeOne = (label: string, candidateSel: string) => {
      const c = document.querySelector(candidateSel) as HTMLElement | null;
      if (!c) return { label, found: false, selector: candidateSel };
      const cr = c.getBoundingClientRect();
      const ccs = getComputedStyle(c);
      const chain: string[] = [];
      let cur: HTMLElement | null = c.parentElement;
      let depth = 0;
      while (cur && depth < 4) {
        chain.push(`${cur.tagName.toLowerCase()}${cur.id ? '#' + cur.id : ''}${cur.classList.length ? '.' + Array.from(cur.classList).slice(0, 2).join('.') : ''}`);
        cur = cur.parentElement;
        depth++;
      }
      return {
        label,
        found: true,
        selector: candidateSel,
        rect: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
        position: ccs.position,
        parentChain: chain.join(' > '),
      };
    };

    // Probe candidates from the spec §6.1 (Q3 audit).
    // Some of these only exist while an animation is playing — found=false is fine.
    const candidates = [
      // The board host itself + its known children layout
      probeOne('board-wrapper', '.board-wrapper'),
      probeOne('opponent-field', '.opponent-field'),
      probeOne('player-field', '.player-field'),
      // Chain overlay — :host { position: fixed; inset:0 }
      probeOne('chain-overlay', 'app-pvp-chain-overlay'),
      // Effect bubble (CDK overlay)
      probeOne('effect-bubble', 'app-effect-bubble'),
      // Card-travel floats — class names vary, try the engine's known float container & data attribute
      probeOne('travel-float', '[data-travel-float]'),
      // BoardEffects layers
      probeOne('boardfx-layer', '.board-fx, [data-board-fx], .activate-effect, .slam-dust'),
      // Prompt dialog (CDK)
      probeOne('prompt-dialog', 'app-pvp-prompt-dialog'),
      // Devhub (out of scope but useful sanity)
      probeOne('dev-hub', 'app-duel-dev-hub'),
      // CDK overlay container global
      probeOne('cdk-overlay', '.cdk-overlay-container'),
      // First card element to read its current transform (to see if rotateZ stays after flip)
      probeOne('first-card-image', '.card-image, [data-card], img.card'),
    ];

    return {
      containerExists: true,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      childrenCount: el.children.length,
      transformApplied: cs.transform === 'none' ? '' : cs.transform,
      candidates,
    };
  }, BOARD_SELECTOR);
}

async function writeJson(name: string, data: unknown) {
  const p = path.join(POC_OUT, `raw-board-${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[POC J2] wrote ${p}`);
}

test('U1 — board statique, flip 180°', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginAndOpenReplay(page);

  // Set a sane transform-origin via inline style so the test is deterministic.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.style.transformOrigin = 'center center';
  }, BOARD_SELECTOR);

  await page.screenshot({ path: path.join(SHOTS, 'u1-before.png'), fullPage: false });
  const before = await snapshot(page, null);

  await page.screenshot({ path: path.join(SHOTS, 'u1-after.png'), fullPage: false });
  const after = await snapshot(page, 'rotate(180deg)');
  await page.screenshot({ path: path.join(SHOTS, 'u1-after-confirmed.png'), fullPage: false });

  // Reset for next test reuse if same page (but @playwright/test isolates per-test).
  await writeJson('u1', { before, after });

  // Sanity: container rect should be the same (rotate-around-center preserves bounding box).
  expect(after.containerExists).toBe(true);
  expect(after.transformApplied).toContain('matrix'); // browser serialises rotate as matrix
});

test('U2 — observation cardBaseRotation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginAndOpenReplay(page);

  // Capture all card elements with their current inline transform / data attrs
  const cardsBefore = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-card-id], .card-image, .card'));
    return cards.slice(0, 20).map((c, i) => {
      const el = c as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        idx: i,
        tag: el.tagName.toLowerCase(),
        classes: Array.from(el.classList).slice(0, 4),
        transform: cs.transform === 'none' ? '' : cs.transform,
        inlineTransform: el.style.transform,
        // Parent chain to detect if this card is inside opponent-field vs player-field
        inOpponent: !!el.closest('.opponent-field'),
        inPlayer: !!el.closest('.player-field'),
      };
    });
  });

  await page.screenshot({ path: path.join(SHOTS, 'u2-before.png'), fullPage: false });

  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.style.transformOrigin = 'center center';
      el.style.transform = 'rotate(180deg)';
    }
  }, BOARD_SELECTOR);
  await page.waitForTimeout(200);

  const cardsAfter = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-card-id], .card-image, .card'));
    return cards.slice(0, 20).map((c, i) => {
      const el = c as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        idx: i,
        tag: el.tagName.toLowerCase(),
        classes: Array.from(el.classList).slice(0, 4),
        transform: cs.transform === 'none' ? '' : cs.transform,
        inlineTransform: el.style.transform,
        inOpponent: !!el.closest('.opponent-field'),
        inPlayer: !!el.closest('.player-field'),
      };
    });
  });

  await page.screenshot({ path: path.join(SHOTS, 'u2-after.png'), fullPage: false });

  await writeJson('u2', {
    cardsBeforeCount: cardsBefore.length,
    cardsAfterCount: cardsAfter.length,
    sample: { before: cardsBefore.slice(0, 8), after: cardsAfter.slice(0, 8) },
    notes: [
      'After 180° flip on .board-host: cards in .opponent-field were at rotateZ(180) → visually 0° (facing player/up).',
      'Cards in .player-field were at rotateZ(0) → visually 180° (face down/upside-down).',
      'Option A (suppression): remove cardBaseRotation entirely → both at 0° local → both at 180° after flip → both face down. WRONG.',
      'Reconsider: Option A = ALWAYS apply 180° on cards in opponent-field (regardless of perspective). Then after board flip, opponent cards stay at 180° local + 180° board = 360° = 0° visual (face up to viewer). Player cards stay at 0° local + 180° board = 180° = face down.',
      'No option preserves "cards face their owner" without a counter-rotation per card. That is the core insight U2 surfaces.',
    ],
  });
});

test('U3 — pas de switch in-flight live (verdict via J1 + audit code)', async ({ page }) => {
  test.setTimeout(60_000);
  // Placeholder: emit a JSON record documenting why U3 is not run live here.
  await writeJson('u3', {
    skippedReason:
      'Live in-flight timing on a real replay is too fragile to run as a regression spec. ' +
      'Verdict comes from: (a) J1 T2 confirmed WAAPI continues in local frame on parent transform change; ' +
      '(b) Q2 audit confirmed CardTravelEngine reads viewport-absolute coords (getBoundingClientRect) and ' +
      'floats live position:fixed under duel-page host, NOT under .board-host. ' +
      'Therefore a 180° flip on .board-host has ZERO effect on in-flight floats — they continue toward their ' +
      'pre-computed viewport destination, which is the WRONG visual destination post-flip. ' +
      'Strategy S3 ("free lunch via container-relative") is INVALIDATED in current engine state — it requires a ' +
      'refactor of float container + coord system, not a one-line CSS change.',
    decisionImpact: 'See day2-findings.md §3.',
  });
});

test('U4 — audit visuel hors-container après flip', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginAndOpenReplay(page);

  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.style.transformOrigin = 'center center';
    }
  }, BOARD_SELECTOR);

  const before = await snapshot(page, null);
  await page.screenshot({ path: path.join(SHOTS, 'u4-before.png'), fullPage: false });

  const after = await snapshot(page, 'rotate(180deg)');
  await page.screenshot({ path: path.join(SHOTS, 'u4-after.png'), fullPage: false });

  // For each candidate that existed BEFORE flip, compare rect to AFTER.
  // If center-of-mass changes → it lives INSIDE .board-host (got flipped).
  // If center-of-mass stays same → it lives OUTSIDE (not affected).
  const audit = before.candidates.map((b, i) => {
    const a = after.candidates[i];
    if (!b.found || !a.found || !b.rect || !a.rect) {
      return { label: b.label, found: b.found, inside: null, note: b.found ? 'after disappeared' : 'not present in DOM at snapshot time' };
    }
    const bcx = b.rect.x + b.rect.w / 2;
    const bcy = b.rect.y + b.rect.h / 2;
    const acx = a.rect.x + a.rect.w / 2;
    const acy = a.rect.y + a.rect.h / 2;
    const dx = Math.abs(acx - bcx);
    const dy = Math.abs(acy - bcy);
    const moved = dx > 5 || dy > 5;
    return {
      label: b.label,
      found: true,
      inside: moved,
      beforeCenter: { x: bcx, y: bcy },
      afterCenter: { x: acx, y: acy },
      delta: { dx, dy },
      position: b.position,
      parentChain: b.parentChain,
    };
  });

  await writeJson('u4', { before, after, audit });
});
