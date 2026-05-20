import { type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE_URL, BACK_URL, ADMIN, loginViaUI } from './helpers';

/**
 * Responsive-audit harness — captures every key skytrix page across the
 * 8-viewport responsive grid defined in [[responsive-strategy]] (with mobile
 * landscape additions). Each capture is paired with mechanical assertions
 * (horizontal overflow, undersized touch targets, truncated text, broken
 * images, console errors, failed requests, axe-core a11y) so the visual
 * audit can focus on "looks broken" vs "is broken".
 *
 * Enrichments wired in:
 *   - A: interactive states (modals, dialogs, drawers, menus open)
 *   - B: truncation + broken-image + overflow:hidden content detection
 *   - C: dual locale runs (FR default + EN on critical pages)
 *   - J: axe-core a11y audit (CDN-injected, no devDep)
 *
 * Output: _bmad-output/responsive-audit-{ISO date}/
 *   frames/<page>/<viewport>[-<state>][-<locale>].png  — viewport-only capture
 *   snapshots/<page>/<viewport>[-<state>][-<locale>].json — per-capture findings
 *   findings-mechanical.json — aggregate, machine-readable
 *   findings-mechanical.md   — aggregate, human-readable
 *   axe-summary.md           — a11y violations top-list
 *   report.md                — top-level summary + grid + counters
 *
 * Stack assumed up at the BASE_URL/BACK_URL constants from helpers.ts.
 * Login: admin / admin (matches cache-prefetch.spec.ts).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.resolve(REPO_ROOT, '_bmad-output');

// axe-core injected at runtime via CDN (no devDep added per brownfield policy).
// Pinned version so the audit is reproducible.
const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';

export interface Viewport {
  label: string;
  width: number;
  height: number;
}

export type Locale = 'fr' | 'en';

export interface PageTarget {
  /** Folder slug under frames/ — keep filesystem-safe. */
  id: string;
  /** Human label for the report. */
  label: string;
  /** Track A = canvas-scaled, Track B = pure CSS responsive. */
  track: 'A' | 'B';
  /** Authenticated path requires admin (`adminGuard`). */
  adminOnly?: boolean;
  /** Navigate to the page. */
  navigate: (ctx: NavigateContext) => Promise<void>;
  /** Optional cleanup after the page's captures complete. */
  teardown?: (ctx: NavigateContext) => Promise<void>;
  /** Optional extra wait after navigate before capturing. Default 1500ms. */
  postNavWaitMs?: number;
  /** Optional interactive states to capture on top of the base ("initial") state.
   *  Each state opens a modal/dialog/menu/etc. and captures it. Lives in the
   *  same `<page>` folder, suffixed `-<state>`. */
  states?: PageState[];
  /** Run this page in EN as well as FR? Default false (FR only). */
  runInEnglish?: boolean;
  /** Skip a11y audit on this page (e.g. canvas-only screens). Default false. */
  skipAxe?: boolean;
  /** Capture this page in a fresh, unauthenticated BrowserContext.
   *  Use for pages whose state requires logging out (e.g. /login) — without
   *  this, clearing cookies would poison every subsequent page's auth. */
  isolated?: boolean;
}

export interface PageState {
  /** Slug appended to the filename (`<viewport>-<state>.png`). */
  id: string;
  /** Human label for the report. */
  label: string;
  /** Open the state (click a button, open a menu, fill a field, etc.).
   *  Receives a page already at the page's initial state. Should return
   *  a selector or element-handle of the opened overlay so the harness
   *  can verify it's visible — return null to skip the verification. */
  open: (page: Page) => Promise<string | null>;
}

export interface NavigateContext {
  page: Page;
  context: BrowserContext;
  baseUrl: string;
  backUrl: string;
}

export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  description: string;
  helpUrl: string;
  nodeCount: number;
  /** Up to 3 example HTML targets for the violation. */
  exampleTargets: string[];
}

export interface PageFinding {
  pageId: string;
  pageLabel: string;
  viewport: string;
  locale: Locale;
  state: string; // 'initial' or PageState.id
  finalUrl: string;
  totalMs: number;

  // Mechanical
  horizontalOverflowPx: number;
  undersizedTouchTargets: Array<{ tag: string; size: string; text: string }>;
  truncatedTexts: Array<{ tag: string; text: string; cssReason: string }>;
  brokenImages: Array<{ src: string; alt: string }>;
  hiddenOverflowing: Array<{ tag: string; overflowPx: number; text: string }>;

  // Diagnostics
  consoleErrors: string[];
  failedRequests: Array<{ url: string; status: number }>;

  // a11y
  axeViolations: AxeViolation[];
  axeRanOk: boolean;
}

export interface AuditOptions {
  outputTag?: string;
  onlyPages?: string[];
  onlyViewports?: string[];
  /** Force-enable a11y audit (default true). Disable to speed up smoke tests. */
  runAxe?: boolean;
  /** Force-enable EN locale runs (default true). */
  runEnglish?: boolean;
}

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { label: '360', width: 360, height: 800 },   // iPhone SE / small Android — portrait
  { label: '414', width: 414, height: 896 },   // iPhone Pro Max class — portrait
  { label: '360L', width: 800, height: 360 },  // iPhone SE / small Android — landscape
  { label: '414L', width: 896, height: 414 },  // iPhone Pro Max class — landscape
  { label: '768', width: 768, height: 1024 },  // iPad portrait
  { label: '1024', width: 1024, height: 768 }, // iPad landscape / small laptop
  { label: '1280', width: 1280, height: 800 }, // 13" laptop
  { label: '1920', width: 1920, height: 1080 },// desktop monitor
];

// ─── Interactive state helpers (Enrichment A) ────────────────────────────

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Try a list of selectors in order, click the first one found. Returns the
 *  selector that worked, or null if none did. Soft — never throws. */
async function tryClickFirst(page: Page, selectors: string[], timeoutEachMs = 1000): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: timeoutEachMs, state: 'visible' });
      if (el) {
        await el.click({ timeout: 1500 });
        return sel;
      }
    } catch {
      // try next
    }
  }
  return null;
}

const STATE_LIBRARY = {
  /** Open the deck-picker dialog from the lobby (Bac à sable / sandbox flow). */
  quickDuelDialog: {
    id: 'sandbox-dialog',
    label: 'Sandbox (Bac à sable) deck picker dialog',
    open: async (page: Page) => {
      const sel = await tryClickFirst(page, [
        'button:has-text("Bac à sable")',
        'button:has-text("BAC À SABLE")',
        'button:has-text("Sandbox")',
        'button:has-text("Duel rapide")',
        '[data-test="quick-duel-btn"]',
      ]);
      if (!sel) return null;
      await wait(800);
      return 'mat-dialog-container, [role="dialog"]';
    },
  } satisfies PageState,

  /** Open the create-room dialog from the lobby. */
  createRoomDialog: {
    id: 'create-room-dialog',
    label: 'Create-room dialog',
    open: async (page: Page) => {
      const sel = await tryClickFirst(page, [
        'button:has-text("Créer une room")',
        'button:has-text("CRÉER UNE ROOM")',
        'button:has-text("Créer la première room")',
        'button:has-text("Create room")',
        'button:has-text("Créer")',
        '[data-test="create-room-btn"]',
      ]);
      if (!sel) return null;
      await wait(800);
      return 'mat-dialog-container, [role="dialog"]';
    },
  } satisfies PageState,

  /** Trigger a login error by submitting empty/invalid credentials. */
  loginError: {
    id: 'error-state',
    label: 'Login error state (empty submit)',
    open: async (page: Page) => {
      // Try submit with empty fields first; fall back to invalid creds
      const submitClicked = await tryClickFirst(page, [
        'button:has-text("Se connecter")',
        'button:has-text("Sign in")',
        'button[type="submit"]',
      ]);
      if (!submitClicked) return null;
      await wait(800);
      // If that did nothing visible, try invalid creds
      const pseudoInput = await page.$('input[name="pseudo"], input[formcontrolname="pseudo"]');
      const passInput = await page.$('input[name="password"], input[formcontrolname="password"], input[type="password"]');
      if (pseudoInput && passInput) {
        await pseudoInput.fill('nope');
        await passInput.fill('wrong');
        await tryClickFirst(page, ['button:has-text("Se connecter")', 'button:has-text("Sign in")', 'button[type="submit"]']);
        await wait(1500);
      }
      return null; // we don't have a fixed selector — visual will show
    },
  } satisfies PageState,

  /** Open the token-select filter on the card search page. */
  tokenSelectOpen: {
    id: 'token-select-open',
    label: 'Token-select filter open',
    open: async (page: Page) => {
      const sel = await tryClickFirst(page, [
        'app-token-select button',
        'button:has-text("Type")',
        'button:has-text("Race")',
        'button:has-text("Extension")',
        '.token-select-trigger',
      ]);
      if (!sel) return null;
      await wait(500);
      return '.cdk-overlay-pane, [role="listbox"]';
    },
  } satisfies PageState,

  /** Open the sort menu on the replay hub. */
  replaySortMenu: {
    id: 'replay-sort-menu',
    label: 'Replay-hub sort menu',
    open: async (page: Page) => {
      const sel = await tryClickFirst(page, [
        'button[mat-menu-trigger-for], button[ng-reflect-menu-trigger-for]',
        'app-section-header button:has(mat-icon)',
        'button:has(mat-icon[fonticon="sort"])',
        'button:has-text("Plus récentes")',
        'button:has-text("Sort")',
      ]);
      if (!sel) return null;
      await wait(500);
      return '.cdk-overlay-pane, [role="menu"], mat-menu-panel, .mat-mdc-menu-panel';
    },
  } satisfies PageState,

  /** Click the delete button on a deck card → opens a confirm-dialog. */
  deckDeleteConfirm: {
    id: 'deck-delete-confirm',
    label: 'Deck delete-confirm dialog',
    open: async (page: Page) => {
      const sel = await tryClickFirst(page, [
        '.deck-page-deck-remove',
        'button[aria-label^="Supprimer"]',
        'button[aria-label^="Delete"]',
        '.deck-page-deck button:has(mat-icon[fonticon="delete"])',
      ]);
      if (!sel) return null;
      await wait(800);
      return 'mat-dialog-container, [role="dialog"]';
    },
  } satisfies PageState,
};

// ─── Page catalog ────────────────────────────────────────────────────────

/** Build the page catalog. Late-bound so callers can inject a fresh
 *  roomCode for the duel page. */
export function buildPageCatalog(opts: { replayId: string; deckId: number; deckName: string; roomCode?: string }): PageTarget[] {
  const pages: PageTarget[] = [
    {
      id: '01-login',
      label: 'Login',
      track: 'B',
      runInEnglish: true,
      isolated: true, // captured in a fresh BrowserContext so clearing auth here doesn't poison other pages
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/login`);
        await page.waitForSelector('input', { timeout: 8000 }).catch(() => {});
      },
      states: [STATE_LIBRARY.loginError],
    },
    {
      id: '02-decks-list',
      label: 'Decks (list)',
      track: 'B',
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/decks`);
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      },
      states: [STATE_LIBRARY.deckDeleteConfirm],
    },
    {
      id: '03-deck-builder',
      label: 'Deck Builder',
      track: 'A',
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/decks/${opts.deckId}`);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      },
      postNavWaitMs: 2000,
    },
    {
      id: '04-simulator',
      label: 'Simulator',
      track: 'A',
      skipAxe: true, // canvas-heavy — axe is noisy
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/decks/${opts.deckId}/simulator`);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      },
      postNavWaitMs: 2000,
    },
    {
      id: '05-card-search',
      label: 'Card Search',
      track: 'A',
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/search`);
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      },
      states: [STATE_LIBRARY.tokenSelectOpen],
    },
    {
      id: '06-preferences',
      label: 'Preferences',
      track: 'B',
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/preferences`);
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      },
    },
    {
      id: '07-parameters',
      label: 'Parameters (admin)',
      track: 'B',
      adminOnly: true,
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/parameters`);
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      },
    },
    {
      id: '08-pvp-lobby',
      label: 'PvP Lobby',
      track: 'B',
      runInEnglish: true,
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/pvp`);
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      },
      states: [STATE_LIBRARY.quickDuelDialog, STATE_LIBRARY.createRoomDialog],
    },
    {
      id: '09-replay-hub',
      label: 'Replay Hub',
      track: 'B',
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/pvp/history`);
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      },
      states: [STATE_LIBRARY.replaySortMenu],
    },
    {
      id: '10-replay-viewer',
      label: 'Replay Viewer',
      track: 'B',
      runInEnglish: true,
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/pvp/replay/${opts.replayId}`);
        await Promise.race([
          page.waitForSelector('[data-zone]', { timeout: 15000 }),
          page.waitForSelector('app-replay-card-skeleton, .replay-skeleton', { timeout: 15000 }),
        ]).catch(() => {});
      },
      postNavWaitMs: 2500,
    },
  ];

  if (opts.roomCode) {
    pages.push({
      id: '11-duel-ingame',
      label: 'Duel in-game (fork-solo)',
      track: 'B',
      runInEnglish: true,
      navigate: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/pvp/duel/${opts.roomCode}`);
        await page.waitForSelector('[data-zone]', { timeout: 12000 }).catch(() => {});
      },
      postNavWaitMs: 3000,
    });
  }

  return pages;
}

// ─── Mechanical assertions (Enrichment B) ─────────────────────────────────

const ASSERT_SCRIPT = `(() => {
  const body = document.body;
  const horizontalOverflowPx = Math.max(0, body.scrollWidth - body.clientWidth);

  // Touch targets — WCAG 2.1 AAA (44x44)
  const MIN_TOUCH = 44;
  const undersizedTouchTargets = [];
  const interactive = document.querySelectorAll('button, a, [role="button"], input[type="checkbox"], input[type="radio"]');
  for (const el of interactive) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.width < MIN_TOUCH || rect.height < MIN_TOUCH) {
      undersizedTouchTargets.push({
        tag: el.tagName.toLowerCase(),
        size: Math.round(rect.width) + 'x' + Math.round(rect.height),
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
    if (undersizedTouchTargets.length >= 20) break;
  }

  // Text truncation — text-overflow:ellipsis ACTIVE (scrollWidth > clientWidth) OR line-clamp visible cut
  const truncatedTexts = [];
  const textCandidates = document.querySelectorAll('p, span, h1, h2, h3, h4, button, a, li, td, .truncate, [class*="ellipsis"]');
  for (const el of textCandidates) {
    if (truncatedTexts.length >= 25) break;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // ellipsis truncation
    if (cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible' && el.scrollWidth > el.clientWidth + 1) {
      truncatedTexts.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 60),
        cssReason: 'text-overflow:ellipsis',
      });
      continue;
    }
    // line-clamp truncation (-webkit-line-clamp)
    const lineClamp = cs.getPropertyValue('-webkit-line-clamp');
    if (lineClamp && lineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) {
      truncatedTexts.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 60),
        cssReason: '-webkit-line-clamp:' + lineClamp.trim(),
      });
    }
  }

  // Broken images
  const brokenImages = [];
  for (const img of document.querySelectorAll('img')) {
    if (brokenImages.length >= 10) break;
    if (img.complete && img.naturalWidth === 0 && img.src) {
      brokenImages.push({
        src: img.src.length > 100 ? img.src.slice(0, 100) + '…' : img.src,
        alt: (img.getAttribute('alt') || '').slice(0, 60),
      });
    }
  }

  // overflow:hidden eating content — clientHeight < scrollHeight by >8px on
  // elements with overflow:hidden (not scroll, not auto) and visible children
  const hiddenOverflowing = [];
  const allEls = document.querySelectorAll('*');
  let scanned = 0;
  for (const el of allEls) {
    if (hiddenOverflowing.length >= 15) break;
    scanned++;
    if (scanned > 4000) break; // cap perf cost
    const cs = getComputedStyle(el);
    if (cs.overflow !== 'hidden' && cs.overflowY !== 'hidden' && cs.overflowX !== 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 30) continue;
    const overflowY = el.scrollHeight - el.clientHeight;
    const overflowX = el.scrollWidth - el.clientWidth;
    const overflowPx = Math.max(overflowY, overflowX);
    if (overflowPx > 8) {
      hiddenOverflowing.push({
        tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.').slice(0, 40) : ''),
        overflowPx,
        text: (el.textContent || '').trim().slice(0, 50),
      });
    }
  }

  return { horizontalOverflowPx, undersizedTouchTargets, truncatedTexts, brokenImages, hiddenOverflowing };
})()`;

// ─── axe-core a11y (Enrichment J) ─────────────────────────────────────────

/** axe-core source, fetched once from the CDN at run start and reused as an
 *  inline `addScriptTag({content})` per capture — saves a ~500KB network
 *  round-trip on every one of the ~150+ captures. */
let axeSource: string | null = null;

/** Fetch axe-core once via a throwaway Chromium page (the CDN is reachable
 *  from the browser's TLS stack even when `curl` is blocked). */
async function loadAxeSource(context: BrowserContext): Promise<void> {
  if (axeSource) return;
  const page = await context.newPage();
  try {
    const res = await page.request.get(AXE_CDN);
    if (res.status() === 200) {
      axeSource = await res.text();
    } else {
      console.warn(`[axe] CDN returned ${res.status()} — a11y audit disabled`);
    }
  } catch (err) {
    console.warn(`[axe] failed to fetch source: ${(err as Error).message} — a11y audit disabled`);
  }
  await page.close();
}

async function runAxe(page: Page): Promise<{ ok: boolean; violations: AxeViolation[] }> {
  if (!axeSource) return { ok: false, violations: [] };
  try {
    // Inject the cached axe source — no network call.
    await page.addScriptTag({ content: axeSource });
    await page.waitForFunction(() => typeof (window as { axe?: unknown }).axe !== 'undefined', { timeout: 3000 });
  } catch {
    return { ok: false, violations: [] };
  }

  try {
    const raw = await page.evaluate(async () => {
      // axe is now on window
      const axe = (window as unknown as { axe: { run: (opts?: object) => Promise<unknown> } }).axe;
      const result = await axe.run({
        // Skip rules that don't matter for responsive audit
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] },
        resultTypes: ['violations'],
      });
      return result;
    });
    const violations = ((raw as { violations: Array<{ id: string; impact: AxeViolation['impact']; description: string; helpUrl: string; nodes: Array<{ html: string }> }> }).violations ?? []).map(v => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      helpUrl: v.helpUrl,
      nodeCount: v.nodes.length,
      exampleTargets: v.nodes.slice(0, 3).map(n => n.html.slice(0, 120)),
    }));
    return { ok: true, violations };
  } catch {
    return { ok: false, violations: [] };
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────

export async function runResponsiveAudit(
  context: BrowserContext,
  pageCatalog: PageTarget[],
  viewports: Viewport[],
  options: AuditOptions = {},
): Promise<{ outputDir: string; findings: PageFinding[] }> {
  const today = new Date().toISOString().slice(0, 10);
  const tag = options.outputTag ?? `responsive-audit-${today}`;
  const outputDir = path.resolve(OUTPUT_ROOT, tag);

  const runAxeOpt = options.runAxe ?? true;
  const runEnglishOpt = options.runEnglish ?? true;

  const targetPages = options.onlyPages?.length
    ? pageCatalog.filter(p => options.onlyPages!.includes(p.id))
    : pageCatalog;
  const targetViewports = options.onlyViewports?.length
    ? viewports.filter(v => options.onlyViewports!.includes(v.label))
    : viewports;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'snapshots'), { recursive: true });

  const findings: PageFinding[] = [];

  // One-time setup: seed cookies + fetch axe-core source once.
  await ensureAuthenticated(context, 'initial');
  if (runAxeOpt) await loadAxeSource(context);

  try {
    for (const target of targetPages) {
      fs.mkdirSync(path.join(outputDir, 'frames', target.id), { recursive: true });
      fs.mkdirSync(path.join(outputDir, 'snapshots', target.id), { recursive: true });

      // Re-verify the backend session once per page. The per-page
      // `seedAuthState` (addInitScript) keeps the FRONT authenticated even if
      // a page clears localStorage, so a per-capture probe is unnecessary —
      // one probe per page is enough to catch a fully-lost backend session.
      if (!target.isolated) {
        await ensureAuthenticated(context, target.id);
      }

      const locales: Locale[] = target.runInEnglish && runEnglishOpt ? ['fr', 'en'] : ['fr'];

      for (const locale of locales) {
        for (const viewport of targetViewports) {
          // Base + each interactive state. A crash in one capture must NOT
          // abort the whole run — catch, record a stub finding, continue.
          const states: (PageState | null)[] = [null, ...(target.states ?? [])];
          for (const state of states) {
            try {
              const finding = await captureOne({
                target, viewport, locale, state, context, outputDir,
                runAxe: runAxeOpt && !target.skipAxe,
              });
              findings.push(finding);
            } catch (err) {
              console.warn(`[capture ${target.id} ${viewport.label} ${locale} ${state?.id ?? 'initial'}] FAILED: ${(err as Error).message}`);
              findings.push(makeErrorFinding(target, viewport, locale, state, (err as Error).message));
            }
          }
        }
      }

      if (target.teardown) {
        const tdPage = await context.newPage();
        try {
          await target.teardown({ page: tdPage, context, baseUrl: BASE_URL, backUrl: BACK_URL });
        } catch (err) {
          console.warn(`[teardown ${target.id}] ${(err as Error).message}`);
        }
        await tdPage.close();
      }
    }
  } finally {
    // Always write aggregate outputs — even if the loop above threw, so a
    // partial run still produces a usable report.
    fs.writeFileSync(
      path.join(outputDir, 'findings-mechanical.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        pages: targetPages.map(p => ({ id: p.id, label: p.label, track: p.track, states: (p.states ?? []).map(s => s.id), runInEnglish: !!p.runInEnglish })),
        viewports: targetViewports,
        findings,
      }, null, 2),
    );
    fs.writeFileSync(path.join(outputDir, 'findings-mechanical.md'), renderFindingsMarkdown(targetPages, targetViewports, findings));
    fs.writeFileSync(path.join(outputDir, 'axe-summary.md'), renderAxeSummary(findings));
    fs.writeFileSync(path.join(outputDir, 'report.md'), renderReportMarkdown(targetPages, targetViewports, findings, tag));
  }

  return { outputDir, findings };
}

/**
 * skytrix auth lives in TWO places:
 *   - HttpOnly cookies (`Access` / `Refresh`) — used by the backend.
 *   - `localStorage['currentUser']` — read by Angular's `AuthService.canActivate`.
 *     This is a plain `UserDTO` JSON, written by the login page on success.
 *
 * If a page (e.g. the Replay Viewer's WS flow, or a failed token refresh)
 * clears `localStorage`, the cookies still work but Angular's guard redirects
 * every subsequent route to `/login`. The robust fix is to re-seed
 * `localStorage['currentUser']` on EVERY page before it loads — via
 * `addInitScript`, which runs before the Angular bootstrap reads it.
 */
const CURRENT_USER_KEY = 'currentUser';

/** Cached UserDTO from POST /api/login — fetched once, reused for every seed. */
let cachedUserDto: string | null = null;

/** Fetch the UserDTO JSON the front stores under localStorage['currentUser'].
 *  Also seeds the context's HttpOnly cookies as a side effect. */
async function fetchUserDto(context: BrowserContext): Promise<string> {
  if (cachedUserDto) return cachedUserDto;
  const res = await context.request.post(`${BACK_URL}/api/login`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${ADMIN.pseudo}:${ADMIN.password}`).toString('base64') },
  });
  if (res.status() !== 200) {
    throw new Error(`fetchUserDto: POST /api/login returned ${res.status()}`);
  }
  cachedUserDto = JSON.stringify(await res.json());
  return cachedUserDto;
}

/** Inject `localStorage['currentUser']` (+ optional lang) into a page BEFORE
 *  it loads, so Angular's auth guard sees an authenticated session even if a
 *  prior page cleared localStorage. */
async function seedAuthState(page: Page, userDto: string, locale: Locale): Promise<void> {
  await page.addInitScript(
    ({ key, value, lang }: { key: string; value: string; lang: string }) => {
      try {
        localStorage.setItem(key, value);
        localStorage.setItem('lang', lang);
      } catch {
        // localStorage may be unavailable on some error pages — ignore
      }
    },
    { key: CURRENT_USER_KEY, value: userDto, lang: locale },
  );
}

/** Verify the shared context still has valid backend cookies; re-seed if not.
 *  Cheap when already authed (one /api/decks probe). */
async function ensureAuthenticated(context: BrowserContext, site: string): Promise<void> {
  try {
    const probe = await context.request.get(`${BACK_URL}/api/decks`);
    if (probe.status() === 200) return;
  } catch {
    // fall through
  }
  console.warn(`[auth ${site}] backend session lost — re-seeding cookies`);
  cachedUserDto = null; // force a fresh /api/login
  try {
    await fetchUserDto(context);
  } catch (err) {
    console.warn(`[auth ${site}] re-seed failed: ${(err as Error).message}`);
  }
}

/** Build a stub finding when a capture throws, so the report still accounts
 *  for the slot. */
function makeErrorFinding(target: PageTarget, viewport: Viewport, locale: Locale, state: PageState | null, errMsg: string): PageFinding {
  return {
    pageId: target.id,
    pageLabel: target.label,
    viewport: viewport.label,
    locale,
    state: state?.id ?? 'initial',
    finalUrl: '(capture threw before URL was read)',
    totalMs: 0,
    horizontalOverflowPx: 0,
    undersizedTouchTargets: [],
    truncatedTexts: [],
    brokenImages: [],
    hiddenOverflowing: [],
    consoleErrors: [`[capture failed] ${errMsg}`],
    failedRequests: [],
    axeViolations: [],
    axeRanOk: false,
  };
}

interface CaptureArgs {
  target: PageTarget;
  viewport: Viewport;
  locale: Locale;
  state: PageState | null;
  context: BrowserContext;
  outputDir: string;
  runAxe: boolean;
}

async function captureOne(args: CaptureArgs): Promise<PageFinding> {
  const { target, viewport, locale, state, context, outputDir, runAxe: shouldRunAxe } = args;
  const stateSlug = state?.id ?? 'initial';
  const localeSlug = locale === 'fr' ? '' : `-${locale}`;
  const captureName = state ? `${viewport.label}-${state.id}${localeSlug}` : `${viewport.label}${localeSlug}`;

  // For isolated pages (like /login that needs an unauthed session), spawn a
  // fresh BrowserContext. Otherwise reuse the shared authenticated context.
  const browser = context.browser();
  const localCtx = target.isolated && browser ? await browser.newContext() : context;
  const isLocalCtx = localCtx !== context;
  const page = await localCtx.newPage();
  const consoleErrors: string[] = [];
  const failedRequests: Array<{ url: string; status: number }> = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('response', res => {
    const status = res.status();
    if (status >= 400 && status < 600) {
      failedRequests.push({ url: res.url(), status });
    }
  });

  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  // Seed auth + locale into localStorage BEFORE the page loads (via
  // addInitScript), so Angular's auth guard sees a session even if a prior
  // page cleared localStorage. Skipped for isolated pages (login must render
  // unauthenticated). The seed also sets `lang`, so EN captures need no extra
  // navigation round-trip.
  if (!target.isolated) {
    try {
      const userDto = await fetchUserDto(localCtx);
      await seedAuthState(page, userDto, locale);
    } catch (err) {
      consoleErrors.push(`[auth seed threw] ${(err as Error).message}`);
    }
  } else if (locale === 'en') {
    // Isolated (unauth) page still needs the EN locale — seed lang only.
    await page.addInitScript(() => {
      try { localStorage.setItem('lang', 'en'); } catch {}
    });
  }

  const start = Date.now();
  try {
    await target.navigate({ page, context: localCtx, baseUrl: BASE_URL, backUrl: BACK_URL });
  } catch (err) {
    consoleErrors.push(`[navigate threw] ${(err as Error).message}`);
  }

  await page.waitForTimeout(target.postNavWaitMs ?? 1500);

  // Open the interactive state if any
  if (state) {
    try {
      await state.open(page);
      await page.waitForTimeout(700);
    } catch (err) {
      consoleErrors.push(`[state.open threw] ${(err as Error).message}`);
    }
  }

  // Mechanical asserts
  let mech = {
    horizontalOverflowPx: 0,
    undersizedTouchTargets: [] as PageFinding['undersizedTouchTargets'],
    truncatedTexts: [] as PageFinding['truncatedTexts'],
    brokenImages: [] as PageFinding['brokenImages'],
    hiddenOverflowing: [] as PageFinding['hiddenOverflowing'],
  };
  try {
    mech = await page.evaluate(ASSERT_SCRIPT);
  } catch (err) {
    consoleErrors.push(`[assert threw] ${(err as Error).message}`);
  }

  // a11y
  const axe = shouldRunAxe ? await runAxe(page) : { ok: false, violations: [] };

  // Single screenshot per slot — viewport-only (`fullPage: false`). This is
  // the honest "what the user sees before scrolling" frame: if content sits
  // below the fold, that IS the responsive truth we want to judge. Pages with
  // an internal scroll container (login `screen-bg-*`, etc.) intentionally
  // show only their above-the-fold slice; the audit judges what is visible.
  const framePath = path.join(outputDir, 'frames', target.id, `${captureName}.png`);
  try {
    await page.screenshot({ path: framePath, fullPage: false, animations: 'disabled' });
  } catch (err) {
    consoleErrors.push(`[screenshot threw] ${(err as Error).message}`);
  }

  const finding: PageFinding = {
    pageId: target.id,
    pageLabel: target.label,
    viewport: viewport.label,
    locale,
    state: stateSlug,
    finalUrl: page.url(),
    totalMs: Date.now() - start,
    horizontalOverflowPx: mech.horizontalOverflowPx,
    undersizedTouchTargets: mech.undersizedTouchTargets,
    truncatedTexts: mech.truncatedTexts,
    brokenImages: mech.brokenImages,
    hiddenOverflowing: mech.hiddenOverflowing,
    consoleErrors,
    failedRequests,
    axeViolations: axe.violations,
    axeRanOk: axe.ok,
  };

  fs.writeFileSync(
    path.join(outputDir, 'snapshots', target.id, `${captureName}.json`),
    JSON.stringify(finding, null, 2),
  );

  await page.close();
  if (isLocalCtx) await localCtx.close();
  return finding;
}

// ─── Reporting ────────────────────────────────────────────────────────────

function renderFindingsMarkdown(pages: PageTarget[], viewports: Viewport[], findings: PageFinding[]): string {
  const lines: string[] = [];
  lines.push(`# Responsive Audit — Mechanical Findings`);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push('');

  lines.push(`## Grid overview (initial state, FR locale)`);
  lines.push('');
  lines.push(`| Page \\\\ Viewport | ${viewports.map(v => v.label).join(' | ')} |`);
  lines.push(`|---|${viewports.map(() => '---').join('|')}|`);
  for (const page of pages) {
    const cells = viewports.map(v => {
      const f = findings.find(x => x.pageId === page.id && x.viewport === v.label && x.state === 'initial' && x.locale === 'fr');
      return f ? formatCellFlags(f) : '·';
    });
    lines.push(`| ${page.label} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push(`Legend: \`OF<px>\` overflow · \`T<n>\` undersized touch · \`X<n>\` truncated · \`B<n>\` broken img · \`H<n>\` hidden-overflow · \`E<n>\` console err · \`R<n>\` failed req · \`A<n>\` axe violations · \`✓\` no finding`);
  lines.push('');

  // Per-page detail (sections with findings only)
  for (const page of pages) {
    const pageFindings = findings.filter(f => f.pageId === page.id);
    const hasAny = pageFindings.some(f => hasFinding(f));
    if (!hasAny) continue;

    lines.push(`## ${page.label} (${page.id})`);
    lines.push('');

    for (const f of pageFindings) {
      if (!hasFinding(f)) continue;
      const labelParts = [f.viewport + 'px'];
      if (f.state !== 'initial') labelParts.push(`state=${f.state}`);
      if (f.locale !== 'fr') labelParts.push(`locale=${f.locale}`);
      lines.push(`### ${labelParts.join(' · ')}`);
      lines.push('');
      lines.push(`- **Final URL** \`${f.finalUrl}\` (${f.totalMs}ms)`);
      if (f.horizontalOverflowPx > 0) lines.push(`- **Horizontal overflow** ${f.horizontalOverflowPx}px`);
      if (f.undersizedTouchTargets.length > 0) {
        lines.push(`- **Undersized touch targets** (${f.undersizedTouchTargets.length}):`);
        for (const t of f.undersizedTouchTargets.slice(0, 6)) lines.push(`  - \`<${t.tag}>\` ${t.size} — ${t.text || '(no text)'}`);
        if (f.undersizedTouchTargets.length > 6) lines.push(`  - … +${f.undersizedTouchTargets.length - 6}`);
      }
      if (f.truncatedTexts.length > 0) {
        lines.push(`- **Truncated texts** (${f.truncatedTexts.length}):`);
        for (const t of f.truncatedTexts.slice(0, 6)) lines.push(`  - \`<${t.tag}>\` [${t.cssReason}] — ${t.text || '(empty)'}`);
        if (f.truncatedTexts.length > 6) lines.push(`  - … +${f.truncatedTexts.length - 6}`);
      }
      if (f.brokenImages.length > 0) {
        lines.push(`- **Broken images** (${f.brokenImages.length}):`);
        for (const i of f.brokenImages.slice(0, 5)) lines.push(`  - \`${i.src}\` alt=${i.alt || '(none)'}`);
      }
      if (f.hiddenOverflowing.length > 0) {
        lines.push(`- **\`overflow:hidden\` clipping content** (${f.hiddenOverflowing.length}):`);
        for (const h of f.hiddenOverflowing.slice(0, 6)) lines.push(`  - \`${h.tag}\` clips ${h.overflowPx}px — ${h.text || '(empty)'}`);
        if (f.hiddenOverflowing.length > 6) lines.push(`  - … +${f.hiddenOverflowing.length - 6}`);
      }
      if (f.consoleErrors.length > 0) {
        lines.push(`- **Console errors** (${f.consoleErrors.length}):`);
        for (const e of f.consoleErrors.slice(0, 5)) lines.push(`  - \`${e.replace(/`/g, '\\`')}\``);
      }
      if (f.failedRequests.length > 0) {
        lines.push(`- **Failed requests** (${f.failedRequests.length}):`);
        for (const r of f.failedRequests.slice(0, 5)) lines.push(`  - ${r.status} ${r.url}`);
      }
      if (f.axeViolations.length > 0) {
        const critical = f.axeViolations.filter(v => v.impact === 'critical' || v.impact === 'serious');
        lines.push(`- **a11y violations** (${f.axeViolations.length}, critical/serious: ${critical.length}):`);
        for (const v of critical.slice(0, 5)) {
          lines.push(`  - **[${v.impact}] ${v.id}** × ${v.nodeCount} — ${v.description}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderAxeSummary(findings: PageFinding[]): string {
  // Aggregate violations across all captures, ranked by impact then count
  const map = new Map<string, { id: string; impact: AxeViolation['impact']; description: string; helpUrl: string; totalNodes: number; pageHits: Set<string> }>();
  for (const f of findings) {
    for (const v of f.axeViolations) {
      const key = v.id;
      const entry = map.get(key) ?? { id: v.id, impact: v.impact, description: v.description, helpUrl: v.helpUrl, totalNodes: 0, pageHits: new Set<string>() };
      entry.totalNodes += v.nodeCount;
      entry.pageHits.add(`${f.pageId}@${f.viewport}${f.state !== 'initial' ? '/' + f.state : ''}`);
      map.set(key, entry);
    }
  }

  const IMPACT_ORDER: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const rows = Array.from(map.values()).sort((a, b) => {
    const ia = IMPACT_ORDER[a.impact ?? 'minor'] ?? 4;
    const ib = IMPACT_ORDER[b.impact ?? 'minor'] ?? 4;
    if (ia !== ib) return ia - ib;
    return b.totalNodes - a.totalNodes;
  });

  const lines: string[] = [];
  lines.push(`# Responsive Audit — a11y (axe-core) Summary`);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push('');
  if (rows.length === 0) {
    lines.push(`✅ No a11y violations detected across captured states.`);
    return lines.join('\n');
  }
  lines.push(`| Impact | Rule | Nodes total | Captures impacted | Description |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of rows) {
    lines.push(`| ${r.impact ?? '—'} | [${r.id}](${r.helpUrl}) | ${r.totalNodes} | ${r.pageHits.size} | ${r.description} |`);
  }
  return lines.join('\n');
}

function renderReportMarkdown(pages: PageTarget[], viewports: Viewport[], findings: PageFinding[], tag: string): string {
  const totals = {
    captures: findings.length,
    overflowHits: findings.filter(f => f.horizontalOverflowPx > 0).length,
    touchHits: findings.filter(f => f.undersizedTouchTargets.length > 0).length,
    truncatedHits: findings.filter(f => f.truncatedTexts.length > 0).length,
    brokenImgHits: findings.filter(f => f.brokenImages.length > 0).length,
    hiddenHits: findings.filter(f => f.hiddenOverflowing.length > 0).length,
    consoleHits: findings.filter(f => f.consoleErrors.length > 0).length,
    requestHits: findings.filter(f => f.failedRequests.length > 0).length,
    axeHits: findings.filter(f => f.axeViolations.length > 0).length,
    axeCriticalHits: findings.filter(f => f.axeViolations.some(v => v.impact === 'critical' || v.impact === 'serious')).length,
  };

  const lines: string[] = [];
  lines.push(`# Responsive Audit — Report`);
  lines.push('');
  lines.push(`_Tag: \`${tag}\` · Generated ${new Date().toISOString()}_`);
  lines.push('');
  lines.push(`## Coverage`);
  lines.push('');
  lines.push(`- **Pages:** ${pages.length} (Track A canvas: ${pages.filter(p => p.track === 'A').length}, Track B CSS: ${pages.filter(p => p.track === 'B').length})`);
  lines.push(`- **Viewports:** ${viewports.length} (${viewports.map(v => v.label).join(', ')})`);
  lines.push(`- **States captured:** initial + ${pages.reduce((sum, p) => sum + (p.states?.length ?? 0), 0)} interactive states`);
  lines.push(`- **Locales:** FR (always) + EN on ${pages.filter(p => p.runInEnglish).length} critical pages`);
  lines.push(`- **Total captures:** ${totals.captures}`);
  lines.push('');
  lines.push(`## Mechanical summary`);
  lines.push('');
  lines.push(`| Issue | Captures impacted |`);
  lines.push(`|---|---|`);
  lines.push(`| Horizontal overflow | ${totals.overflowHits} |`);
  lines.push(`| Undersized touch targets (< 44px) | ${totals.touchHits} |`);
  lines.push(`| Truncated text (ellipsis / line-clamp active) | ${totals.truncatedHits} |`);
  lines.push(`| Broken images | ${totals.brokenImgHits} |`);
  lines.push(`| \`overflow:hidden\` clipping content | ${totals.hiddenHits} |`);
  lines.push(`| Console errors | ${totals.consoleHits} |`);
  lines.push(`| Failed network requests | ${totals.requestHits} |`);
  lines.push(`| a11y violations (any) | ${totals.axeHits} |`);
  lines.push(`| a11y critical/serious | ${totals.axeCriticalHits} |`);
  lines.push('');
  lines.push(`See [findings-mechanical.md](findings-mechanical.md) for per-capture detail, [axe-summary.md](axe-summary.md) for a11y aggregate, and [frames/](frames/) for screenshots.`);
  lines.push('');
  lines.push(`## Next step`);
  lines.push('');
  lines.push(`Visual audit pass: walk through \`frames/\`, classify findings into P0 (broken) / P1 (degraded) / P2 (polish), then red-team with Axel before fixing.`);

  return lines.join('\n');
}

function hasFinding(f: PageFinding): boolean {
  return (
    f.horizontalOverflowPx > 0 ||
    f.undersizedTouchTargets.length > 0 ||
    f.truncatedTexts.length > 0 ||
    f.brokenImages.length > 0 ||
    f.hiddenOverflowing.length > 0 ||
    f.consoleErrors.length > 0 ||
    f.failedRequests.length > 0 ||
    f.axeViolations.some(v => v.impact === 'critical' || v.impact === 'serious')
  );
}

function formatCellFlags(f: PageFinding): string {
  const flags: string[] = [];
  if (f.horizontalOverflowPx > 0) flags.push(`OF${f.horizontalOverflowPx}`);
  if (f.undersizedTouchTargets.length > 0) flags.push(`T${f.undersizedTouchTargets.length}`);
  if (f.truncatedTexts.length > 0) flags.push(`X${f.truncatedTexts.length}`);
  if (f.brokenImages.length > 0) flags.push(`B${f.brokenImages.length}`);
  if (f.hiddenOverflowing.length > 0) flags.push(`H${f.hiddenOverflowing.length}`);
  if (f.consoleErrors.length > 0) flags.push(`E${f.consoleErrors.length}`);
  if (f.failedRequests.length > 0) flags.push(`R${f.failedRequests.length}`);
  const axeCritical = f.axeViolations.filter(v => v.impact === 'critical' || v.impact === 'serious').length;
  if (axeCritical > 0) flags.push(`A${axeCritical}`);
  return flags.length ? flags.join(' ') : '✓';
}
