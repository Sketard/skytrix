// =============================================================================
// spike-empirical-validation.ts — Empirical validation spike (2026-04-13)
//
// Purpose: answer the gating question "are the 3 top blockers in
// solver-structural-constraints.md (1.3 fork cost, 2.1 move ordering,
// 2.3 latent modeling / 2.2 scorer fidelity) the real dominants, or do we
// need to reframe?"
//
// Runs the 3 curated meta fixtures (D/D/D, Mitsurugi Ryzeal, Branded
// Dracotail) through the DFS solver in-process (skipping piscina so
// instrumentation counters are readable in the same process), with
// SOLVER_INSTRUMENT=1 timing for fork / applyAction / scoreWithCards, and
// dumps a structured JSON result next to the markdown synthesis.
//
// NOT a regression test. NOT a production harness. One-shot measurement.
//
// Usage:
//   SOLVER_INSTRUMENT=1 npx tsx scripts/spike-empirical-validation.ts
//   SOLVER_INSTRUMENT=1 npx tsx scripts/spike-empirical-validation.ts --speed=optimal
//   SOLVER_INSTRUMENT=1 npx tsx scripts/spike-empirical-validation.ts --hand=ddd-pendulum-opener
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import { snapshot as instrumentSnapshot, reset as instrumentReset, instrumentationEnabled } from '../src/solver/solver-instrumentation.js';
import type { DuelConfig, SolverConfig, SolverResult, InterruptionTag, EndBoardCard } from '../src/solver/solver-types.js';

// =============================================================================
// Types
// =============================================================================

interface ExpectedBoardEntry {
  zone: string;
  cardId: number;
  cardName: string;
}

interface HandFixture {
  id: string;
  deck: string;
  description: string;
  hand: number[];
  deckSeed: string;
  expectedBoard?: ExpectedBoardEntry[];
}

interface FixtureFile {
  decks: Record<string, { main: number[]; extra: number[]; side?: number[] }>;
  hands: HandFixture[];
}

interface DiffEntry {
  zone: string;
  cardId: number;
  cardName: string;
  tagged: boolean;
}

interface BoardSnapshot {
  zone: string;
  cardId: number;
  cardName: string;
  isFallback: boolean;
  consumedUses?: number;
}

interface FixtureResult {
  handId: string;
  deck: string;
  description: string;
  handCards: { cardId: number; cardName: string }[];
  speed: string;
  timeLimitMs: number;
  // Raw solver stats
  score: number;
  mainPathLength: number;
  nodesExplored: number;
  maxDepthReached: number;
  maxDepthConfig: number;
  averageBranchingFactor: number;
  maxBranchingFactor: number;
  terminationReason: string;
  truncated: boolean;
  elapsedMs: number;
  depthHistogram: number[];
  scoreBreakdown: Record<string, number>;
  transpositionHits: number;
  transpositionMisses: number;
  transpositionStores: number;
  // Instrumentation
  instrumentation: ReturnType<typeof instrumentSnapshot> | null;
  forkPctOfWall: number;
  applyPctOfWall: number;
  scorePctOfWall: number;
  // Baseline (pre-solve) measurements — captured at the first prompt
  // BEFORE any solver action, so the solver's "earned" value is measurable.
  baselineScore: number;
  baselineBreakdown: Record<string, number>;
  baselineBoard: BoardSnapshot[];
  baselineHandCards: { cardId: number; cardName: string }[];
  // Delta = what the solver added on top of the baseline
  deltaScore: number;
  deltaBreakdown: Record<string, number>;
  // Endboard diff (absolute — matched vs expected regardless of baseline)
  actualBoard: BoardSnapshot[];
  expectedBoard: ExpectedBoardEntry[];
  matched: ExpectedBoardEntry[];
  missing: DiffEntry[];
  extra: DiffEntry[];
  missingTaggedCount: number;
  missingUntaggedCount: number;
  // Expected-board decomposition by baseline presence
  expectedAtBaseline: ExpectedBoardEntry[]; // expected cards already present at baseline
  expectedEarned: ExpectedBoardEntry[];     // expected cards the solver added during solve
  expectedStillMissing: ExpectedBoardEntry[]; // expected cards never reached
  // Main path
  mainPathActions: { respIdx: number; cardId: number; cardName: string }[];
}

// =============================================================================
// CLI
// =============================================================================

interface CliOpts {
  handFilter?: string;
  speed: 'fast' | 'optimal';
  outPath: string;
}

function parseCli(argv: string[]): CliOpts {
  const opts: CliOpts = {
    speed: 'fast',
    outPath: resolve(
      import.meta.dirname!, '..', '..',
      '_bmad-output', 'planning-artifacts', 'research',
      'empirical-validation-2026-04-13-raw.json',
    ),
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--hand=')) opts.handFilter = arg.slice(7);
    else if (arg === '--speed=fast') opts.speed = 'fast';
    else if (arg === '--speed=optimal') opts.speed = 'optimal';
    else if (arg.startsWith('--out=')) opts.outPath = arg.slice(6);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx scripts/spike-empirical-validation.ts [--hand=ID] [--speed=fast|optimal] [--out=PATH]');
      process.exit(0);
    } else {
      console.error(`[Spike] Unknown arg: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

// =============================================================================
// Diff logic
// =============================================================================

function diffBoards(
  expected: ExpectedBoardEntry[],
  actual: EndBoardCard[],
  tags: Record<string, InterruptionTag>,
): { matched: ExpectedBoardEntry[]; missing: DiffEntry[]; extra: DiffEntry[] } {
  const key = (zone: string, cardId: number): string => `${zone}::${cardId}`;
  const expectedMap = new Map<string, ExpectedBoardEntry>();
  for (const e of expected) expectedMap.set(key(e.zone, e.cardId), e);

  const actualMap = new Map<string, EndBoardCard>();
  for (const a of actual) actualMap.set(key(a.zone, a.cardId), a);

  const matched: ExpectedBoardEntry[] = [];
  const missing: DiffEntry[] = [];
  const extra: DiffEntry[] = [];

  for (const [k, e] of expectedMap) {
    if (actualMap.has(k)) {
      matched.push(e);
    } else {
      missing.push({
        zone: e.zone,
        cardId: e.cardId,
        cardName: e.cardName,
        tagged: tags[String(e.cardId)] !== undefined,
      });
    }
  }
  for (const [k, a] of actualMap) {
    if (!expectedMap.has(k)) {
      extra.push({
        zone: a.zone,
        cardId: a.cardId,
        cardName: a.cardName ?? `#${a.cardId}`,
        tagged: tags[String(a.cardId)] !== undefined,
      });
    }
  }

  return { matched, missing, extra };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const opts = parseCli(process.argv);
  console.log(`[Spike] SOLVER_INSTRUMENT=${process.env.SOLVER_INSTRUMENT ?? '(unset)'}  enabled=${instrumentationEnabled()}`);
  if (!instrumentationEnabled()) {
    console.warn('[Spike] WARNING: instrumentation is OFF. Set SOLVER_INSTRUMENT=1 for timing data.');
  }

  const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
  const FIXTURE_PATH = resolve(
    import.meta.dirname!, '..', '..',
    '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
  );

  console.log(`[Spike] Loading ${FIXTURE_PATH}`);
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as FixtureFile;

  console.log(`[Spike] Boot: cardDB + scripts + solver config`);
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  const scorer = new InterruptionScorer(allConfigs.interruptionTags, allConfigs.interruptionWeights);
  const ranker = new GoldfishChainRanker();
  const stmt = cardDB.stmt;

  const timeLimitMs = opts.speed === 'fast'
    ? allConfigs.solverConfig.timeBudgetFastMs
    : allConfigs.solverConfig.timeBudgetOptimalMs;
  const maxDepthConfig = allConfigs.solverConfig.maxDepth;

  const hands = opts.handFilter
    ? fixture.hands.filter(h => h.id === opts.handFilter)
    : fixture.hands;

  console.log(`[Spike] Running ${hands.length} hand(s) at speed=${opts.speed} budget=${timeLimitMs}ms maxDepth=${maxDepthConfig}\n`);

  const results: FixtureResult[] = [];

  for (const hand of hands) {
    const deck = fixture.decks[hand.deck];
    if (!deck) {
      console.error(`[Spike] Unknown deck '${hand.deck}' for hand '${hand.id}'`);
      continue;
    }

    const mainDeck = [...deck.main];
    let missing = false;
    for (const cardId of hand.hand) {
      const idx = mainDeck.indexOf(cardId);
      if (idx === -1) {
        console.error(`[Spike] Hand card ${cardId} not in ${hand.deck} main`);
        missing = true;
        break;
      }
      mainDeck.splice(idx, 1);
    }
    if (missing) continue;

    const duelConfig: DuelConfig = {
      mainDeck,
      extraDeck: deck.extra,
      hand: hand.hand,
      deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
      opponentDeck: [],
      // Spike-only: suppress OCGCore's default 5-card auto-draw on top of
      // the explicit `hand`. Without this, every solve starts with a
      // 10-card hand (5 scripted + 5 random from post-shuffle deck), which
      // silently polluted every prior measurement. Setting this to 0 makes
      // the fixture hand authoritative. `drawCountPerTurn: 0` removes the
      // per-turn draw that would otherwise add 1 more interruption-tagged
      // card to hand each turn the solver explores.
      startingDrawCount: 0,
      drawCountPerTurn: 0,
    };

    const handCards = hand.hand.map(cid => {
      const row = stmt.get(cid) as { name?: string } | undefined;
      return { cardId: cid, cardName: row?.name ?? `#${cid}` };
    });

    console.log(`═══ ${hand.id} (${hand.deck}) ═══`);
    console.log(`  hand: ${handCards.map(c => c.cardName).join(', ')}`);

    // Fresh solver instances per fixture so TT/Zobrist state doesn't bleed.
    const hasher = new ZobristHasher();
    const table = new TranspositionTable(allConfigs.solverConfig.transpositionMaxEntries);
    const dfs = new DfsSolver(hasher, table, scorer, adapter, ranker, allConfigs.solverConfig);

    const startHandle = adapter.createDuel(duelConfig);
    const signal = AbortSignal.timeout(timeLimitMs + 5000);
    const solverConfig: SolverConfig = { mode: 'goldfish', speed: opts.speed, timeLimitMs };

    // Baseline capture — read the post-createDuel field state DIRECTLY,
    // without calling getLegalActions externally. Calling getLegalActions
    // on startHandle twice (once here, once from inside dfs.solve) breaks
    // OCGCore's state machine on some fixtures (observed: Branded collapses
    // to 0 legal actions at depth 0). getFieldState is a pure query via
    // duelQueryLocation — it does not progress the engine.
    //
    // With `startingDrawCount: 0` and `drawCountPerTurn: 0` set in the
    // duelConfig, the HAND zone contains exactly the fixture's `hand` array
    // at this point (no auto-draws have happened). This is the "do nothing"
    // baseline: the scorer's credit for the starter hand alone, before any
    // solver action.
    const baselineFieldState = adapter.getFieldState(startHandle);
    const baselineLog = adapter.getActivationLog(startHandle);
    const baselineScored = scorer.scoreWithCards(baselineFieldState, baselineLog);
    const baselineScore = baselineScored.score;
    const baselineBreakdown = baselineScored.scoreBreakdown as unknown as Record<string, number>;
    const baselineBoardRaw = baselineScored.endBoardCards;
    const baselineBoard: BoardSnapshot[] = baselineBoardRaw.map(c => ({
      zone: c.zone, cardId: c.cardId, cardName: c.cardName ?? `#${c.cardId}`,
      isFallback: c.isFallback, consumedUses: c.consumedUses,
    }));
    const baselineHandCards = (baselineFieldState.zones.HAND ?? []).map(c => ({
      cardId: c.cardId, cardName: c.cardName ?? `#${c.cardId}`,
    }));

    // Reset instrumentation AFTER baseline capture so scoring calls during
    // baseline don't inflate the post-solve metric.
    instrumentReset();

    const t0 = Date.now();
    let result: SolverResult;
    try {
      result = dfs.solve(adapter, solverConfig, signal, () => {}, startHandle);
    } catch (err) {
      console.error(`[Spike] THROWN on ${hand.id}: ${err instanceof Error ? err.message : String(err)}`);
      adapter.destroyAll();
      continue;
    }
    const wallMs = Date.now() - t0;

    // Capture instrumentation snapshot immediately
    const instr = instrumentationEnabled() ? instrumentSnapshot() : null;

    // Diff expected vs actual
    const diff = diffBoards(hand.expectedBoard ?? [], result.endBoardCards ?? [], allConfigs.interruptionTags);

    const actualBoard = (result.endBoardCards ?? []).map(c => ({
      zone: c.zone,
      cardId: c.cardId,
      cardName: c.cardName ?? `#${c.cardId}`,
      isFallback: c.isFallback,
      consumedUses: c.consumedUses,
    }));

    // Expected-board decomposition: split each expected entry into
    // "already present at baseline" (the solver can't claim credit for it —
    // it was in HAND/board before any solver action), "earned during solve"
    // (appeared in the final endboard but not in baseline — real combo
    // execution), and "still missing" (never reached).
    const keyOf = (z: string, cid: number): string => `${z}::${cid}`;
    const baselineKeys = new Set(baselineBoard.map(c => keyOf(c.zone, c.cardId)));
    const finalKeys = new Set(actualBoard.map(c => keyOf(c.zone, c.cardId)));
    const expectedAtBaseline: ExpectedBoardEntry[] = [];
    const expectedEarned: ExpectedBoardEntry[] = [];
    const expectedStillMissing: ExpectedBoardEntry[] = [];
    for (const e of (hand.expectedBoard ?? [])) {
      const k = keyOf(e.zone, e.cardId);
      if (baselineKeys.has(k)) expectedAtBaseline.push(e);
      else if (finalKeys.has(k)) expectedEarned.push(e);
      else expectedStillMissing.push(e);
    }

    // Delta breakdown — per-category diff between final and baseline
    const deltaBreakdown: Record<string, number> = {};
    for (const k of Object.keys(baselineBreakdown)) {
      const f = (result.scoreBreakdown as unknown as Record<string, number>)[k] ?? 0;
      const b = baselineBreakdown[k] ?? 0;
      if (f - b !== 0) deltaBreakdown[k] = f - b;
    }

    const fixtureResult: FixtureResult = {
      handId: hand.id,
      deck: hand.deck,
      description: hand.description,
      handCards,
      speed: opts.speed,
      timeLimitMs,
      score: result.score,
      mainPathLength: result.mainPath.length,
      nodesExplored: result.stats.nodesExplored,
      maxDepthReached: result.stats.maxDepthReached,
      maxDepthConfig,
      averageBranchingFactor: result.stats.averageBranchingFactor,
      maxBranchingFactor: result.stats.maxBranchingFactor,
      terminationReason: result.stats.terminationReason,
      truncated: result.stats.truncated,
      elapsedMs: wallMs,
      depthHistogram: result.stats.depthHistogram,
      scoreBreakdown: result.scoreBreakdown as unknown as Record<string, number>,
      transpositionHits: result.stats.transpositionHits ?? 0,
      transpositionMisses: result.stats.transpositionMisses ?? 0,
      transpositionStores: result.stats.transpositionStores ?? 0,
      instrumentation: instr,
      forkPctOfWall: instr ? (instr.forkMsTotal / wallMs) * 100 : 0,
      applyPctOfWall: instr ? (instr.applyMsTotal / wallMs) * 100 : 0,
      scorePctOfWall: instr ? (instr.scoreMsTotal / wallMs) * 100 : 0,
      baselineScore,
      baselineBreakdown,
      baselineBoard,
      baselineHandCards,
      deltaScore: result.score - baselineScore,
      deltaBreakdown,
      actualBoard,
      expectedBoard: hand.expectedBoard ?? [],
      matched: diff.matched,
      missing: diff.missing,
      extra: diff.extra,
      missingTaggedCount: diff.missing.filter(m => m.tagged).length,
      missingUntaggedCount: diff.missing.filter(m => !m.tagged).length,
      expectedAtBaseline,
      expectedEarned,
      expectedStillMissing,
      mainPathActions: result.mainPath.slice(0, 30).map(a => ({
        respIdx: a.responseIndex,
        cardId: a.cardId,
        cardName: a.cardName ?? `#${a.cardId}`,
      })),
    };

    results.push(fixtureResult);

    // Live console output — concise snapshot
    console.log(`  BASELINE score=${baselineScore} handSize=${baselineHandCards.length} taggedInBaseline=${baselineBoard.length}`);
    if (baselineBoard.length > 0) {
      for (const c of baselineBoard.slice(0, 10)) {
        console.log(`    [baseline ${c.zone}] ${c.cardName}${c.isFallback ? ' (fallback)' : ''}`);
      }
    }
    console.log(`  wall=${wallMs}ms termination=${fixtureResult.terminationReason} truncated=${fixtureResult.truncated}`);
    console.log(`  score=${fixtureResult.score} (baseline=${baselineScore}, DELTA=${fixtureResult.deltaScore >= 0 ? '+' : ''}${fixtureResult.deltaScore}) mainPathLen=${fixtureResult.mainPathLength}`);
    if (Object.keys(fixtureResult.deltaBreakdown).length > 0) {
      const pairs = Object.entries(fixtureResult.deltaBreakdown)
        .filter(([k]) => k !== 'total' && k !== 'weighted')
        .map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${v}`);
      if (pairs.length > 0) console.log(`  delta breakdown: ${pairs.join(' ')}`);
    }
    console.log(`  nodes=${fixtureResult.nodesExplored.toLocaleString()} depth=${fixtureResult.maxDepthReached}/${maxDepthConfig} BFavg=${fixtureResult.averageBranchingFactor.toFixed(2)} BFmax=${fixtureResult.maxBranchingFactor}`);
    if (instr) {
      console.log(`  forks=${instr.forks} forkMsMean=${instr.forkMsMean.toFixed(2)} forkMsMax=${instr.forkMsMax.toFixed(2)}`);
      console.log(`  fork%=${fixtureResult.forkPctOfWall.toFixed(1)}% apply%=${fixtureResult.applyPctOfWall.toFixed(1)}% score%=${fixtureResult.scorePctOfWall.toFixed(1)}%`);
    }
    console.log(`  endBoard: ${actualBoard.length} cards`);
    for (const c of actualBoard.slice(0, 10)) {
      console.log(`    [${c.zone}] ${c.cardName}${c.isFallback ? ' (fallback)' : ''}${c.consumedUses ? ` used=${c.consumedUses}` : ''}`);
    }
    console.log(`  EXPECTED decomposition: atBaseline=${expectedAtBaseline.length} earned=${expectedEarned.length} stillMissing=${expectedStillMissing.length} / ${hand.expectedBoard?.length ?? 0}`);
    if (expectedEarned.length > 0) {
      for (const e of expectedEarned) console.log(`    + EARNED [${e.zone}] ${e.cardName}`);
    }
    if (expectedAtBaseline.length > 0) {
      for (const e of expectedAtBaseline) console.log(`    = BASELINE [${e.zone}] ${e.cardName}`);
    }
    console.log('');

    adapter.destroyAll();
  }

  const runMeta = {
    date: new Date().toISOString(),
    speed: opts.speed,
    timeLimitMs,
    maxDepth: maxDepthConfig,
    instrumentationEnabled: instrumentationEnabled(),
    solverConfigFile: allConfigs.solverConfig,
    fixtures: results,
  };

  writeFileSync(opts.outPath, JSON.stringify(runMeta, null, 2));
  console.log(`[Spike] Wrote ${opts.outPath}`);
  console.log(`[Spike] Done.`);
  process.exit(0);
}

main().catch(err => {
  console.error('[Spike] FATAL:', err);
  process.exit(1);
});
