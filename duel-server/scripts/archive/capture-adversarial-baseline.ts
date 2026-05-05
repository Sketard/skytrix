// =============================================================================
// capture-adversarial-baseline.ts — Phase 1 baseline capture for the
// OpponentBranchingOracle code path (handtrap adversarial mode).
//
// Reproduces the same setup as adversarial-fixes-smoke-test.ts (Alexandrite x40
// vanilla deck + 3 handtraps from data/handtraps.json + seed [42, 137]) and
// dumps the solver result so Phase 3 can diff bit-exactly after the
// PromptResolver refactor migrates the OpponentBranchingOracle path.
//
// The Alexandrite fixture is intentionally weak — it doesn't measure performance,
// it only exercises the opponent SELECT_CHAIN branching path. That branch is
// dormant in production fixtures (combo simulator currently goldfishes) but
// will be re-activated when the combo-vs-handtrap feature ships.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/capture-adversarial-baseline.ts \
//     --out=../_bmad-output/solver-data/phase-1-baselines/adversarial-alexandrite.json
// =============================================================================

import { join, resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { GoldfishChainRanker } from '../../src/solver/goldfish-chain-ranker.js';
import { MinimaxMctsSolver } from '../../src/solver/minimax-mcts-solver.js';
import { InterruptionScorer } from '../../src/solver/interruption-scorer.js';
import {
  loadInterruptionTags,
  loadInterruptionWeights,
  loadSolverConfig,
  loadHandtraps,
} from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import type { SolverConfig } from '../../src/solver/solver-types.js';

function pickArg(name: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

const outArg = pickArg('out');
if (!outArg) {
  console.error('Usage: --out=<path.json>');
  process.exit(2);
}

const DATA_DIR = join(import.meta.dirname!, '..', '..', '..', 'data');
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const tags = loadInterruptionTags(DATA_DIR);
const weights = loadInterruptionWeights(DATA_DIR);
const solverConfig = loadSolverConfig(DATA_DIR);
const adapter = await OCGCoreAdapter.create(cardDB, scripts, tags);
const scorer = new InterruptionScorer(tags, weights);
const ranker = new GoldfishChainRanker();
const handtraps = loadHandtraps(DATA_DIR);

if (handtraps.length === 0) {
  console.error('No handtraps in data/handtraps.json');
  process.exit(1);
}

const testHandtraps = handtraps.slice(0, 3);
const ALEXANDRITE = 43096270;
const testDeck = Array(40).fill(ALEXANDRITE);
const testHand = Array(5).fill(ALEXANDRITE);

const solver = new MinimaxMctsSolver(scorer, adapter, ranker, solverConfig);
solver.setSeed([42n, 137n]);

const config: SolverConfig = {
  mode: 'adversarial',
  speed: 'fast',
  timeLimitMs: 3000,
  handtraps: testHandtraps,
};

const handle = adapter.createDuel({
  mainDeck: testDeck,
  extraDeck: [],
  hand: testHand,
  deckSeed: [42n, 137n],
  opponentDeck: Array(40).fill(ALEXANDRITE),
  handtraps: testHandtraps,
});

let result;
try {
  const signal = AbortSignal.timeout(config.timeLimitMs);
  result = solver.solve(adapter, config, signal, () => {}, handle);
} finally {
  adapter.destroyAll();
}

const baseline = {
  fixture: 'adversarial-alexandrite',
  setup: {
    handtraps: testHandtraps,
    deckCardId: ALEXANDRITE,
    deckSize: testDeck.length,
    handSize: testHand.length,
    seed: ['42', '137'],
    config: { mode: config.mode, speed: config.speed, timeLimitMs: config.timeLimitMs },
  },
  result: {
    mainPathHash: result.mainPath.length,
    mainPath: result.mainPath.map(a => ({
      promptType: a.promptType,
      cardId: a.cardId,
      responseIndex: a.responseIndex,
      actionVerb: a.actionVerb ?? null,
      sourceZone: a.sourceZone ?? null,
      team: a.team ?? 0,
      isExploratory: a.isExploratory ?? false,
    })),
    score: result.score,
    nodesExplored: result.stats?.nodesExplored ?? null,
    divergence: result.divergence ?? null,
  },
};

const abs = resolve(outArg);
mkdirSync(dirname(abs), { recursive: true });
writeFileSync(abs, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
console.log(`[adversarial] wrote ${abs}`);
console.log(`  mainPath length=${result.mainPath.length}, score=${result.score}, nodes=${result.stats?.nodesExplored ?? '?'}`);
