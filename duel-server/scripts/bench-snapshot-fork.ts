// =============================================================================
// bench-snapshot-fork.ts — wall-clock comparison of replay vs snapshot fork
// on a real fixture. Runs the same DFS twice, same seed + same budget, and
// reports elapsed / nodes-per-second for each.
//
// Usage:
//   npx tsx scripts/bench-snapshot-fork.ts <fixtureId> [nodeBudget=400]
//
// Example:
//   npx tsx scripts/bench-snapshot-fork.ts ddd-pendulum-opener 400
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../src/solver/route-aware-ranker.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
import type { DuelConfig, SolverConfig } from '../src/solver/solver-types.js';

const fixtureId = process.argv[2];
const nodeBudget = Number(process.argv[3] ?? 400);

if (!fixtureId) {
  console.error('Usage: bench-snapshot-fork.ts <fixtureId> [nodeBudget=400]');
  process.exit(1);
}

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES_PATH = resolve(
  import.meta.dirname!, '..', '..',
  '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
);

const fixtureFile = JSON.parse(readFileSync(FIXTURES_PATH, 'utf-8')) as {
  decks: Record<string, { main: number[]; extra: number[] }>;
  hands: { id: string; deck: string; hand: number[]; deckSeed: string }[];
};
const hand = fixtureFile.hands.find(h => h.id === fixtureId);
if (!hand) {
  console.error(`Fixture not found: ${fixtureId}`);
  process.exit(1);
}
const deck = fixtureFile.decks[hand.deck];
if (!deck) {
  console.error(`Deck not found: ${hand.deck}`);
  process.exit(1);
}

const duelConfig: DuelConfig = {
  mainDeck: deck.main,
  extraDeck: deck.extra,
  hand: hand.hand,
  deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
  opponentDeck: [],
};

const solverConfig: SolverConfig = {
  mode: 'goldfish',
  speed: 'optimal',
  timeLimitMs: 3_600_000,
  rootChildBudgetNodes: nodeBudget,
};

async function runOnce(useSnapshot: boolean): Promise<{ elapsed: number; nodes: number; score: number; match: string; }> {
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags, { useSnapshot });

  const metadataIds = [...deck.main, ...deck.extra, ...hand!.hand];
  const cardMetadata = buildCardMetadataMap(cardDB, metadataIds);

  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    cardMetadata,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );
  const ranker = new RouteAwareRanker(new GoldfishChainRanker(allConfigs.interruptionTags));
  const hasher = new ZobristHasher();
  const table = new TranspositionTable(allConfigs.solverConfig.transpositionMaxEntries);
  const solver = new DfsSolver(hasher, table, scorer, adapter, ranker, allConfigs.solverConfig);

  const h = adapter.createDuel(duelConfig);
  const t0 = Date.now();
  const result = solver.solve(adapter, solverConfig, new AbortController().signal, () => {}, h);
  const elapsed = Date.now() - t0;
  adapter.destroyAll();

  const mainPathSig = result.mainPath.map(a => `${a.responseIndex}:${a.cardId}`).join('|');
  return {
    elapsed,
    nodes: result.stats.nodesExplored,
    score: result.score,
    match: mainPathSig,
  };
}

console.log(`\n=== Bench: ${fixtureId} (nodeBudget=${nodeBudget}) ===\n`);

console.log('Run 1 — REPLAY fork (baseline)');
const replay = await runOnce(false);
console.log(`  nodes=${replay.nodes}  elapsed=${replay.elapsed}ms  rate=${(replay.nodes / (replay.elapsed / 1000)).toFixed(1)} n/s  score=${replay.score}`);

console.log('\nRun 2 — SNAPSHOT fork');
const snap = await runOnce(true);
console.log(`  nodes=${snap.nodes}  elapsed=${snap.elapsed}ms  rate=${(snap.nodes / (snap.elapsed / 1000)).toFixed(1)} n/s  score=${snap.score}`);

console.log('\n=== Summary ===');
console.log(`speedup:      ${(replay.elapsed / Math.max(1, snap.elapsed)).toFixed(2)}×`);
console.log(`throughput:   ${(replay.nodes / (replay.elapsed / 1000)).toFixed(0)} → ${(snap.nodes / (snap.elapsed / 1000)).toFixed(0)} n/s`);
console.log(`parity:       mainPath ${replay.match === snap.match ? 'IDENTICAL ✓' : 'DIVERGED ✗'}`);
console.log(`              nodes    ${replay.nodes === snap.nodes ? 'IDENTICAL ✓' : `DIVERGED (${replay.nodes} vs ${snap.nodes}) ✗`}`);
console.log(`              score    ${replay.score === snap.score ? 'IDENTICAL ✓' : `DIVERGED (${replay.score} vs ${snap.score}) ✗`}`);

if (replay.match !== snap.match || replay.nodes !== snap.nodes || replay.score !== snap.score) {
  process.exit(1);
}
