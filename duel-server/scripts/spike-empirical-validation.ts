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
  /** Spike-only: extra cardIds that should be preferred by SELECT_CARD
   *  auto-resolution, beyond what `expectedBoard` lists. Used for combo
   *  intermediates (e.g. Dracotail Mululu on Branded — not on the final
   *  endboard but required as a fusion material for Arthalion). */
  preferredIntermediates?: number[];
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
  diagnostic?: unknown;
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
  budgetMsOverride?: number;
  maxDepthOverride?: number;
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
    else if (arg.startsWith('--budget-ms=')) opts.budgetMsOverride = Number(arg.slice(12));
    else if (arg.startsWith('--max-depth=')) opts.maxDepthOverride = Number(arg.slice(12));
    else if (arg.startsWith('--out=')) opts.outPath = arg.slice(6);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx scripts/spike-empirical-validation.ts [--hand=ID] [--speed=fast|optimal] [--budget-ms=N] [--max-depth=N] [--out=PATH]');
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

/** Normalize a zone label from the expected-board fixture format
 *  ("MZONE" / "SZONE") to the family it represents. The diff then matches
 *  any specific zone (M1-M5, EMZ_L/R, S1-S5) belonging to that family. */
function zoneFamily(zone: string): string {
  if (zone === 'MZONE' || zone === 'M1' || zone === 'M2' || zone === 'M3' || zone === 'M4' || zone === 'M5' || zone === 'EMZ_L' || zone === 'EMZ_R') return 'MZONE';
  if (zone === 'SZONE' || zone === 'S1' || zone === 'S2' || zone === 'S3' || zone === 'S4' || zone === 'S5') return 'SZONE';
  return zone; // HAND, GY, DECK, EXTRA, BANISHED — pass through
}

function diffBoards(
  expected: ExpectedBoardEntry[],
  actual: EndBoardCard[],
  tags: Record<string, InterruptionTag>,
): { matched: ExpectedBoardEntry[]; missing: DiffEntry[]; extra: DiffEntry[] } {
  // Match by (zone family, cardId) so that expected "MZONE" matches any
  // of M1-M5/EMZ_L/R, and expected "SZONE" matches any of S1-S5.
  // Expected entries may use either a family label or a specific slot.
  const key = (zone: string, cardId: number): string => `${zoneFamily(zone)}::${cardId}`;
  const expectedMap = new Map<string, ExpectedBoardEntry>();
  for (const e of expected) expectedMap.set(key(e.zone, e.cardId), e);

  // Multiple actual slots may map to the same family key (e.g. two monsters
  // in MZONE with the same cardId). Track all keys present.
  const actualKeys = new Set<string>();
  for (const a of actual) actualKeys.add(key(a.zone, a.cardId));

  const matched: ExpectedBoardEntry[] = [];
  const missing: DiffEntry[] = [];
  const extra: DiffEntry[] = [];

  for (const [k, e] of expectedMap) {
    if (actualKeys.has(k)) {
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
  // For `extra`, we report a card as extra only if it is not in the expected
  // set at all (by family+cardId). This means e.g. having a Dracotail Flame
  // in any MZONE won't be flagged as extra if the expected listed it in any
  // MZONE — the family-matched tolerance is symmetric.
  for (const a of actual) {
    const k = key(a.zone, a.cardId);
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

  const timeLimitMs = opts.budgetMsOverride ?? (opts.speed === 'fast'
    ? allConfigs.solverConfig.timeBudgetFastMs
    : allConfigs.solverConfig.timeBudgetOptimalMs);
  // Apply maxDepth override + auto-scale maxResultNodes proportionally
  // so the tree-size safety net doesn't pre-empt the depth budget.
  const overriddenSolverConfig = opts.maxDepthOverride !== undefined
    ? {
        ...allConfigs.solverConfig,
        maxDepth: opts.maxDepthOverride,
        maxResultNodes: Math.max(
          allConfigs.solverConfig.maxResultNodes,
          opts.maxDepthOverride * 20,
        ),
      }
    : allConfigs.solverConfig;
  const maxDepthConfig = overriddenSolverConfig.maxDepth;
  console.log(`[Spike] maxDepth=${maxDepthConfig} maxResultNodes=${overriddenSolverConfig.maxResultNodes}`);

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

    // Build preferred-search-target list: endboard card IDs plus any
    // explicit combo intermediates the fixture lists. SELECT_CARD
    // auto-resolution will bias toward these when the selectable pool
    // contains a match. Spike-only — test whether the solver can reach
    // the canonical line given correct target picks.
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
      // Spike-only: suppress OCGCore's default 5-card auto-draw on top of
      // the explicit `hand`. Keep drawCountPerTurn at 1 (turn-start draw)
      // — setting it to 0 was observed to cause OCGCore to end the duel
      // early after 2-3 empty turn cycles, which collapsed the search to
      // ~40 actionsZero terminals at depth 3 on Branded.
      startingDrawCount: 0,
      drawCountPerTurn: 1,
      preferredSearchTargets,
    };

    const handCards = hand.hand.map(cid => {
      const row = stmt.get(cid) as { name?: string } | undefined;
      return { cardId: cid, cardName: row?.name ?? `#${cid}` };
    });

    console.log(`═══ ${hand.id} (${hand.deck}) ═══`);
    console.log(`  hand: ${handCards.map(c => c.cardName).join(', ')}`);

    // Fresh solver instances per fixture so TT/Zobrist state doesn't bleed.
    const hasher = new ZobristHasher();
    const table = new TranspositionTable(overriddenSolverConfig.transpositionMaxEntries);
    const dfs = new DfsSolver(hasher, table, scorer, adapter, ranker, overriddenSolverConfig);

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
    // Uses zone-family matching so expected "MZONE" matches any M1-M5/EMZ.
    const keyOf = (z: string, cid: number): string => `${zoneFamily(z)}::${cid}`;
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
      diagnostic: (result.stats as unknown as { diagnostic?: unknown }).diagnostic,
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

    // Full-zone replay dump: re-execute the mainPath on a fresh duel,
    // scoring at each step to find the PEAK state along the path. The
    // solver's `ctx.bestScore` is from this peak; the mainPath's final
    // step is not necessarily that peak (with 3.2-light, scores are
    // tracked across all visited states, not just terminals).
    // Dumping the peak state reveals what *actually* earned matched=1:
    // what cards (including face-down S/Ts) were on the board when the
    // solver achieved its best score.
    if (result.mainPath.length > 0) {
      try {
        // Phase 1: find peak by replaying + scoring at each step
        const probe = adapter.createDuel(duelConfig);
        let bestStep = 0;
        let bestStepScore = -1;
        let stepsDone = 0;
        // Score the initial state too (step 0)
        {
          const fs0 = adapter.getFieldState(probe);
          const log0 = adapter.getActivationLog(probe);
          const s0 = scorer.scoreWithCards(fs0, log0).score;
          if (s0 > bestStepScore) { bestStepScore = s0; bestStep = 0; }
        }
        for (const mpAction of result.mainPath) {
          const legal = adapter.getLegalActions(probe);
          if (legal.length === 0) break;
          const m = legal.find(x => x.responseIndex === mpAction.responseIndex);
          if (!m) break;
          try { adapter.applyAction(probe, m); stepsDone++; }
          catch { break; }
          const fs = adapter.getFieldState(probe);
          const log = adapter.getActivationLog(probe);
          const s = scorer.scoreWithCards(fs, log).score;
          if (s > bestStepScore) { bestStepScore = s; bestStep = stepsDone; }
        }
        adapter.destroyAll();

        // Phase 2: replay up to bestStep and dump the full field state
        console.log(`  PEAK STATE (step ${bestStep}/${stepsDone}, score=${bestStepScore}):`);
        const peak = adapter.createDuel(duelConfig);
        for (let i = 0; i < bestStep; i++) {
          const legal = adapter.getLegalActions(peak);
          if (legal.length === 0) break;
          const m = legal.find(x => x.responseIndex === result.mainPath[i].responseIndex);
          if (!m) break;
          adapter.applyAction(peak, m);
        }
        const fs = adapter.getFieldState(peak);
        console.log(`    turn=${fs.turn} phase=${fs.phase} LP=${fs.lifePoints[0]}/${fs.lifePoints[1]}`);
        const zoneOrder = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R', 'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD', 'HAND', 'GY', 'BANISHED', 'EXTRA'] as const;
        for (const z of zoneOrder) {
          const cards = fs.zones[z] ?? [];
          if (cards.length === 0) continue;
          // Abridge GY/EXTRA/BANISHED to just card names + count (face-down
          // position in those zones is noise — they're never really "set").
          if (z === 'GY' || z === 'EXTRA' || z === 'BANISHED') {
            const names = cards.map(c => c.cardName || `#${c.cardId}`);
            console.log(`    ${z.padEnd(8)} (${cards.length}): ${names.join(', ')}`);
          } else {
            const summary = cards.map(c => `${c.cardName || `#${c.cardId}`}(${c.position})`).join(', ');
            console.log(`    ${z.padEnd(8)} (${cards.length}): ${summary}`);
          }
        }
        adapter.destroyAll();
      } catch (err) {
        console.log(`    REPLAY ERROR: ${err instanceof Error ? err.message : String(err)}`);
        adapter.destroyAll();
      }
    }
    // Diagnostic: terminal reasons + prompt type distribution + BF-by-depth
    const diag = (result.stats as unknown as { diagnostic?: {
      terminalReasons: Record<string, number>;
      promptTypeCounts: Record<string, number>;
      bfByDepthSum: number[];
      bfByDepthCount: number[];
      actionsZeroByDepth: number[];
      actionsZeroSamples: { depth: number; phase: string; turn: number; lp0: number; lp1: number; handSize: number }[];
    } }).diagnostic;
    if (diag) {
      const tr = diag.terminalReasons;
      const trTotal = Object.values(tr).reduce((a, b) => a + b, 0);
      const trPairs = Object.entries(tr)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}(${trTotal > 0 ? (100 * v / trTotal).toFixed(0) : 0}%)`);
      console.log(`  TERMINAL reasons [Σ=${trTotal}]: ${trPairs.join(' ')}`);
      const ptPairs = Object.entries(diag.promptTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`);
      console.log(`  PROMPT types: ${ptPairs.join(' ')}`);
      // BF by depth — only non-zero depths
      const bfLines: string[] = [];
      for (let d = 0; d < diag.bfByDepthSum.length; d++) {
        if (diag.bfByDepthCount[d] > 0) {
          const avg = diag.bfByDepthSum[d] / diag.bfByDepthCount[d];
          bfLines.push(`d${d}:${avg.toFixed(1)}×${diag.bfByDepthCount[d]}`);
        }
      }
      console.log(`  BF by depth: ${bfLines.join(' ')}`);
      // actionsZero by depth
      const azLines: string[] = [];
      for (let d = 0; d < diag.actionsZeroByDepth.length; d++) {
        if (diag.actionsZeroByDepth[d] > 0) azLines.push(`d${d}:${diag.actionsZeroByDepth[d]}`);
      }
      if (azLines.length > 0) console.log(`  actionsZero by depth: ${azLines.join(' ')}`);
      // Terminal state samples — what does the game look like at actionsZero?
      if (diag.actionsZeroSamples.length > 0) {
        console.log(`  actionsZero samples (first ${diag.actionsZeroSamples.length}):`);
        for (const s of diag.actionsZeroSamples) {
          console.log(`    d${s.depth} turn=${s.turn} phase=${s.phase} LP=${s.lp0}/${s.lp1} hand=${s.handSize}`);
        }
      }
    }

    // Root children walk — for each d0 action, what depth/score did the
    // subtree reach? This tells us WHICH root action the solver dedicated
    // its search budget to and whether any promising lines died shallow.
    // Walks only the top-1 child path per node (= the best-score sub-line).
    type TreeNode = { action: { cardName?: string; actionDescription?: string }; score: number; children?: TreeNode[]; isTerminal?: boolean };
    const root = result.tree as unknown as TreeNode;
    if (root && Array.isArray(root.children) && root.children.length > 0) {
      console.log(`  ROOT CHILDREN (${root.children.length}):`);
      const walkSubtree = (node: TreeNode): { maxDepth: number; nodeCount: number; bestPath: string[] } => {
        if (!node.children || node.children.length === 0) {
          return { maxDepth: 0, nodeCount: 1, bestPath: [] };
        }
        let maxDepth = 0;
        let nodeCount = 1;
        let bestPath: string[] = [];
        let bestChildScore = -Infinity;
        for (const c of node.children) {
          const sub = walkSubtree(c);
          nodeCount += sub.nodeCount;
          if (1 + sub.maxDepth > maxDepth) maxDepth = 1 + sub.maxDepth;
          if (c.score > bestChildScore) {
            bestChildScore = c.score;
            bestPath = [c.action.cardName ?? `(resp)`, ...sub.bestPath];
          }
        }
        return { maxDepth, nodeCount, bestPath };
      };
      // Sort by score descending, then by nodeCount descending
      const childSummaries = root.children.map((c, idx) => {
        const sub = walkSubtree(c);
        return {
          idx,
          action: c.action.cardName ?? '(unknown)',
          score: c.score,
          maxDepth: 1 + sub.maxDepth,
          nodeCount: sub.nodeCount + 1,
          bestSubPath: [c.action.cardName ?? '(root action)', ...sub.bestPath],
        };
      });
      childSummaries.sort((a, b) => b.score - a.score || b.nodeCount - a.nodeCount);
      for (const s of childSummaries) {
        console.log(`    [${s.idx}] score=${s.score} depth=${s.maxDepth} nodes=${s.nodeCount}  "${s.action}"`);
        console.log(`         best: ${s.bestSubPath.slice(0, 14).join(' → ')}${s.bestSubPath.length > 14 ? ' ...' : ''}`);
      }

      // DEEP TRACE — start with NS Lukias (resp=0) and auto-walk forward
      // 20 steps, picking activate > summon > pass, printing each prompt's
      // options and the state after each apply. This is the closest we
      // have to "what does OCGCore show a naive combo player after
      // Normal Summoning Lukias".
      console.log(`\n  === DEEP TRACE — resp=0 (Lukias) + 20 steps auto-walk ===`);
      const traceHandle = adapter.createDuel(duelConfig);
      const printState = (label: string): void => {
        const fs = adapter.getFieldState(traceHandle);
        const hand = (fs.zones.HAND ?? []).map(c => c.cardName || `#${c.cardId}`);
        const mz = (['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'] as const).flatMap(z => (fs.zones[z] ?? []).map(c => `${z}:${c.cardName || '?'}(${c.position.slice(0, 6)})`));
        const sz = (['S1', 'S2', 'S3', 'S4', 'S5'] as const).flatMap(z => (fs.zones[z] ?? []).map(c => `${z}:${c.cardName || '?'}(${c.position.slice(0, 6)})`));
        const gy = (fs.zones.GY ?? []).map(c => c.cardName || `#${c.cardId}`);
        console.log(`    ${label} turn=${fs.turn} phase=${fs.phase} LP=${fs.lifePoints[0]}/${fs.lifePoints[1]}`);
        console.log(`      HAND(${hand.length}): ${hand.join(', ')}`);
        if (mz.length > 0) console.log(`      MZONE: ${mz.join(', ')}`);
        if (sz.length > 0) console.log(`      SZONE: ${sz.join(', ')}`);
        if (gy.length > 0) console.log(`      GY(${gy.length}): ${gy.join(', ')}`);
      };
      const pickAction = (actions: { responseIndex: number; cardId: number; actionTag?: string; promptType: string }[]): number => {
        // SELECT_EFFECTYN: OCGCore convention is resp=1 = yes (activate),
        // resp=0 = no (decline). Prefer yes to keep triggered effects firing.
        // Same for SELECT_YESNO.
        if (actions[0]?.promptType === 'SELECT_EFFECTYN' || actions[0]?.promptType === 'SELECT_YESNO') {
          const yesIdx = actions.findIndex(a => a.responseIndex === 1);
          if (yesIdx >= 0) return yesIdx;
        }
        // Preference: activate > non-activate non-pass > pass
        const activateIdx = actions.findIndex(a => a.actionTag === 'activate');
        if (activateIdx >= 0) return activateIdx;
        const nonPassIdx = actions.findIndex(a => a.actionTag !== 'pass' && a.cardId > 0);
        if (nonPassIdx >= 0) return nonPassIdx;
        return 0;
      };
      try {
        printState('[initial]');
        // Step 0: apply resp=0 (first Lukias at root)
        const rootActs = adapter.getLegalActions(traceHandle);
        console.log(`    root prompt: ${rootActs.length} actions, type=${rootActs[0]?.promptType}`);
        for (let i = 0; i < rootActs.length; i++) {
          const a = rootActs[i];
          const cn = a.cardId ? (stmt.get(a.cardId) as { name?: string } | undefined)?.name ?? '?' : '(pass)';
          console.log(`      [${i}] resp=${a.responseIndex} ${cn} tag=${a.actionTag ?? '-'}`);
        }
        const lukiasAct = rootActs[0]; // resp=0 Lukias
        console.log(`    → APPLY [0] (resp=0 Lukias)`);
        adapter.applyAction(traceHandle, lukiasAct);
        printState('[step 0 after]');

        for (let step = 1; step <= 20; step++) {
          const acts = adapter.getLegalActions(traceHandle);
          if (acts.length === 0) {
            console.log(`    [step ${step}] TERMINAL — 0 legal actions`);
            break;
          }
          const pt = acts[0].promptType;
          console.log(`    [step ${step}] prompt=${pt} (${acts.length} options):`);
          for (let i = 0; i < Math.min(10, acts.length); i++) {
            const a = acts[i];
            const cn = a.cardId ? (stmt.get(a.cardId) as { name?: string } | undefined)?.name ?? '?' : '(pass)';
            console.log(`      [${i}] resp=${a.responseIndex} ${cn} tag=${a.actionTag ?? '-'} desc="${(a.description ?? '').slice(0, 40)}"`);
          }
          const pickIdx = pickAction(acts);
          const picked = acts[pickIdx];
          const pname = picked.cardId ? (stmt.get(picked.cardId) as { name?: string } | undefined)?.name ?? '?' : '(pass)';
          console.log(`      → PICK [${pickIdx}] resp=${picked.responseIndex} ${pname}`);
          adapter.applyAction(traceHandle, picked);
          printState(`      [after]`);
        }
      } catch (err) {
        console.log(`    TRACE ERROR: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        adapter.destroyAll();
      }

      // ROOT ACTION INSPECTION — for each of the 8 d0 actions, create a
      // fresh duel, apply ONLY that action, and dump the resulting state.
      // This tells us what each action ACTUALLY does (NS vs Set vs activate
      // vs phase transition), because the tree's cardName label is derived
      // from cardId and does not distinguish action semantics.
      console.log(`\n  === ROOT ACTIONS — semantic probe (1 apply each) ===`);
      const probeHandle0 = adapter.createDuel(duelConfig);
      const probeRootActions = adapter.getLegalActions(probeHandle0);
      console.log(`  Root prompt: ${probeRootActions.length} actions, type=${probeRootActions[0]?.promptType ?? '(none)'}`);
      for (let i = 0; i < probeRootActions.length; i++) {
        const a = probeRootActions[i];
        const cn = a.cardId ? (stmt.get(a.cardId) as { name?: string } | undefined)?.name ?? '?' : '(pass)';
        console.log(`    [${i}] resp=${a.responseIndex} cardId=${a.cardId} "${cn}" tag=${a.actionTag ?? '-'} desc="${(a.description ?? '').slice(0, 60)}"`);
      }
      adapter.destroyAll();

      console.log(`\n  === ROOT ACTIONS — post-apply state probe ===`);
      for (let i = 0; i < 8; i++) {
        const fresh = adapter.createDuel(duelConfig);
        try {
          const legal = adapter.getLegalActions(fresh);
          if (i >= legal.length) { console.log(`    [${i}] no action`); continue; }
          const a = legal[i];
          const cn = a.cardId ? (stmt.get(a.cardId) as { name?: string } | undefined)?.name ?? '?' : '(pass)';
          adapter.applyAction(fresh, a);
          const fs = adapter.getFieldState(fresh);
          const hand = (fs.zones.HAND ?? []).map(c => c.cardName || `#${c.cardId}`);
          const mz = (['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'] as const).flatMap(z => (fs.zones[z] ?? []).map(c => `${z}:${c.cardName || '?'} (${c.position})`));
          const sz = (['S1', 'S2', 'S3', 'S4', 'S5'] as const).flatMap(z => (fs.zones[z] ?? []).map(c => `${z}:${c.cardName || '?'} (${c.position})`));
          const gy = (fs.zones.GY ?? []).map(c => c.cardName || `#${c.cardId}`);
          console.log(`    [${i}] resp=${a.responseIndex} "${cn}" tag=${a.actionTag ?? '-'}`);
          console.log(`         → turn=${fs.turn} phase=${fs.phase} handSize=${hand.length}`);
          if (hand.length !== 5) console.log(`         → HAND: ${hand.join(', ')}`);
          if (mz.length > 0) console.log(`         → MZONE: ${mz.join(', ')}`);
          if (sz.length > 0) console.log(`         → SZONE: ${sz.join(', ')}`);
          if (gy.length > 0) console.log(`         → GY: ${gy.join(', ')}`);
          // Next prompt after applying this action
          const next = adapter.getLegalActions(fresh);
          console.log(`         → next prompt: ${next.length} actions, type=${next[0]?.promptType ?? '(none)'}`);
        } catch (err) {
          console.log(`    [${i}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          adapter.destroyAll();
        }
      }

      // FULL DUMP: for the first "Dracotail Lukias" root child, print the
      // entire subtree (up to 18 nodes) as indented text, showing every
      // action, and then replay the DEEPEST path through a fresh duel and
      // dump state after each step.
      type ActionLike = { responseIndex: number; cardId: number; cardName?: string; actionDescription?: string };
      type FullTreeNode = { action: ActionLike; score: number; children?: FullTreeNode[]; isTerminal?: boolean };
      const lukiasIdx = root.children.findIndex(c => (c.action.cardName ?? '').includes('Lukias'));
      if (lukiasIdx >= 0) {
        const lukiasRoot = root.children[lukiasIdx] as unknown as FullTreeNode;
        console.log(`\n  === NS LUKIAS SUBTREE (idx ${lukiasIdx}) — full dump ===`);
        const dumpIndented = (node: FullTreeNode, depth: number, prefix: string): void => {
          const cn = node.action.cardName || '(pass/empty)';
          const ri = node.action.responseIndex;
          const term = node.isTerminal ? ' [TERM]' : '';
          console.log(`${prefix}d${depth} resp=${ri} score=${node.score} "${cn}"${term}`);
          if (node.children) {
            for (const c of node.children) dumpIndented(c, depth + 1, prefix + '  ');
          }
        };
        dumpIndented(lukiasRoot, 1, '  ');

        // Collect all leaf paths, pick the deepest one.
        type Path = { actions: ActionLike[]; depth: number; leafScore: number };
        const allPaths: Path[] = [];
        const walkPaths = (node: FullTreeNode, pathSoFar: ActionLike[]): void => {
          const nextPath = [...pathSoFar, node.action];
          if (!node.children || node.children.length === 0) {
            allPaths.push({ actions: nextPath, depth: nextPath.length, leafScore: node.score });
            return;
          }
          for (const c of node.children) walkPaths(c, nextPath);
        };
        walkPaths(lukiasRoot, []);
        allPaths.sort((a, b) => b.depth - a.depth || b.leafScore - a.leafScore);
        const deepest = allPaths[0];
        console.log(`\n  === REPLAY deepest NS Lukias path (${deepest.depth} steps, leaf score ${deepest.leafScore}) ===`);

        // Replay via a fresh duel. Use responseIndex matching against
        // live-enumerated actions at each prompt.
        const replayHandle = adapter.createDuel(duelConfig);
        const dumpState = (label: string): void => {
          const fs = adapter.getFieldState(replayHandle);
          const hand = (fs.zones.HAND ?? []).map(c => c.cardName || `#${c.cardId}`);
          const m = (['M1', 'M2', 'M3', 'M4', 'M5'] as const).flatMap(z => (fs.zones[z] ?? []).map(c => `${z}:${c.cardName || '?'}`));
          const s = (['S1', 'S2', 'S3', 'S4', 'S5'] as const).flatMap(z => (fs.zones[z] ?? []).map(c => `${z}:${c.cardName || '?'} (${c.position})`));
          const emz = (['EMZ_L', 'EMZ_R'] as const).flatMap(z => (fs.zones[z] ?? []).map(c => `${z}:${c.cardName || '?'}`));
          const gy = (fs.zones.GY ?? []).map(c => c.cardName || `#${c.cardId}`);
          console.log(`    ${label} turn=${fs.turn} phase=${fs.phase} LP=${fs.lifePoints[0]}/${fs.lifePoints[1]}`);
          console.log(`      HAND(${hand.length}): ${hand.join(', ')}`);
          if (m.length > 0 || emz.length > 0) console.log(`      MZONE: ${[...m, ...emz].join(', ')}`);
          if (s.length > 0) console.log(`      SZONE: ${s.join(', ')}`);
          if (gy.length > 0) console.log(`      GY: ${gy.join(', ')}`);
        };
        try {
          dumpState('[d0 before]');
          for (let i = 0; i < deepest.actions.length; i++) {
            const a = deepest.actions[i];
            if (!a || a.responseIndex === undefined) {
              console.log(`    [step ${i}] SKIP — no action`);
              continue;
            }
            const legal = adapter.getLegalActions(replayHandle);
            if (legal.length === 0) {
              console.log(`    [step ${i}] STOP — 0 legal actions returned by adapter`);
              break;
            }
            const match = legal.find(x => x.responseIndex === a.responseIndex);
            if (!match) {
              console.log(`    [step ${i}] NO MATCH — looking for resp=${a.responseIndex} "${a.cardName}" among ${legal.length} legal: ${legal.slice(0, 6).map(x => `resp=${x.responseIndex} ${(stmt.get(x.cardId) as { name?: string } | undefined)?.name ?? '?'}`).join(' | ')}`);
              break;
            }
            const matchName = (stmt.get(match.cardId) as { name?: string } | undefined)?.name ?? `#${match.cardId}`;
            console.log(`    [step ${i}] APPLY resp=${a.responseIndex} promptType=${match.promptType} card=${matchName} tag=${match.actionTag ?? '-'}`);
            adapter.applyAction(replayHandle, match);
            dumpState(`    [after step ${i}]`);
          }
        } catch (err) {
          console.log(`    REPLAY ERROR: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
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
