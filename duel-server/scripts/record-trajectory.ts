// =============================================================================
// record-trajectory.ts — derive a bit-exact trajectory from a cardId hint.
//
// Takes a "canonical path hint" JSON (author-produced, terse — just an
// ordered list of cardIds representing the combo's key decisions) and runs
// the DFS with `SolverConfig.canonicalPath` set. At each decision point, the
// DFS force-picks the option whose cardId matches the next entry in the
// hint. The resulting `mainPath` is dumped as a full trajectory JSON
// (`SolverAction[]`) that `scripts/replay-trajectory.ts` can rehydrate and
// verify bit-exactly.
//
// Hint JSON format (input):
//   {
//     "fixtureId":       "ryzeal-mitsurugi-opener",
//     "description":     "1-card Habakiri → Futsu + Photon Lord",
//     "canonicalPath":   [13332685, 55397172, 45171524, ...]
//   }
//
// Trajectory JSON format (output):
//   {
//     "fixtureId":         "ryzeal-mitsurugi-opener",
//     "description":       "...",
//     "canonicalPathHint": [13332685, ...],
//     "steps": [
//       { "responseIndex": N, "cardId": X, "cardName": "...",
//         "actionDescription": "..." },
//       ...
//     ]
//   }
//
// Usage:
//   cd duel-server
//   SOLVER_INSTRUMENT=1 npx tsx scripts/record-trajectory.ts \
//     --hint=../_bmad-output/planning-artifacts/research/trajectories/ryzeal-mitsurugi-hint.json \
//     --out=data/trajectories/ryzeal-mitsurugi-opener.json \
//     --node-budget=800
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  type FixtureFile,
  type HandFixture,
} from './evaluate-structural.js';
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

interface HintFile {
  fixtureId: string;
  description?: string;
  canonicalPath: number[];
  /** Anti-pins: cardIds the DFS must never pick. Blocks scorer-exploited
   *  detours (e.g., Mitsurugi Mirror tributing the canonical ritual
   *  target). Forwarded to `SolverConfig.bannedCardIds`. */
  bannedCardIds?: number[];
}

interface TrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
}

interface TrajectoryFile {
  fixtureId: string;
  description: string;
  canonicalPathHint: number[];
  bannedCardIdsHint?: number[];
  steps: TrajectoryStep[];
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

function findHand(fixture: FixtureFile, id: string): HandFixture {
  const hand = fixture.hands.find(h => h.id === id);
  if (!hand) throw new Error(`[record] fixture '${id}' not found`);
  if (hand._draft === true) throw new Error(`[record] fixture '${id}' is marked _draft`);
  return hand;
}

async function main(): Promise<void> {
  const hintPath = parseStringArg('hint');
  const outPath = parseStringArg('out');
  const nodeBudget = parseNumArg('node-budget') ?? 800;
  const budgetMs = parseNumArg('budget-ms') ?? 3600000;
  if (!hintPath || !outPath) {
    console.error('[record] --hint=<path> and --out=<path> required');
    process.exit(2);
  }

  const hint = JSON.parse(readFileSync(resolve(hintPath), 'utf-8')) as HintFile;
  if (!hint.fixtureId || !Array.isArray(hint.canonicalPath) || hint.canonicalPath.length === 0) {
    throw new Error(`[record] hint must have fixtureId + non-empty canonicalPath`);
  }

  const fixture = loadFixtureFile();
  const hand = findHand(fixture, hint.fixtureId);
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`[record] deck '${hand.deck}' not found`);

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  try {
    const mainDeck = [...deck.main];
    for (const cid of hand.hand) {
      const idx = mainDeck.indexOf(cid);
      if (idx === -1) throw new Error(`[record] hand card ${cid} not in main deck`);
      mainDeck.splice(idx, 1);
    }
    const duelConfig: DuelConfig = {
      mainDeck,
      extraDeck: deck.extra,
      hand: hand.hand,
      deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
      opponentDeck: [],
      startingDrawCount: 0,
      drawCountPerTurn: 1,
      preferredSearchTargets: [
        ...(hand.expectedBoard ?? []).map(e => e.cardId),
        ...(hand.preferredIntermediates ?? []),
      ],
    };

    const cardMetadata = buildCardMetadataMap(cardDB, [
      ...deck.main, ...deck.extra, ...hand.hand,
    ]);
    const scorer = new InterruptionScorer(
      allConfigs.interruptionTags,
      allConfigs.interruptionWeights,
      cardMetadata,
      allConfigs.structuralWeights,
      allConfigs.structuralTutorCards,
    );
    const ranker = new GoldfishChainRanker(allConfigs.interruptionTags);

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
    const signal = AbortSignal.timeout(budgetMs + 5000);
    const solverConfig: SolverConfig = {
      mode: 'goldfish',
      speed: 'optimal',
      timeLimitMs: budgetMs,
      rootChildBudgetNodes: nodeBudget,
      canonicalPath: hint.canonicalPath,
      bannedCardIds: hint.bannedCardIds && hint.bannedCardIds.length > 0
        ? hint.bannedCardIds
        : undefined,
    };

    const banSuffix = hint.bannedCardIds && hint.bannedCardIds.length > 0
      ? `  bans=[${hint.bannedCardIds.join(',')}]`
      : '';
    console.log(`[record] fixture=${hint.fixtureId}  hint-len=${hint.canonicalPath.length}  nb=${nodeBudget}${banSuffix}`);
    const t0 = Date.now();
    const result = dfs.solve(adapter, solverConfig, signal, () => {}, startHandle);
    const wallMs = Date.now() - t0;
    console.log(`[record] DFS done  score=${result.score}  mainPath-len=${result.mainPath.length}  wallMs=${wallMs}`);

    if (result.mainPath.length === 0) {
      throw new Error(`[record] DFS produced empty mainPath — no turn<=1 state was ever reached`);
    }

    const steps: TrajectoryStep[] = result.mainPath.map(a => ({
      responseIndex: a.responseIndex,
      cardId: a.cardId,
      cardName: a.cardName,
      actionDescription: a.actionDescription,
    }));

    const traj: TrajectoryFile = {
      fixtureId: hint.fixtureId,
      description: hint.description ?? '',
      canonicalPathHint: hint.canonicalPath,
      ...(hint.bannedCardIds && hint.bannedCardIds.length > 0
        ? { bannedCardIdsHint: hint.bannedCardIds }
        : {}),
      steps,
    };

    const absOut = resolve(outPath);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, JSON.stringify(traj, null, 2) + '\n', 'utf-8');
    console.log(`[record] wrote ${absOut}`);

    // Emit a summary to help validate: show first 5 and last 5 steps.
    const preview = steps.length <= 10
      ? steps
      : [...steps.slice(0, 5), { responseIndex: -1, cardId: -1, cardName: '…', actionDescription: `…${steps.length - 10} more…` }, ...steps.slice(-5)];
    for (const s of preview) console.log(`  step rIdx=${s.responseIndex} cid=${s.cardId} ${s.cardName} — ${s.actionDescription}`);
  } finally {
    adapter.destroyAll();
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[record] FATAL:', err);
  process.exit(1);
});
