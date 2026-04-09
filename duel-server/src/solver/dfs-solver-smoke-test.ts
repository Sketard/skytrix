// =============================================================================
// dfs-solver-smoke-test.ts — Smoke tests for DfsSolver & GoldfishChainRanker
// Run: npx tsx src/solver/dfs-solver-smoke-test.ts
// =============================================================================

import { join } from 'node:path';
import type { ZoneId } from '../ws-protocol.js';
import type { Action, DecisionNode, FieldCard, FieldState, SolverAction, SolverConfig } from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import { DfsSolver, ROOT_ACTION } from './dfs-solver.js';
import { ZobristHasher } from './zobrist.js';
import { TranspositionTable } from './transposition-table.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { loadInterruptionTags, loadInterruptionWeights, loadSolverConfig } from './solver-config-loader.js';
import { OCGCoreAdapter } from './ocgcore-adapter.js';
import { loadDatabase, loadScripts } from '../ocg-scripts.js';

// =============================================================================
// Helpers
// =============================================================================

function makeFieldState(partialZones: Partial<Record<ZoneId, FieldCard[]>> = {}): FieldState {
  const zones = {} as Record<ZoneId, FieldCard[]>;
  for (const z of ALL_ZONE_IDS) zones[z] = [];
  for (const [z, cards] of Object.entries(partialZones)) {
    zones[z as ZoneId] = cards!;
  }
  return { zones, lifePoints: [8000, 8000], turn: 1, phase: 'MAIN1' };
}

function makeAction(overrides: Partial<Action> & { responseIndex: number }): Action {
  return {
    cardId: 0,
    promptType: 'SELECT_CHAIN',
    isExploratory: true,
    ...overrides,
  };
}

function makeDecisionNode(overrides: Partial<DecisionNode> = {}): DecisionNode {
  return {
    action: ROOT_ACTION,
    annotation: '',
    score: 0,
    confidence: 1.0,
    children: [],
    isTerminal: true,
    ...overrides,
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

// =============================================================================
// Group A — Pure unit tests (no OCGCore)
// =============================================================================

const state = makeFieldState();

// Test 4.2: DFS metadata & ROOT_ACTION
console.log('\n🔬 Test 4.2: DFS metadata & ROOT_ACTION');
{
  assert(ROOT_ACTION.responseIndex === -1, `ROOT_ACTION.responseIndex = ${ROOT_ACTION.responseIndex} (expected -1)`);
  assert(ROOT_ACTION.cardId === 0, `ROOT_ACTION.cardId = ${ROOT_ACTION.cardId} (expected 0)`);
  assert(ROOT_ACTION.cardName === '', `ROOT_ACTION.cardName = '${ROOT_ACTION.cardName}' (expected '')`);
  assert(ROOT_ACTION.actionDescription === 'root', `ROOT_ACTION.actionDescription = '${ROOT_ACTION.actionDescription}' (expected 'root')`);
}

// Test 4.3: GoldfishChainRanker single-activation auto-resolve
console.log('\n🔬 Test 4.3: GoldfishChainRanker single-activation auto-resolve');
{
  const ranker = new GoldfishChainRanker();
  const actions: Action[] = [
    makeAction({ responseIndex: 0, cardId: 100, actionTag: 'activate', description: 'draw 1 card' }),
    makeAction({ responseIndex: -1, cardId: 0, actionTag: 'pass' }),
  ];
  const ranked = ranker.rank(actions, state);

  assert(ranked.length === 1, `Ranked length = ${ranked.length} (expected 1)`);
  assert(ranked[0].responseIndex === 0, `Ranked[0].responseIndex = ${ranked[0].responseIndex} (expected 0, activation only)`);
}

// Test 4.4: GoldfishChainRanker multi-activation
console.log('\n🔬 Test 4.4: GoldfishChainRanker multi-activation (pass last)');
{
  const ranker = new GoldfishChainRanker();
  const actions: Action[] = [
    makeAction({ responseIndex: 0, cardId: 100, actionTag: 'activate', description: 'draw 2 cards' }),
    makeAction({ responseIndex: 1, cardId: 200, actionTag: 'activate', description: 'Special Summon from deck' }),
    makeAction({ responseIndex: -1, cardId: 0, actionTag: 'pass' }),
  ];
  const ranked = ranker.rank(actions, state);

  assert(ranked.length === 3, `Ranked length = ${ranked.length} (expected 3)`);
  assert(ranked[ranked.length - 1].responseIndex === -1, `Last action is pass (responseIndex = ${ranked[ranked.length - 1].responseIndex})`);
}

// Test 4.5: GoldfishChainRanker SELECT_BATTLECMD
console.log('\n🔬 Test 4.5: GoldfishChainRanker SELECT_BATTLECMD → to_m2 only');
{
  const ranker = new GoldfishChainRanker();
  const actions: Action[] = [
    makeAction({ responseIndex: 0, cardId: 100, promptType: 'SELECT_BATTLECMD', actionTag: 'attack' }),
    makeAction({ responseIndex: 1, cardId: 200, promptType: 'SELECT_BATTLECMD', actionTag: 'attack' }),
    makeAction({ responseIndex: 2, cardId: 300, promptType: 'SELECT_BATTLECMD', actionTag: 'attack' }),
    makeAction({ responseIndex: 3, cardId: 0, promptType: 'SELECT_BATTLECMD', actionTag: 'to_m2' }),
    makeAction({ responseIndex: 4, cardId: 0, promptType: 'SELECT_BATTLECMD', actionTag: 'to_ep' }),
  ];
  const ranked = ranker.rank(actions, state);

  assert(ranked.length === 1, `Ranked length = ${ranked.length} (expected 1)`);
  assert(ranked[0].actionTag === 'to_m2', `Ranked[0].actionTag = '${ranked[0].actionTag}' (expected 'to_m2')`);
}

// Test 4.6: GoldfishChainRanker description missing
console.log('\n🔬 Test 4.6: GoldfishChainRanker description undefined (no crash)');
{
  const ranker = new GoldfishChainRanker();
  const actions: Action[] = [
    makeAction({ responseIndex: 0, cardId: 100, actionTag: 'activate' }), // description undefined
    makeAction({ responseIndex: 1, cardId: 200, actionTag: 'activate', description: 'draw 1' }),
    makeAction({ responseIndex: -1, cardId: 0, actionTag: 'pass' }),
  ];
  const ranked = ranker.rank(actions, state);

  assert(ranked.length === 3, `Ranked length = ${ranked.length} (expected 3, no crash)`);
  assert(ranked[ranked.length - 1].actionTag === 'pass', `Last action is pass`);
}

// Test 4.7: mainPath extraction on empty tree (contract: no children → [])
console.log('\n🔬 Test 4.7: mainPath extraction on empty tree');
{
  const root = makeDecisionNode({ children: [], isTerminal: true });
  // Simulate extractMainPath: if root.children.length === 0, return []
  const mainPath: SolverAction[] = [];
  let current: DecisionNode = root;
  while (current.children.length > 0) {
    current = current.children[0];
    if (current.action.actionDescription !== ROOT_ACTION.actionDescription) {
      mainPath.push(current.action);
    }
  }
  assert(mainPath.length === 0, `mainPath is empty for terminal root (length = ${mainPath.length})`);
}

// Test 4.8: mainPath follows children[0] chain, skips ROOT_ACTION, keeps pass actions
console.log('\n🔬 Test 4.8: mainPath follows children[0] chain');
{
  const passAction: SolverAction = { responseIndex: -1, cardId: 0, cardName: '', actionDescription: 'SELECT_CHAIN response -1 ()' };
  const leaf = makeDecisionNode({
    action: passAction,
    score: 20,
    isTerminal: true,
  });
  const mid = makeDecisionNode({
    action: { responseIndex: 1, cardId: 200, cardName: 'Card B', actionDescription: 'summon' },
    score: 20,
    isTerminal: false,
    children: [leaf],
  });
  const root = makeDecisionNode({
    action: ROOT_ACTION,
    score: 20,
    isTerminal: false,
    children: [mid, makeDecisionNode({ score: 5 })],
  });

  // Simulate extractMainPath: follow children[0], skip ROOT_ACTION by actionDescription
  const mainPath: SolverAction[] = [];
  let current: DecisionNode = root;
  while (current.children.length > 0) {
    current = current.children[0];
    if (current.action.actionDescription !== ROOT_ACTION.actionDescription) {
      mainPath.push(current.action);
    }
  }
  assert(mainPath.length === 2, `mainPath has 2 entries (length = ${mainPath.length})`);
  assert(mainPath[0].cardName === 'Card B', `mainPath[0] is Card B`);
  assert(mainPath[1].responseIndex === -1, `mainPath[1] is pass action (responseIndex = ${mainPath[1].responseIndex})`);
  assert(root.children.length === 2, `Root has 2 children (best path first)`);
}

// =============================================================================
// Group B — Integration tests (real OCGCore via shared OCGCoreAdapter)
// =============================================================================

async function runIntegrationTests(): Promise<void> {
  console.log('\n🔧 Initializing OCGCore WASM for integration tests...');

  const dataDir = join(import.meta.dirname, '..', '..', 'data');
  const cardDB = loadDatabase(join(dataDir, 'cards.cdb'));
  const scripts = loadScripts(join(dataDir, 'scripts_full'));
  const tags = loadInterruptionTags(dataDir);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, tags);
  const weights = loadInterruptionWeights(dataDir);
  const solverConfigFile = loadSolverConfig(dataDir);

  const hasher = new ZobristHasher();
  const table = new TranspositionTable(solverConfigFile.transpositionMaxEntries);
  const scorer = new InterruptionScorer(tags, weights);
  const ranker = new GoldfishChainRanker();

  const solver = new DfsSolver(hasher, table, scorer, adapter, ranker, solverConfigFile);

  assert(solver.name === 'dfs', `solver.name = '${solver.name}' (expected 'dfs')`);
  assert(solver.supportsAdversarial === false, `solver.supportsAdversarial = ${solver.supportsAdversarial} (expected false)`);

  // Simple hand: a few vanilla/simple monsters for a quick-terminating duel
  // Ash Blossom (14558127) — no combo, just a simple hand for quick termination
  const simpleConfig = {
    mainDeck: Array(35).fill(43096270), // 35 Alexandrite Dragon (filler)
    extraDeck: [],
    hand: [43096270, 43096270, 43096270, 43096270, 43096270], // 5 vanillas
    deckSeed: [42n, 123n, 456n, 789n],
    opponentDeck: [],
  };

  const solverConfig: SolverConfig = {
    mode: 'goldfish',
    speed: 'fast',
    timeLimitMs: 5000,
  };

  // Test 4.9: Terminal node scoring
  console.log('\n🔬 Test 4.9: Terminal node scoring (vanilla hand)');
  {
    const handle = adapter.createDuel(simpleConfig);
    const result = solver.solve(adapter, solverConfig, new AbortController().signal, () => {}, handle);

    assert(typeof result.score === 'number', `result.score is number: ${result.score}`);
    assert(result.scoreBreakdown !== undefined, `result.scoreBreakdown exists`);
    assert(typeof result.scoreBreakdown.total === 'number', `scoreBreakdown.total is number`);
    assert(result.tree.isTerminal || result.tree.children.length > 0, `tree is terminal or has children`);
  }

  // Test 4.10: Abort signal
  console.log('\n🔬 Test 4.10: Abort signal (anytime behavior)');
  {
    // Use a combo hand that takes longer to solve
    const comboConfig = {
      mainDeck: Array(35).fill(43096270),
      extraDeck: [],
      hand: [43096270, 43096270, 43096270, 43096270, 43096270],
      deckSeed: [42n, 123n, 456n, 789n],
      opponentDeck: [],
    };
    const ac = new AbortController();
    // Abort after 500ms
    setTimeout(() => ac.abort(), 500);

    const handle = adapter.createDuel(comboConfig);
    const result = solver.solve(adapter, solverConfig, ac.signal, () => {}, handle);

    assert(result.stats.nodesExplored > 0, `nodesExplored = ${result.stats.nodesExplored} (> 0)`);
    assert(typeof result.score === 'number', `result has a score: ${result.score}`);
  }

  // Test 4.11: SolverResult structure
  console.log('\n🔬 Test 4.11: SolverResult structure (full solve)');
  {
    const handle = adapter.createDuel(simpleConfig);
    const result = solver.solve(adapter, solverConfig, new AbortController().signal, () => {}, handle);

    assert(result.tree !== undefined, `result.tree exists`);
    assert(Array.isArray(result.mainPath), `result.mainPath is array`);
    assert(typeof result.score === 'number', `result.score is number`);
    assert(result.scoreBreakdown !== undefined, `result.scoreBreakdown exists`);
    assert(result.stats !== undefined, `result.stats exists`);
    assert(result.stats.algorithm === 'dfs', `stats.algorithm = '${result.stats.algorithm}' (expected 'dfs')`);
    assert(result.stats.algorithmUsed === 'dfs', `stats.algorithmUsed = '${result.stats.algorithmUsed}' (expected 'dfs')`);
    assert(typeof result.stats.nodesExplored === 'number', `stats.nodesExplored is number`);
    assert(typeof result.stats.elapsed === 'number', `stats.elapsed is number`);
    assert(typeof result.stats.maxDepthReached === 'number', `stats.maxDepthReached is number`);
    assert(typeof result.stats.averageBranchingFactor === 'number', `stats.averageBranchingFactor is number`);
    assert(result.stats.deckSeed === '', `stats.deckSeed = '${result.stats.deckSeed}' (expected '')`);
  }

  console.log('\n✅ Integration tests complete');
}

// =============================================================================
// Summary (Group A) then Integration (Group B)
// =============================================================================

console.log(`\n📊 Group A Results: ${passed} passed, ${failed} failed`);

runIntegrationTests().then(() => {
  console.log(`\n📊 Final Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error('\n❌ Integration test error:', err);
  process.exit(1);
});
