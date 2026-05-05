// =============================================================================
// enumerate-pivot.ts — Mechanical brute-force enumeration of SELECT_CARD picks.
//
// Levier 1 of Sprint 1 (Path β industrialization): when an LLM-authored plan
// plateaus because step K's SELECT_CARD pick is suboptimal (e.g. Gate→Lance
// instead of Gate→Doom Queen on D/D/D), this tool replaces LLM intuition with
// empirical enumeration. It generates one variant plan per legal candidate at
// the pivot prompt, replays each, and ranks them by matched/score.
//
// Zero LLM tokens consumed. Pure mechanical replay × N candidates.
//
// Output of this tool feeds a critic-LLM dispatch that re-authors the plan
// with the empirical best pivot fixed at step K.
//
// Usage:
//   npx tsx scripts/enumerate-pivot.ts \
//     --fixture-id=ddd-pendulum-opener \
//     --base-plan=path/to/base-plan.json \
//     --vary-plan-step=4 \
//     --out-dir=data/path-beta-poc/<fixture>/enumerate-pivot/
//
// Args:
//   --fixture-id=<id>            Fixture from solver-validation-decks.json.
//   --base-plan=<path>           A β-1 plan JSON. Must have at least one
//                                 plan[V].targets entry (the one we override).
//   --vary-plan-step=<int>       Plan step index V whose first SELECT_CARD
//                                 prompt's targets[0] we will enumerate.
//   --out-dir=<path>             Output directory (variants + aggregate).
//   [--auto-finish]              Default true: truncate plan after V and let
//                                 endTurn auto-finish. Set --no-auto-finish
//                                 to keep the rest of the base plan as-is
//                                 (most variants will diverge mid-replay).
//   [--max-candidates=<int>]     Cap on enumerated candidates (default ∞).
//
// Output:
//   <out-dir>/_discovery-corpus.jsonl    Corpus dump from the base run.
//   <out-dir>/_discovery-result.json     Replay result of base plan.
//   <out-dir>/variant-<cardId>.json      Variant plan for each candidate.
//   <out-dir>/variant-<cardId>-result.json    Replay result for each variant.
//   <out-dir>/aggregate.json             Summary table: per-candidate
//                                         (matched, score, stoppedReason,
//                                         finalBoardSize), sorted desc.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface Args {
  fixtureId: string;
  basePlan: string;
  varyPlanStep: number;
  outDir: string;
  autoFinish: boolean;
  maxCandidates: number;
}

function parseArgs(): Args {
  const pick = (n: string): string | undefined => {
    const a = process.argv.find(x => x.startsWith(`--${n}=`));
    return a?.slice(n.length + 3);
  };
  const has = (n: string): boolean => process.argv.includes(`--${n}`);
  const fixtureId = pick('fixture-id');
  const basePlan = pick('base-plan');
  const varyPlanStepRaw = pick('vary-plan-step');
  const outDir = pick('out-dir');
  if (!fixtureId || !basePlan || varyPlanStepRaw === undefined || !outDir) {
    console.error('Usage: --fixture-id=<id> --base-plan=<path> --vary-plan-step=<int> --out-dir=<path> [--no-auto-finish] [--max-candidates=<int>]');
    process.exit(2);
  }
  return {
    fixtureId,
    basePlan: resolve(basePlan),
    varyPlanStep: Number(varyPlanStepRaw),
    outDir: resolve(outDir),
    autoFinish: !has('no-auto-finish'),
    maxCandidates: Number(pick('max-candidates') ?? '999'),
  };
}

interface PlanStep {
  cardName: string;
  verb?: string;
  targets?: Array<{ cardName?: string; cardNames?: string[]; responseIndex?: number; promptHint?: string }>;
  chainTargets?: unknown[];
}
interface PlanFile {
  plan: PlanStep[];
  endTurn?: boolean;
}

interface CorpusRow {
  fixtureId: string;
  stepIndex: number;
  planStepIndex: number | null;
  ownerPlanStepIndex: number | null;
  pickSource: string;
  promptType: string;
  candidates: Array<{ cardId: number; cardName: string; responseIndex: number }>;
  pickedIndex: number;
  pickedCardId: number;
}

function runReplay(planPath: string, fixtureId: string, resultPath: string, opts: { corpusPath?: string; aggressive?: boolean } = {}): boolean {
  const cliArgs = [
    'tsx', 'scripts/replay-trajectory-cli.ts',
    `--fixture-id=${fixtureId}`,
    `--plan-file=${planPath}`,
    `--out=${resultPath}`,
  ];
  if (opts.corpusPath) cliArgs.push(`--dump-corpus=${opts.corpusPath}`);
  if (opts.aggressive) cliArgs.push('--continue-mode=aggressive');
  const r = spawnSync('npx', cliArgs, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  if (r.status !== 0) {
    process.stderr.write(r.stderr?.toString() ?? '');
    return false;
  }
  return true;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function main(): void {
  const args = parseArgs();
  mkdirSync(args.outDir, { recursive: true });

  // 1. Load base plan; sanity-check that the vary-plan-step has a target to override.
  const basePlan: PlanFile = JSON.parse(readFileSync(args.basePlan, 'utf-8'));
  if (!basePlan.plan || !Array.isArray(basePlan.plan)) {
    console.error('[enum-pivot] base-plan does not contain a "plan" array');
    process.exit(1);
  }
  const varyStep = basePlan.plan[args.varyPlanStep];
  if (!varyStep) {
    console.error(`[enum-pivot] vary-plan-step=${args.varyPlanStep} out of range (plan has ${basePlan.plan.length} steps)`);
    process.exit(1);
  }
  if (!varyStep.targets || varyStep.targets.length === 0) {
    console.error(`[enum-pivot] plan[${args.varyPlanStep}] (${varyStep.cardName}) has no targets[] — nothing to vary`);
    process.exit(1);
  }
  console.log(`[enum-pivot] base plan: plan[${args.varyPlanStep}] = ${varyStep.cardName} (${varyStep.verb}); targets[0]=${JSON.stringify(varyStep.targets[0])}`);

  // 2. Run base plan with corpus dump to discover candidates at the pivot prompt.
  const discoveryCorpus = join(args.outDir, '_discovery-corpus.jsonl');
  const discoveryResult = join(args.outDir, '_discovery-result.json');
  console.log('[enum-pivot] running base plan (discovery pass)...');
  if (!runReplay(args.basePlan, args.fixtureId, discoveryResult, { corpusPath: discoveryCorpus })) {
    console.error('[enum-pivot] discovery replay failed');
    process.exit(1);
  }

  // 3. Parse corpus, find the FIRST SELECT_CARD row owned by varyPlanStep.
  const corpusLines = readFileSync(discoveryCorpus, 'utf-8').split('\n').filter(Boolean);
  const corpusRows: CorpusRow[] = corpusLines.map(l => JSON.parse(l));
  const pivotRow = corpusRows.find(r =>
    r.ownerPlanStepIndex === args.varyPlanStep && r.promptType === 'SELECT_CARD'
  );
  if (!pivotRow) {
    console.error(`[enum-pivot] no SELECT_CARD row owned by plan step ${args.varyPlanStep} in corpus.`);
    console.error(`[enum-pivot] (rows seen: ${corpusRows.map(r => `${r.promptType}/owner=${r.ownerPlanStepIndex}`).join(', ')})`);
    process.exit(1);
  }
  console.log(`[enum-pivot] pivot row: stepIndex=${pivotRow.stepIndex}, ${pivotRow.candidates.length} candidates, originally picked cardId=${pivotRow.pickedCardId}`);

  // 4. Dedupe candidates by cardId (multiple deck copies share cardId, different responseIndex).
  const seen = new Set<number>();
  const uniqueCands: Array<{ cardId: number; cardName: string; responseIndex: number }> = [];
  for (const c of pivotRow.candidates) {
    if (!seen.has(c.cardId)) {
      seen.add(c.cardId);
      uniqueCands.push(c);
    }
  }
  if (uniqueCands.length > args.maxCandidates) uniqueCands.length = args.maxCandidates;
  console.log(`[enum-pivot] enumerating ${uniqueCands.length} unique candidates (${pivotRow.candidates.length} raw)`);

  // 5. For each unique candidate, generate a variant plan and replay it.
  const variants: Array<{
    cardId: number;
    cardName: string;
    responseIndex: number;
    matched: number | null;
    expectedBoardSize: number | null;
    score: number | null;
    stoppedReason: string;
    stoppedAtPlanStep: number | null;
    finalBoardSize: number | null;
    isOriginal: boolean;
  }> = [];

  for (const cand of uniqueCands) {
    const variantPlan: PlanFile = JSON.parse(JSON.stringify(basePlan));
    // Override targets[0] of the vary-plan-step with this candidate's responseIndex
    // (responseIndex is more precise than cardName when duplicates exist).
    variantPlan.plan[args.varyPlanStep].targets![0] = {
      responseIndex: cand.responseIndex,
      cardName: cand.cardName,
      promptHint: `enum-pivot variant cardId=${cand.cardId}`,
    };
    if (args.autoFinish) {
      // Truncate plan to the pivot step + auto-finish via endTurn=true.
      variantPlan.plan = variantPlan.plan.slice(0, args.varyPlanStep + 1);
      variantPlan.endTurn = true;
    }
    const variantPath = join(args.outDir, `variant-${cand.cardId}-${slugify(cand.cardName)}.json`);
    const variantResultPath = join(args.outDir, `variant-${cand.cardId}-result.json`);
    writeFileSync(variantPath, JSON.stringify(variantPlan, null, 2));

    const ok = runReplay(variantPath, args.fixtureId, variantResultPath, { aggressive: args.autoFinish });
    let res: any = null;
    if (ok && existsSync(variantResultPath)) {
      try { res = JSON.parse(readFileSync(variantResultPath, 'utf-8')); } catch { /* ignore */ }
    }
    const entry = {
      cardId: cand.cardId,
      cardName: cand.cardName,
      responseIndex: cand.responseIndex,
      matched: res?.matched ?? null,
      expectedBoardSize: res?.expectedBoardSize ?? null,
      score: res?.score ?? null,
      stoppedReason: res?.stoppedReason ?? 'spawn-failed',
      stoppedAtPlanStep: res?.stoppedAtPlanStep ?? null,
      finalBoardSize: res?.finalBoardSelf?.length ?? null,
      isOriginal: cand.cardId === pivotRow.pickedCardId,
    };
    variants.push(entry);
    const matchedStr = entry.matched !== null ? `${entry.matched}/${entry.expectedBoardSize}` : '-/-';
    const orig = entry.isOriginal ? ' [ORIGINAL]' : '';
    console.log(`[enum-pivot]   ${cand.cardName.padEnd(40)} matched=${matchedStr.padEnd(5)} score=${String(entry.score ?? '-').padEnd(5)} stopped=${entry.stoppedReason}${orig}`);
  }

  // 6. Rank and write aggregate report.
  variants.sort((a, b) => (b.matched ?? -1) - (a.matched ?? -1) || (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const aggregate = {
    fixtureId: args.fixtureId,
    basePlan: args.basePlan,
    varyPlanStep: args.varyPlanStep,
    autoFinish: args.autoFinish,
    pivotPromptType: pivotRow.promptType,
    pivotCandidatesEnumerated: uniqueCands.length,
    pivotRawCandidatesCount: pivotRow.candidates.length,
    originalPickedCardId: pivotRow.pickedCardId,
    variants,
  };
  const aggregatePath = join(args.outDir, 'aggregate.json');
  writeFileSync(aggregatePath, JSON.stringify(aggregate, null, 2));
  console.log(`\n[enum-pivot] wrote ${aggregatePath}`);
  console.log('[enum-pivot] top 5 by matched (then score):');
  variants.slice(0, 5).forEach((v, i) => {
    const matchedStr = v.matched !== null ? `${v.matched}/${v.expectedBoardSize}` : '-/-';
    console.log(`  ${i + 1}. ${v.cardName.padEnd(40)} matched=${matchedStr.padEnd(5)} score=${v.score ?? '-'} stopped=${v.stoppedReason}${v.isOriginal ? ' [ORIGINAL]' : ''}`);
  });
}

main();
