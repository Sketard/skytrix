// =============================================================================
// probe-move-enum-audit.ts — move enumeration audit probe.
//
// Runs a parameterized DFS on any fixture and dumps the information needed
// to decide whether the solver's action generator is exposing all required
// branches for a given deck, or whether it's missing canonical combo moves.
//
// Read-only: no production code changes. Uses existing DfsDiagnostic
// instrumentation (actionsZeroByDepth, bfByDepthSum/Count, promptTypeCounts,
// actionsZeroSamples, terminalReasons) plus mainPath step-by-step replay.
//
// Usage:
//   cd duel-server
//   SOLVER_INSTRUMENT=1 npx tsx scripts/probe-move-enum-audit.ts --fixture=ddd-pendulum-opener
//   SOLVER_INSTRUMENT=1 npx tsx scripts/probe-move-enum-audit.ts --fixture=ryzeal-mitsurugi-opener
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import { instrumentationEnabled } from '../src/solver/solver-instrumentation.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
import type { DuelConfig, SolverConfig } from '../src/solver/solver-types.js';

interface HandFixture {
  id: string;
  deck: string;
  description: string;
  hand: number[];
  deckSeed: string;
  expectedBoard?: { zone: string; cardId: number; cardName: string }[];
  preferredIntermediates?: number[];
  maxDepth?: number;
}

interface FixtureFile {
  decks: Record<string, { main: number[]; extra: number[]; side?: number[] }>;
  hands: HandFixture[];
}

function parseFixtureArg(): string {
  const arg = process.argv.find(a => a.startsWith('--fixture='));
  if (!arg) {
    console.error('[audit] missing --fixture=<id> arg');
    console.error('  known fixtures: ddd-pendulum-opener, ryzeal-mitsurugi-opener,');
    console.error('                  branded-dracotail-opener, branded-dracotail-opener-mirrorjade-line');
    process.exit(1);
  }
  return arg.slice('--fixture='.length);
}

function parseNumArg(name: string): number | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const v = Number(arg.slice(name.length + 3));
  return Number.isFinite(v) ? v : undefined;
}

async function main(): Promise<void> {
  const fixtureId = parseFixtureArg();
  console.log(`[audit] SOLVER_INSTRUMENT=${process.env.SOLVER_INSTRUMENT ?? '(unset)'}  enabled=${instrumentationEnabled()}`);
  console.log(`[audit] fixture: ${fixtureId}`);

  const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
  const FIXTURE_PATH = resolve(
    import.meta.dirname!, '..', '..',
    '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
  );

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as FixtureFile;
  const hand = fixture.hands.find(h => h.id === fixtureId);
  if (!hand) {
    console.error(`[audit] Hand '${fixtureId}' not found`);
    process.exit(1);
  }
  const deck = fixture.decks[hand.deck];
  if (!deck) {
    console.error(`[audit] Deck '${hand.deck}' not found`);
    process.exit(1);
  }

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  const cardMetadata = buildCardMetadataMap(cardDB, [...deck.main, ...deck.extra, ...hand.hand]);
  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    cardMetadata,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );
  const ranker = new GoldfishChainRanker(allConfigs.interruptionTags);
  const stmt = cardDB.stmt;
  const cardName = (cid: number): string => {
    if (!cid) return '(pass)';
    return (stmt.get(cid) as { name?: string } | undefined)?.name ?? `#${cid}`;
  };

  const mainDeck = [...deck.main];
  for (const cid of hand.hand) {
    const idx = mainDeck.indexOf(cid);
    if (idx === -1) {
      console.error(`[audit] Hand card ${cid} not in ${hand.deck} main`);
      process.exit(1);
    }
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

  const maxDepthOverride = parseNumArg('max-depth');
  const budgetOverride = parseNumArg('budget-ms');
  const maxDepth = maxDepthOverride ?? hand.maxDepth ?? allConfigs.solverConfig.maxDepth;
  const perFixtureConfig = {
    ...allConfigs.solverConfig,
    maxDepth,
    maxResultNodes: Math.max(allConfigs.solverConfig.maxResultNodes, maxDepth * 20),
  };
  const timeLimitMs = budgetOverride ?? allConfigs.solverConfig.timeBudgetOptimalMs;

  console.log(`\n═══ ${hand.id} (${hand.deck}) ═══`);
  console.log(`  hand: ${hand.hand.map(cardName).join(', ')}`);
  console.log(`  maxDepth=${maxDepth}  budget=${timeLimitMs}ms`);
  console.log(`  expectedBoard (${hand.expectedBoard?.length ?? 0}):`);
  for (const e of hand.expectedBoard ?? []) {
    console.log(`    [${e.zone}] ${e.cardName} (#${e.cardId})`);
  }
  console.log('');

  const hasher = new ZobristHasher();
  const table = new TranspositionTable(perFixtureConfig.transpositionMaxEntries);
  const dfs = new DfsSolver(hasher, table, scorer, adapter, ranker, perFixtureConfig);
  const startHandle = adapter.createDuel(duelConfig);
  const signal = AbortSignal.timeout(timeLimitMs + 5000);
  const solverConfig: SolverConfig = { mode: 'goldfish', speed: 'optimal', timeLimitMs };

  console.log(`[audit] Running DFS (${timeLimitMs / 1000}s budget)...`);
  const t0 = Date.now();
  const result = dfs.solve(adapter, solverConfig, signal, () => {}, startHandle);
  const wallMs = Date.now() - t0;

  console.log(`\n[audit] DFS complete: wall=${wallMs}ms score=${result.score} termination=${result.stats.terminationReason}`);
  console.log(`  nodesExplored=${result.stats.nodesExplored}  maxDepthReached=${result.stats.maxDepthReached}`);
  console.log(`  avgBranchingFactor=${result.stats.averageBranchingFactor.toFixed(2)}  maxBF=${result.stats.maxBranchingFactor}`);

  const diag = result.stats.diagnostic;
  if (!diag) {
    console.error('[audit] no diagnostic — SOLVER_INSTRUMENT not set?');
    adapter.destroyAll();
    process.exit(1);
  }

  adapter.destroyAll();

  // =========================================================================
  // A) TERMINAL REASONS BREAKDOWN
  // =========================================================================
  console.log(`\n[audit] ════════ A) TERMINAL REASONS ════════`);
  const tr = diag.terminalReasons;
  const totalTerminals = Object.values(tr).reduce((a, b) => a + b, 0);
  const pct = (n: number) => totalTerminals > 0 ? `${((n / totalTerminals) * 100).toFixed(1)}%` : '0%';
  console.log(`  total terminals: ${totalTerminals}`);
  for (const [k, v] of Object.entries(tr).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(22)} ${String(v).padStart(6)}  (${pct(v)})`);
  }

  // =========================================================================
  // B) PROMPT TYPE DISTRIBUTION
  // =========================================================================
  console.log(`\n[audit] ════════ B) PROMPT TYPE DISTRIBUTION (exploratory nodes only) ════════`);
  const pt = diag.promptTypeCounts;
  const totalPrompts = Object.values(pt).reduce((a, b) => a + b, 0);
  console.log(`  total exploratory nodes: ${totalPrompts}`);
  for (const [k, v] of Object.entries(pt).sort((a, b) => b[1] - a[1])) {
    const p = totalPrompts > 0 ? `${((v / totalPrompts) * 100).toFixed(1)}%` : '0%';
    console.log(`    ${k.padEnd(22)} ${String(v).padStart(6)}  (${p})`);
  }

  // =========================================================================
  // C) BRANCHING FACTOR BY DEPTH
  // =========================================================================
  console.log(`\n[audit] ════════ C) BRANCHING FACTOR + ACTIONS-ZERO BY DEPTH ════════`);
  console.log(`  depth | nodes(BF) | sum(legal) | avgBF  | az/depth | `);
  console.log(`  ------+-----------+------------+--------+----------+`);
  const bfSum = diag.bfByDepthSum;
  const bfCount = diag.bfByDepthCount;
  const azByDepth = diag.actionsZeroByDepth;
  const maxD = Math.max(bfSum.length, bfCount.length, azByDepth.length);
  for (let d = 0; d < maxD; d++) {
    const s = bfSum[d] ?? 0;
    const c = bfCount[d] ?? 0;
    const az = azByDepth[d] ?? 0;
    if (c === 0 && az === 0) continue;
    const avg = c > 0 ? (s / c).toFixed(2) : '-';
    console.log(`  ${String(d).padStart(5)} | ${String(c).padStart(9)} | ${String(s).padStart(10)} | ${avg.padStart(6)} | ${String(az).padStart(8)} |`);
  }

  // =========================================================================
  // D) ACTIONS-ZERO SAMPLES (where does DFS get stuck?)
  // =========================================================================
  console.log(`\n[audit] ════════ D) ACTIONS-ZERO SAMPLES (first N stuck states) ════════`);
  console.log(`  depth | phase           | turn | LP0  / LP1  | handSize`);
  console.log(`  ------+-----------------+------+-------------+---------`);
  for (const s of diag.actionsZeroSamples.slice(0, 20)) {
    console.log(
      `  ${String(s.depth).padStart(5)} | ${s.phase.padEnd(15)} | ${String(s.turn).padStart(4)} | ${String(s.lp0).padStart(4)} / ${String(s.lp1).padStart(4)} | ${String(s.handSize).padStart(8)}`,
    );
  }

  // =========================================================================
  // E) MAIN PATH REPLAY WITH LEGAL-ACTION SETS
  // =========================================================================
  console.log(`\n[audit] ════════ E) MAIN PATH STEP-BY-STEP (legal actions per node) ════════`);
  const replay = adapter.createDuel(duelConfig);
  let step = 0;
  let skipped = 0;
  for (const mpAction of result.mainPath) {
    step++;
    if (mpAction.responseIndex < 0 && mpAction.actionDescription === 'root') {
      skipped++;
      continue;
    }
    const legal = adapter.getLegalActions(replay);
    if (legal.length === 0) {
      console.log(`  [${String(step).padStart(2)}] STOP — 0 legal actions at replay`);
      break;
    }
    const match = legal.find(x => x.responseIndex === mpAction.responseIndex);
    if (!match) {
      console.log(`  [${String(step).padStart(2)}] DESYNC — looking for resp=${mpAction.responseIndex} at promptType=${legal[0].promptType}`);
      break;
    }
    const cn = cardName(match.cardId);
    const picked = `${match.promptType.replace('SELECT_', '')}/${match.actionTag ?? '-'}:${cn}`;

    const uniqCards = Array.from(new Set(legal.map(x => `${cardName(x.cardId)}${x.actionTag ? `(${x.actionTag})` : ''}`)));
    const alt = uniqCards.length <= 1
      ? ''
      : `  {${uniqCards.slice(0, 8).join(', ')}${uniqCards.length > 8 ? `, +${uniqCards.length - 8}` : ''}}`;
    console.log(`  [${String(step).padStart(2)}] BF=${legal.length}  → ${picked}${alt}`);

    // SELECT_CARD full dump — show EVERY candidate verbatim so we can see
    // which targets are actually exposed to the DFS vs collapsed by the
    // mechanical auto-resolver (DECK-only gate). Critical for diagnosing
    // Gate-tutor-style prompts where the DFS only sees 1 candidate despite
    // a 40+ deck search pool.
    if (match.promptType === 'SELECT_CARD') {
      console.log(`        SELECT_CARD full candidate list (${legal.length} entries):`);
      for (let i = 0; i < legal.length; i++) {
        const a = legal[i];
        const picked_marker = a.responseIndex === match.responseIndex ? ' ← PICKED' : '';
        console.log(`          [${i}] resp=${a.responseIndex} cid=${a.cardId} "${cardName(a.cardId)}" tag=${a.actionTag ?? '-'}${picked_marker}`);
      }
    }
    try {
      adapter.applyAction(replay, match);
    } catch (err) {
      console.log(`        APPLY ERROR: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
  adapter.destroyAll();
  console.log(`  (${step - skipped} applied, ${skipped} synthetic root markers)`);

  // =========================================================================
  // F) EXPECTED BOARD vs AUTHORITATIVE PEAK
  // =========================================================================
  console.log(`\n[audit] ════════ F) EXPECTED vs AUTHORITATIVE PEAK (bestTurn1FieldState) ════════`);
  const peakFs = diag.bestTurn1FieldState as undefined | {
    turn: number;
    phase?: string;
    zones: Record<string, { cardId: number; cardName?: string; position: string }[]>;
  };
  if (!peakFs) {
    console.log(`  (no peak state recorded)`);
  } else {
    const expected = new Map<number, { zone: string; name: string }>();
    for (const e of hand.expectedBoard ?? []) {
      expected.set(e.cardId, { zone: e.zone, name: e.cardName });
    }
    // Field-only zones for matched check (exclude EXTRA/DECK/HAND/GY/BANISHED
    // which would otherwise false-positive on every unused extra deck card).
    const FIELD_ZONES = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R', 'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD']);
    const presentOnField = new Set<number>();
    for (const [zoneName, zs] of Object.entries(peakFs.zones)) {
      if (!FIELD_ZONES.has(zoneName)) continue;
      for (const c of zs) presentOnField.add(c.cardId);
    }
    console.log(`  expected cards (${expected.size}) — FIELD-ONLY check:`);
    for (const [cid, info] of expected) {
      const hit = presentOnField.has(cid) ? '✓ PRESENT' : '✗ MISSING';
      console.log(`    ${hit}  #${cid} ${info.name} (target zone ${info.zone})`);
    }
    const matchedCount = Array.from(expected.keys()).filter(cid => presentOnField.has(cid)).length;
    console.log(`  matched (field-only): ${matchedCount} / ${expected.size}`);

    // F2) Full peak field dump — zone-by-zone, all occupancy. Critical for
    // diagnosing peak state shape vs expected combo endboard.
    console.log(`\n[audit] ════════ F2) FULL PEAK FIELD DUMP ════════`);
    console.log(`  turn=${peakFs.turn} phase=${peakFs.phase ?? '?'}`);
    const ZONE_ORDER = [
      'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
      'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD',
      'HAND', 'GY', 'BANISHED', 'EXTRA',
    ];
    for (const z of ZONE_ORDER) {
      const cards = peakFs.zones[z] ?? [];
      if (cards.length === 0) continue;
      const summary = cards
        .map(c => `${c.cardName ?? `#${c.cardId}`}(${c.position.slice(0, 6)})`)
        .join(', ');
      console.log(`  ${z.padEnd(9)} (${String(cards.length).padStart(2)}): ${summary}`);
    }
  }

  console.log(`\n[audit] done. wallMs=${wallMs}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[audit] FATAL:', err);
  process.exit(1);
});
