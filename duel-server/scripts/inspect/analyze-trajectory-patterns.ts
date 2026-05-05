// =============================================================================
// analyze-trajectory-patterns.ts — Stage 2b (Phase 3 auto-discovery validation).
//
// Cross-fixture pattern detection on a trajectory corpus dumped by
// `--dump-trajectories`. Three signals reported:
//
//   1. Verb n-gram frequencies (1-grams, 2-grams, 3-grams across all
//      trajectories, only on STRATEGIC decisions — pass and (no-verb) are
//      excluded by default to surface combat-decision grammar).
//   2. (state-condition, verb) co-occurrence — for selected discriminative
//      state features (e.g. `normal_summon_used`, `hand_combo_potential_engine`),
//      report what verb the solver picks when the feature is high vs low.
//   3. Step-position bias — early-game vs late-game verb distribution.
//
// Output: human-readable report on stdout + optional `--out=<path>` JSON
// dump for downstream consumption.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/analyze-trajectory-patterns.ts \
//     --dir=data/trajectories/phase-b-v2-mlpv3-sd7
//
//   # Include passes (default off — they're 50%+ of corpus and crowd out signal):
//   npx tsx scripts/analyze-trajectory-patterns.ts \
//     --dir=<dir> --include-pass
//
//   # JSON output for further analysis:
//   npx tsx scripts/analyze-trajectory-patterns.ts --dir=<dir> --out=patterns.json
// =============================================================================
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

interface TrajectoryStep {
  step: number;
  promptType: string;
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
  actionVerb: string | null;
  stateFeatures: Record<string, number>;
  actionFeatures: Record<string, number>;
}

interface TrajectoryDumpFile {
  fixtureId: string;
  trajectory: TrajectoryStep[];
}

interface FlatStep extends TrajectoryStep {
  fixtureId: string;
  fixtureSize: number;
}

function parseArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function loadCorpus(dir: string): FlatStep[] {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const all: FlatStep[] = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TrajectoryDumpFile;
    for (const s of j.trajectory) {
      all.push({ ...s, fixtureId: j.fixtureId, fixtureSize: j.trajectory.length });
    }
  }
  return all;
}

function verbOf(s: TrajectoryStep): string {
  return s.actionVerb ?? '(no-verb)';
}

function isStrategic(verb: string): boolean {
  return verb !== 'pass' && verb !== '(no-verb)';
}

function tabulateNGrams(
  steps: FlatStep[],
  n: number,
  filter: (verb: string) => boolean,
): Map<string, number> {
  // Build n-grams within each fixture's sequence (no cross-fixture wrap).
  const counts = new Map<string, number>();
  let i = 0;
  while (i < steps.length) {
    // Extend window only within the same fixture
    const fixId = steps[i].fixtureId;
    const seq: string[] = [];
    let j = i;
    while (j < steps.length && steps[j].fixtureId === fixId) {
      const v = verbOf(steps[j]);
      if (filter(v)) seq.push(v);
      j++;
    }
    for (let k = 0; k + n <= seq.length; k++) {
      const key = seq.slice(k, k + n).join(' → ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    i = j;
  }
  return counts;
}

function topByCount(counts: Map<string, number>, top: number): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

interface FeatureBucketResult {
  feature: string;
  threshold: number;
  highVerbDist: Record<string, number>;
  lowVerbDist: Record<string, number>;
  highStepCount: number;
  lowStepCount: number;
}

function bucketByFeature(
  steps: FlatStep[],
  feature: string,
  threshold: number,
  filter: (verb: string) => boolean,
): FeatureBucketResult {
  const high: Record<string, number> = {};
  const low: Record<string, number> = {};
  let highCount = 0;
  let lowCount = 0;
  for (const s of steps) {
    const v = verbOf(s);
    if (!filter(v)) continue;
    const fv = s.stateFeatures[feature];
    if (fv === undefined) continue;
    if (fv >= threshold) {
      high[v] = (high[v] ?? 0) + 1;
      highCount++;
    } else {
      low[v] = (low[v] ?? 0) + 1;
      lowCount++;
    }
  }
  return {
    feature,
    threshold,
    highVerbDist: high,
    lowVerbDist: low,
    highStepCount: highCount,
    lowStepCount: lowCount,
  };
}

function bucketByStepPosition(
  steps: FlatStep[],
  filter: (verb: string) => boolean,
): { earlyVerbs: Record<string, number>; lateVerbs: Record<string, number>; earlyCount: number; lateCount: number } {
  // "Early" = first 1/3 of fixture's trajectory, "Late" = last 1/3.
  const early: Record<string, number> = {};
  const late: Record<string, number> = {};
  let earlyCount = 0;
  let lateCount = 0;
  for (const s of steps) {
    const v = verbOf(s);
    if (!filter(v)) continue;
    const pos = s.step / Math.max(1, s.fixtureSize - 1); // 0..1
    if (pos <= 1 / 3) {
      early[v] = (early[v] ?? 0) + 1;
      earlyCount++;
    } else if (pos >= 2 / 3) {
      late[v] = (late[v] ?? 0) + 1;
      lateCount++;
    }
  }
  return { earlyVerbs: early, lateVerbs: late, earlyCount, lateCount };
}

function fmtPct(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

function fmtVerbDist(dist: Record<string, number>, total: number): string {
  return Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v} (${fmtPct(v, total)})`)
    .join(', ');
}

function main(): void {
  const dir = parseArg('dir');
  const outPath = parseArg('out');
  const includePass = process.argv.includes('--include-pass');
  if (!dir) {
    console.error('Usage: --dir=<corpus-dir> [--include-pass] [--out=<json>]');
    process.exit(2);
  }

  const filter: (v: string) => boolean = includePass
    ? () => true
    : isStrategic;

  const corpus = loadCorpus(dir);
  console.log(`Corpus: ${dir}`);
  console.log(`Fixtures: ${new Set(corpus.map(s => s.fixtureId)).size}`);
  console.log(`Total steps: ${corpus.length}`);
  console.log(`Strategic steps (excl pass + no-verb): ${corpus.filter(s => isStrategic(verbOf(s))).length}`);
  console.log('═'.repeat(78));

  // 1-gram, 2-gram, 3-gram verb sequences
  const ngrams: Record<number, [string, number][]> = {};
  for (const n of [1, 2, 3]) {
    const counts = tabulateNGrams(corpus, n, filter);
    const top = topByCount(counts, 15);
    ngrams[n] = top;
    console.log(`\nTop ${n}-gram verb sequences (across fixtures, ${includePass ? 'including pass' : 'strategic only'}):`);
    for (const [seq, cnt] of top) {
      console.log(`  ${String(cnt).padStart(3)}  ${seq}`);
    }
  }

  // Feature-conditioned verb distributions
  const conditioned: FeatureBucketResult[] = [];
  console.log('\n═'.repeat(40));
  console.log('Feature-conditioned verb distributions:');
  console.log('═'.repeat(40));
  for (const { feature, threshold } of [
    { feature: 'normal_summon_used', threshold: 0.5 },
    { feature: 'hand_combo_potential_engine', threshold: 0.4 },
    { feature: 'special_summons_this_turn_norm', threshold: 0.25 },
    { feature: 'effects_activated_this_turn_norm', threshold: 0.25 },
    { feature: 'turn_norm', threshold: 0.5 },
    { feature: 'monsters_self_count', threshold: 0.4 },
  ]) {
    const r = bucketByFeature(corpus, feature, threshold, filter);
    conditioned.push(r);
    console.log(`\n${feature} (threshold=${threshold}):`);
    console.log(`  HIGH (n=${r.highStepCount}): ${fmtVerbDist(r.highVerbDist, r.highStepCount)}`);
    console.log(`  LOW  (n=${r.lowStepCount}): ${fmtVerbDist(r.lowVerbDist, r.lowStepCount)}`);
  }

  // Step-position bias (early vs late game)
  const positionBias = bucketByStepPosition(corpus, filter);
  console.log('\n═'.repeat(40));
  console.log('Step-position bias (early third vs late third of trajectory):');
  console.log('═'.repeat(40));
  console.log(`  EARLY (n=${positionBias.earlyCount}): ${fmtVerbDist(positionBias.earlyVerbs, positionBias.earlyCount)}`);
  console.log(`  LATE  (n=${positionBias.lateCount}): ${fmtVerbDist(positionBias.lateVerbs, positionBias.lateCount)}`);

  if (outPath) {
    const dump = {
      schemaVersion: 1,
      corpusDir: dir,
      includePass,
      stats: {
        fixtureCount: new Set(corpus.map(s => s.fixtureId)).size,
        totalSteps: corpus.length,
        strategicSteps: corpus.filter(s => isStrategic(verbOf(s))).length,
      },
      ngrams,
      conditioned,
      positionBias,
    };
    const abs = resolve(outPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(dump, null, 2) + '\n', 'utf-8');
    console.log(`\nWrote ${abs}`);
  }
}

main();
