// =============================================================================
// evaluate-macro-dfs.ts — H1 diagnostic eval (2026-05-03).
//
// Runs the macro-DFS POC standalone (no piscina, no solver-worker) over every
// non-draft fixture in solver-validation-decks.json with G2 enumeration ON
// and DefaultSubPromptPolicy. Honest test: no canonical seeding, no
// preferredSearchTargets leak, no RouteAwareRanker — just compressed entry-
// point enumeration + InterruptionScorer at leaf.
//
// Each fixture boots its own OCGCore handle in-process so the eval is fully
// hermetic vs the production worker pool. WASM Memory is captured once per
// process and re-bound on every fixture (snapshot/restore is per-fixture
// since each fixture creates its own duel handle, and OCGCore's per-duel
// state lives in WASM memory anyway).
//
// Usage:
//   cd duel-server
//   npx tsx scripts/evaluate-macro-dfs.ts \
//     --node-budget=800 --time-budget-ms=12000 \
//     --out=data/eval-macro-dfs/h1-default-g2.json \
//     [--fixture-filter=ddd,branded]
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
} from '@n1xx1/ocgcore-wasm';

import { DATA_DIR, loadFixtureFile, type HandFixture } from './evaluate-structural.js';
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../src/ocg-callbacks.js';
import {
  loadInterruptionTags,
  loadInterruptionWeights,
} from '../src/solver/solver-config-loader.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { queryFieldState } from '../src/solver/ocg-field-query.js';
import {
  DefaultSubPromptPolicy,
  OcgMacroEnumerator,
  runMacroDfs,
  type OcgCoreBridge,
  type MacroDfsResult,
} from '../src/solver/macro-dfs.js';
import type { ActivationLog, FieldState } from '../src/solver/solver-types.js';

// =============================================================================
// CLI
// =============================================================================

function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const outPath = parseArg('out');
if (!outPath) {
  console.error('[eval-macro] required: --out=<path>');
  console.error('  optional: --node-budget=N --time-budget-ms=N --max-depth=N');
  console.error('            --fixture-filter=<comma-substring-list>');
  console.error('            --baseline=<path-to-canonical-eval.json>');
  console.error('            --no-g2  (disable G2 expansion — pre-G2 fallback)');
  process.exit(2);
}
const nodeBudget = Number(parseArg('node-budget') ?? '800');
const timeBudgetMs = Number(parseArg('time-budget-ms') ?? '12000');
const maxDepth = Number(parseArg('max-depth') ?? '50');
const fixtureFilter = parseArg('fixture-filter');
const baselinePath = parseArg('baseline')
  ?? resolve(import.meta.dirname!, '..', '..', '_bmad-output', 'solver-data',
             'phase-1-baselines', 'canonical-eval-v2-2026-05-02.json');
const g2Enabled = !hasFlag('no-g2');
const configMode = g2Enabled
  ? 'macro-dfs-default-policy-G2'
  : 'macro-dfs-default-policy-pre-G2';

// =============================================================================
// Boot — once per process
// =============================================================================

const fixture = loadFixtureFile();
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const tags = loadInterruptionTags(DATA_DIR);
const weights = loadInterruptionWeights(DATA_DIR);

const nameStmt = cardDB.nameStmt;
const nameCache = new Map<number, string>();
function getCardName(id: number): string {
  if (id <= 0) return '';
  const cached = nameCache.get(id);
  if (cached !== undefined) return cached;
  const row = nameStmt.get(id) as { name?: string } | undefined;
  const name = row?.name ?? `#${id}`;
  nameCache.set(id, name);
  return name;
}

// Capture WASM Memory once via instantiate patch — same pattern as
// macro-dfs-poc.ts. The captured Memory is shared by all subsequent duels
// created on the same core (OCGCore reuses the WASM heap).
interface CaptureSlot { memory: WebAssembly.Memory | null }
const slot: CaptureSlot = { memory: null };
const origInstantiate = WebAssembly.instantiate;
const origStreaming = WebAssembly.instantiateStreaming;
WebAssembly.instantiate = function patched(this: unknown, ...args: unknown[]): Promise<unknown> {
  const p = (origInstantiate as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown>;
  return Promise.resolve(p).then((result) => {
    const inst = result instanceof WebAssembly.Instance
      ? result
      : (result as { instance?: WebAssembly.Instance })?.instance;
    if (inst && !slot.memory) {
      for (const exp of Object.values(inst.exports)) {
        if (exp instanceof WebAssembly.Memory) { slot.memory = exp; break; }
      }
    }
    return result;
  });
} as typeof WebAssembly.instantiate;
if (typeof origStreaming === 'function') {
  WebAssembly.instantiateStreaming = function patched(this: unknown, ...args: unknown[]): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
    const p = (origStreaming as (...a: unknown[]) => unknown).apply(this, args) as Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    return Promise.resolve(p).then((result) => {
      if (result?.instance && !slot.memory) {
        for (const exp of Object.values(result.exports ?? result.instance.exports)) {
          if (exp instanceof WebAssembly.Memory) { slot.memory = exp; break; }
        }
      }
      return result;
    });
  } as typeof WebAssembly.instantiateStreaming;
}

const core = await createCore({ sync: true } as never);
WebAssembly.instantiate = origInstantiate;
WebAssembly.instantiateStreaming = origStreaming;

if (!slot.memory) {
  console.error('[eval-macro] failed to capture WASM Memory — snapshot fork unavailable');
  process.exit(3);
}
const wasmMemory = slot.memory;
console.log(`[eval-macro] WASM Memory captured (${wasmMemory.buffer.byteLength} bytes)`);
console.log(`[eval-macro] config: ${configMode}, nodeBudget=${nodeBudget}, timeBudgetMs=${timeBudgetMs}, maxDepth=${maxDepth}`);

const scorer = new InterruptionScorer(tags, weights);

// =============================================================================
// Per-fixture eval
// =============================================================================

interface FixtureEval {
  fixtureId: string;
  deck: string;
  expectedBoardSize: number;
  matched: number;
  score: number;
  matchedCardIds: number[];
  missingCardIds: number[];
  macrosExplored: number;
  promptsTraversed: number;
  promptToMacroRatio: number;
  bestPathLength: number;
  wallTimeMs: number;
  stoppedReason: MacroDfsResult['stoppedReason'];
  policyStats: MacroDfsResult['policyStats'];
  crashed?: boolean;
  errorMsg?: string;
}

const FILLER_CARD = 43096270;

function evalFixture(hand: HandFixture): FixtureEval {
  const deck = fixture.decks[hand.deck];
  if (!deck) {
    return mkCrashEval(hand, `deck ${hand.deck} not found`);
  }

  // Validate hand cards exist in deck — defensive (matches macro-dfs-poc.ts).
  for (const cid of hand.hand) {
    if (!deck.main.includes(cid)) {
      return mkCrashEval(hand, `hand card ${cid} not in deck ${hand.deck}`);
    }
  }

  const seedHex = hand.deckSeed.split(',').map(s => BigInt('0x' + s.trim()));
  while (seedHex.length < 4) seedHex.push(0n);
  const seed: [bigint, bigint, bigint, bigint] = [seedHex[0], seedHex[1], seedHex[2], seedHex[3]];

  // Reorder mainDeck so hand cards land on top (drawn first).
  const handSet = new Set(hand.hand);
  const handPile: number[] = [];
  const restPile: number[] = [];
  for (const code of deck.main) {
    const handDup = hand.hand.filter(h => h === code).length;
    const handPlaced = handPile.filter(c => c === code).length;
    if (handSet.has(code) && handPlaced < handDup) {
      handPile.push(code);
    } else {
      restPile.push(code);
    }
  }
  const mainPushOrder = [...restPile, ...handPile];

  const oppMain = Array.from({ length: 40 }, () => FILLER_CARD);

  let duel: number | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    duel = (core as any).createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed,
      team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      cardReader: createCardReader(cardDB),
      scriptReader: createScriptReader(scripts),
      errorHandler: (_t: number, text: string) => {
        if (!text.includes('script not found')) console.error(`[OCG][${hand.id}] ${text}`);
      },
    });
    if (!duel) throw new Error('createDuel returned null');

    for (const name of STARTUP_SCRIPTS) {
      const content = scripts.startupScripts.get(name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (content) (core as any).loadScript(duel, name, content);
    }

    for (const code of mainPushOrder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (core as any).duelNewCard(duel, {
        code, team: 0, duelist: 0, controller: 0,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
    for (const code of deck.extra) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (core as any).duelNewCard(duel, {
        code, team: 0, duelist: 0, controller: 0,
        location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
    for (const code of oppMain) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (core as any).duelNewCard(duel, {
        code, team: 1, duelist: 0, controller: 1,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (core as any).startDuel(duel);

    const bridge: OcgCoreBridge = {
      core,
      snapshot: () => wasmMemory.buffer.slice(0),
      restore: (snap) => {
        const cur = wasmMemory.buffer;
        if (cur.byteLength < snap.byteLength) {
          throw new Error(`WASM memory shrank: ${cur.byteLength} < ${snap.byteLength}`);
        }
        new Uint8Array(cur, 0, snap.byteLength).set(new Uint8Array(snap));
        if (cur.byteLength > snap.byteLength) {
          new Uint8Array(cur, snap.byteLength).fill(0);
        }
      },
      captureFieldState: (duelId) => queryFieldState({
        core,
        nativeHandle: duelId,
        turn: 1, phase: 'MAIN1', getCardName,
      }),
    };

    const expectedBoardCardIds = (hand.expectedBoard ?? []).map(e => e.cardId);

    const policy = new DefaultSubPromptPolicy();
    const enumerator = new OcgMacroEnumerator(bridge, { g2Enabled });

    function scoreState(
      fs: FieldState,
      activationLog?: ActivationLog,
      distinctActivations?: ReadonlySet<number>,
    ): { score: number; matched: number } {
      // H1.5 — DFS engine threads activationLog + distinctActivations from
      // the path-local state it maintains across `expand()`. Forward both
      // to the scorer for OPT-aware tag credit (matches production
      // `dfs-solver.ts:1105` contract).
      const { score } = scorer.scoreWithCards(fs, activationLog, distinctActivations);
      const onField = collectOnFieldIds(fs);
      const matched = expectedBoardCardIds.filter(id => onField.has(id)).length;
      return { score, matched };
    }

    const result = runMacroDfs(duel, {
      nodeBudget,
      timeBudgetMs,
      maxDepth,
      expectedBoardCardIds,
      policy,
      enumerator,
      bridge,
      tags,
      scoreState,
      strictEntryPointSelection: false,
    });

    const ratio = result.totalNodesExplored > 0
      ? result.totalPromptsTraversed / result.totalNodesExplored
      : 0;

    return {
      fixtureId: hand.id,
      deck: hand.deck,
      expectedBoardSize: expectedBoardCardIds.length,
      matched: result.bestMatched,
      score: result.bestScore,
      matchedCardIds: result.bestMatchedCardIds,
      missingCardIds: result.bestMissingCardIds,
      macrosExplored: result.totalNodesExplored,
      promptsTraversed: result.totalPromptsTraversed,
      promptToMacroRatio: Number(ratio.toFixed(2)),
      bestPathLength: result.bestPath.length,
      wallTimeMs: result.wallTimeMs,
      stoppedReason: result.stoppedReason,
      policyStats: result.policyStats,
    };
  } catch (e) {
    return mkCrashEval(hand, e instanceof Error ? e.message : String(e));
  } finally {
    if (duel !== undefined) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (core as any).destroyDuel(duel);
      } catch { /* ignore destroy errors during eval cleanup */ }
    }
  }
}

function mkCrashEval(hand: HandFixture, msg: string): FixtureEval {
  return {
    fixtureId: hand.id,
    deck: hand.deck,
    expectedBoardSize: (hand.expectedBoard ?? []).length,
    matched: 0,
    score: 0,
    matchedCardIds: [],
    missingCardIds: (hand.expectedBoard ?? []).map(e => e.cardId),
    macrosExplored: 0,
    promptsTraversed: 0,
    promptToMacroRatio: 0,
    bestPathLength: 0,
    wallTimeMs: 0,
    stoppedReason: 'tree-exhausted',
    policyStats: {
      trivialResolutions: 0, seededResolutions: 0, autoPassResolutions: 0,
      entryPointSelections: { seeded: 0, dfsBranched: 0 },
    },
    crashed: true,
    errorMsg: msg,
  };
}

function collectOnFieldIds(fs: FieldState): Set<number> {
  const ids = new Set<number>();
  const fieldZones: Array<keyof typeof fs.zones> = [
    'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
    'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD',
  ];
  for (const z of fieldZones) {
    for (const c of fs.zones[z]) ids.add(c.cardId);
  }
  return ids;
}

// =============================================================================
// Run loop
// =============================================================================

const allHands = fixture.hands.filter(h => h._draft !== true);
let candidateHands = allHands;
if (fixtureFilter) {
  const tokens = fixtureFilter.split(',').map(s => s.trim()).filter(Boolean);
  candidateHands = allHands.filter(h => tokens.some(t => h.id.includes(t)));
}
console.log(`[eval-macro] running ${candidateHands.length}/${allHands.length} fixtures`);

const evals: FixtureEval[] = [];
const wallStart = Date.now();
for (let i = 0; i < candidateHands.length; i++) {
  const hand = candidateHands[i];
  const t0 = Date.now();
  const e = evalFixture(hand);
  const dt = Date.now() - t0;
  evals.push(e);
  const tag = e.crashed ? 'CRASH' : 'OK';
  console.log(`[eval-macro] [${i+1}/${candidateHands.length}] ${tag} ${hand.id}: ${e.matched}/${e.expectedBoardSize} score=${e.score.toFixed(0)} macros=${e.macrosExplored} prompts=${e.promptsTraversed} ratio=${e.promptToMacroRatio} wall=${dt}ms stop=${e.stoppedReason}${e.errorMsg ? ' err=' + e.errorMsg : ''}`);
}
const wallTotal = Date.now() - wallStart;

// =============================================================================
// Aggregate + report
// =============================================================================

const cumMatched = evals.reduce((a, b) => a + b.matched, 0);
const cumScore = evals.reduce((a, b) => a + b.score, 0);
const cumExpected = evals.reduce((a, b) => a + b.expectedBoardSize, 0);
const cumMacros = evals.reduce((a, b) => a + b.macrosExplored, 0);
const cumPrompts = evals.reduce((a, b) => a + b.promptsTraversed, 0);
const avgRatio = cumMacros > 0 ? cumPrompts / cumMacros : 0;

// Compare against baseline if available
let baselineDiff: { fixtureId: string; baselineMatched: number; macroMatched: number; deltaMatched: number; baselineScore: number; macroScore: number; deltaScore: number }[] | null = null;
let baselineCum: { matched: number; score: number; expected: number } | null = null;
if (baselinePath && existsSync(baselinePath)) {
  try {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as {
      fixtures: Record<string, { matched: number; score: number; matchedTotal: number }>;
      aggregate: { cumulativeMatched: number; cumulativeScore: number; cumulativeMatchedTotal: number };
    };
    baselineDiff = [];
    for (const e of evals) {
      const b = baseline.fixtures[e.fixtureId];
      if (b) {
        baselineDiff.push({
          fixtureId: e.fixtureId,
          baselineMatched: b.matched,
          macroMatched: e.matched,
          deltaMatched: e.matched - b.matched,
          baselineScore: b.score,
          macroScore: e.score,
          deltaScore: e.score - b.score,
        });
      }
    }
    baselineCum = {
      matched: baseline.aggregate.cumulativeMatched,
      score: baseline.aggregate.cumulativeScore,
      expected: baseline.aggregate.cumulativeMatchedTotal,
    };
  } catch (e) {
    console.warn(`[eval-macro] baseline parse failed: ${String(e)}`);
  }
}

const output = {
  configMode,
  budgetNodes: nodeBudget,
  budgetMs: timeBudgetMs,
  maxDepth,
  g2Enabled,
  fixturesEvaluated: evals.length,
  fixtures: evals,
  cumulative: {
    matched: cumMatched,
    score: cumScore,
    matchedTotal: cumExpected,
    macrosExplored: cumMacros,
    promptsTraversed: cumPrompts,
    avgPromptToMacroRatio: Number(avgRatio.toFixed(2)),
    wallTimeTotalMs: wallTotal,
  },
  baseline: baselineCum
    ? { path: baselinePath, ...baselineCum, deltaMatched: cumMatched - baselineCum.matched, deltaScore: cumScore - baselineCum.score }
    : null,
  baselineDiff,
};

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(output, null, 2) + '\n', 'utf-8');

// Console summary
console.log('[eval-macro] ────────────────────────────────────────────────');
console.log(`[eval-macro] Macro-DFS ${g2Enabled ? 'G2' : 'pre-G2'} cum: ${cumMatched}/${cumExpected} matched, ${cumScore.toFixed(0)} score`);
if (baselineCum) {
  const sign = (n: number) => (n > 0 ? '+' : '') + n.toString();
  console.log(`[eval-macro] vs baseline ${baselineCum.matched}/${baselineCum.expected} ${baselineCum.score} -> Δmatched=${sign(cumMatched - baselineCum.matched)} Δscore=${sign(Math.round(cumScore - baselineCum.score))}`);
}
console.log(`[eval-macro] cum macros=${cumMacros} prompts=${cumPrompts} avg-ratio=${avgRatio.toFixed(2)} wall=${(wallTotal / 1000).toFixed(1)}s`);

const sortedByMatched = [...evals].sort((a, b) => b.matched - a.matched);
console.log('[eval-macro] top 5 by matched:');
for (const e of sortedByMatched.slice(0, 5)) {
  console.log(`           ${e.matched}/${e.expectedBoardSize} score=${e.score.toFixed(0)} ${e.fixtureId}`);
}
const zeros = evals.filter(e => e.matched === 0);
console.log(`[eval-macro] matched=0 fixtures (${zeros.length}):`);
for (const e of zeros.slice(0, 5)) {
  console.log(`           0/${e.expectedBoardSize} score=${e.score.toFixed(0)} ${e.fixtureId}${e.crashed ? ' [CRASH]' : ''}`);
}
if (baselineDiff) {
  const regressions = baselineDiff.filter(d => d.deltaMatched < 0);
  const improvements = baselineDiff.filter(d => d.deltaMatched > 0);
  console.log(`[eval-macro] vs baseline: ${improvements.length} improvements, ${regressions.length} regressions`);
  for (const d of regressions) {
    console.log(`           REG ${d.fixtureId}: ${d.baselineMatched}->${d.macroMatched} (${d.deltaMatched}) score ${d.baselineScore}->${d.macroScore} (${d.deltaScore})`);
  }
  for (const d of improvements) {
    console.log(`           +++ ${d.fixtureId}: ${d.baselineMatched}->${d.macroMatched} (+${d.deltaMatched}) score ${d.baselineScore}->${d.macroScore} (+${d.deltaScore})`);
  }
}
console.log(`[eval-macro] wrote ${outPath}`);

process.exit(0);
