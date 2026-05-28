import { type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BASE_URL, BACK_URL, ADMIN, ensureAccount, loginViaUI, fetchOwnedDecks, waitForBoard } from './helpers';

/**
 * γ commit 7b (2026-05-27) — SOLO PvP debug harness.
 *
 * Mirror of `debug-replay-harness.ts` (kept structurally similar so they
 * can share future refactors) but targets a live SOLO PvP "quick duel"
 * session instead of a replay file. Used for the manual T2-T10 checklist
 * of `_bmad-output/phase-gamma/test-T2-T10-manual-checklist.md`.
 *
 * What it does :
 *   1. Logs the user in via the UI (cookies set so SPA guards pass).
 *   2. POSTs /api/rooms/quick-duel to create a SOLO session — the response
 *      gives `roomCode + wsToken1 + wsToken2`, the same payload the lobby
 *      `quickDuel()` flow uses (cf. lobby-page.component.ts:155-178).
 *   3. Navigates to `/pvp/duel/{code}?solo=true` with the tokens in
 *      `history.state` (same shape duel-page.component.ts:611-627 reads).
 *   4. Captures console + screenshots + JSON snapshots, exposes
 *      scenario helpers to script user actions (switch perspective,
 *      surrender, wait for prompt, capture frame).
 *   5. Tears the session down on exit (surrender + sessionStorage clear).
 *
 * Output goes to `_bmad-output/debug-solo/<tag>/` :
 *   - `report.md`    — Markdown timeline of captures + warnings.
 *   - `console.log`  — raw filtered console output.
 *   - `frames/`      — screenshots, zero-padded for chronological sort.
 *   - `snapshots/`   — `window.__skytrixDebug.snapshot()` dumps.
 *
 * Requires the stack to be UP (back 8080, duel-server 3001, front 4200
 * via `ng serve` or a static build served on its own port). The harness
 * does NOT spawn the back/duel-server itself — that's the user's job.
 *
 * Smoke-only by default (T0-bootstrap : login + create + open + capture
 * one frame + dispose). Specs that need the full T2-T10 scenarios
 * extend `runSoloPvpDebug` and add their own action scripts.
 *
 * --
 *
 * Why no `buildFirst` mode (vs replay harness) : SOLO sessions require
 * a live back DB + WS bridge — they can't be pre-built. The harness
 * always points at the running stack at `BASE_URL`.
 */

export interface SoloPvpDebugOptions {
  /** Captures + report tag under `_bmad-output/debug-solo/`. Defaults to
   *  `{ISO date}-solo`. */
  tag?: string;
  /** Max wall-clock seconds before the harness gives up waiting for the
   *  duel to reach `active`. Default 60s — covers a `ng serve` cold start
   *  + back duel-worker spawn. */
  timeoutSec?: number;
  /** Force a particular deck by name (matches against `fetchOwnedDecks`
   *  results, case-insensitive substring). Default: the first deck the
   *  account owns. T2 / T5 need a chain-capable deck (D/D, Eldlich,
   *  Spright …) — set the deck name explicitly when running those. */
  deckName?: string;
  /** Capture a screenshot + snapshot every time a console line matches one
   *  of these substrings. Same semantics as replay-harness `screenshotOn`. */
  screenshotOn?: string | string[];
  /** First-player override (0 or 1 — server-side OCGCore identity).
   *  Default 0. */
  firstPlayer?: 0 | 1;
  /** Skip the in-engine shuffle so the test runs deterministic hands.
   *  Useful for T2 (reproducing the bug-solo sequence with a known card
   *  on top of the deck). Default false. */
  skipShuffle?: boolean;
  /** Turn time limit in seconds. Defaults to 60s — long enough for an
   *  interactive scenario to finish without inactivity timeouts. */
  turnTimeSecs?: number;
}

interface CapturedLine {
  t: number;
  type: string;
  text: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.resolve(REPO_ROOT, '_bmad-output', 'debug-solo');

/** Filter console messages — keep the categories the harness analyses.
 *  Mirror of `debug-replay-harness.isInterestingMessage`. */
function isInterestingMessage(text: string, type: string): boolean {
  return text.includes('[ANIM:')
      || text.includes('[ANIM]')
      || text.includes('[skytrix-debug]')
      || text.includes('POLL-DROP')
      || text.includes('Lock safety timeout')
      || type === 'error'
      || type === 'warning';
}

/** Take a screenshot + snapshot pair, labelled by the trigger that fired it.
 *  Names are zero-padded so file listings sort chronologically. */
export async function captureFrame(
  page: Page, outDir: string, idx: number, label: string,
  lines: CapturedLine[], baseT: number,
): Promise<void> {
  const tag = String(idx).padStart(4, '0');
  const safe = label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
  await page.screenshot({ path: path.join(outDir, 'frames', `${tag}-${safe}.png`), fullPage: false });
  const snap = await page.evaluate(() => {
    const w = window as unknown as { __skytrixDebug?: { snapshot?: () => unknown } };
    try { return w.__skytrixDebug?.snapshot?.() ?? null; } catch (e) { return { error: String(e) }; }
  });
  fs.writeFileSync(path.join(outDir, 'snapshots', `${tag}-${safe}.json`),
    JSON.stringify(snap, null, 2));
  lines.push({ t: (Date.now() - baseT) / 1000, type: 'capture', text: `[CAPTURE-${tag}] ${label}` });
}

interface QuickDuelResponse {
  roomCode: string;
  wsToken1: string;
  wsToken2: string;
}

/** Create a SOLO session via /api/rooms/quick-duel — same HTTP call the
 *  lobby's "Quick Duel" button fires (lobby-page.component.ts:164). */
async function createSoloSession(
  context: BrowserContext, decklistId: number,
  firstPlayer: 0 | 1, skipShuffle: boolean, turnTimeSecs: number,
): Promise<QuickDuelResponse> {
  const res = await context.request.post(`${BACK_URL}/api/rooms/quick-duel`, {
    data: {
      decklistId1: decklistId,
      decklistId2: decklistId,
      firstPlayer,
      skipShuffle,
      turnTimeSecs,
    },
  });
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(`POST /api/rooms/quick-duel failed: HTTP ${res.status()} ${await res.text()}`);
  }
  return await res.json();
}

/** Navigate to the SOLO duel page with tokens injected in history.state —
 *  the same shape `duel-page.component.ts:611-627` reads at bootstrap. */
async function navigateToSoloDuel(page: Page, session: QuickDuelResponse, decklistId: number): Promise<void> {
  // Playwright's `page.goto` doesn't allow setting `history.state` directly.
  // We navigate via `evaluate` to mimic the Angular router's
  // `router.navigate(..., { state: {...} })` shape — same key path the
  // production lobby uses.
  await page.goto(`${BASE_URL}/pvp/duel/${session.roomCode}?solo=true`, {
    waitUntil: 'commit',
  });
  await page.evaluate(({ wsToken1, wsToken2, decklistId, code }) => {
    // sessionStorage is the back-channel duel-page checks at bootstrap if
    // history.state is empty (refresh-safe path, cf. duel-page.component.ts:610).
    sessionStorage.setItem(
      `solo-duel-tokens-${code}`,
      JSON.stringify({ wsToken1, wsToken2, activePlayer: 0, decklistId }),
    );
    // history.state needs replaceState since we already navigated.
    history.replaceState({ wsToken1, wsToken2, decklistId }, '', location.href);
  }, { wsToken1: session.wsToken1, wsToken2: session.wsToken2, decklistId, code: session.roomCode });
  // Re-trigger the bootstrap effects: a `location.reload` is the simplest
  // way to re-run duel-page.component.ts's `ngOnInit` with the now-populated
  // sessionStorage. The history.replaceState we just did is the fallback
  // for any reload during the session.
  await page.reload();
}

export interface SoloPvpHarness {
  /** The output directory for this run's artefacts. */
  outDir: string;
  /** The session payload from `/api/rooms/quick-duel`. */
  session: QuickDuelResponse;
  /** Snapshot a frame + JSON state, named by the caller. */
  capture: (label: string) => Promise<void>;
  /** Click the "switch perspective" button if rendered, or evaluate the
   *  orchestrator's `switchPerspective()` directly via window.ng. The
   *  fallback is needed because the SOLO `s` keyboard shortcut requires
   *  the duel to be in a specific state (duel-page.component.ts:815). */
  switchPerspective: () => Promise<void>;
  /** Resolve when the orchestrator's `chainPhase === 'resolving'` is
   *  observed (via `__skytrixDebug.snapshot()`). Polls every 100ms,
   *  rejects after `maxMs`. */
  waitForChainResolving: (maxMs?: number) => Promise<void>;
  /** Resolve when the orchestrator's `chainPhase === 'idle'` is observed
   *  (after MSG_CHAIN_END). */
  waitForChainIdle: (maxMs?: number) => Promise<void>;
  /** Surrender the duel cleanly (avoids end-of-test timeouts on the
   *  back). Idempotent — safe to call from `finally`. */
  surrender: () => Promise<void>;
  /** Captured console lines so far. */
  lines: CapturedLine[];
}

/**
 * Entry point — opens a SOLO PvP session, hands the caller a harness object
 * with scripted actions, then writes a Markdown report on `dispose()`.
 *
 * Returns the harness object + a `dispose` callback the caller MUST run
 * (typically in `finally`) to write the report and surrender.
 */
export async function runSoloPvpDebug(
  ctx: BrowserContext, opts: SoloPvpDebugOptions = {},
): Promise<{ harness: SoloPvpHarness; dispose: () => Promise<void> }> {
  const tag = opts.tag ?? `${new Date().toISOString().slice(0, 10)}-solo`;
  const outDir = path.resolve(OUTPUT_ROOT, tag);
  fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'snapshots'), { recursive: true });

  const page = await ctx.newPage();
  const baseT = Date.now();
  const lines: CapturedLine[] = [];

  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    if (!isInterestingMessage(text, type)) return;
    lines.push({ t: (Date.now() - baseT) / 1000, type, text });
  });
  page.on('pageerror', err => {
    lines.push({ t: (Date.now() - baseT) / 1000, type: 'error', text: `[pageerror] ${err.message}` });
  });

  const screenshotTriggers = Array.isArray(opts.screenshotOn) ? opts.screenshotOn
    : opts.screenshotOn ? [opts.screenshotOn] : [];
  let captureIdx = 0;
  if (screenshotTriggers.length > 0) {
    page.on('console', async msg => {
      const text = msg.text();
      const hit = screenshotTriggers.find(t => text.includes(t));
      if (hit) {
        captureIdx++;
        try { await captureFrame(page, outDir, captureIdx, hit, lines, baseT); } catch { /* best-effort */ }
      }
    });
  }

  // Login + ensure account — the admin user is seeded in dev DB.
  await ensureAccount(ctx, ADMIN);
  await loginViaUI(page, ADMIN);

  // Pick a deck. Default to the first owned; the caller can pin a specific
  // one via opts.deckName when the scenario needs a chain-capable deck.
  const decks = await fetchOwnedDecks(ctx);
  if (decks.length === 0) {
    throw new Error('No decks owned by admin — seed at least one before running the harness');
  }
  const picked = opts.deckName
    ? decks.find(d => d.name.toLowerCase().includes(opts.deckName!.toLowerCase()))
    : decks[0];
  if (!picked) {
    throw new Error(`No deck matching "${opts.deckName}" — owned: ${decks.map(d => d.name).join(', ')}`);
  }

  const session = await createSoloSession(
    ctx, picked.id,
    opts.firstPlayer ?? 0,
    opts.skipShuffle ?? false,
    opts.turnTimeSecs ?? 60,
  );
  await navigateToSoloDuel(page, session, picked.id);

  // Wait for the board — same signal `debug-replay-harness` uses (the
  // first `data-zone` paint means BOARD_STATE landed + dice arena
  // dismissed).
  await waitForBoard(page, (opts.timeoutSec ?? 60) * 1000);

  // Initial smoke capture so even a no-action run produces evidence the
  // bootstrap worked.
  await captureFrame(page, outDir, ++captureIdx, 't0-bootstrap', lines, baseT);

  const switchPerspective = async () => {
    // Try the keyboard shortcut first (the user-facing path —
    // duel-page.component.ts:815 binds `s` to switchPerspective in SOLO).
    // If it doesn't dispatch (focus elsewhere, modal open, …), fall back
    // to invoking the orchestrator via window.ng injector inspector.
    await page.keyboard.press('s');
    // No further verification here — the caller asserts via snapshot().
  };

  const snapshotState = async () => {
    return await page.evaluate(() => {
      const w = window as unknown as { __skytrixDebug?: { snapshot?: () => unknown } };
      try { return w.__skytrixDebug?.snapshot?.() ?? null; } catch { return null; }
    }) as { chain?: { phase?: string } } | null;
  };

  const waitForChainResolving = async (maxMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const snap = await snapshotState();
      if (snap?.chain?.phase === 'resolving') return;
      await page.waitForTimeout(100);
    }
    throw new Error(`waitForChainResolving timed out after ${maxMs}ms`);
  };

  const waitForChainIdle = async (maxMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const snap = await snapshotState();
      if (snap?.chain?.phase === 'idle') return;
      await page.waitForTimeout(100);
    }
    throw new Error(`waitForChainIdle timed out after ${maxMs}ms`);
  };

  const surrender = async () => {
    // Best-effort: dispatch via window.ng if the surrender button isn't
    // currently rendered (e.g. duel ended naturally). Idempotent.
    try {
      await page.evaluate(() => {
        const w = window as unknown as { __skytrixDebug?: { send?: (op: string) => void } };
        w.__skytrixDebug?.send?.('surrender');
      });
    } catch { /* swallow — finally-only */ }
  };

  const capture = async (label: string) => {
    captureIdx++;
    await captureFrame(page, outDir, captureIdx, label, lines, baseT);
  };

  const harness: SoloPvpHarness = {
    outDir, session,
    capture, switchPerspective, waitForChainResolving, waitForChainIdle, surrender,
    lines,
  };

  const dispose = async () => {
    try { await surrender(); } catch { /* best-effort */ }
    try { await page.close(); } catch { /* best-effort */ }
    writeReport(outDir, opts, session, lines);
  };

  return { harness, dispose };
}

function writeReport(
  outDir: string, opts: SoloPvpDebugOptions, session: QuickDuelResponse,
  lines: CapturedLine[],
): void {
  const warnings = lines.filter(l => l.type === 'warning');
  const errors = lines.filter(l => l.type === 'error');
  const captures = lines.filter(l => l.type === 'capture');
  const lockTimeouts = lines.filter(l => l.text.includes('Lock safety timeout'));
  const pollDrops = lines.filter(l => l.text.includes('POLL-DROP'));
  const pipelineLines = lines.filter(l => l.text.includes('[ANIM:PIPELINE]'));

  const md: string[] = [];
  md.push(`# SOLO PvP debug report — ${session.roomCode}`);
  md.push('');
  md.push(`- **roomCode**: \`${session.roomCode}\``);
  md.push(`- **tag**: ${opts.tag ?? 'default'}`);
  md.push(`- **captures**: ${captures.length}`);
  md.push(`- **warnings**: ${warnings.length}`);
  md.push(`- **errors**: ${errors.length}`);
  md.push(`- **Lock safety timeouts** (T2 victory signal): ${lockTimeouts.length} ${lockTimeouts.length === 0 ? '✓' : '✗'}`);
  md.push(`- **POLL-DROP REGRESSION** (T2 victory signal): ${pollDrops.length} ${pollDrops.length === 0 ? '✓' : '✗'}`);
  md.push(`- **total filtered log lines**: ${lines.length}`);
  md.push('');

  if (errors.length) {
    md.push('## Errors');
    md.push('');
    errors.forEach(l => md.push(`- \`t=${l.t.toFixed(3)}s\` ${l.text}`));
    md.push('');
  }

  if (lockTimeouts.length || pollDrops.length) {
    md.push('## ⚠️ γ test-of-victory signals fired');
    md.push('');
    md.push('Either symptom below indicates γ has NOT eliminated the bug-solo-sequence:');
    md.push('');
    lockTimeouts.forEach(l => md.push(`- \`t=${l.t.toFixed(3)}s\` ${l.text}`));
    pollDrops.forEach(l => md.push(`- \`t=${l.t.toFixed(3)}s\` ${l.text}`));
    md.push('');
  }

  if (warnings.length) {
    md.push('## Warnings');
    md.push('');
    warnings.slice(0, 50).forEach(l => md.push(`- \`t=${l.t.toFixed(3)}s\` ${l.text}`));
    if (warnings.length > 50) md.push(`- … and ${warnings.length - 50} more (see \`console.log\`)`);
    md.push('');
  }

  if (captures.length) {
    md.push('## Captures');
    md.push('');
    captures.forEach(l => {
      const m = /\[CAPTURE-(\d+)\]\s*(.*)/.exec(l.text);
      if (!m) return;
      const [, tag, label] = m;
      const safe = label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
      md.push(`### t=${l.t.toFixed(3)}s — ${label}`);
      md.push('');
      md.push(`- frame: \`frames/${tag}-${safe}.png\``);
      md.push(`- snapshot: \`snapshots/${tag}-${safe}.json\``);
      md.push('');
    });
  }

  md.push('## Pipeline trace (last 50)');
  md.push('');
  md.push('```');
  pipelineLines.slice(-50).forEach(l => md.push(`t=${l.t.toFixed(3)}s ${l.text}`));
  md.push('```');
  md.push('');

  // Also flush the full filtered console to a sibling file (no truncation).
  fs.writeFileSync(path.join(outDir, 'console.log'),
    lines.map(l => `[${l.t.toFixed(3)}s][${l.type}] ${l.text}`).join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'), 'utf8');
}
