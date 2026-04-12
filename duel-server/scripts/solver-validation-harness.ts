// =============================================================================
// solver-validation-harness.ts — Observation harness for the Combo Path Solver
//
// Runs the solver against curated meta decklists (Mitsurugi Ryzeal, Branded
// Dracotail, D/D/D) and prints structured stats leveraging the new Phase A/B
// instrumentation: truncated flag, termination reason, depth cap, max BF,
// transposition hit rate, compacted depth histogram.
//
// NOT a smoke test — no pass/fail. This is an exploration tool for grounding
// algorithm improvements (iterative deepening, move ordering, MCTS cache) in
// real combo deck behaviour, and later for capturing golden endBoards.
//
// Usage:
//   npx tsx scripts/solver-validation-harness.ts                    # all hands, dfs+mcts fast
//   npx tsx scripts/solver-validation-harness.ts --hand=ddd-pendulum-opener
//   npx tsx scripts/solver-validation-harness.ts --algo=dfs
//   npx tsx scripts/solver-validation-harness.ts --speed=optimal
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs, loadSolverConfig } from '../src/solver/solver-config-loader.js';
import { SolverOrchestrator } from '../src/solver/solver-orchestrator.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import type {
  DuelConfig,
  SolverConfig,
  SolverResult,
  SolverStats,
  EndBoardCard,
} from '../src/solver/solver-types.js';

// =============================================================================
// Types mirroring the fixture file shape
// =============================================================================

interface FixtureFile {
  _meta: unknown;
  decks: Record<string, { main: number[]; extra: number[]; side?: number[] }>;
  hands: {
    id: string;
    deck: string;
    description: string;
    hand: number[];
    deckSeed: string;
  }[];
}

// =============================================================================
// CLI parsing
// =============================================================================

interface CliOpts {
  handFilter?: string;
  algos: ('dfs' | 'mcts')[];
  speed: 'fast' | 'optimal';
  /** When set, skip the orchestrator and instead boot the adapter directly,
   *  walking N IDLECMD prompts while dumping every legal action + the pick.
   *  Diagnostic tool — answers "what does OCGCore actually expose for this
   *  hand?" without the DFS/MCTS/ranker layers on top. */
  adapterWalkSteps?: number;
  /** Adapter-walk picking strategy:
   *   - 'meaningful' (default): first non-pass, non-phase-transition action
   *   - 'pass'                : always pass/phase-transition (observe how
   *                             OCGCore progresses through phases untouched) */
  adapterWalkStrategy?: 'meaningful' | 'pass';
  /** Re-fork the handle at every step to mirror what DFS does. Useful for
   *  detecting fork-via-replay divergence: if the direct walk reaches step N
   *  but the fork-every-step walk terminates earlier, replay is broken. */
  adapterWalkFork?: boolean;
}

function parseCli(argv: string[]): CliOpts {
  const opts: CliOpts = { algos: ['dfs', 'mcts'], speed: 'fast' };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--hand=')) opts.handFilter = arg.slice(7);
    else if (arg === '--algo=dfs') opts.algos = ['dfs'];
    else if (arg === '--algo=mcts') opts.algos = ['mcts'];
    else if (arg === '--algo=both') opts.algos = ['dfs', 'mcts'];
    else if (arg === '--speed=fast') opts.speed = 'fast';
    else if (arg === '--speed=optimal') opts.speed = 'optimal';
    else if (arg.startsWith('--adapter-walk=')) opts.adapterWalkSteps = Number(arg.slice(15));
    else if (arg === '--adapter-walk-strategy=pass') opts.adapterWalkStrategy = 'pass';
    else if (arg === '--adapter-walk-strategy=meaningful') opts.adapterWalkStrategy = 'meaningful';
    else if (arg === '--adapter-walk-fork') opts.adapterWalkFork = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx scripts/solver-validation-harness.ts [--hand=ID] [--algo=dfs|mcts|both] [--speed=fast|optimal] [--adapter-walk=N]');
      process.exit(0);
    } else {
      console.error(`[Harness] Unknown arg: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

// =============================================================================
// Formatting helpers
// =============================================================================

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function reasonColor(reason: SolverStats['terminationReason']): string {
  switch (reason) {
    case 'completed': return GREEN;
    case 'timeout': return YELLOW;
    case 'depth_cap': return RED;
    case 'failures': return RED;
    case 'aborted': return DIM;
  }
}

/** Compact a potentially sparse depth histogram into a readable form.
 *  Drops leading and trailing zero buckets, and collapses runs of zeros
 *  in the middle to keep the output under ~80 chars even for maxDepth=50. */
function formatHistogram(hist: readonly number[]): string {
  if (hist.length === 0) return '[]';
  let first = 0, last = hist.length - 1;
  while (first < hist.length && hist[first] === 0) first++;
  while (last >= 0 && hist[last] === 0) last--;
  if (first > last) return '[all-zero]';
  const slice = hist.slice(first, last + 1);
  const total = slice.reduce((a, b) => a + b, 0);
  const max = Math.max(...slice);
  const cells = slice.map(v => {
    if (v === 0) return '·';
    const frac = v / max;
    if (frac > 0.75) return '█';
    if (frac > 0.50) return '▆';
    if (frac > 0.25) return '▄';
    return '▂';
  }).join('');
  return `[d${first}..d${last}] ${cells} Σ=${total} max=${max}`;
}

function pct(n: number, d: number): string {
  if (d === 0) return '   n/a';
  return `${(100 * n / d).toFixed(1).padStart(5)}%`;
}

function formatStats(stats: SolverStats, maxDepthConfig: number): string {
  const lines: string[] = [];
  const budgetFrac = stats.budgetMs > 0 ? stats.elapsed / stats.budgetMs : 0;
  const budgetColor = budgetFrac > 0.95 ? YELLOW : DIM;
  const reasonC = reasonColor(stats.terminationReason);
  const depthStr = `${stats.maxDepthReached}/${maxDepthConfig}`;
  const depthColor = stats.maxDepthReached >= maxDepthConfig ? RED
    : stats.maxDepthReached >= maxDepthConfig * 0.8 ? YELLOW : DIM;

  lines.push(
    `    ${DIM}status${RESET}   ${reasonC}${stats.terminationReason}${RESET}` +
    (stats.truncated ? ` ${RED}truncated${RESET}` : ` ${GREEN}complete${RESET}`) +
    (stats.abortedDueToFailures !== undefined ? ` ${RED}failures=${stats.abortedDueToFailures}${RESET}` : ''),
  );
  lines.push(
    `    ${DIM}budget${RESET}   ${stats.elapsed}ms / ${stats.budgetMs}ms ${budgetColor}(${(budgetFrac * 100).toFixed(0)}%)${RESET}`,
  );
  lines.push(
    `    ${DIM}depth${RESET}    ${depthColor}${depthStr}${RESET}   ` +
    `${DIM}bf${RESET} avg=${stats.averageBranchingFactor.toFixed(2)} max=${stats.maxBranchingFactor}`,
  );
  lines.push(
    `    ${DIM}nodes${RESET}    ${stats.nodesExplored.toLocaleString()}`,
  );

  const hits = stats.transpositionHits ?? 0;
  const misses = stats.transpositionMisses ?? 0;
  const stores = stats.transpositionStores ?? 0;
  const evictions = stats.transpositionEvictions ?? 0;
  const stale = stats.transpositionStaleHits ?? 0;
  const ttTotal = hits + misses;
  if (ttTotal > 0 || stores > 0) {
    lines.push(
      `    ${DIM}TT${RESET}       hit=${hits} miss=${misses} stores=${stores} evict=${evictions} stale=${stale}` +
      `   rate=${pct(hits, ttTotal)}`,
    );
  } else {
    lines.push(`    ${DIM}TT${RESET}       ${DIM}(not used by this algo)${RESET}`);
  }
  lines.push(`    ${DIM}hist${RESET}     ${formatHistogram(stats.depthHistogram)}`);
  return lines.join('\n');
}

function formatEndBoard(cards: EndBoardCard[] | undefined, stmt: { get(id: number): { name?: string } | undefined }): string {
  if (!cards || cards.length === 0) return `    ${DIM}(empty end board)${RESET}`;
  const byZone = new Map<string, string[]>();
  for (const c of cards) {
    const name = c.cardName || (stmt.get(c.cardId) as { name?: string } | undefined)?.name || `#${c.cardId}`;
    const label = c.consumedUses ? `${name} ${DIM}(used:${c.consumedUses})${RESET}` : name;
    let arr = byZone.get(c.zone);
    if (!arr) { arr = []; byZone.set(c.zone, arr); }
    arr.push(label);
  }
  const order = ['MZONE', 'SZONE', 'HAND', 'GY', 'BANISHED', 'DECK', 'EXTRA'];
  const lines: string[] = [];
  for (const zone of order) {
    const arr = byZone.get(zone);
    if (!arr || arr.length === 0) continue;
    lines.push(`    ${DIM}${zone.padEnd(8)}${RESET} ${arr.join(', ')}`);
  }
  for (const [zone, arr] of byZone) {
    if (!order.includes(zone)) lines.push(`    ${DIM}${zone.padEnd(8)}${RESET} ${arr.join(', ')}`);
  }
  return lines.join('\n');
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const opts = parseCli(process.argv);

  const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
  const FIXTURE_PATH = resolve(
    import.meta.dirname!, '..', '..',
    '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
  );

  console.log(`${BOLD}[Harness]${RESET} Loading ${FIXTURE_PATH}`);
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as FixtureFile;

  console.log(`${BOLD}[Harness]${RESET} Boot: card DB + solver config`);
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const solverConfigFile = loadSolverConfig(DATA_DIR);

  // Adapter-walk mode: skip the orchestrator entirely, boot OCGCore directly,
  // and walk a hand step-by-step printing every prompt. Diagnostic for
  // "why is the solver picking pass at depth 3" — if the adapter exposes the
  // expected IDLECMD actions but the solver walks away, the issue is in the
  // DFS/MCTS/ranker layer, not in OCGCore enumeration.
  if (opts.adapterWalkSteps !== undefined) {
    await runAdapterWalk(opts, fixture, cardDB, DATA_DIR, opts.adapterWalkSteps);
    process.exit(0);
  }

  // Piscina needs a .js worker file — source TS is not runnable directly.
  // We build to dist/ and point the orchestrator at the compiled worker so
  // the harness runs through the exact same pipeline as the prod server.
  const compiledWorkerPath = resolve(import.meta.dirname!, '..', 'dist', 'solver', 'solver-worker.js');
  const orchestrator = new SolverOrchestrator();
  await orchestrator.init(solverConfigFile, DATA_DIR, compiledWorkerPath);

  const maxDepthConfig = solverConfigFile.maxDepth;
  const timeLimitMs = opts.speed === 'fast'
    ? solverConfigFile.timeBudgetFastMs
    : solverConfigFile.timeBudgetOptimalMs;

  const hands = opts.handFilter
    ? fixture.hands.filter(h => h.id === opts.handFilter)
    : fixture.hands;

  if (hands.length === 0) {
    console.error(`[Harness] No hands matched filter '${opts.handFilter ?? ''}'`);
    process.exit(1);
  }

  console.log(`${BOLD}[Harness]${RESET} Running ${hands.length} hand(s) × ${opts.algos.length} algo(s) × speed=${opts.speed} (${timeLimitMs}ms each)\n`);

  for (const hand of hands) {
    const deck = fixture.decks[hand.deck];
    if (!deck) {
      console.error(`[Harness] Unknown deck '${hand.deck}' for hand '${hand.id}'`);
      continue;
    }

    // Strip hand cards from the main deck (same pattern as debug-solver.ts)
    const mainDeck = [...deck.main];
    let missing = false;
    for (const cardId of hand.hand) {
      const idx = mainDeck.indexOf(cardId);
      if (idx === -1) {
        console.error(`[Harness] Hand card ${cardId} not in ${hand.deck} main`);
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
    };

    const handCardNames = hand.hand.map(cid => {
      const row = cardDB.stmt.get(cid) as { name?: string } | undefined;
      return row?.name ?? `#${cid}`;
    });

    console.log(`${BOLD}${CYAN}═══ ${hand.id} ═══${RESET}  ${DIM}(${hand.deck})${RESET}`);
    console.log(`  ${DIM}${hand.description}${RESET}`);
    console.log(`  ${DIM}hand:${RESET} ${handCardNames.join(', ')}`);
    console.log('');

    for (const algo of opts.algos) {
      const solverConfig: SolverConfig = {
        mode: 'goldfish',
        speed: opts.speed,
        timeLimitMs,
      };

      const label = `${algo.padEnd(4)} ${opts.speed}`;
      console.log(`  ${BOLD}── ${label} ──${RESET}`);

      const t0 = Date.now();
      try {
        const outcome = await orchestrator.solve(
          `harness-${hand.id}-${algo}`,
          duelConfig,
          solverConfig,
          algo,
          () => { /* swallow progress — final stats carry everything we need */ },
        );

        if (outcome.type === 'error') {
          console.log(`    ${RED}ERROR${RESET} ${outcome.error}: ${outcome.message}`);
        } else if (outcome.type === 'cancelled') {
          console.log(`    ${YELLOW}CANCELLED${RESET}`);
          if (outcome.partialResult) {
            printResult(outcome.partialResult, maxDepthConfig, cardDB.stmt);
          }
        } else {
          printResult(outcome.result, maxDepthConfig, cardDB.stmt);
        }
      } catch (err) {
        console.log(`    ${RED}THROWN${RESET} ${err instanceof Error ? err.message : String(err)}`);
      }
      console.log(`    ${DIM}(wall ${Date.now() - t0}ms)${RESET}\n`);
    }
  }

  console.log(`${BOLD}[Harness]${RESET} Done. Shutting down pool...`);
  // Piscina pool shutdown — the orchestrator doesn't expose it directly, so
  // we rely on process.exit() since we're a one-shot script.
  process.exit(0);
}

function printResult(
  result: SolverResult,
  maxDepthConfig: number,
  stmt: { get(id: number): { name?: string } | undefined },
): void {
  console.log(`    ${DIM}score${RESET}    ${BOLD}${result.score}${RESET}   ${DIM}mainPath${RESET} length=${result.mainPath.length}${result.verified !== undefined ? ` verified=${result.verified}` : ''}${result.minimax !== undefined ? ` minimax=${result.minimax}` : ''}`);
  console.log(formatStats(result.stats, maxDepthConfig));
  console.log(`    ${DIM}endBoard${RESET}`);
  console.log(formatEndBoard(result.endBoardCards, stmt));
}

// =============================================================================
// Adapter Walk — diagnostic tool
// Boots OCGCore directly (no orchestrator, no solver) and walks prompts so we
// can see what the raw engine exposes. When the harness reports "mainPath=2,
// endBoard=empty", this tells us whether OCGCore enumerates the expected
// summon actions or not — i.e. whether the blocker is in the engine itself
// or higher up in the DFS/MCTS/ranker stack.
// =============================================================================

async function runAdapterWalk(
  opts: CliOpts,
  fixture: FixtureFile,
  cardDB: ReturnType<typeof loadDatabase>,
  dataDir: string,
  steps: number,
): Promise<void> {
  const hands = opts.handFilter
    ? fixture.hands.filter(h => h.id === opts.handFilter)
    : [fixture.hands[0]]; // default to first hand if no filter
  if (hands.length === 0) {
    console.error(`[Harness] Adapter-walk: no hand matched '${opts.handFilter ?? ''}'`);
    return;
  }

  console.log(`${BOLD}[Harness]${RESET} Adapter-walk mode — boot OCGCore directly`);
  const scripts = loadScripts(join(dataDir, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(dataDir, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  const nameOf = (id: number): string => {
    if (!id) return '(no card)';
    const row = cardDB.stmt.get(id) as { name?: string } | undefined;
    return row?.name ?? `#${id}`;
  };

  for (const hand of hands) {
    const deck = fixture.decks[hand.deck];
    if (!deck) continue;
    const mainDeck = [...deck.main];
    for (const cid of hand.hand) {
      const idx = mainDeck.indexOf(cid);
      if (idx !== -1) mainDeck.splice(idx, 1);
    }

    const duelConfig: DuelConfig = {
      mainDeck,
      extraDeck: deck.extra,
      hand: hand.hand,
      deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
      opponentDeck: [],
    };

    console.log(`\n${BOLD}${CYAN}═══ ${hand.id} ═══${RESET}`);
    console.log(`  ${DIM}hand:${RESET} ${hand.hand.map(nameOf).join(', ')}\n`);

    let handle = adapter.createDuel(duelConfig);
    try {
      for (let step = 0; step < steps; step++) {
        if (opts.adapterWalkFork && step > 0) {
          // Fork → replaces handle with a freshly-replayed copy to detect
          // divergence between direct play and DFS-style replay.
          const forked = adapter.fork(handle);
          adapter.destroyDuel(handle);
          handle = forked;
        }
        const actions = adapter.getLegalActions(handle);
        if (actions.length === 0) {
          console.log(`  ${YELLOW}[step ${step}] No legal actions → duel terminal${RESET}`);
          break;
        }
        const prompt = actions[0].promptType;
        const state = adapter.getFieldState(handle);
        console.log(`  ${BOLD}[step ${step}]${RESET} prompt=${CYAN}${prompt}${RESET} actions=${actions.length} ${DIM}turn=${state.turn} phase=${state.phase}${RESET}`);
        for (let i = 0; i < Math.min(actions.length, 30); i++) {
          const a = actions[i];
          const tag = a.actionTag ? `${DIM}tag=${a.actionTag}${RESET}` : '';
          const desc = a.description ? ` ${DIM}desc="${a.description.slice(0, 60)}"${RESET}` : '';
          console.log(`      [${String(i).padStart(2)}] respIdx=${a.responseIndex} ${nameOf(a.cardId).padEnd(40)} ${tag}${desc}`);
        }
        if (actions.length > 30) console.log(`      ${DIM}... and ${actions.length - 30} more${RESET}`);

        let picked;
        if (opts.adapterWalkStrategy === 'pass') {
          // Prefer pass → phase transitions → first. "Observe what OCGCore
          // does when the solver never activates anything" — answers the
          // question "does the duel eventually reach a Main Phase IDLECMD?"
          picked = actions.find(a => a.actionTag === 'pass')
            ?? actions.find(a => a.actionTag === 'to_m2')
            ?? actions.find(a => a.actionTag === 'to_ep')
            ?? actions.find(a => a.actionTag === 'to_bp')
            ?? actions[0];
        } else {
          // Default: try to DO something.
          picked = actions.find(a =>
            a.actionTag !== 'to_ep' &&
            a.actionTag !== 'to_m2' &&
            a.actionTag !== 'to_bp' &&
            a.actionTag !== 'pass',
          ) ?? actions[0];
        }
        const pickedName = nameOf(picked.cardId);
        console.log(`      ${GREEN}→ pick [${actions.indexOf(picked)}] ${pickedName} (${picked.actionTag ?? '-'})${RESET}`);
        try {
          adapter.applyAction(handle, picked);
        } catch (err) {
          console.log(`      ${RED}applyAction failed: ${err instanceof Error ? err.message : String(err)}${RESET}`);
          break;
        }
      }

      // Final state dump
      const finalState = adapter.getFieldState(handle);
      console.log(`\n  ${DIM}── final state ──${RESET}`);
      for (const zone of ['MZONE', 'SZONE', 'HAND', 'GY', 'BANISHED'] as const) {
        const cards = finalState.zones[zone];
        if (!cards || cards.length === 0) continue;
        const names = cards.map(c => nameOf(c.cardId));
        console.log(`    ${DIM}${zone.padEnd(8)}${RESET} ${names.join(', ')}`);
      }
      const p0LpZone = finalState.zones['LP0'];
      const p1LpZone = finalState.zones['LP1'];
      console.log(`    ${DIM}LP${RESET}       p0=${p0LpZone?.[0]?.cardId ?? '?'} p1=${p1LpZone?.[0]?.cardId ?? '?'}`);
      console.log(`    ${DIM}turn=${finalState.turn} phase=${finalState.phase}${RESET}`);
    } finally {
      adapter.destroyAll();
    }
  }
}

main().catch(err => {
  console.error('[Harness] fatal:', err);
  process.exit(1);
});
