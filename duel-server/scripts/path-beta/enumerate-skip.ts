// =============================================================================
// enumerate-skip.ts — Mechanical brute-force enumeration of step-removal
// (skip-card / skip-step exploration).
//
// Levier R1 of Sprint 1 process refinement: counters the LLM "use-everything
// bias" — given a base plan with N steps, generate variants where each step
// (or pair of steps if --combo-depth=2) is REMOVED, replay each, rank by
// matched. Surfaces "which step is hurting the score" — i.e. which card
// activation should be skipped because its constraint locks downstream
// summons.
//
// Use case: branded-dracotail base plan plateaus at 7/8. The LLM critic
// confirmed Branded Fusion locks ED to Fusion-only, but never tested
// "what if I never activate Branded Fusion?" because LLMs treat every hand
// card as "must be used". This tool runs that experiment mechanically.
//
// Zero LLM tokens consumed. Pure mechanical replay × N (or N²) variants.
//
// Output of this tool reveals plans that improve on the base by skipping
// a step. The result feeds either a critic-LLM dispatch (with the skip
// hypothesis confirmed) OR is shipped directly as a new best plan.
//
// Usage:
//   npx tsx scripts/enumerate-skip.ts \
//     --fixture-id=branded-dracotail-opener \
//     --base-plan=path/to/base-plan.json \
//     --out-dir=data/path-beta-poc/<fixture>/enumerate-skip/
//     [--combo-depth=2]   # also try pair-skip combinations (default 1)
//     [--steps=2,5]       # restrict to specific steps (default: all)
//
// Args:
//   --fixture-id=<id>            Fixture from solver-validation-decks.json.
//   --base-plan=<path>           A β-1 plan JSON (the plateau plan).
//   --out-dir=<path>             Output directory (variants + aggregate).
//   [--combo-depth=<int>]        1 = single-skip (default), 2 = pair-skip.
//   [--steps=<csv>]              CSV of step indices to consider (default
//                                 = all steps in the plan).
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface PlanStep {
  cardName: string;
  verb?: string;
  targets?: unknown[];
  chainTargets?: unknown[];
}
interface PlanFile {
  plan: PlanStep[];
  endTurn?: boolean;
}

interface Args {
  fixtureId: string;
  basePlan: string;
  outDir: string;
  comboDepth: number;
  steps?: number[];
  /** When set (any truthy), each variant replay also produces a trajectory
   *  dump (state+action features per step, outcome at end) at
   *  `<out-dir>/variant-skip-<label>-trajectory.json`. The baseline replay
   *  also dumps to `<out-dir>/_baseline-trajectory.json`. Format matches the
   *  Stage 1 schema produced by `evaluate-structural --dump-trajectories`,
   *  so corpora can be merged for value-head training. */
  dumpTrajectories: boolean;
}

function parseArgs(): Args {
  const pick = (n: string): string | undefined => {
    const a = process.argv.find(x => x.startsWith(`--${n}=`));
    return a?.slice(n.length + 3);
  };
  const fixtureId = pick('fixture-id');
  const basePlan = pick('base-plan');
  const outDir = pick('out-dir');
  if (!fixtureId || !basePlan || !outDir) {
    console.error('Usage: --fixture-id=<id> --base-plan=<path> --out-dir=<path> [--combo-depth=<1|2>] [--steps=<csv>] [--dump-trajectories]');
    process.exit(2);
  }
  const stepsRaw = pick('steps');
  const steps = stepsRaw ? stepsRaw.split(',').map(s => Number(s.trim())) : undefined;
  const dumpTrajectories = process.argv.includes('--dump-trajectories');
  return {
    fixtureId,
    basePlan: resolve(basePlan),
    outDir: resolve(outDir),
    comboDepth: Number(pick('combo-depth') ?? '1'),
    steps,
    dumpTrajectories,
  };
}

function runReplay(
  planPath: string,
  fixtureId: string,
  resultPath: string,
  trajectoryPath?: string,
): boolean {
  // Skip-enumeration uses the default `end-phase` continue-mode. Unlike
  // enumerate-pivot (which truncates and needs aggressive cascade), skip
  // variants keep the rest of the base plan running and we want the natural
  // end-of-plan endboard — aggressive-continue would over-summon and
  // destroy the existing match (e.g. branded baseline 7/8 → 5/8 because
  // aggressive picks demolish the carefully-built fusion stack).
  const args = [
    'tsx', 'scripts/replay-trajectory-cli.ts',
    `--fixture-id=${fixtureId}`,
    `--plan-file=${planPath}`,
    `--out=${resultPath}`,
  ];
  if (trajectoryPath) args.push(`--dump-trajectory=${trajectoryPath}`);
  const r = spawnSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  if (r.status !== 0) {
    process.stderr.write(r.stderr?.toString() ?? '');
    return false;
  }
  return true;
}

function readResult(path: string): { matched: number | null; expectedBoardSize: number | null; score: number | null; stoppedReason: string; finalBoardSize: number | null } {
  if (!existsSync(path)) return { matched: null, expectedBoardSize: null, score: null, stoppedReason: 'no-result-file', finalBoardSize: null };
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      matched: j.matched ?? null,
      expectedBoardSize: j.expectedBoardSize ?? null,
      score: j.score ?? null,
      stoppedReason: j.stoppedReason ?? 'unknown',
      finalBoardSize: j.finalBoardSelf?.length ?? null,
    };
  } catch {
    return { matched: null, expectedBoardSize: null, score: null, stoppedReason: 'parse-error', finalBoardSize: null };
  }
}

function describeStep(s: PlanStep): string {
  const verbTag = s.verb ? ` (${s.verb})` : '';
  return `${s.cardName}${verbTag}`;
}

interface VariantResult {
  skippedStepIndices: number[];
  skippedSteps: string[];
  matched: number | null;
  expectedBoardSize: number | null;
  score: number | null;
  stoppedReason: string;
  finalBoardSize: number | null;
  matchedDelta: number | null;   // matched - baseline_matched
  scoreDelta: number | null;     // score - baseline_score
}

function main(): void {
  const args = parseArgs();
  mkdirSync(args.outDir, { recursive: true });

  const basePlan: PlanFile = JSON.parse(readFileSync(args.basePlan, 'utf-8'));
  if (!basePlan.plan || !Array.isArray(basePlan.plan)) {
    console.error('[enum-skip] base-plan does not contain a "plan" array');
    process.exit(1);
  }
  const N = basePlan.plan.length;
  const candidateSteps = args.steps ?? Array.from({ length: N }, (_, i) => i);
  for (const s of candidateSteps) {
    if (s < 0 || s >= N) {
      console.error(`[enum-skip] step ${s} out of range (plan has ${N} steps)`);
      process.exit(1);
    }
  }

  // Step 1 — baseline run (no skip).
  const baselineResultPath = join(args.outDir, '_baseline-result.json');
  const baselineTrajectoryPath = args.dumpTrajectories ? join(args.outDir, '_baseline-trajectory.json') : undefined;
  console.log('[enum-skip] running baseline (no skip)...');
  if (!runReplay(args.basePlan, args.fixtureId, baselineResultPath, baselineTrajectoryPath)) {
    console.error('[enum-skip] baseline replay failed');
    process.exit(1);
  }
  const baseline = readResult(baselineResultPath);
  console.log(`[enum-skip] baseline: matched=${baseline.matched}/${baseline.expectedBoardSize} score=${baseline.score} stopped=${baseline.stoppedReason}`);

  // Step 2 — generate skip variants.
  const skipCombos: number[][] = [];
  if (args.comboDepth >= 1) {
    for (const i of candidateSteps) skipCombos.push([i]);
  }
  if (args.comboDepth >= 2) {
    for (let i = 0; i < candidateSteps.length; i++) {
      for (let j = i + 1; j < candidateSteps.length; j++) {
        skipCombos.push([candidateSteps[i], candidateSteps[j]].sort((a, b) => a - b));
      }
    }
  }
  console.log(`[enum-skip] generating ${skipCombos.length} skip variants (combo-depth=${args.comboDepth})`);

  const variants: VariantResult[] = [];
  let i = 0;
  for (const combo of skipCombos) {
    i++;
    const skipSet = new Set(combo);
    const variantPlan: PlanFile = {
      plan: basePlan.plan.filter((_, idx) => !skipSet.has(idx)),
      endTurn: basePlan.endTurn !== false,
    };
    const skipLabel = combo.map(s => `step${s}`).join('+');
    const variantPath = join(args.outDir, `variant-skip-${skipLabel}.json`);
    const variantResultPath = join(args.outDir, `variant-skip-${skipLabel}-result.json`);
    const variantTrajectoryPath = args.dumpTrajectories
      ? join(args.outDir, `variant-skip-${skipLabel}-trajectory.json`)
      : undefined;
    writeFileSync(variantPath, JSON.stringify(variantPlan, null, 2));
    runReplay(variantPath, args.fixtureId, variantResultPath, variantTrajectoryPath);
    const r = readResult(variantResultPath);
    const skippedSteps = combo.map(s => describeStep(basePlan.plan[s]));
    const matchedDelta = r.matched !== null && baseline.matched !== null ? r.matched - baseline.matched : null;
    const scoreDelta = r.score !== null && baseline.score !== null ? r.score - baseline.score : null;
    const entry: VariantResult = {
      skippedStepIndices: combo,
      skippedSteps,
      matched: r.matched,
      expectedBoardSize: r.expectedBoardSize,
      score: r.score,
      stoppedReason: r.stoppedReason,
      finalBoardSize: r.finalBoardSize,
      matchedDelta,
      scoreDelta,
    };
    variants.push(entry);
    const matchedStr = r.matched !== null ? `${r.matched}/${r.expectedBoardSize}` : '-/-';
    const deltaTag = matchedDelta !== null && matchedDelta > 0 ? ` (+${matchedDelta} 🎯)` : matchedDelta !== null && matchedDelta < 0 ? ` (${matchedDelta})` : '';
    const skipDesc = skippedSteps.join(' + ');
    console.log(`[enum-skip] [${i}/${skipCombos.length}] skip ${skipLabel.padEnd(15)} (${skipDesc.slice(0, 50).padEnd(50)}) matched=${matchedStr.padEnd(5)} score=${r.score ?? '-'}${deltaTag}`);
  }

  // Step 3 — sort + write aggregate.
  variants.sort((a, b) => (b.matched ?? -1) - (a.matched ?? -1) || (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const improved = variants.filter(v => (v.matchedDelta ?? 0) > 0);
  const tied = variants.filter(v => v.matchedDelta === 0);
  const aggregate = {
    fixtureId: args.fixtureId,
    basePlan: args.basePlan,
    comboDepth: args.comboDepth,
    candidateSteps,
    baseline,
    variantsCount: variants.length,
    improvedCount: improved.length,
    tiedCount: tied.length,
    variants,
  };
  const aggregatePath = join(args.outDir, 'aggregate.json');
  writeFileSync(aggregatePath, JSON.stringify(aggregate, null, 2));
  console.log(`\n[enum-skip] wrote ${aggregatePath}`);
  console.log(`[enum-skip] baseline matched=${baseline.matched}/${baseline.expectedBoardSize} score=${baseline.score}`);
  console.log(`[enum-skip] ${improved.length} variants IMPROVED on baseline (matchedDelta > 0)`);
  if (improved.length > 0) {
    console.log('[enum-skip] top improvements:');
    improved.slice(0, 5).forEach((v, idx) => {
      const desc = v.skippedSteps.join(' + ');
      console.log(`  ${idx + 1}. skip ${v.skippedStepIndices.join(',')} (${desc}) matched=${v.matched}/${v.expectedBoardSize} (Δ+${v.matchedDelta}) score=${v.score} (Δ${v.scoreDelta && v.scoreDelta >= 0 ? '+' : ''}${v.scoreDelta})`);
    });
  } else {
    console.log('[enum-skip] no skip variant improved baseline matched count.');
  }
}

main();
