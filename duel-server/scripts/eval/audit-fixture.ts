// =============================================================================
// audit-fixture.ts — dump peak field state + scoreBreakdown for a single fixture.
//
// Diagnostic helper for understanding why a fixture scores the way it does.
// Prints:
//   - Expected board vs peak board match summary
//   - Full peak board (all zones, all pieces)
//   - scoreBreakdown (interruptionScore, explorationScore, fallbackPoints, etc.)
//   - Score contributors per tag (if scorer exposes them)
//
// Usage:
//   cd duel-server
//   npx tsx scripts/audit-fixture.ts --fixture=nekroz-ryzeal-opener [--node-budget=400]
// =============================================================================

import { join, resolve } from 'node:path';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../../src/solver/goldfish-chain-ranker.js';
import { DfsSolver } from '../../src/solver/dfs-solver.js';
import { ZobristHasher } from '../../src/solver/zobrist.js';
import { TranspositionTable } from '../../src/solver/transposition-table.js';
import { readFileSync } from 'node:fs';
import type { DuelConfig, SolverConfig } from '../../src/solver/solver-types.js';

function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const fixtureId = parseArg('fixture') ?? 'nekroz-ryzeal-opener';
const nodeBudget = Number(parseArg('node-budget') ?? '400');
const budgetMs = Number(parseArg('budget-ms') ?? '3600000');

const DATA_DIR = resolve(import.meta.dirname!, '..', '..', '..', 'data');
const DECKS_PATH = resolve(import.meta.dirname!, '..', '..', '..', '_bmad-output/planning-artifacts/research/solver-validation-decks.json');

const fixture = JSON.parse(readFileSync(DECKS_PATH, 'utf-8')) as {
  decks: Record<string, { main: number[]; extra: number[] }>;
  hands: Array<{ id: string; deck: string; hand: number[]; deckSeed: string; maxDepth?: number; expectedBoard?: { zone: string; cardId: number; cardName: string; position?: string }[]; preferredIntermediates?: number[] }>;
};
const hand = fixture.hands.find(h => h.id === fixtureId);
if (!hand) { console.error(`Unknown fixture '${fixtureId}'`); process.exit(2); }
const deck = fixture.decks[hand.deck];
if (!deck) { console.error(`Unknown deck '${hand.deck}'`); process.exit(2); }

const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
const scorer = new InterruptionScorer(allConfigs.interruptionTags, allConfigs.interruptionWeights);
const ranker = new GoldfishChainRanker();

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
  mainDeck, extraDeck: deck.extra, hand: hand.hand,
  deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
  opponentDeck: [], startingDrawCount: 0, drawCountPerTurn: 1,
  preferredSearchTargets,
};

const maxDepth = hand.maxDepth ?? allConfigs.solverConfig.maxDepth;
const perFixtureConfig = { ...allConfigs.solverConfig, maxDepth, maxResultNodes: Math.max(allConfigs.solverConfig.maxResultNodes, maxDepth * 20) };
const hasher = new ZobristHasher();
const table = new TranspositionTable(perFixtureConfig.transpositionMaxEntries);
const dfs = new DfsSolver(hasher, table, scorer, adapter, ranker, perFixtureConfig);
const startHandle = adapter.createDuel(duelConfig);
const signal = AbortSignal.timeout(budgetMs + 5000);
const solverConfig: SolverConfig = { mode: 'goldfish', speed: 'optimal', timeLimitMs: budgetMs, rootChildBudgetNodes: nodeBudget };

console.log(`\n═══ AUDIT: ${fixtureId} (nb=${nodeBudget}) ═══\n`);
const t0 = Date.now();
const result = dfs.solve(adapter, solverConfig, signal, () => {}, startHandle);
const wallMs = Date.now() - t0;

console.log(`score: ${result.score}  depth: ${result.stats.maxDepthReached}  nodes: ${result.stats.nodesExplored}  wallMs: ${wallMs}`);
console.log(`scoreBreakdown: ${JSON.stringify(result.scoreBreakdown, null, 2)}\n`);

const peakFs = result.stats.diagnostic?.bestTurn1FieldState as undefined | { zones: Record<string, { cardId: number; cardName?: string; position?: string }[]> };
const expected = hand.expectedBoard ?? [];

console.log('━━━ EXPECTED BOARD ━━━');
for (const e of expected) console.log(`  ${e.zone} ${e.cardId} ${e.cardName} (${e.position ?? '?'})`);

console.log('\n━━━ PEAK BOARD ━━━');
if (peakFs) {
  for (const [zone, cards] of Object.entries(peakFs.zones)) {
    if (!cards || cards.length === 0) continue;
    for (const c of cards) {
      if (!c || !c.cardId) continue;
      const hit = expected.some(e => e.cardId === c.cardId) ? ' ← MATCHES expected' : '';
      console.log(`  ${zone} ${c.cardId} ${c.cardName ?? '?'} (${c.position ?? '?'})${hit}`);
    }
  }
} else {
  console.log('  <no peak field state>');
}

console.log('\n━━━ MAIN PATH (actions) ━━━');
if (result.mainPath && result.mainPath.length > 0) {
  for (const a of result.mainPath) {
    console.log(`  rIdx=${a.responseIndex}  cid=${a.cardId}  ${a.cardName ?? '?'}  — ${a.actionDescription ?? ''}`);
  }
} else {
  console.log('  <empty mainPath>');
}

console.log('\n━━━ INTERRUPTION TAGS APPLIED ━━━');
// Scan peak board cards against interruption tags to see which contribute
const allTags = allConfigs.interruptionTags;
const fieldCardIds = new Set<number>();
if (peakFs) {
  for (const cards of Object.values(peakFs.zones)) {
    for (const c of cards ?? []) if (c?.cardId) fieldCardIds.add(c.cardId);
  }
}
let totalTagContribution = 0;
for (const id of fieldCardIds) {
  const tag = allTags.byCardId?.get(id);
  if (tag) {
    const primaryUse = tag.uses?.[0];
    const weight = primaryUse?.category ? (allConfigs.interruptionWeights as unknown as Record<string, number>)[primaryUse.category] ?? 0 : 0;
    console.log(`  ${id} ${tag.cardName ?? '?'}: uses=${tag.uses?.length ?? 0}, primary.category=${primaryUse?.category ?? '?'}, weight=${weight}`);
    totalTagContribution += weight;
  }
}
console.log(`  (rough tag contribution sum: ${totalTagContribution})`);

adapter.destroyAll();
process.exit(0);
