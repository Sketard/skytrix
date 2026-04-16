// =============================================================================
// evaluate-structural.ts — batch evaluation harness for step 1 regression gate.
//
// Runs DFS over every non-draft fixture in solver-validation-decks.json,
// collects per-fixture functional metrics (score, matched, peak field) +
// diagnostic metrics (nodes, actionsZero%, turn2%, walltime), writes a JSON
// baseline or compares against an existing one and reports regressions.
//
// Read-only: no production code changes. Reuses the adapter / scorer / DFS
// exactly as the solver-worker wires them.
//
// Usage:
//   cd duel-server
//   SOLVER_INSTRUMENT=1 npx tsx scripts/evaluate-structural.ts \
//     --out=../_bmad-output/planning-artifacts/research/baselines/pre-step1-baseline.json
//
//   SOLVER_INSTRUMENT=1 npx tsx scripts/evaluate-structural.ts \
//     --compare=../_bmad-output/planning-artifacts/research/baselines/pre-step1-baseline.json
//
// Deterministic regression gate (pre-S2 infra): --node-budget=N swaps the
// Phase L per-root-child wall-clock guard for a node-count guard, removing
// CPU-throughput sensitivity across runs. Pair with a large --budget-ms to
// prevent the global time budget from kicking in before the node-budget does:
//   SOLVER_INSTRUMENT=1 npx tsx scripts/evaluate-structural.ts \
//     --node-budget=400 --budget-ms=3600000 \
//     --compare=../_bmad-output/planning-artifacts/research/baselines/<baseline>.json
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
import type { DuelConfig, SolverConfig } from '../src/solver/solver-types.js';

interface HandFixture {
  id: string;
  deck: string;
  description?: string;
  hand: number[];
  deckSeed: string;
  expectedBoard?: { zone: string; cardId: number; cardName: string }[];
  preferredIntermediates?: number[];
  maxDepth?: number;
  _draft?: boolean;
}

interface FixtureFile {
  decks: Record<string, { main: number[]; extra: number[]; side?: number[]; _draft?: boolean }>;
  hands: HandFixture[];
}

interface FixtureResult {
  score: number;
  matched: number;
  matchedTotal: number;
  matchedCardIds: number[];
  missingCardIds: number[];
  terminationReason: string;
  nodesExplored: number;
  maxDepthReached: number;
  actionsZeroPct: number;
  turn2Pct: number;
  wallMs: number;
}

interface BaselineFile {
  _meta: {
    timestamp: string;
    budgetMs: number;
    scorerVersion: string;
    gitHead?: string;
    /** Pre-S2 infra — present when the run used deterministic node-budget
     *  mode instead of the default wall-clock Phase L guard. Recorded for
     *  baseline traceability; `compareBaselines` does not key off it. */
    rootChildBudgetNodes?: number;
  };
  fixtures: Record<string, FixtureResult>;
  aggregate: {
    cumulativeMatched: number;
    cumulativeMatchedTotal: number;
    cumulativeScore: number;
    fixtureCount: number;
  };
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function parseNumArg(name: string): number | undefined {
  const v = parseStringArg(name);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const FIELD_ZONES = new Set([
  'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
  'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD',
]);

async function runFixture(
  adapter: OCGCoreAdapter,
  scorer: InterruptionScorer,
  ranker: GoldfishChainRanker,
  fixture: FixtureFile,
  hand: HandFixture,
  allConfigs: ReturnType<typeof loadAllSolverConfigs>,
  timeLimitMs: number,
  rootChildBudgetNodes: number | undefined,
): Promise<FixtureResult> {
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`Deck '${hand.deck}' not found`);

  const mainDeck = [...deck.main];
  for (const cid of hand.hand) {
    const idx = mainDeck.indexOf(cid);
    if (idx === -1) throw new Error(`Hand card ${cid} not in ${hand.deck}`);
    mainDeck.splice(idx, 1);
  }

  const preferredSearchTargets = [
    ...(hand.expectedBoard ?? []).map(e => e.cardId),
    ...(hand.preferredIntermediates ?? []),
  ];

  const duelConfig: DuelConfig = {
    mainDeck,
    extraDeck: deck.extra,
    hand: hand.hand,
    deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
    opponentDeck: [],
    startingDrawCount: 0,
    drawCountPerTurn: 1,
    preferredSearchTargets,
  };

  const maxDepth = hand.maxDepth ?? allConfigs.solverConfig.maxDepth;
  const perFixtureConfig = {
    ...allConfigs.solverConfig,
    maxDepth,
    maxResultNodes: Math.max(allConfigs.solverConfig.maxResultNodes, maxDepth * 20),
  };
  const hasher = new ZobristHasher();
  const table = new TranspositionTable(perFixtureConfig.transpositionMaxEntries);
  const dfs = new DfsSolver(hasher, table, scorer, adapter, ranker, perFixtureConfig);
  const startHandle = adapter.createDuel(duelConfig);
  const signal = AbortSignal.timeout(timeLimitMs + 5000);
  const solverConfig: SolverConfig = {
    mode: 'goldfish',
    speed: 'optimal',
    timeLimitMs,
    rootChildBudgetNodes,
  };

  const t0 = Date.now();
  const result = dfs.solve(adapter, solverConfig, signal, () => {}, startHandle);
  const wallMs = Date.now() - t0;

  const peakFs = result.stats.diagnostic?.bestTurn1FieldState as undefined | {
    zones: Record<string, { cardId: number; cardName?: string }[]>;
  };
  const presentOnField = new Set<number>();
  if (peakFs) {
    for (const [zoneName, zs] of Object.entries(peakFs.zones)) {
      if (!FIELD_ZONES.has(zoneName)) continue;
      for (const c of zs) presentOnField.add(c.cardId);
    }
  }
  const expected = hand.expectedBoard ?? [];
  const matchedCardIds: number[] = [];
  const missingCardIds: number[] = [];
  for (const e of expected) {
    if (presentOnField.has(e.cardId)) matchedCardIds.push(e.cardId);
    else missingCardIds.push(e.cardId);
  }

  const diag = result.stats.diagnostic;
  const totalTerminals = diag
    ? Object.values(diag.terminalReasons).reduce((a, b) => a + b, 0)
    : 0;
  const actionsZeroCount = diag?.terminalReasons['actionsZero'] ?? 0;
  const turn2Count = diag?.terminalReasons['turn2'] ?? 0;
  const actionsZeroPct = totalTerminals > 0 ? (actionsZeroCount / totalTerminals) * 100 : 0;
  const turn2Pct = totalTerminals > 0 ? (turn2Count / totalTerminals) * 100 : 0;

  return {
    score: result.score,
    matched: matchedCardIds.length,
    matchedTotal: expected.length,
    matchedCardIds,
    missingCardIds,
    terminationReason: result.stats.terminationReason,
    nodesExplored: result.stats.nodesExplored,
    maxDepthReached: result.stats.maxDepthReached,
    actionsZeroPct: Number(actionsZeroPct.toFixed(1)),
    turn2Pct: Number(turn2Pct.toFixed(1)),
    wallMs,
  };
}

function compareBaselines(prev: BaselineFile, curr: BaselineFile): { regressions: string[]; improvements: string[]; stable: string[] } {
  const regressions: string[] = [];
  const improvements: string[] = [];
  const stable: string[] = [];
  const ids = new Set([...Object.keys(prev.fixtures), ...Object.keys(curr.fixtures)]);
  for (const id of ids) {
    const p = prev.fixtures[id];
    const c = curr.fixtures[id];
    if (!p) { improvements.push(`${id}: NEW fixture  matched=${c.matched}/${c.matchedTotal}  score=${c.score}`); continue; }
    if (!c) { regressions.push(`${id}: REMOVED`); continue; }
    const matchDelta = c.matched - p.matched;
    const scoreDelta = c.score - p.score;
    const line = `${id}: matched ${p.matched}→${c.matched} (Δ${matchDelta >= 0 ? '+' : ''}${matchDelta})  score ${p.score}→${c.score} (Δ${scoreDelta >= 0 ? '+' : ''}${scoreDelta})`;
    if (matchDelta < 0) regressions.push(line);
    else if (matchDelta > 0 || scoreDelta > 0) improvements.push(line);
    else stable.push(line);
  }
  return { regressions, improvements, stable };
}

async function main(): Promise<void> {
  const outPath = parseStringArg('out');
  const comparePath = parseStringArg('compare');
  const budgetOverride = parseNumArg('budget-ms');
  const nodeBudget = parseNumArg('node-budget');
  const fixtureFilter = parseStringArg('only');
  const scorerVersion = parseStringArg('label') ?? 'unspecified';

  const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
  const FIXTURE_PATH = resolve(
    import.meta.dirname!, '..', '..',
    '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
  );

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as FixtureFile;

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  const validHands = fixture.hands.filter(h => {
    if (h._draft === true) return false;
    if (fixtureFilter && h.id !== fixtureFilter) return false;
    return true;
  });

  // Scorer is shared across fixtures — build metadata as the union of every
  // valid fixture's cards. O(130 cards × 1 stmt.get) at startup only.
  const metadataCardIds: number[] = [];
  for (const h of validHands) {
    const deck = fixture.decks[h.deck];
    if (!deck) continue;
    metadataCardIds.push(...deck.main, ...deck.extra, ...h.hand);
  }
  const cardMetadata = buildCardMetadataMap(cardDB, metadataCardIds);

  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    cardMetadata,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );
  const ranker = new GoldfishChainRanker(allConfigs.interruptionTags);

  const timeLimitMs = budgetOverride ?? allConfigs.solverConfig.timeBudgetOptimalMs;

  const modeTag = nodeBudget !== undefined
    ? `node-budget=${nodeBudget}`
    : `phase-L=wall-clock`;
  console.log(`[evaluate] fixtures: ${validHands.length}  budget=${timeLimitMs}ms  ${modeTag}  label='${scorerVersion}'  metadataCards=${cardMetadata.size}`);

  const fixtureResults: Record<string, FixtureResult> = {};
  for (const hand of validHands) {
    console.log(`\n[evaluate] ─── ${hand.id} (${hand.deck})`);
    try {
      const res = await runFixture(adapter, scorer, ranker, fixture, hand, allConfigs, timeLimitMs, nodeBudget);
      fixtureResults[hand.id] = res;
      console.log(`  score=${res.score}  matched=${res.matched}/${res.matchedTotal}  ` +
        `nodes=${res.nodesExplored}  depth=${res.maxDepthReached}  ` +
        `az=${res.actionsZeroPct}%  t2=${res.turn2Pct}%  walk=${res.wallMs}ms  ` +
        `term=${res.terminationReason}`);
    } catch (err) {
      console.error(`  FAIL: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  adapter.destroyAll();

  const cumulativeMatched = Object.values(fixtureResults).reduce((a, r) => a + r.matched, 0);
  const cumulativeMatchedTotal = Object.values(fixtureResults).reduce((a, r) => a + r.matchedTotal, 0);
  const cumulativeScore = Object.values(fixtureResults).reduce((a, r) => a + r.score, 0);

  const baseline: BaselineFile = {
    _meta: {
      timestamp: new Date().toISOString(),
      budgetMs: timeLimitMs,
      scorerVersion,
      ...(nodeBudget !== undefined ? { rootChildBudgetNodes: nodeBudget } : {}),
    },
    fixtures: fixtureResults,
    aggregate: {
      cumulativeMatched,
      cumulativeMatchedTotal,
      cumulativeScore,
      fixtureCount: Object.keys(fixtureResults).length,
    },
  };

  console.log(`\n[evaluate] ═══ AGGREGATE ═══`);
  console.log(`  cumulative matched: ${cumulativeMatched}/${cumulativeMatchedTotal}`);
  console.log(`  cumulative score:   ${cumulativeScore}`);
  console.log(`  fixtures:           ${Object.keys(fixtureResults).length}`);

  if (outPath) {
    const absOut = resolve(outPath);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
    console.log(`\n[evaluate] wrote ${absOut}`);
  }

  if (comparePath) {
    const prev = JSON.parse(readFileSync(resolve(comparePath), 'utf-8')) as BaselineFile;
    const { regressions, improvements, stable } = compareBaselines(prev, baseline);
    console.log(`\n[evaluate] ═══ COMPARISON vs ${comparePath} ═══`);
    console.log(`  prev label: '${prev._meta.scorerVersion}'  (${prev._meta.timestamp})`);
    console.log(`  curr label: '${baseline._meta.scorerVersion}'  (${baseline._meta.timestamp})`);
    console.log(`  cumulative matched: ${prev.aggregate.cumulativeMatched} → ${baseline.aggregate.cumulativeMatched}  (Δ${baseline.aggregate.cumulativeMatched - prev.aggregate.cumulativeMatched >= 0 ? '+' : ''}${baseline.aggregate.cumulativeMatched - prev.aggregate.cumulativeMatched})`);
    console.log(`  cumulative score:   ${prev.aggregate.cumulativeScore} → ${baseline.aggregate.cumulativeScore}  (Δ${baseline.aggregate.cumulativeScore - prev.aggregate.cumulativeScore >= 0 ? '+' : ''}${baseline.aggregate.cumulativeScore - prev.aggregate.cumulativeScore})`);
    if (improvements.length > 0) {
      console.log(`\n  IMPROVEMENTS (${improvements.length}):`);
      for (const l of improvements) console.log(`    ✓ ${l}`);
    }
    if (stable.length > 0) {
      console.log(`\n  STABLE (${stable.length}):`);
      for (const l of stable) console.log(`    = ${l}`);
    }
    if (regressions.length > 0) {
      console.log(`\n  REGRESSIONS (${regressions.length}):`);
      for (const l of regressions) console.log(`    ✗ ${l}`);
      console.log(`\n[evaluate] FAIL: ${regressions.length} regression(s) detected`);
      process.exit(1);
    } else {
      console.log(`\n[evaluate] PASS: no regressions`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[evaluate] FATAL:', err);
  process.exit(1);
});
