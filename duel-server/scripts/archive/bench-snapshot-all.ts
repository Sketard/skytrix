// =============================================================================
// bench-snapshot-all.ts — run replay vs snapshot across all non-draft fixtures
// and report aggregate parity + speedup. Uses two adapters (one per mode) to
// avoid cross-contamination, but reuses the card DB / scripts load.
//
// Usage:
//   npx tsx scripts/bench-snapshot-all.ts [nodeBudget=200]
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../../src/solver/route-aware-ranker.js';
import { DfsSolver } from '../../src/solver/dfs-solver.js';
import { ZobristHasher } from '../../src/solver/zobrist.js';
import { TranspositionTable } from '../../src/solver/transposition-table.js';
import { buildCardMetadataMap } from '../../src/solver/card-metadata.js';
import type { DuelConfig, SolverConfig, DecisionNode, SolverResult } from '../../src/solver/solver-types.js';

const nodeBudget = Number(process.argv[2] ?? 200);

const DATA_DIR = resolve(import.meta.dirname!, '..', '..', '..', 'data');
const FIXTURES_PATH = resolve(
  import.meta.dirname!, '..', '..', '..',
  '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
);

const fixtureFile = JSON.parse(readFileSync(FIXTURES_PATH, 'utf-8')) as {
  decks: Record<string, { main: number[]; extra: number[]; _draft?: boolean }>;
  hands: { id: string; deck: string; hand: number[]; deckSeed: string; _draft?: boolean }[];
};

const hands = fixtureFile.hands.filter(h => !h._draft && !fixtureFile.decks[h.deck]?._draft);
console.log(`[bench] ${hands.length} fixtures; node budget=${nodeBudget}\n`);

const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);

// Two independent adapters — each owns its own WASM instance.
const replayAdapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags, { useSnapshot: false });
const snapAdapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags, { useSnapshot: true });
if (!snapAdapter.snapshotAvailable) {
  console.error('[bench] snapshot adapter does not have Memory captured — abort');
  process.exit(1);
}

function hashMainPath(r: SolverResult): string {
  return r.mainPath.map(a => `${a.responseIndex}:${a.cardId}`).join('|');
}
function hashTreeShape(node: DecisionNode, depth = 0, max = 8): string {
  if (depth >= max) return '…';
  return `(${node.action.responseIndex}:${node.score}:${node.isTerminal ? 'T' : 'N'}[${node.children.map(c => hashTreeShape(c, depth + 1, max)).join(',')})`;
}

interface Row {
  id: string;
  nodesReplay: number;
  nodesSnap: number;
  elapsedReplay: number;
  elapsedSnap: number;
  scoreReplay: number;
  scoreSnap: number;
  parityNodes: boolean;
  parityPath: boolean;
  parityScore: boolean;
  parityTree: boolean;
  parityBreakdown: boolean;
}

const solverConfig: SolverConfig = {
  mode: 'goldfish',
  speed: 'optimal',
  timeLimitMs: 3_600_000,
  rootChildBudgetNodes: nodeBudget,
};

function runFor(adapter: OCGCoreAdapter, cfg: DuelConfig, metaIds: number[]) {
  const cardMeta = buildCardMetadataMap(cardDB, metaIds);
  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    cardMeta,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );
  const ranker = new RouteAwareRanker(new GoldfishChainRanker(allConfigs.interruptionTags));
  const hasher = new ZobristHasher();
  const table = new TranspositionTable(allConfigs.solverConfig.transpositionMaxEntries);
  const solver = new DfsSolver(hasher, table, scorer, adapter, ranker, allConfigs.solverConfig);

  const h = adapter.createDuel(cfg);
  const t0 = Date.now();
  const r = solver.solve(adapter, solverConfig, new AbortController().signal, () => {}, h);
  const elapsed = Date.now() - t0;
  adapter.destroyDuel(h);
  return { result: r, elapsed };
}

const rows: Row[] = [];

for (let i = 0; i < hands.length; i++) {
  const h = hands[i]!;
  const deck = fixtureFile.decks[h.deck];
  if (!deck) { console.warn(`skip ${h.id}: deck missing`); continue; }

  const duelConfig: DuelConfig = {
    mainDeck: deck.main,
    extraDeck: deck.extra,
    hand: h.hand,
    deckSeed: h.deckSeed.split(',').map(s => BigInt(s.trim())),
    opponentDeck: [],
  };
  const metaIds = [...deck.main, ...deck.extra, ...h.hand];

  process.stdout.write(`[${(i + 1).toString().padStart(2)}/${hands.length}] ${h.id.padEnd(30)} `);

  // Replay first
  const rReplay = runFor(replayAdapter, duelConfig, metaIds);
  // Then snapshot
  const rSnap = runFor(snapAdapter, duelConfig, metaIds);

  const row: Row = {
    id: h.id,
    nodesReplay: rReplay.result.stats.nodesExplored,
    nodesSnap: rSnap.result.stats.nodesExplored,
    elapsedReplay: rReplay.elapsed,
    elapsedSnap: rSnap.elapsed,
    scoreReplay: rReplay.result.score,
    scoreSnap: rSnap.result.score,
    parityNodes: rReplay.result.stats.nodesExplored === rSnap.result.stats.nodesExplored,
    parityPath: hashMainPath(rReplay.result) === hashMainPath(rSnap.result),
    parityScore: rReplay.result.score === rSnap.result.score,
    parityTree: hashTreeShape(rReplay.result.tree) === hashTreeShape(rSnap.result.tree),
    parityBreakdown: JSON.stringify(rReplay.result.scoreBreakdown) === JSON.stringify(rSnap.result.scoreBreakdown),
  };
  rows.push(row);

  const ok = row.parityNodes && row.parityPath && row.parityScore && row.parityTree && row.parityBreakdown;
  const speedup = rReplay.elapsed / Math.max(1, rSnap.elapsed);
  console.log(`${ok ? '✅' : '❌'}  ${row.nodesReplay.toString().padStart(5)}n  ${rReplay.elapsed.toString().padStart(6)}ms → ${rSnap.elapsed.toString().padStart(5)}ms  (${speedup.toFixed(2)}×)`);
  if (!ok) {
    console.log(`         nodes=${row.parityNodes} path=${row.parityPath} score=${row.parityScore} tree=${row.parityTree} bd=${row.parityBreakdown}`);
    console.log(`         replay score=${row.scoreReplay} snap score=${row.scoreSnap}`);
  }
}

replayAdapter.destroyAll();
snapAdapter.destroyAll();

// Aggregate
const okRows = rows.filter(r => r.parityNodes && r.parityPath && r.parityScore && r.parityTree && r.parityBreakdown);
const totalReplay = rows.reduce((a, r) => a + r.elapsedReplay, 0);
const totalSnap = rows.reduce((a, r) => a + r.elapsedSnap, 0);
const totalNodesReplay = rows.reduce((a, r) => a + r.nodesReplay, 0);
const totalNodesSnap = rows.reduce((a, r) => a + r.nodesSnap, 0);

console.log('\n=== AGGREGATE ===');
console.log(`parity:       ${okRows.length}/${rows.length} fixtures identical`);
console.log(`total nodes:  replay=${totalNodesReplay}  snap=${totalNodesSnap}`);
console.log(`total time:   replay=${(totalReplay / 1000).toFixed(1)}s  snap=${(totalSnap / 1000).toFixed(1)}s`);
console.log(`throughput:   replay=${(totalNodesReplay / (totalReplay / 1000)).toFixed(1)} n/s  snap=${(totalNodesSnap / (totalSnap / 1000)).toFixed(1)} n/s`);
console.log(`speedup:      ${(totalReplay / Math.max(1, totalSnap)).toFixed(2)}×`);

process.exit(okRows.length === rows.length ? 0 : 1);
