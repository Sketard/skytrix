import { test as base, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { spawn, type ChildProcess } from 'child_process';
import { BASE_URL, ADMIN, loginViaUI } from './helpers';

/**
 * Replay debug harness — produces a Markdown report + screenshots + JSON
 * snapshots for a given replay ID & perspective. Designed to be the single
 * entry point for "debug an animation bug from a replay".
 *
 * Two run modes:
 *   - `buildFirst: true`  (recommended) — runs `ng build` once, serves the
 *     static artifacts on a free port. ZERO HMR risk. ~30s overhead per spec
 *     file but constant across many replay runs in the same spec.
 *   - `buildFirst: false` — points at the user's running `ng serve` (the
 *     `BASE_URL` constant from helpers). Fast but risks HMR mid-replay
 *     truncating the capture.
 *
 * The harness writes everything to `_bmad-output/debug-replay/{date}-{tag}/`:
 *   - `report.md`       — Markdown timeline + warnings + key signals
 *   - `console.log`     — raw filtered console output with timestamps
 *   - `frames/`         — screenshots tagged with timestamp + label
 *   - `snapshots/`      — JSON dumps from window.__skytrixDebug.snapshot()
 *
 * Re-runs into the same `tag` overwrite. Use a unique tag (or default to a
 * timestamped folder) for archival.
 */

export interface ReplayDebugOptions {
  replayId: string;
  /** 0 = OCGCore player 0 (default). 1 = the opposite side. Bugs that only
   *  manifest from the opposite perspective (e.g. the EMZ data-zone bug
   *  fixed 2026-05-18) require explicit perspective=1 runs. */
  perspective?: 0 | 1;
  /** Skip to this event index before capturing. Saves wall-clock when the
   *  bug only manifests deep into a long replay. Wired via the replay-page's
   *  existing `?seekTo=N` query param (the same mechanism the fork-return
   *  flow uses) — the page waits for boardStates to be precomputed up to N,
   *  then calls `onSeek(N)`. Adds up to ~15s to the harness startup while
   *  the seek settles; budgeted as 25% of `timeoutSec`. */
  fromEvent?: number;
  /** Capture a screenshot + snapshot every time an ANIM:* log line containing
   *  the substring fires. Multiple substrings: pass as array. */
  screenshotOn?: string | string[];
  /** When true, runs `ng build` and serves the static output on a free port.
   *  Recommended for stable captures. Defaults to false (uses the user's
   *  running ng serve, but tolerates HMR-truncated runs). */
  buildFirst?: boolean;
  /** Output tag — folder name under `_bmad-output/debug-replay/`. Defaults
   *  to `{ISO date}-{replayId-short}-p{perspective}`. */
  tag?: string;
  /** Max wall-clock seconds to wait for the replay to finish playing.
   *  Default 120s. The harness polls for `app-replay-end-overlay`. */
  timeoutSec?: number;
}

interface CapturedLine {
  t: number;
  type: string;
  text: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.resolve(REPO_ROOT, '_bmad-output', 'debug-replay');
const FRONT_DIST = path.resolve(REPO_ROOT, 'front', 'dist', 'skytrix', 'browser');

/** Resolve a free TCP port for the static server. Sync-style via a small
 *  shared `Promise.resolve` trick — Playwright tests are async-friendly. */
async function pickFreePort(): Promise<number> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 4201;
      srv.close(() => resolve(port));
    });
  });
}

/** Build the front-end via Angular CLI. Long-running (~30s); returns once the
 *  output directory contains `index.html`. */
async function runBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['ng', 'build', '--configuration=development'], {
      cwd: path.resolve(REPO_ROOT, 'front'),
      stdio: 'pipe',
      shell: true,
    });
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('exit', code => {
      if (code === 0) {
        if (fs.existsSync(path.join(FRONT_DIST, 'index.html'))) return resolve();
        return reject(new Error(`ng build exited 0 but no index.html at ${FRONT_DIST}`));
      }
      reject(new Error(`ng build exit ${code}\n${stderr.slice(-800)}`));
    });
    child.on('error', reject);
  });
}

/** Spawn a tiny static file server over the dist directory. Returns the
 *  server instance so the test can close it in `finally`. SPA fallback:
 *  any request that 404s falls back to `index.html` (the Angular router
 *  needs this). */
function spawnStaticServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    let url = req.url ?? '/';
    if (url.includes('?')) url = url.split('?')[0];
    const safe = path.normalize(url).replace(/^(\.\.[\\/])+/, '');
    let filePath = path.join(FRONT_DIST, safe);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(FRONT_DIST, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.js' ? 'application/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.html' ? 'text/html'
      : ext === '.json' ? 'application/json'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.woff2' ? 'font/woff2'
      : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
  server.listen(port);
  return server;
}

/** Filter console messages — keep only the categories the harness analyses.
 *  Everything else is dropped to keep the captured log lean. */
function isInterestingMessage(text: string, type: string): boolean {
  return text.includes('[ANIM:')
      || text.includes('[ANIM]')
      || text.includes('[skytrix-debug]')
      || type === 'error'
      || type === 'warning';
}

/** Force-set replay preferences via localStorage before navigating to the
 *  viewer. Animations on, perspective set, and the auto-play key set so the
 *  topbar's play button is the only thing left to click. */
async function primeReplayPrefs(page: Page, perspective: 0 | 1): Promise<void> {
  await page.evaluate((p) => {
    localStorage.setItem('replay.animationsEnabled', 'true');
    localStorage.setItem('replay.perspectiveIndex', String(p));
  }, perspective);
}

/** Take a screenshot + snapshot pair, labelled by the trigger line that
 *  fired the capture. Names are zero-padded so file listings sort
 *  chronologically. */
async function captureFrame(page: Page, outDir: string, idx: number, label: string, lines: CapturedLine[], baseT: number): Promise<void> {
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

/** Write the final Markdown report — timeline of capture events + warnings,
 *  with section dividers + links to the screenshots/snapshots. */
function writeReport(outDir: string, opts: ReplayDebugOptions, lines: CapturedLine[]): void {
  const warnings = lines.filter(l => l.type === 'warning');
  const errors = lines.filter(l => l.type === 'error');
  const captures = lines.filter(l => l.type === 'capture');
  const resolveLines = lines.filter(l => l.text.includes('[ANIM:RESOLVE]'));
  const pipelineLines = lines.filter(l => l.text.includes('[ANIM:PIPELINE]'));
  const md: string[] = [];
  md.push(`# Replay debug report — ${opts.replayId}`);
  md.push('');
  md.push(`- **perspective**: ${opts.perspective ?? 0}`);
  md.push(`- **buildFirst**: ${opts.buildFirst ? 'yes' : 'no'}`);
  md.push(`- **captures**: ${captures.length}`);
  md.push(`- **warnings**: ${warnings.length}`);
  md.push(`- **errors**: ${errors.length}`);
  md.push(`- **total log lines**: ${lines.length}`);
  md.push('');
  if (errors.length) {
    md.push('## Errors');
    md.push('');
    errors.forEach(l => md.push(`- \`t=${l.t.toFixed(3)}s\` ${l.text}`));
    md.push('');
  }
  if (warnings.length) {
    md.push('## Warnings');
    md.push('');
    warnings.forEach(l => md.push(`- \`t=${l.t.toFixed(3)}s\` ${l.text}`));
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
  md.push('## Pipeline trace (last 100)');
  md.push('');
  md.push('```');
  pipelineLines.slice(-100).forEach(l => md.push(`t=${l.t.toFixed(3)}s ${l.text}`));
  md.push('```');
  md.push('');
  md.push(`## Resolve trace (count=${resolveLines.length})`);
  md.push('');
  md.push('See `console.log` for the full trace — only failed resolves (which auto-promote to warn) are reproduced above.');
  md.push('');
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'), 'utf8');
}

/** The single entry point: callable from a Playwright test spec.
 *  Returns the output directory path so the spec can attach it to test
 *  artifacts if desired. */
export async function runReplayDebug(ctx: BrowserContext, opts: ReplayDebugOptions): Promise<string> {
  const perspective = opts.perspective ?? 0;
  const replayShort = opts.replayId.slice(0, 8);
  const tag = opts.tag ?? `${new Date().toISOString().slice(0, 10)}-${replayShort}-p${perspective}`;
  const outDir = path.resolve(OUTPUT_ROOT, tag);
  fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'snapshots'), { recursive: true });

  // Decide which base URL to point Playwright at. `buildFirst` mode produces
  // a fully-static bundle and serves it on a free port — no HMR, no
  // background recompiles. Default mode reuses the user's ng serve.
  let staticServer: http.Server | null = null;
  let baseURL = BASE_URL;
  if (opts.buildFirst) {
    await runBuild();
    const port = await pickFreePort();
    staticServer = spawnStaticServer(port);
    baseURL = `http://localhost:${port}`;
  }

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

  try {
    // Login (UI flow — the back-end auth cookie has to be set for the SPA
    // guards to let the replay route through).
    await loginViaUI(page, ADMIN);
    await primeReplayPrefs(page, perspective);

    // The replay-page reads `?seekTo=N` at boot and waits for the boardStates
    // to be precomputed up to index N before calling `onSeek(N)`. This is the
    // same mechanism used by the fork-return flow — no debug-specific code in
    // the page component. When `fromEvent` is omitted, the URL is unchanged
    // and the replay plays from event 0 as before.
    const target = opts.fromEvent != null
      ? `${baseURL}/pvp/replay/${opts.replayId}?seekTo=${opts.fromEvent}`
      : `${baseURL}/pvp/replay/${opts.replayId}`;
    await page.goto(target);
    await page.waitForSelector('[data-zone]', { timeout: 30_000 });
    await page.waitForSelector('app-transport-bar', { timeout: 20_000 });
    // Initial-draw breathe beat — 500ms in code, give it 1s of margin. When
    // a seek is requested, give it longer: the `setupSeekTo` effect waits
    // for boardStates to reach the target index, which depends on how deep
    // into the replay the seek points. Cap at the user's timeout so we
    // don't out-wait the test.
    const settleMs = opts.fromEvent != null
      ? Math.min(15_000, (opts.timeoutSec ?? 120) * 250) // ~25% of total budget
      : 1500;
    await page.waitForTimeout(settleMs);

    // Enable verbose logging via the debug surface (covers RESOLVE +
    // PIPELINE which are off by default). Idempotent.
    await page.evaluate(() => {
      const w = window as unknown as { __skytrixDebug?: { enableAll?: () => void } };
      w.__skytrixDebug?.enableAll?.();
    });

    // Capture a baseline frame BEFORE playback starts so the report shows
    // the initial state next to the final one.
    captureIdx++;
    await captureFrame(page, outDir, captureIdx, 'baseline', lines, baseT);

    // Seek is now driven by the `?seekTo=N` query param appended to the URL
    // above — no post-load action needed. The replay-page's `setupSeekTo`
    // effect handles waiting for the precomputed boardStates to reach the
    // target index before triggering `onSeek(N)`.

    // Click play. The button has aria-label="Lecture" (FR) or "Play" (EN).
    const playBtn = page.locator('app-transport-bar button[aria-label*="Play" i], app-transport-bar button[aria-label*="Lect" i]').first();
    if (await playBtn.count() > 0) {
      await playBtn.click({ timeout: 5000 }).catch(() => { /* already playing OR end overlay shown */ });
    }

    // Wait for the end overlay OR the timeout, whichever comes first.
    const timeoutMs = (opts.timeoutSec ?? 120) * 1000;
    const startMs = Date.now();
    while (Date.now() - startMs < timeoutMs) {
      const ended = await page.locator('app-replay-end-overlay').count() > 0;
      if (ended) break;
      await page.waitForTimeout(2000);
    }

    // Capture a final frame after end-overlay (or timeout).
    captureIdx++;
    await captureFrame(page, outDir, captureIdx, 'final', lines, baseT);
  } finally {
    // Flush logs + Markdown report.
    fs.writeFileSync(path.join(outDir, 'console.log'),
      lines.map(l => `[t=${l.t.toFixed(3)}s][${l.type}] ${l.text}`).join('\n'),
      'utf8');
    writeReport(outDir, opts, lines);
    await page.close().catch(() => undefined);
    if (staticServer) staticServer.close();
  }

  return outDir;
}

/** Convenience wrapper for the common test pattern: open a context, run
 *  the harness, close. Use in specs that don't need extra browser state. */
export const debugTest = base;

export type DebugTestArgs = { ctx: BrowserContext };

/** Marker so future spec files can grep their callsites. */
export const HARNESS_VERSION = '1.0.0';
