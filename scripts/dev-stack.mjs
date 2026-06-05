#!/usr/bin/env node
// dev-stack — isolated stack orchestrator for e2e + Claude debug sessions.
//
// Runs a full skytrix stack (postgres / back / duel-server / front) on
// shifted ports so it cohabits with the user's hand-driven stack on the
// canonical ports. Default user stack stays at 5432 / 8080 / 3001 / 4200;
// this stack uses 15432 / 18080 / 13001 / 14200.
//
//   Service       User stack             Claude stack (this script)
//   ────────────  ─────────────────────  ─────────────────────────────────
//   Postgres      :5432 (yours)          :15432 (Docker, dedicated volume)
//   Back Spring   :8080  / :8081         :18080 / :18081
//   duel-server   :3001                  :13001
//   Front Angular :4200                  :14200
//
// CLI: node scripts/dev-stack.mjs <command> [args]
//
//   up                       — bring everything up (idempotent: skips
//                              already-running services)
//   up --only=back,duel      — bring up a subset
//   down                     — stop every managed service (does NOT touch
//                              the user's stack — pid match required)
//   down --only=front        — stop a subset
//   restart <svc>            — down + up a single service (back|duel|front|db)
//   status                   — table of pid / port / uptime / health
//   logs <svc> [--tail=N]    — print log file (default tail 100)
//   sync-db                  — pg_dump from user's :5432 → import into
//                              this stack's :15432 (overwrites)
//   reset-db                 — drop the dedicated volume and restart
//                              Postgres clean
//   doctor                   — verify pre-requisites (docker, mvnw, ports
//                              free, env files present)
//
// Programmatic: import { ensureStack } from './scripts/dev-stack.mjs'
//   await ensureStack({ services: ['back', 'duel', 'front'] });
//   — idempotent; used by playwright.config.ts webServer hook.
//
// Conventions:
//   - state lives in scripts/.dev-stack/  (pid file, log files)
//   - all sub-processes inherit env overrides set per service below
//   - readiness probes are HTTP GET with retry budget per service
//   - Windows-aware: uses mvnw.cmd, ng.cmd, taskkill /T /F on shutdown

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, readdirSync, copyFileSync, symlinkSync, lstatSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STATE_DIR = resolve(__dirname, '.dev-stack');
const PID_FILE = join(STATE_DIR, 'pids.json');
const IS_WINDOWS = process.platform === 'win32';

// ── JAVA_HOME detection (Windows) ──────────────────────────────────────────
// mvnw.cmd refuses to run without JAVA_HOME, and many dev setups have a
// working `java` on PATH but no env var exported. Probe common install
// locations + the registry; return the first JDK 21+ root we find.

function detectJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME;
  }
  if (!IS_WINDOWS) return null;

  // Candidate roots (most likely first). We pick a JDK (jdk-*) over a JRE
  // (jre*) because Spring Boot needs a JDK at runtime.
  const candidates = [];
  const programFilesPath = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const candidateDirs = [
    join(programFilesPath, 'Eclipse Adoptium'),
    join(programFilesPath, 'Java'),
    join(programFilesPath, 'Microsoft'),
    join(programFilesPath, 'Amazon Corretto'),
  ];
  for (const dir of candidateDirs) {
    if (!existsSync(dir)) continue;
    try {
      const subs = readdirSync(dir);
      for (const sub of subs) {
        if (!sub.toLowerCase().startsWith('jdk-')) continue;
        const root = join(dir, sub);
        if (existsSync(join(root, 'bin', 'java.exe'))) candidates.push(root);
      }
    } catch { /* ignore */ }
  }
  // Prefer JDK 21+ (back/pom.xml pins java.version=21). Sort desc by version
  // suffix so jdk-21.x.y comes before jdk-17.x.y.
  candidates.sort((a, b) => {
    const va = parseInt(a.match(/jdk-(\d+)/)?.[1] ?? '0', 10);
    const vb = parseInt(b.match(/jdk-(\d+)/)?.[1] ?? '0', 10);
    if (vb !== va) return vb - va;
    return b.localeCompare(a);
  });
  const pick = candidates.find((c) => {
    const v = parseInt(c.match(/jdk-(\d+)/)?.[1] ?? '0', 10);
    return v >= 21;
  }) ?? candidates[0];
  return pick ?? null;
}

const JAVA_HOME = detectJavaHome();

// ── Isolated dataDir for duel-server ───────────────────────────────────────
// The user's hand-driven duel-server on :3001 and this stack's duel-server
// on :13001 used to share `duel-server/data/`. When the user clicks "update
// data" on their stack, the rename `cards.cdb -> cards.cdb.backup` fails
// with EBUSY on Windows because our worker thread keeps a sqlite handle
// open. Each stack now points at its own dataDir via process.env.DATA_DIR
// (read by duel-server/src/server.ts line 127).
//
// Strategy: a real copy of cards.cdb (small, ~30 MB, rename-safe — both
// stacks can run their own update independently), plus symlinks for
// scripts_full/ (~10k Lua files, read-only at runtime) and strings.conf
// (one-shot read at boot). Symlinking the scripts dir keeps a `git pull`
// in the canonical scripts_full propagating to both stacks — desired, the
// upstream sync is the same. Don't symlink cards.cdb itself — Windows
// treats the symlink target as the real file for rename purposes, which
// is the exact pattern we're trying to escape.
const DUEL_DATA_CANONICAL = join(ROOT, 'duel-server', 'data');
const DUEL_DATA_ISOLATED = join(ROOT, 'duel-server', 'data-isolated');

function ensureIsolatedDuelData() {
  if (!existsSync(DUEL_DATA_CANONICAL)) {
    throw new Error(`Canonical dataDir missing: ${DUEL_DATA_CANONICAL}. Run the user's duel-server stack at least once to bootstrap it.`);
  }
  if (!existsSync(DUEL_DATA_ISOLATED)) {
    mkdirSync(DUEL_DATA_ISOLATED, { recursive: true });
  }

  // cards.cdb — independent copy (rename-target during update-data)
  const cdbSrc = join(DUEL_DATA_CANONICAL, 'cards.cdb');
  const cdbDst = join(DUEL_DATA_ISOLATED, 'cards.cdb');
  if (existsSync(cdbSrc) && !existsSync(cdbDst)) {
    copyFileSync(cdbSrc, cdbDst);
    log(`→ duel: isolated cards.cdb copied (${(statSync(cdbDst).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // scripts_full + strings.conf — junctions/symlinks (read-only at runtime,
  // safe to share with the canonical stack — `git pull` upstream propagates
  // to both stacks).
  //
  // Windows: dir → junction via `mklink /J` (no admin/dev-mode required,
  // unlike a true symlink). File → POSIX-style symlink (Windows allows file
  // symlinks under most setups, AND strings.conf is small enough that the
  // copy fallback is negligible if symlink fails).
  // POSIX: standard symlinkSync for both.
  for (const entry of ['scripts_full', 'strings.conf']) {
    const src = join(DUEL_DATA_CANONICAL, entry);
    const dst = join(DUEL_DATA_ISOLATED, entry);
    if (!existsSync(src)) continue;
    if (existsSync(dst)) continue; // already linked or copied from a prior run
    const isDir = statSync(src).isDirectory();
    if (linkIsolated(src, dst, isDir)) {
      log(`→ duel: isolated ${entry} → canonical (${isDir && IS_WINDOWS ? 'junction' : 'symlink'})`);
    } else {
      log(`! duel: link ${entry} failed; fallback to copy. Re-run "up" after upstream pull to refresh.`);
      if (isDir) copyDirSync(src, dst);
      else copyFileSync(src, dst);
    }
  }
}

// Create a junction (Windows dir) or symlink (everything else) from src→dst.
// Returns true on success, false on any failure (caller falls back to copy).
function linkIsolated(src, dst, isDir) {
  if (IS_WINDOWS && isDir) {
    // mklink is a cmd.exe builtin, not an exe — needs shell:true.
    const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', dst, src], { stdio: 'pipe' });
    return r.status === 0;
  }
  try {
    symlinkSync(src, dst, isDir ? 'dir' : 'file');
    return true;
  } catch {
    return false;
  }
}

function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else copyFileSync(s, d);
  }
}

// ── Service registry ───────────────────────────────────────────────────────
// One entry per managed process. `start` returns the spawn() args. `probe`
// is an async readiness check; `timeoutMs` is the budget before we give up.

const SERVICES = {
  db: {
    label: 'postgres',
    port: 15432,
    timeoutMs: 30_000,
    // Postgres runs in Docker; pid is the container id, not a host PID.
    docker: true,
    containerName: 'skytrix-e2e-db',
    volumeName: 'skytrix-e2e-data',
    image: 'postgres:16',
    env: { POSTGRES_PASSWORD: 'root', POSTGRES_DB: 'skytrix' },
    probe: () => tcpProbe('localhost', 15432, 1000),
  },
  back: {
    label: 'back',
    port: 18080,
    actuatorPort: 18081,
    cwd: join(ROOT, 'back'),
    // mvnw lives only in the repo, not in PATH. On Windows cmd.exe does
    // NOT search cwd (unlike POSIX shells), so we pass the absolute path.
    cmd: IS_WINDOWS ? join(ROOT, 'back', 'mvnw.cmd') : './mvnw',
    args: ['spring-boot:run', '-q'],
    timeoutMs: 120_000,
    env: {
      SERVER_PORT: '18080',
      MANAGEMENT_SERVER_PORT: '18081',
      SPRING_DATASOURCE_URL: 'jdbc:postgresql://localhost:15432/skytrix',
      DB_PASSWORD: 'root',
      DUEL_SERVER_URL: 'http://localhost:13001',
      // The Spring SecurityConfig default-whitelists only :4200. Without
      // this override, the browser's Origin: http://localhost:14200 trips
      // the CORS filter and every cross-origin request comes back 403.
      // curl-direct works because curl doesn't send Origin.
      CORS_ALLOWED_ORIGINS: 'http://localhost:14200',
      // mvnw.cmd hard-requires JAVA_HOME. Auto-detected at script load if
      // not already set in the user's env (detectJavaHome() above).
      ...(JAVA_HOME ? { JAVA_HOME } : {}),
    },
    probe: () => httpProbe('http://localhost:18081/actuator/health', 2000),
    dependsOn: ['db'],
  },
  duel: {
    label: 'duel-server',
    port: 13001,
    cwd: join(ROOT, 'duel-server'),
    // Use already-built dist (npm run build is run by `up` if needed).
    cmd: IS_WINDOWS ? 'npm.cmd' : 'npm',
    args: ['start'],
    timeoutMs: 20_000,
    env: {
      PORT: '13001',
      SPRING_BOOT_API_URL: 'http://localhost:18080/api',
      INTERNAL_API_KEY: 'dev-internal-key',
      // Read by duel-server/src/server.ts:127. Keeps this stack's cards.cdb
      // isolated from the user's canonical :3001 so /api/update-data on
      // either side can rename atomically without an EBUSY from the other.
      DATA_DIR: DUEL_DATA_ISOLATED,
    },
    probe: () => httpProbe('http://localhost:13001/health', 1000),
    dependsOn: ['back'],
  },
  front: {
    label: 'front',
    port: 14200,
    cwd: join(ROOT, 'front'),
    cmd: IS_WINDOWS ? 'npx.cmd' : 'npx',
    args: ['ng', 'serve', '--port', '14200', '--configuration', 'e2e'],
    timeoutMs: 90_000,
    env: {},
    probe: () => httpProbe('http://localhost:14200/', 2000),
    dependsOn: ['back', 'duel'],
  },
};

const ALL_SERVICE_NAMES = Object.keys(SERVICES);

// ── State persistence ──────────────────────────────────────────────────────

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function readState() {
  ensureStateDir();
  if (!existsSync(PID_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  ensureStateDir();
  writeFileSync(PID_FILE, JSON.stringify(state, null, 2));
}

function logPath(name) {
  return join(STATE_DIR, `${name}.log`);
}

// ── Probes ─────────────────────────────────────────────────────────────────

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolveP) => {
    const sock = createConnection({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolveP(ok);
    };
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}

function httpProbe(url, timeoutMs) {
  return new Promise((resolveP) => {
    const req = httpRequest(url, { method: 'GET' }, (res) => {
      // Any 2xx/3xx counts as up. 4xx/5xx means the server is responding
      // (e.g. 404 on / for an Angular dev-server returning index.html is
      // actually 200 — but ng serve returns 200 only after compile).
      const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400;
      res.resume();
      resolveP(ok);
    });
    req.on('error', () => resolveP(false));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch { /* ignore */ }
      resolveP(false);
    });
    req.end();
  });
}

async function waitForProbe(probe, timeoutMs, label) {
  const start = Date.now();
  let delay = 250;
  while (Date.now() - start < timeoutMs) {
    if (await probe()) return true;
    await sleep(delay);
    delay = Math.min(delay * 1.5, 2000);
  }
  log(`✘ ${label}: probe timeout after ${Math.round((Date.now() - start) / 1000)}s`);
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Logging ────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[dev-stack ${ts}] ${msg}\n`);
}

// ── Docker helpers (for Postgres) ──────────────────────────────────────────

function dockerAvailable() {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore', shell: IS_WINDOWS });
  return r.status === 0;
}

function dockerContainerState(name) {
  // Returns 'running' | 'exited' | 'absent'.
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Status}}', name], {
    encoding: 'utf8', shell: IS_WINDOWS,
  });
  if (r.status !== 0) return 'absent';
  return r.stdout.trim();
}

function dockerVolumeExists(name) {
  const r = spawnSync('docker', ['volume', 'inspect', name], { stdio: 'ignore', shell: IS_WINDOWS });
  return r.status === 0;
}

async function startPostgres() {
  if (!dockerAvailable()) {
    log('✘ Docker daemon not responding. Start Docker Desktop and retry.');
    return false;
  }
  const svc = SERVICES.db;
  const state = dockerContainerState(svc.containerName);
  if (state === 'running') {
    log(`✓ postgres already running (container ${svc.containerName})`);
    return true;
  }
  if (state === 'exited') {
    log(`→ postgres: starting existing container ${svc.containerName}`);
    const r = spawnSync('docker', ['start', svc.containerName], { stdio: 'ignore', shell: IS_WINDOWS });
    if (r.status !== 0) {
      log(`✘ postgres: docker start failed`);
      return false;
    }
  } else {
    log(`→ postgres: creating container ${svc.containerName} (volume ${svc.volumeName})`);
    const r = spawnSync('docker', [
      'run', '-d',
      '--name', svc.containerName,
      '-p', `${svc.port}:5432`,
      '-e', `POSTGRES_PASSWORD=${svc.env.POSTGRES_PASSWORD}`,
      '-e', `POSTGRES_DB=${svc.env.POSTGRES_DB}`,
      '-v', `${svc.volumeName}:/var/lib/postgresql/data`,
      svc.image,
    ], { stdio: 'inherit', shell: IS_WINDOWS });
    if (r.status !== 0) {
      log(`✘ postgres: docker run failed`);
      return false;
    }
  }
  const ok = await waitForProbe(svc.probe, svc.timeoutMs, 'postgres');
  if (ok) log(`✓ postgres up on :${svc.port}`);
  return ok;
}

function stopPostgres() {
  const svc = SERVICES.db;
  const state = dockerContainerState(svc.containerName);
  if (state !== 'running') {
    log(`→ postgres: not running, nothing to stop`);
    return true;
  }
  log(`→ postgres: stopping container ${svc.containerName}`);
  const r = spawnSync('docker', ['stop', svc.containerName], { stdio: 'ignore', shell: IS_WINDOWS });
  return r.status === 0;
}

// ── Node/Java service lifecycle ────────────────────────────────────────────

async function startService(name) {
  const svc = SERVICES[name];
  if (svc.docker) return startPostgres();

  // Already up? (probe directly — pidfile might be stale across reboots)
  if (await svc.probe()) {
    log(`✓ ${name} already responding on :${svc.port}`);
    return true;
  }

  if (name === 'duel') ensureIsolatedDuelData();

  log(`→ ${name}: spawning (${svc.cmd} ${svc.args.join(' ')})`);
  const out = openSync(logPath(name), 'a');
  const err = openSync(logPath(name), 'a');
  const child = spawn(svc.cmd, svc.args, {
    cwd: svc.cwd,
    env: { ...process.env, ...svc.env },
    stdio: ['ignore', out, err],
    detached: !IS_WINDOWS,  // POSIX: detach so it survives this script; Win: handled by taskkill /T
    shell: IS_WINDOWS,      // .cmd shims require shell on Windows
  });

  // Save pid before unref so a crash during probe still leaves us state.
  const state = readState();
  state[name] = {
    pid: child.pid,
    port: svc.port,
    startedAt: new Date().toISOString(),
    logPath: logPath(name),
  };
  writeState(state);

  child.unref();

  const ok = await waitForProbe(svc.probe, svc.timeoutMs, name);
  if (ok) {
    log(`✓ ${name} up on :${svc.port} (pid ${child.pid})`);
  } else {
    log(`✘ ${name} failed to come up — check ${logPath(name)}`);
  }
  return ok;
}

function stopService(name) {
  const svc = SERVICES[name];
  if (svc.docker) return stopPostgres();

  const state = readState();
  const entry = state[name];
  if (entry) {
    log(`→ ${name}: stopping pid ${entry.pid}`);
    killTree(entry.pid);
    delete state[name];
    writeState(state);
  } else {
    log(`→ ${name}: no pid recorded`);
  }
  // Belt-and-suspenders: mvnw → java and npx → ng → node chains can
  // leave orphans whose grandparent PID has already exited, so taskkill /T
  // can't see them anymore. Sweep the service's port and kill any holder.
  if (IS_WINDOWS) killByPort(svc.port, name);
  return true;
}

function killTree(pid) {
  if (IS_WINDOWS) {
    // /T = tree (kills child java/node spawned by mvnw/npm), /F = force.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ }
    }, 5000).unref();
  }
}

function killByPort(port, label) {
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true });
  if (r.status !== 0) return;
  const seen = new Set();
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/\s+TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (!m) continue;
    if (parseInt(m[1], 10) !== port) continue;
    const pid = parseInt(m[2], 10);
    if (pid === 0 || seen.has(pid)) continue;
    seen.add(pid);
    log(`→ ${label}: killing orphan pid ${pid} on :${port}`);
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  }
}

// ── Topological ordering ───────────────────────────────────────────────────

function topoOrder(requested) {
  const visited = new Set();
  const order = [];
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of SERVICES[name].dependsOn ?? []) visit(dep);
    order.push(name);
  }
  for (const name of requested) visit(name);
  return order;
}

// ── Public commands ────────────────────────────────────────────────────────

export async function ensureStack(opts = {}) {
  const requested = opts.services ?? ALL_SERVICE_NAMES;
  for (const name of requested) {
    if (!SERVICES[name]) throw new Error(`Unknown service: ${name}`);
  }
  const ordered = topoOrder(requested);
  for (const name of ordered) {
    const ok = await startService(name);
    if (!ok) {
      log(`✘ stack startup aborted at ${name}`);
      throw new Error(`dev-stack: ${name} failed to start`);
    }
  }
  log(`✓ stack ready: ${ordered.join(', ')}`);
}

export async function tearDown(opts = {}) {
  const requested = opts.services ?? ALL_SERVICE_NAMES;
  // For `down`, only stop what the caller asked — do NOT expand to deps.
  // Reason: `down --only=back` should leave the shared `db` running so
  // a subsequent `up --only=back` is fast. The shutdown order within the
  // requested set still respects reverse-topo so dependents stop first.
  const reverseTopo = topoOrder(ALL_SERVICE_NAMES).reverse();
  const requestedSet = new Set(requested);
  const ordered = reverseTopo.filter((n) => requestedSet.has(n));
  for (const name of ordered) stopService(name);
}

async function cmdStatus() {
  const state = readState();
  const rows = [];
  for (const name of ALL_SERVICE_NAMES) {
    const svc = SERVICES[name];
    const responding = await svc.probe();
    const entry = state[name];
    rows.push({
      service: name,
      port: svc.port,
      probe: responding ? 'up' : 'down',
      pid: entry?.pid ?? (svc.docker ? '(docker)' : '-'),
      uptime: entry?.startedAt ? agoOf(entry.startedAt) : '-',
    });
  }
  // Plain console output (table) — this is the user-facing surface.
  // eslint-disable-next-line no-console
  console.table(rows);
}

function agoOf(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function cmdLogs(name, tail) {
  const path = logPath(name);
  if (!existsSync(path)) {
    log(`✘ no log file for ${name} (${path})`);
    return;
  }
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  const slice = tail > 0 ? lines.slice(-tail) : lines;
  process.stdout.write(slice.join('\n'));
}

async function cmdSyncDb() {
  if (!dockerAvailable()) {
    log('✘ Docker daemon not responding.');
    return;
  }
  if (dockerContainerState(SERVICES.db.containerName) !== 'running') {
    log('→ postgres not running, starting first');
    if (!(await startPostgres())) return;
  }
  log('→ sync-db: pg_dump from localhost:5432 → localhost:15432');
  // Use docker exec for psql restore (avoids requiring psql client on host).
  // Use system pg_dump for the source (the user already has Postgres locally).
  const dumpProc = spawnSync('pg_dump', [
    '-h', 'localhost', '-p', '5432', '-U', 'postgres', '-d', 'skytrix',
    '--clean', '--if-exists', '--no-owner', '--no-acl',
  ], {
    encoding: 'buffer',
    env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD ?? 'root' },
    maxBuffer: 512 * 1024 * 1024,
  });
  if (dumpProc.status !== 0) {
    log(`✘ pg_dump failed: ${dumpProc.stderr?.toString() ?? 'unknown'}`);
    return;
  }
  const restoreProc = spawnSync('docker', [
    'exec', '-i',
    '-e', 'PGPASSWORD=root',
    SERVICES.db.containerName,
    'psql', '-U', 'postgres', '-d', 'skytrix',
  ], {
    input: dumpProc.stdout,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: IS_WINDOWS,
  });
  if (restoreProc.status !== 0) {
    log(`✘ psql restore failed (exit ${restoreProc.status})`);
    return;
  }
  log('✓ sync-db done');
}

async function cmdResetDb() {
  log('→ reset-db: stopping container + dropping volume');
  stopPostgres();
  const svc = SERVICES.db;
  spawnSync('docker', ['rm', '-f', svc.containerName], { stdio: 'ignore', shell: IS_WINDOWS });
  if (dockerVolumeExists(svc.volumeName)) {
    spawnSync('docker', ['volume', 'rm', svc.volumeName], { stdio: 'inherit', shell: IS_WINDOWS });
  }
  log('→ reset-db: recreating fresh container');
  await startPostgres();
}

async function cmdDoctor() {
  const checks = [];
  checks.push(['docker daemon', dockerAvailable() ? '✓' : '✘ (Docker Desktop not running)']);
  checks.push(['JAVA_HOME', JAVA_HOME ? `✓ ${JAVA_HOME}` : '✘ (no JDK 21+ found in Program Files)']);
  checks.push(['back/mvnw exists', existsSync(join(ROOT, 'back', IS_WINDOWS ? 'mvnw.cmd' : 'mvnw')) ? '✓' : '✘']);
  checks.push(['duel-server/dist exists', existsSync(join(ROOT, 'duel-server', 'dist', 'server.js')) ? '✓' : '✘ (run npm run build in duel-server)']);
  checks.push(['front/node_modules exists', existsSync(join(ROOT, 'front', 'node_modules')) ? '✓' : '✘ (run npm install in front)']);
  checks.push(['environment.e2e.ts exists', existsSync(join(ROOT, 'front', 'src', 'environments', 'environment.e2e.ts')) ? '✓' : '✘']);
  for (const [name, port] of [['db', 15432], ['back', 18080], ['duel', 13001], ['front', 14200]]) {
    const inUse = await tcpProbe('localhost', port, 500);
    const entry = readState()[name];
    if (inUse && !entry) {
      checks.push([`port :${port}`, `⚠ in use but not by dev-stack (kill that process or change port)`]);
    } else {
      checks.push([`port :${port}`, inUse ? `in use by dev-stack ${name}` : 'free']);
    }
  }
  // eslint-disable-next-line no-console
  console.table(checks.map(([what, status]) => ({ check: what, status })));
}

// ── CLI dispatch ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  const [, , ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);
  const [cmd, ...args] = positional;

  const onlySvcs = flags.only ? flags.only.split(',') : null;

  switch (cmd) {
    case 'up':
      await ensureStack({ services: onlySvcs ?? ALL_SERVICE_NAMES });
      break;
    case 'down':
      await tearDown({ services: onlySvcs ?? ALL_SERVICE_NAMES });
      break;
    case 'restart': {
      const svc = args[0];
      if (!svc || !SERVICES[svc]) {
        log(`✘ usage: restart <${ALL_SERVICE_NAMES.join('|')}>`);
        process.exit(1);
      }
      await tearDown({ services: [svc] });
      await sleep(500);
      await ensureStack({ services: [svc] });
      break;
    }
    case 'status':
      await cmdStatus();
      break;
    case 'logs': {
      const svc = args[0];
      if (!svc || !SERVICES[svc]) {
        log(`✘ usage: logs <${ALL_SERVICE_NAMES.join('|')}> [--tail=N]`);
        process.exit(1);
      }
      const tail = flags.tail ? parseInt(flags.tail, 10) : 100;
      cmdLogs(svc, tail);
      break;
    }
    case 'sync-db':
      await cmdSyncDb();
      break;
    case 'reset-db':
      await cmdResetDb();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      log(`✘ unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  process.stdout.write(`
dev-stack — isolated stack for e2e + debug

Usage: node scripts/dev-stack.mjs <command> [args]

Commands:
  up [--only=a,b]         Bring stack up (idempotent)
  down [--only=a,b]       Stop managed services
  restart <svc>           Restart one service (db|back|duel|front)
  status                  Table of pid/port/uptime/health
  logs <svc> [--tail=N]   Tail a service log (default N=100)
  sync-db                 pg_dump user :5432 → restore into :15432
  reset-db                Drop volume + recreate Postgres
  doctor                  Verify prerequisites + port collisions

Stack ports (isolated from user's 5432/8080/3001/4200):
  postgres  :15432    back  :18080 / :18081
  duel      :13001    front :14200

State: scripts/.dev-stack/  (pids.json + per-service logs)
`);
}

// Only run CLI when invoked directly, not when imported.
const invokedDirectly = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
if (invokedDirectly) {
  main().catch((e) => { log(`✘ fatal: ${e.message}`); process.exit(1); });
}
