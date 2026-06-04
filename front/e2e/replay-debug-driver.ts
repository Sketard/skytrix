import { type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { spawn } from 'child_process';
import { BASE_URL, ADMIN, loginViaUI } from './helpers';

/**
 * Reusable replay debug toolkit. Splits the original `runReplayDebug`
 * (`debug-replay-harness.ts`) into two pieces so specs can compose
 * arbitrary scenarios (seek to N → toggle perspective → step → assert)
 * instead of being limited to "play until end".
 *
 *   - `setupReplaySession(ctx, opts)` — login + optional build + navigate +
 *     wait for the viewer to be ready. Returns a `ReplayDebugSession`
 *     containing the page, the driver, the output directory, the
 *     captured-line buffer, and a `finalize()` to write `report.md` +
 *     `console.log` + close any spawned static server.
 *
 *   - `ReplayDebugDriver` — thin façade over the `window.__skytrixDebug.replay`
 *     surface (see `replay-page.component.ts:bindToWindow + replay` block).
 *     Every action is a single `page.evaluate()` that calls the SAME
 *     component-level handler the transport-bar invokes on click, so any
 *     side-effect a real click triggers (notably `abortAndClean()` +
 *     `gameLogRebuildTick++`) fires identically.
 *
 * The driver's stability comes from talking to a stable global window
 * surface, not to selectors that may move when the transport-bar / timeline
 * is reworked. The surface is dev-only (no-op in production bundles), but
 * the harness only runs in dev anyway.
 *
 * See CLAUDE.md → "Debugging Animations (...)" for the broader debug story.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.resolve(REPO_ROOT, '_bmad-output', 'debug-replay');
const FRONT_DIST = path.resolve(REPO_ROOT, 'front', 'dist', 'skytrix', 'browser');

// =============================================================================
// Captured-line buffer (shared with the legacy `runReplayDebug` harness so
// reports written via `finalize()` look identical to the original ones)
// =============================================================================

export interface CapturedLine {
  t: number;
  type: string;
  text: string;
}

/** Same predicate the original harness uses — keep only signal-bearing lines
 *  so the report stays readable. */
export function isInterestingMessage(text: string, type: string): boolean {
  return text.includes('[ANIM:')
      || text.includes('[ANIM]')
      || text.includes('[skytrix-debug]')
      || type === 'error'
      || type === 'warning';
}

// =============================================================================
// Static server (buildFirst mode)
// =============================================================================

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

// =============================================================================
// Driver — single source of truth for replay debug actions
// =============================================================================

/** Mirror of the shape `replay-page.component.ts` exposes under
 *  `window.__skytrixDebug.replay`. Kept in sync via tsc — if the component
 *  signature changes, this interface flags the drift at compile time when a
 *  spec uses a method the surface no longer has. */
export interface SkytrixReplayDebugSurface {
  seek(idx: number): void;
  stepForward(): void;
  stepBack(): void;
  skipStart(): void;
  skipEnd(): void;
  playPause(): void;
  togglePerspective(): void;
  toggleAnimations(): void;
  togglePromptMode(): void;
  currentIndex(): number;
  computedUpTo(): number;
  totalBoardStates(): number;
  isPlaying(): boolean;
  perspectiveIndex(): 0 | 1;
  animationsEnabled(): boolean;
  promptMode(): 'decision' | 'result';
  chainState(): {
    phase: 'idle' | 'building' | 'resolving';
    activeChainLinks: Array<{
      chainIndex: number; cardCode: number; cardName: string; player: number;
      location: number; sequence: number; resolving: boolean; negated: boolean;
    }>;
  };
  currentStateChainSnapshot(): null | {
    links: unknown[]; phase: 'building' | 'resolving';
    negatedIndices: number[]; currentSolvingChainIndex: number | null;
  };
  currentStateEventTypes(): string[];
}

export class ReplayDebugDriver {
  constructor(private readonly page: Page) {}

  // ───── Navigation ─────

  /** Pause + jump to event index N. Equivalent to clicking a sub-event tick
   *  in the timeline. Fires `abortAndClean()` (orchestrator reset + journal
   *  rebuild) — same path the transport-bar uses. */
  async seek(idx: number): Promise<void> {
    await this.page.evaluate(([i]) => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.seek(i as number);
    }, [idx]);
    await this.page.waitForTimeout(50); // microtask flush; signals propagate
  }

  /** Pause + jump to the LAST event index. Fires `abortAndClean()`. */
  async skipEnd(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.skipEnd();
    });
    await this.page.waitForTimeout(50);
  }

  /** Pause + jump to event 0. Fires `abortAndClean()`. */
  async skipStart(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.skipStart();
    });
    await this.page.waitForTimeout(50);
  }

  /** Step one event forward without seeking (preserves the orchestrator
   *  state via the natural advanceStep path). Does NOT fire `abortAndClean`. */
  async stepForward(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.stepForward();
    });
    await this.page.waitForTimeout(50);
  }

  /** Step one event backward. Fires `abortAndClean()`. */
  async stepBack(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.stepBack();
    });
    await this.page.waitForTimeout(50);
  }

  /** Toggle play / pause. Toggling play from an idle paused state starts
   *  the playback loop; from playing pauses it. */
  async playPause(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.playPause();
    });
    await this.page.waitForTimeout(50);
  }

  // ───── Toggles ─────

  /** Swap viewer perspective (0 ↔ 1). Fires `abortAndClean()` + re-jumps
   *  the adapter to the current state. Mid-chain perspective flip is a
   *  known UX edge — the chain overlay restore depends on whether the
   *  page re-jumpsToState after the flip; today it does NOT (see
   *  `onTogglePerspective` in `replay-page.component.ts`). */
  async togglePerspective(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.togglePerspective();
    });
    await this.page.waitForTimeout(100); // perspective flip cascades through the pipeline
  }

  /** Toggle animations ON ↔ OFF. Fires `abortAndClean()` + re-jumps. */
  async toggleAnimations(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.toggleAnimations();
    });
    await this.page.waitForTimeout(50);
  }

  /** Toggle prompt mode (decision ↔ result). In decision mode, replay
   *  pauses at every player choice; in result mode the choice is auto-
   *  applied and playback continues. */
  async togglePromptMode(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
        .__skytrixDebug?.replay?.togglePromptMode();
    });
    await this.page.waitForTimeout(50);
  }

  // ───── Read-only inspectors ─────

  async currentIndex(): Promise<number> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.currentIndex() ?? -1);
  }

  async totalBoardStates(): Promise<number> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.totalBoardStates() ?? 0);
  }

  async perspectiveIndex(): Promise<0 | 1> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.perspectiveIndex() ?? 0);
  }

  async animationsEnabled(): Promise<boolean> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.animationsEnabled() ?? false);
  }

  async promptMode(): Promise<'decision' | 'result'> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.promptMode() ?? 'result');
  }

  async isPlaying(): Promise<boolean> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.isPlaying() ?? false);
  }

  /** Live read of the processor's chain state. Use this to assert that a
   *  mid-chain seek restored the overlay correctly (F9-bis verification). */
  async chainState(): Promise<{
    phase: string;
    activeChainLinks: Array<{
      chainIndex: number; cardCode: number; cardName: string; player: number;
      location: number; sequence: number; resolving: boolean; negated: boolean;
    }>;
  }> {
    const out = await this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.chainState() ?? { phase: 'unknown', activeChainLinks: [] });
    return out;
  }

  /** Returns the chainSnapshot field on the currently rendered
   *  PreComputedState (or null when absent). Use this to verify that the
   *  precompute embedded a snapshot at the expected index. */
  async currentStateChainSnapshot(): Promise<null | { links: unknown[]; phase: string; negatedIndices: number[]; currentSolvingChainIndex: number | null }> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.currentStateChainSnapshot() ?? null);
  }

  /** Returns the event types of the currently rendered state. */
  async currentStateEventTypes(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as { __skytrixDebug?: { replay?: SkytrixReplayDebugSurface } })
      .__skytrixDebug?.replay?.currentStateEventTypes() ?? []);
  }

  /** Take a full debug snapshot via `__skytrixDebug.snapshot()`. Used for
   *  archival captures (see `report.md` → snapshot JSON). */
  async fullSnapshot(): Promise<unknown> {
    return this.page.evaluate(() => {
      const w = window as unknown as { __skytrixDebug?: { snapshot?: () => unknown } };
      try { return w.__skytrixDebug?.snapshot?.() ?? null; } catch (e) { return { error: String(e) }; }
    });
  }

  // ───── Wait helpers ─────

  /** Poll until `currentIndex >= targetIdx`. Used after `playPause()` or
   *  forward-step sequences that should advance to a known point. */
  async waitForIndex(targetIdx: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const cur = await this.currentIndex();
      if (cur >= targetIdx) return;
      await this.page.waitForTimeout(100);
    }
    throw new Error(`waitForIndex(${targetIdx}) timed out at ${await this.currentIndex()}`);
  }

  /** Poll until the precompute has at least `target` board states. Use
   *  this after navigating to wait for the WS REPLAY_BOARD_STATES batches
   *  to land. */
  async waitForBoardStates(target: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const n = await this.totalBoardStates();
      if (n >= target) return;
      await this.page.waitForTimeout(150);
    }
    throw new Error(`waitForBoardStates(${target}) timed out at ${await this.totalBoardStates()}`);
  }

  /** Poll until the end overlay is mounted (the replay played to the
   *  natural end). Used by the play-until-end harness wrapper. */
  async waitForEndOverlay(timeoutMs = 120_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ended = await this.page.locator('app-replay-end-overlay').count() > 0;
      if (ended) return true;
      await this.page.waitForTimeout(2000);
    }
    return false;
  }
}

// =============================================================================
// Session setup — login + navigation + driver wiring
// =============================================================================

export interface ReplaySessionOptions {
  replayId: string;
  /** 0 = OCGCore P0 (default). 1 = the opposite side. */
  perspective?: 0 | 1;
  /** Optional `?seekTo=N` for fork-style mid-bootstrap seek. Most specs
   *  don't need this — call `driver.seek(N)` after the session is ready
   *  instead, which goes through the user-facing seek path. */
  fromEvent?: number;
  /** `true` runs `ng build` once + serves on a free port. HMR-immune,
   *  ~30s overhead. `false` (default) reuses the user's running ng serve. */
  buildFirst?: boolean;
  /** Output folder under `_bmad-output/debug-replay/`. Defaults to a
   *  timestamped + replay-shortened folder. */
  tag?: string;
  /** Substrings to capture a screenshot+snapshot on. Passed through to
   *  the page's `console` listener. Optional. */
  screenshotOn?: string | string[];
}

export interface ReplayDebugSession {
  readonly page: Page;
  readonly driver: ReplayDebugDriver;
  readonly outDir: string;
  readonly lines: CapturedLine[];
  readonly baseT: number;
  /** Capture a screenshot + JSON snapshot pair labelled by `label`. */
  capture(label: string): Promise<void>;
  /** Flush captured lines into `console.log` + write `report.md` + close
   *  the static server if one was spawned. Idempotent. */
  finalize(): Promise<void>;
}

/** Provision a fresh replay session: optionally builds, optionally starts
 *  a static server, logs in via UI, navigates to the viewer, waits for
 *  the page to be ready, and returns the driver wired to the page. The
 *  caller is responsible for closing the BrowserContext.
 *
 *  Pattern:
 *    const session = await setupReplaySession(ctx, { replayId, perspective: 1 });
 *    try {
 *      await session.driver.seek(42);
 *      const cs = await session.driver.chainState();
 *      expect(cs.activeChainLinks.length).toBeGreaterThan(0);
 *      await session.capture('after-seek');
 *    } finally {
 *      await session.finalize();
 *    } */
export async function setupReplaySession(
  ctx: BrowserContext,
  opts: ReplaySessionOptions,
): Promise<ReplayDebugSession> {
  const perspective = opts.perspective ?? 0;
  const replayShort = opts.replayId.slice(0, 8);
  const tag = opts.tag ?? `${new Date().toISOString().slice(0, 10)}-${replayShort}-p${perspective}`;
  const outDir = path.resolve(OUTPUT_ROOT, tag);
  fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'snapshots'), { recursive: true });

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
  let captureIdx = 0;

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

  // ───── Login + prime + navigate ─────

  await loginViaUI(page, ADMIN);
  await page.evaluate((p) => {
    localStorage.setItem('replay.animationsEnabled', 'true');
    localStorage.setItem('replay.perspectiveIndex', String(p));
  }, perspective);

  const target = opts.fromEvent != null
    ? `${baseURL}/pvp/replay/${opts.replayId}?seekTo=${opts.fromEvent}`
    : `${baseURL}/pvp/replay/${opts.replayId}`;
  await page.goto(target);
  await page.waitForSelector('[data-zone]', { timeout: 30_000 });
  await page.waitForSelector('app-transport-bar', { timeout: 20_000 });
  // Initial-draw breathe beat — 500ms in code, give it 1s of margin.
  await page.waitForTimeout(opts.fromEvent != null ? 5_000 : 1_500);

  // Enable verbose categories (covers RESOLVE + PIPELINE which are off
  // by default).
  await page.evaluate(() => {
    const w = window as unknown as { __skytrixDebug?: { enableAll?: () => void } };
    w.__skytrixDebug?.enableAll?.();
  });

  const driver = new ReplayDebugDriver(page);

  // Baseline capture so the report always has a starting frame.
  captureIdx++;
  await captureFrame(page, outDir, captureIdx, 'baseline', lines, baseT);

  let finalized = false;
  const session: ReplayDebugSession = {
    page,
    driver,
    outDir,
    lines,
    baseT,
    async capture(label: string) {
      captureIdx++;
      await captureFrame(page, outDir, captureIdx, label, lines, baseT);
    },
    async finalize() {
      if (finalized) return;
      finalized = true;
      try {
        fs.writeFileSync(path.join(outDir, 'console.log'),
          lines.map(l => `[t=${l.t.toFixed(3)}s][${l.type}] ${l.text}`).join('\n'),
          'utf8');
        writeReport(outDir, opts, lines);
      } finally {
        if (staticServer) staticServer.close();
      }
    },
  };
  return session;
}

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

function writeReport(outDir: string, opts: ReplaySessionOptions, lines: CapturedLine[]): void {
  const warnings = lines.filter(l => l.type === 'warning');
  const errors = lines.filter(l => l.type === 'error');
  const captures = lines.filter(l => l.type === 'capture');
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
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'), 'utf8');
}
