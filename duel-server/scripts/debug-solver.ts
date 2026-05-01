// =============================================================================
// debug-solver.ts — One-shot debugging script for MCTS / DFS solver issues
// Usage: npx tsx scripts/debug-solver.ts [dfs|mcts]
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { MCTSSolver } from '../src/solver/mcts-solver.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import type { DuelConfig, SolverConfig } from '../src/solver/solver-types.js';

const algo = (process.argv[2] ?? 'mcts') as 'dfs' | 'mcts';
const TIME_MS = 10000;

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const HANDS_PATH = resolve(import.meta.dirname!, '..', '..', '_bmad-output', 'planning-artifacts', 'research', 'mcts-calibration-hands.json');

console.log(`[Debug] Booting (algo=${algo})...`);
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
const scorer = new InterruptionScorer(allConfigs.interruptionTags, allConfigs.interruptionWeights);
const ranker = new GoldfishChainRanker();
console.log('[Debug] Boot complete\n');

interface CalibFile {
  decks: Record<string, { main: number[]; extra: number[] }>;
  hands: { id: string; deck: string; hand: number[]; deckSeed: string }[];
}
const calib = JSON.parse(readFileSync(HANDS_PATH, 'utf-8')) as CalibFile;

// Take first hand only — branded-fusion-opener
const hand = calib.hands[0];
const deck = calib.decks[hand.deck];
const mainDeck = [...deck.main];
for (const cardId of hand.hand) {
  const idx = mainDeck.indexOf(cardId);
  if (idx === -1) throw new Error(`Hand card ${cardId} not in deck`);
  mainDeck.splice(idx, 1);
}

const duelConfig: DuelConfig = {
  mainDeck,
  extraDeck: deck.extra,
  hand: hand.hand,
  deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
  opponentDeck: [],
};
const solverConfig: SolverConfig = { mode: 'goldfish', speed: 'fast', timeLimitMs: TIME_MS };

console.log(`[Debug] Hand: ${hand.id}`);
console.log(`[Debug] Hand cardIds: ${hand.hand.join(', ')}`);
console.log(`[Debug] Hand cards:`);
const stmt = cardDB.stmt;
for (const cid of hand.hand) {
  const row = stmt.get(cid) as { name: string } | undefined;
  console.log(`  ${cid} -> ${row?.name ?? '?'}`);
}
console.log('');

// Step 1 — manually inspect the very first SELECT_* prompt the adapter exposes
console.log('[Debug] === Step 1: Inspect first prompt ===');
const handle1 = adapter.createDuel(duelConfig);
const firstActions = adapter.getLegalActions(handle1);
console.log(`[Debug] First prompt: ${firstActions.length} legal actions`);
console.log(`[Debug] Prompt type: ${firstActions[0]?.promptType ?? '(none)'}`);
for (let i = 0; i < Math.min(20, firstActions.length); i++) {
  const a = firstActions[i];
  const cardName = a.cardId ? (stmt.get(a.cardId) as { name?: string } | undefined)?.name ?? '?' : '(no card)';
  console.log(`  [${i}] respIdx=${a.responseIndex} card=${a.cardId} (${cardName}) tag=${a.actionTag ?? '-'} ${a.description ? `desc="${a.description.slice(0, 50)}"` : ''}`);
}
adapter.destroyAll();
console.log('');

// Step 2 — apply the first action and see what state we end up in
console.log('[Debug] === Step 2: Apply first action, see what happens ===');
const handle2 = adapter.createDuel(duelConfig);
const actions2 = adapter.getLegalActions(handle2);
console.log(`[Debug] Initial: ${actions2.length} actions, type=${actions2[0]?.promptType}`);
if (actions2.length > 0) {
  // Pick the first non-pass action (try to summon something)
  const summonAction = actions2.find(a => a.actionTag !== 'pass') ?? actions2[0];
  const cardName = (stmt.get(summonAction.cardId) as { name?: string } | undefined)?.name ?? '?';
  console.log(`[Debug] Applying: respIdx=${summonAction.responseIndex} card=${cardName} tag=${summonAction.actionTag ?? '-'}`);
  adapter.applyAction(handle2, summonAction);

  const after = adapter.getLegalActions(handle2);
  console.log(`[Debug] After: ${after.length} actions, type=${after[0]?.promptType}`);
  for (let i = 0; i < Math.min(10, after.length); i++) {
    const a = after[i];
    const cn = a.cardId ? (stmt.get(a.cardId) as { name?: string } | undefined)?.name ?? '?' : '(no card)';
    console.log(`  [${i}] respIdx=${a.responseIndex} card=${a.cardId} (${cn}) tag=${a.actionTag ?? '-'}`);
  }
}
adapter.destroyAll();
console.log('');

// Step 2.5 — Manually walk the duel for ~10 prompts to see where state diverges
console.log('[Debug] === Step 2.5: Walk 10 prompts manually ===');
const handleW = adapter.createDuel(duelConfig);
for (let step = 0; step < 12; step++) {
  const actions = adapter.getLegalActions(handleW);
  if (actions.length === 0) {
    console.log(`[Debug] step ${step}: NO LEGAL ACTIONS — duel ended`);
    break;
  }
  const promptType = actions[0].promptType;
  const summary = actions.slice(0, 6).map((a, i) => {
    const cn = a.cardId ? (stmt.get(a.cardId) as { name?: string } | undefined)?.name?.slice(0, 20) ?? '?' : '_';
    return `[${i}]${a.responseIndex}/${cn}/${a.actionTag ?? '-'}`;
  }).join(' ');
  console.log(`[Debug] step ${step}: prompt=${promptType} count=${actions.length} -> ${summary}${actions.length > 6 ? ' ...' : ''}`);

  // Pick first non-pass action
  const pick = actions.find(a => a.actionTag !== 'pass') ?? actions[0];
  const cn = pick.cardId ? (stmt.get(pick.cardId) as { name?: string } | undefined)?.name ?? '?' : '_';
  console.log(`[Debug]   apply: respIdx=${pick.responseIndex} ${cn}`);
  try {
    adapter.applyAction(handleW, pick);
  } catch (err) {
    console.log(`[Debug]   ERROR: ${String(err)}`);
    break;
  }
}
adapter.destroyAll();
console.log('');

// Step 3 — Run the actual solver and capture stats
console.log(`[Debug] === Step 3: Run ${algo.toUpperCase()} solver for ${TIME_MS}ms ===`);
const startHandle = adapter.createDuel(duelConfig);
const signal = AbortSignal.timeout(TIME_MS + 2000);
const t0 = Date.now();
let result;
if (algo === 'dfs') {
  const hasher = new ZobristHasher();
  const table = new TranspositionTable(allConfigs.solverConfig.transpositionMaxEntries);
  const dfs = new DfsSolver(hasher, table, scorer, adapter, ranker, allConfigs.solverConfig);
  result = dfs.solve(adapter, solverConfig, signal, () => {}, startHandle);
} else {
  const mcts = new MCTSSolver(scorer, adapter, ranker, allConfigs.solverConfig);
  mcts.setSeed(duelConfig.deckSeed);
  result = mcts.solve(adapter, solverConfig, signal, () => {}, startHandle);
}
const elapsed = Date.now() - t0;

console.log(`[Debug] Elapsed: ${elapsed}ms`);
console.log(`[Debug] score=${result.score}, nodes=${result.stats.nodesExplored}, maxDepth=${result.stats.maxDepthReached}, bf=${result.stats.averageBranchingFactor.toFixed(2)}`);
console.log(`[Debug] mainPath length: ${result.mainPath.length}`);
console.log(`[Debug] mainPath first 10:`);
for (let i = 0; i < Math.min(10, result.mainPath.length); i++) {
  const a = result.mainPath[i];
  console.log(`  [${i}] ${a.cardName} (${a.cardId}) respIdx=${a.responseIndex} desc="${a.actionDescription}"`);
}
console.log(`[Debug] endBoard cards: ${result.endBoardCards?.length ?? 0}`);
for (const c of result.endBoardCards ?? []) {
  console.log(`  ${c.cardName} (${c.zone}) effects=${c.effects.length} fallback=${c.isFallback}`);
}

adapter.destroyAll();
process.exit(0);
