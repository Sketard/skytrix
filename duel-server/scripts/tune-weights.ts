// =============================================================================
// tune-weights.ts — step 3 grid-sweep orchestrator (Phase 3.0 C4).
//
// Reads a sweep spec, enumerates the Cartesian product of axis values into
// WeightsOverride candidates, evaluates each against a fixture subset, and
// appends per-candidate results to a JSONL corpus. Ranks by fitness (with
// tiebreak) and surfaces no-regression violations vs a reference baseline.
//
// Runs in-process: the EvaluationContext is built once (boot cost ~2-3s) and
// reused across every candidate via `applyWeightsOverride` + `resetWeightsTo
// Baseline` on the shared scorer. A sweep of N candidates × M fixtures runs
// in N × (M × per-fixture-solve-time), NOT in N × (boot + M × solve).
//
// Usage:
//   cd duel-server
//   SOLVER_INSTRUMENT=1 npx tsx scripts/tune-weights.ts \
//     --spec=../_bmad-output/planning-artifacts/research/sweep-specs/coarse-v1.json
//
// The spec fully determines fixture subset, node budget, budget-ms, axes,
// fitness, baseline reference, and output path — no other CLI args needed.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  setupEvaluationContext,
  runEvaluation,
  applyWeightsOverride,
  resetWeightsToBaseline,
  type EvaluationContext,
  type WeightsOverride,
} from './evaluate-structural.js';

// =============================================================================
// Spec + result types
// =============================================================================

/** `cumulativeExplorationScore` (Phase 3.0 C5) is the right target for tuning
 *  axes that affect latent/structural but not directly interruptionScore —
 *  the interruptionScore can stay bit-identical across a sweep while the
 *  latent component moves, which is the signal tuning needs. */
type Fitness = 'cumulativeMatched' | 'cumulativeScore' | 'cumulativeExplorationScore';

interface SweepSpec {
  /** Axis key = "structural.<field>" or "interruption.<type>". Values are
   *  enumerated; candidates = Cartesian product. */
  axes: Record<string, number[]>;
  /** Fixture subset; undefined = all non-draft. */
  fixtureFilter?: readonly string[];
  /** Deterministic Phase L guard. Recommended for sweeps. */
  nodeBudget?: number;
  /** Global per-fixture wall-clock cap. Keep large (>=3600000) when using
   *  node-budget so the wall-clock doesn't kick in first. */
  budgetMs: number;
  fitness: Fitness;
  tiebreak?: Fitness;
  /** Optional reference baseline for per-fixture no-regression check. */
  baselinePath?: string;
  noRegressionPerFixture?: boolean;
  /** JSONL path where each candidate result is appended. */
  outputPath: string;
  /** Number of top candidates to report after the sweep. Default 5. */
  topK?: number;
  /** Free-form label propagated into each candidate's run metadata. */
  label?: string;
}

interface BaselineLike {
  fixtures: Record<string, { matched: number; score: number; matchedTotal: number }>;
  aggregate: {
    cumulativeMatched: number;
    cumulativeMatchedTotal: number;
    cumulativeScore: number;
    cumulativeExplorationScore: number;
    fixtureCount: number;
  };
}

interface CandidateRecord {
  runId: string;
  timestamp: string;
  axisAssignment: Record<string, number>;
  override: WeightsOverride;
  wallMs: number;
  aggregate: BaselineLike['aggregate'];
  fixtures: BaselineLike['fixtures'];
  regressionFlags: string[];
  fitnessValue: number;
  tiebreakValue: number;
}

// =============================================================================
// CLI
// =============================================================================

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function loadSpec(specPath: string): SweepSpec {
  const raw = JSON.parse(readFileSync(resolve(specPath), 'utf-8')) as SweepSpec;
  if (!raw.axes || typeof raw.axes !== 'object' || Object.keys(raw.axes).length === 0) {
    throw new Error(`[tune] spec.axes must be a non-empty object`);
  }
  for (const [key, values] of Object.entries(raw.axes)) {
    if (!key.startsWith('structural.') && !key.startsWith('interruption.')) {
      throw new Error(`[tune] axis key '${key}' must start with 'structural.' or 'interruption.'`);
    }
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`[tune] axis '${key}' must have a non-empty values array`);
    }
    for (const v of values) {
      if (!Number.isFinite(v)) throw new Error(`[tune] axis '${key}' has non-number value ${String(v)}`);
    }
  }
  if (typeof raw.budgetMs !== 'number' || raw.budgetMs <= 0) {
    throw new Error(`[tune] spec.budgetMs must be a positive number`);
  }
  const validFitness: Fitness[] = ['cumulativeMatched', 'cumulativeScore', 'cumulativeExplorationScore'];
  if (!validFitness.includes(raw.fitness)) {
    throw new Error(`[tune] spec.fitness must be one of ${validFitness.join(', ')}`);
  }
  if (raw.tiebreak !== undefined && !validFitness.includes(raw.tiebreak)) {
    throw new Error(`[tune] spec.tiebreak must be one of ${validFitness.join(', ')}`);
  }
  if (!raw.outputPath || typeof raw.outputPath !== 'string') {
    throw new Error(`[tune] spec.outputPath is required`);
  }
  return raw;
}

// =============================================================================
// Candidate enumeration
// =============================================================================

/** Cartesian product of axis values. */
function enumerateAssignments(axes: Record<string, number[]>): Record<string, number>[] {
  const keys = Object.keys(axes);
  const out: Record<string, number>[] = [{}];
  for (const key of keys) {
    const next: Record<string, number>[] = [];
    for (const partial of out) {
      for (const v of axes[key]) {
        next.push({ ...partial, [key]: v });
      }
    }
    out.length = 0;
    out.push(...next);
  }
  return out;
}

function assignmentToOverride(assignment: Record<string, number>): WeightsOverride {
  const structural: Record<string, unknown> = {};
  const interruption: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(assignment)) {
    const dotIndex = key.indexOf('.');
    const scope = key.slice(0, dotIndex);
    const field = key.slice(dotIndex + 1);
    if (scope === 'structural') structural[field] = value;
    else if (scope === 'interruption') interruption[field] = value;
  }
  const out: WeightsOverride = {};
  if (Object.keys(structural).length > 0) out.structural = structural;
  if (Object.keys(interruption).length > 0) out.interruption = interruption;
  return out;
}

// =============================================================================
// Regression detection
// =============================================================================

function detectRegressions(
  baseline: BaselineLike,
  fixtures: BaselineLike['fixtures'],
): string[] {
  const flags: string[] = [];
  for (const [id, baseRes] of Object.entries(baseline.fixtures)) {
    const currRes = fixtures[id];
    if (!currRes) continue; // fixture filtered out of this sweep — not a regression
    if (currRes.matched < baseRes.matched) {
      flags.push(`${id}: matched ${baseRes.matched}→${currRes.matched}`);
    }
  }
  return flags;
}

// =============================================================================
// Per-candidate run
// =============================================================================

async function runCandidate(
  ctx: EvaluationContext,
  spec: SweepSpec,
  runId: string,
  assignment: Record<string, number>,
  baseline: BaselineLike | undefined,
): Promise<CandidateRecord> {
  resetWeightsToBaseline(ctx);
  const override = assignmentToOverride(assignment);
  applyWeightsOverride(ctx, override, runId);

  const t0 = Date.now();
  const result = await runEvaluation(ctx, {
    fixtureFilter: spec.fixtureFilter,
    timeLimitMs: spec.budgetMs,
    nodeBudget: spec.nodeBudget,
    label: spec.label ?? runId,
  });
  const wallMs = Date.now() - t0;

  const regressionFlags = baseline && spec.noRegressionPerFixture === true
    ? detectRegressions(baseline, result.fixtures)
    : [];

  const fitnessValue = result.aggregate[spec.fitness];
  const tiebreakValue = spec.tiebreak ? result.aggregate[spec.tiebreak] : 0;

  return {
    runId,
    timestamp: new Date().toISOString(),
    axisAssignment: assignment,
    override,
    wallMs,
    aggregate: result.aggregate,
    fixtures: result.fixtures,
    regressionFlags,
    fitnessValue,
    tiebreakValue,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const specPath = parseStringArg('spec');
  if (!specPath) {
    console.error('[tune] --spec=<path> required');
    process.exit(1);
  }

  const spec = loadSpec(specPath);
  const baseline = spec.baselinePath
    ? JSON.parse(readFileSync(resolve(spec.baselinePath), 'utf-8')) as BaselineLike
    : undefined;

  const assignments = enumerateAssignments(spec.axes);
  const outAbs = resolve(spec.outputPath);
  mkdirSync(dirname(outAbs), { recursive: true });
  // Fresh corpus file per sweep run — overwrite any prior partial.
  writeFileSync(outAbs, '', 'utf-8');

  console.log(`[tune] spec=${specPath}`);
  console.log(`[tune] candidates: ${assignments.length}  axes: ${Object.keys(spec.axes).join(', ')}`);
  console.log(`[tune] fitness=${spec.fitness}${spec.tiebreak ? ` tiebreak=${spec.tiebreak}` : ''}  noRegressionPerFixture=${spec.noRegressionPerFixture === true}`);
  console.log(`[tune] output=${outAbs}`);

  const ctx = await setupEvaluationContext();
  const records: CandidateRecord[] = [];
  try {
    // Fail-fast on fixture ID typos — a 10h sweep on an empty filter would
    // silently produce cumulativeMatched=0 and mislead downstream ranking.
    if (spec.fixtureFilter) {
      const validIds = new Set(ctx.fixture.hands.filter(h => h._draft !== true).map(h => h.id));
      const invalid = spec.fixtureFilter.filter(id => !validIds.has(id));
      if (invalid.length > 0) {
        throw new Error(`[tune] Unknown fixture ids in fixtureFilter: ${invalid.join(', ')}`);
      }
    }

    for (let i = 0; i < assignments.length; i++) {
      const runId = `candidate-${String(i).padStart(4, '0')}`;
      console.log(`\n[tune] ═══ ${runId}  (${i + 1}/${assignments.length})`);
      console.log(`  assignment: ${JSON.stringify(assignments[i])}`);
      try {
        const rec = await runCandidate(ctx, spec, runId, assignments[i], baseline);
        records.push(rec);
        appendFileSync(outAbs, JSON.stringify(rec) + '\n', 'utf-8');
        console.log(`  fitness=${rec.fitnessValue}${spec.tiebreak ? ` tiebreak=${rec.tiebreakValue}` : ''}  wallMs=${rec.wallMs}  regressions=${rec.regressionFlags.length}`);
      } catch (err) {
        console.error(`  FAIL: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    ctx.dispose();
  }

  // Rank
  const eligible = spec.noRegressionPerFixture === true
    ? records.filter(r => r.regressionFlags.length === 0)
    : records;
  eligible.sort((a, b) => {
    if (a.fitnessValue !== b.fitnessValue) return b.fitnessValue - a.fitnessValue;
    return b.tiebreakValue - a.tiebreakValue;
  });

  const topK = spec.topK ?? 5;
  console.log(`\n[tune] ═══ TOP ${Math.min(topK, eligible.length)} (of ${eligible.length} eligible / ${records.length} total) ═══`);
  for (let i = 0; i < Math.min(topK, eligible.length); i++) {
    const r = eligible[i];
    console.log(`  ${i + 1}. ${r.runId}  fitness=${r.fitnessValue}  tiebreak=${r.tiebreakValue}  ${JSON.stringify(r.axisAssignment)}`);
  }

  if (spec.noRegressionPerFixture === true) {
    const disqualified = records.filter(r => r.regressionFlags.length > 0);
    if (disqualified.length > 0) {
      console.log(`\n[tune] DISQUALIFIED by per-fixture regression: ${disqualified.length}`);
      for (const r of disqualified.slice(0, 10)) {
        console.log(`  ${r.runId}: ${r.regressionFlags.join('; ')}`);
      }
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[tune] FATAL:', err);
  process.exit(1);
});
