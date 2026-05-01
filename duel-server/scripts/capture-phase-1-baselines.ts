// =============================================================================
// capture-phase-1-baselines.ts — Phase 1 baseline capture orchestrator for
// the prompt-resolver refactor.
//
// Captures bit-exact snapshots of every Phase 1 baseline category so Phase 3
// (adapter migration) and Phase 4 (CLI migration) can diff against them after
// PromptResolver wiring is enabled. Categories:
//
//   1. canonical-eval      — 69-fixture canonical eval via evaluate-structural
//   2. plan-replay (β-1)   — 3 audited fixtures (branded, ddd, snake-eye)
//   3. raw-replay (β-3)    — 4 audited fixtures (radiant, mitsurugi, branded,
//                             snake-eye, ddd)
//   4. enumerate-skip      — 3 fixtures × skip variants (smoke check, not full
//                             sweep — just enough to lock pickSource semantics)
//   5. adversarial         — 1 fixture (Alexandrite + 3 handtraps) via
//                             capture-adversarial-baseline
//
// Output: _bmad-output/solver-data/phase-1-baselines/<category>/<fixture>.json
//         + manifest.json (commit SHA, timestamp, command, file list)
//
// Usage:
//   cd duel-server
//   npx tsx scripts/capture-phase-1-baselines.ts \
//     --out-dir=../_bmad-output/solver-data/phase-1-baselines \
//     [--mode=eval|replay|adversarial|enumerate|all (default: all)]
//     [--skip-eval]   # eval is the slowest (~10-15min); use to iterate faster
// =============================================================================

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

interface ReplayTarget {
  fixtureId: string;
  planFile: string;
  outFile: string;
  traceFile: string;
  /** Optional human note for the manifest. */
  note?: string;
}

interface SkipTarget {
  fixtureId: string;
  basePlanFile: string;
  outDir: string;
  /** How many skip variants to enumerate (full coverage = plan length; use a
   *  small fixed N here to keep capture fast). */
  comboDepth: number;
}

function pickArg(name: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const outDirArg = pickArg('out-dir');
if (!outDirArg) {
  console.error('Usage: --out-dir=<path> [--mode=eval|replay|adversarial|enumerate|all]');
  process.exit(2);
}
const mode = pickArg('mode') ?? 'all';
const skipEval = hasFlag('skip-eval');

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const OUT_DIR = resolve(outDirArg);
mkdirSync(OUT_DIR, { recursive: true });

// =============================================================================
// Commit SHA pin
// =============================================================================

function gitSha(): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git rev-parse failed: ${r.stderr}`);
  return r.stdout.trim();
}
function gitDirty(): boolean {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (r.status !== 0) return true;
  // Ignore untracked files in _bmad-output/solver-data/phase-1-baselines (the
  // very directory we're writing to) — only flag real source dirty.
  const lines = r.stdout.split('\n').filter(l => l.trim().length > 0);
  const meaningful = lines.filter(l => {
    const p = l.slice(3);
    if (p.startsWith('_bmad-output/solver-data/phase-1-baselines')) return false;
    if (p.startsWith('.claude/')) return false;
    return true;
  });
  return meaningful.length > 0;
}

const sha = gitSha();
const dirty = gitDirty();

// =============================================================================
// Capture targets
// =============================================================================

const REPLAY_TARGETS: ReplayTarget[] = [
  {
    fixtureId: 'branded-dracotail-opener',
    planFile: 'data/path-beta-poc/branded-dracotail-opener/critic-branded-best-plan.json',
    outFile: join(OUT_DIR, 'plan-replay/branded-dracotail-opener.result.json'),
    traceFile: join(OUT_DIR, 'plan-replay/branded-dracotail-opener.trace.jsonl'),
    note: 'β-1 critic mode, expected 7/8',
  },
  {
    fixtureId: 'ddd-pendulum-opener',
    planFile: 'data/path-beta-poc/ddd-pendulum-opener/sprint2-option-b-best-plan.json',
    outFile: join(OUT_DIR, 'plan-replay/ddd-pendulum-opener.result.json'),
    traceFile: join(OUT_DIR, 'plan-replay/ddd-pendulum-opener.trace.jsonl'),
    note: 'β-1 sprint 2 option B, expected 3/5',
  },
  {
    fixtureId: 'snake-eye-yummy-opener',
    planFile: 'data/path-beta-poc/snake-eye-yummy-opener/beta1v2-yesno-best-plan.json',
    outFile: join(OUT_DIR, 'plan-replay/snake-eye-yummy-opener.result.json'),
    traceFile: join(OUT_DIR, 'plan-replay/snake-eye-yummy-opener.trace.jsonl'),
    note: 'β-1 v2 + YESNO override (sprint 2), expected 4/7',
  },
];

const RAW_REPLAY_TARGETS: ReplayTarget[] = [
  {
    fixtureId: 'ryzeal-mitsurugi-opener',
    planFile: 'data/path-beta-poc/ryzeal-mitsurugi-opener/beta3-best-trajectory.json',
    outFile: join(OUT_DIR, 'raw-replay/ryzeal-mitsurugi-opener.result.json'),
    traceFile: join(OUT_DIR, 'raw-replay/ryzeal-mitsurugi-opener.trace.jsonl'),
    note: 'β-3, expected 5/5',
  },
  {
    fixtureId: 'radiant-typhoon-opener',
    planFile: 'data/path-beta-poc/radiant-typhoon-opener/beta3-best-trajectory.json',
    outFile: join(OUT_DIR, 'raw-replay/radiant-typhoon-opener.result.json'),
    traceFile: join(OUT_DIR, 'raw-replay/radiant-typhoon-opener.trace.jsonl'),
    note: 'β-3, expected 3/3',
  },
  {
    fixtureId: 'branded-dracotail-opener',
    planFile: 'data/path-beta-poc/branded-dracotail-opener/beta3-best-trajectory.json',
    outFile: join(OUT_DIR, 'raw-replay/branded-dracotail-opener.result.json'),
    traceFile: join(OUT_DIR, 'raw-replay/branded-dracotail-opener.trace.jsonl'),
    note: 'β-3 alt path, expected 6/8',
  },
];

// NOTE: snake-eye-yummy and ddd-pendulum have `.raw-replay.json` files under
// _bmad-output/planning-artifacts/research/trajectories/ but those use the
// `raw-replay-v1` PvP recording format which is NOT round-trip compatible
// with the solver (different deck-shuffle init). See the comment block in
// scripts/raw-replay-to-trajectory.ts. They diverge at step 0 deterministically.
// Phase 1 only baselines β-3 trajectories produced by Path β subagents under
// data/path-beta-poc/<fixture>/beta3-best-trajectory.json.

const SKIP_TARGETS: SkipTarget[] = [
  {
    fixtureId: 'branded-dracotail-opener',
    basePlanFile: 'data/path-beta-poc/branded-dracotail-opener/critic-branded-best-plan.json',
    outDir: join(OUT_DIR, 'enumerate-skip/branded-dracotail-opener'),
    comboDepth: 1,
  },
  {
    fixtureId: 'snake-eye-yummy-opener',
    basePlanFile: 'data/path-beta-poc/snake-eye-yummy-opener/beta1v2-yesno-best-plan.json',
    outDir: join(OUT_DIR, 'enumerate-skip/snake-eye-yummy-opener'),
    comboDepth: 1,
  },
];

// =============================================================================
// Capture functions
// =============================================================================

function ensureDir(p: string): void {
  mkdirSync(dirname(p), { recursive: true });
}
function logCmd(cmd: string, args: string[]): void {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
}
function exitOnFail(label: string, r: SpawnSyncReturns<Buffer>): void {
  if (r.status !== 0) {
    console.error(`\n[${label}] FAILED (exit=${r.status})`);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  }
}

function captureCanonicalEval(): { outFile: string; command: string } {
  const outFile = join(OUT_DIR, 'canonical-eval.json');
  ensureDir(outFile);
  // pool-size=1 (not 4) — pool=4 makes cum matched non-deterministic on
  // ryzeal-mitsurugi-opener (alternates 2 ↔ 3 between runs), shifting
  // cumulativeMatched by ±1 and breaking the bit-exact gate. pool=1 produces
  // a stable cum=27/545. Per-fixture nodesExplored/transpositionHits still
  // jitter slightly (wall-clock-bound DFS); the gate excludes those fields.
  // Trade-off: pool=1 is ~4× slower (~12 min vs ~3 min) but reproducible.
  // Discovery: 2026-05-01, see Phase 1 README. Predecessor memo
  // eval-noise-audit-2026-04-27 had σ=0.00 at pool=4 — something between
  // 2026-04-27 and 2026-05-01 made the pool=4 path non-deterministic.
  const args = [
    'tsx',
    'scripts/evaluate-structural.ts',
    `--out=${outFile}`,
    '--budget-ms=6000',
    '--node-budget=400',
    '--pool-size=1',
    '--implicit-goals=10',
  ];
  const env = {
    ...process.env,
    SOLVER_DISABLE_EXPERTISE: '1',
    SOLVER_USE_NEURAL_WEIGHTS: '1',
  };
  logCmd('SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 npx', args);
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: true, env });
  exitOnFail('canonical-eval', r);
  return {
    outFile,
    command: `SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 npx ${args.join(' ')}`,
  };
}

function captureReplay(t: ReplayTarget): { outFile: string; traceFile: string; command: string } {
  ensureDir(t.outFile);
  ensureDir(t.traceFile);
  const args = [
    'tsx',
    'scripts/replay-trajectory-cli.ts',
    `--fixture-id=${t.fixtureId}`,
    `--plan-file=${t.planFile}`,
    `--out=${t.outFile}`,
    `--dump-trace=${t.traceFile}`,
  ];
  logCmd('npx', args);
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
  exitOnFail(`replay/${t.fixtureId}`, r);
  return {
    outFile: t.outFile,
    traceFile: t.traceFile,
    command: `npx ${args.join(' ')}`,
  };
}

function captureSkip(t: SkipTarget): { outDir: string; command: string } {
  mkdirSync(t.outDir, { recursive: true });
  const args = [
    'tsx',
    'scripts/enumerate-skip.ts',
    `--fixture-id=${t.fixtureId}`,
    `--base-plan=${t.basePlanFile}`,
    `--out-dir=${t.outDir}`,
    `--combo-depth=${t.comboDepth}`,
  ];
  logCmd('npx', args);
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
  exitOnFail(`skip/${t.fixtureId}`, r);
  return {
    outDir: t.outDir,
    command: `npx ${args.join(' ')}`,
  };
}

function captureAdversarial(): { outFile: string; command: string } {
  const outFile = join(OUT_DIR, 'adversarial/alexandrite-handtraps.json');
  ensureDir(outFile);
  const args = ['tsx', 'scripts/capture-adversarial-baseline.ts', `--out=${outFile}`];
  logCmd('npx', args);
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
  exitOnFail('adversarial', r);
  return { outFile, command: `npx ${args.join(' ')}` };
}

// =============================================================================
// Orchestration
// =============================================================================

interface ManifestEntry {
  category: string;
  label: string;
  files: string[];
  command: string;
  note?: string;
}
const manifest: {
  pinnedCommitSha: string;
  workingTreeDirty: boolean;
  capturedAt: string;
  manifestVersion: 1;
  decisions: Record<string, string>;
  entries: ManifestEntry[];
} = {
  pinnedCommitSha: sha,
  workingTreeDirty: dirty,
  capturedAt: new Date().toISOString(),
  manifestVersion: 1,
  decisions: {
    snapshotMode: 'ON (default, no env var needed)',
    aggressiveContinuation: 'β-1 only (parité stricte, β-3 omits aggressive)',
    expertiseInEval: 'OFF (SOLVER_DISABLE_EXPERTISE=1, honest baseline)',
    neuralWeightsInEval: 'ON (SOLVER_USE_NEURAL_WEIGHTS=1)',
    nodeBudget: '400 (deterministic)',
    poolSize: '1 (NOT 4 — see eval section in README; pool=4 is non-deterministic on ryzeal-mitsurugi cum matched)',
    implicitGoals: '10',
  },
  entries: [],
};

function rel(p: string): string {
  return relative(REPO_ROOT, resolve(p)).replace(/\\/g, '/');
}

if (mode === 'eval' || (mode === 'all' && !skipEval)) {
  console.log('\n========== Capturing canonical eval (69 fixtures) ==========');
  const r = captureCanonicalEval();
  manifest.entries.push({
    category: 'canonical-eval',
    label: '69-fixture eval (SOLVER_DISABLE_EXPERTISE=1)',
    files: [rel(r.outFile)],
    command: r.command,
  });
} else if (mode === 'all' && skipEval) {
  console.log('\n[skip] canonical-eval (--skip-eval)');
}

if (mode === 'replay' || mode === 'all') {
  console.log('\n========== Capturing β-1 plan-replay baselines ==========');
  for (const t of REPLAY_TARGETS) {
    const r = captureReplay(t);
    manifest.entries.push({
      category: 'plan-replay',
      label: t.fixtureId,
      files: [rel(r.outFile), rel(r.traceFile)],
      command: r.command,
      note: t.note,
    });
  }

  console.log('\n========== Capturing β-3 raw-replay baselines ==========');
  for (const t of RAW_REPLAY_TARGETS) {
    if (t.planFile.startsWith('../') && !existsSync(resolve(t.planFile))) {
      console.warn(`[skip] ${t.fixtureId}: plan file not found at ${t.planFile}`);
      continue;
    }
    const r = captureReplay(t);
    manifest.entries.push({
      category: 'raw-replay',
      label: t.fixtureId,
      files: [rel(r.outFile), rel(r.traceFile)],
      command: r.command,
      note: t.note,
    });
  }
}

if (mode === 'enumerate' || mode === 'all') {
  console.log('\n========== Capturing enumerate-skip baselines ==========');
  for (const t of SKIP_TARGETS) {
    const r = captureSkip(t);
    manifest.entries.push({
      category: 'enumerate-skip',
      label: t.fixtureId,
      files: [rel(r.outDir)],
      command: r.command,
    });
  }
}

if (mode === 'adversarial' || mode === 'all') {
  console.log('\n========== Capturing adversarial baseline ==========');
  const r = captureAdversarial();
  manifest.entries.push({
    category: 'adversarial',
    label: 'alexandrite-handtraps',
    files: [rel(r.outFile)],
    command: r.command,
  });
}

const manifestPath = join(OUT_DIR, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`\n[done] manifest written to ${manifestPath}`);
console.log(`  pinned commit: ${sha}`);
if (dirty) console.warn('  WARNING: working tree was dirty during capture (see manifest.workingTreeDirty)');
console.log(`  ${manifest.entries.length} baseline entries captured`);
