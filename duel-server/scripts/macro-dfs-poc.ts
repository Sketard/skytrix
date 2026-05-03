// =============================================================================
// macro-dfs-poc.ts — CLI driver for the macro-action DFS POC (2026-05-03).
//
// Boots OCGCore + cardDB + scripts (raw-replay-verify pattern), wires the
// fixture's deck into the engine, builds an InterruptionScorer, then runs
// `runMacroDfs` with either a SeededCanonicalSubPromptPolicy (when a
// raw-replay seed is provided) or a DefaultSubPromptPolicy.
//
// Output: JSON file + human-readable console summary.
//
// Usage:
//   npx tsx scripts/macro-dfs-poc.ts \
//     --fixture-id=ddd-pendulum-opener \
//     --raw-replay-seed=../_bmad-output/.../ddd-pendulum-replay-eb8c6865.raw-replay.json \
//     --node-budget=800 --time-budget-ms=12000 --max-depth=50 \
//     --out=/tmp/macro-dfs-ddd.json
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
} from '@n1xx1/ocgcore-wasm';

import { DATA_DIR, loadFixtureFile } from './evaluate-structural.js';
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
  SeededCanonicalSubPromptPolicy,
  runMacroDfs,
  type MacroDfsResult,
  type OcgCoreBridge,
} from '../src/solver/macro-dfs.js';
import type { FieldState } from '../src/solver/solver-types.js';

// =============================================================================
// CLI arg parsing
// =============================================================================

function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const fixtureId = parseArg('fixture-id');
const outPath = parseArg('out');
if (!fixtureId || !outPath) {
  console.error('[macro-dfs-poc] required: --fixture-id=<id> --out=<path>');
  console.error('  optional: --raw-replay-seed=<path> --node-budget=N --time-budget-ms=N --max-depth=N --full-canonical-replay');
  process.exit(2);
}
const rawReplaySeedPath = parseArg('raw-replay-seed');
const fullCanonicalReplay = hasFlag('full-canonical-replay');
if (fullCanonicalReplay && !rawReplaySeedPath) {
  console.error('[macro-dfs-poc] --full-canonical-replay requires --raw-replay-seed=<path>');
  process.exit(2);
}
const nodeBudget = Number(parseArg('node-budget') ?? '800');
const timeBudgetMs = Number(parseArg('time-budget-ms') ?? '12000');
const maxDepth = Number(parseArg('max-depth') ?? '50');

// =============================================================================
// Boot data + fixture
// =============================================================================

const fixture = loadFixtureFile();
const hand = fixture.hands.find(h => h.id === fixtureId);
if (!hand) {
  console.error(`[macro-dfs-poc] fixture '${fixtureId}' not found in solver-validation-decks.json`);
  process.exit(2);
}
const deck = fixture.decks[hand.deck];
if (!deck) {
  console.error(`[macro-dfs-poc] deck '${hand.deck}' not found`);
  process.exit(2);
}

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

// =============================================================================
// Boot OCGCore — capture WASM Memory for snapshot fork
// =============================================================================

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
  console.error('[macro-dfs-poc] failed to capture WASM Memory — snapshot fork unavailable');
  process.exit(3);
}
const wasmMemory = slot.memory;
console.log(`[macro-dfs-poc] WASM Memory captured (${wasmMemory.buffer.byteLength} bytes)`);

// =============================================================================
// Build a duel — opponent gets a vanilla filler deck
// =============================================================================

const FILLER_CARD = 43096270;  // Alexandrite Dragon
const oppMain = Array.from({ length: 40 }, () => FILLER_CARD);

// In full-canonical replay mode, load the deck and seed from the raw-replay
// itself — the fixture-file deck/seed are independent of the canonical line
// and would cause OCGCore to surface a different prompt sequence (different
// hand cards, different shuffle), making canonical-step matching impossible.
let mainDeck: number[] = deck.main;
let extraDeck: number[] = deck.extra;
let seed: [bigint, bigint, bigint, bigint];

if (fullCanonicalReplay && rawReplaySeedPath) {
  const rawReplay = JSON.parse(readFileSync(resolve(rawReplaySeedPath), 'utf-8'));
  mainDeck = rawReplay.decks[0].main as number[];
  extraDeck = rawReplay.decks[0].extra as number[];
  const seedStrs = rawReplay.seed as string[];
  const seedBig = seedStrs.map((s: string) => BigInt(s));
  while (seedBig.length < 4) seedBig.push(0n);
  seed = [seedBig[0], seedBig[1], seedBig[2], seedBig[3]];
  console.log(`[macro-dfs-poc] FULL-CANONICAL: using raw-replay deck (main=${mainDeck.length}, extra=${extraDeck.length}) and seed`);
} else {
  for (const cid of hand.hand) {
    if (!mainDeck.includes(cid)) {
      console.error(`[macro-dfs-poc] hand card ${cid} not in deck '${hand.deck}'`);
      process.exit(2);
    }
  }
  const seedHex = hand.deckSeed.split(',').map(s => BigInt('0x' + s.trim()));
  while (seedHex.length < 4) seedHex.push(0n);
  seed = [seedHex[0], seedHex[1], seedHex[2], seedHex[3]];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const duel = (core as any).createDuel({
  flags: OcgDuelMode.MODE_MR5,
  seed,
  team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
  team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
  cardReader: createCardReader(cardDB),
  scriptReader: createScriptReader(scripts),
  errorHandler: (_t: number, text: string) => {
    if (!text.includes('script not found')) console.error(`[OCG] ${text}`);
  },
});
if (!duel) throw new Error('[macro-dfs-poc] createDuel failed');

for (const name of STARTUP_SCRIPTS) {
  const content = scripts.startupScripts.get(name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (content) (core as any).loadScript(duel, name, content);
}

// Load decks. In full-canonical mode, push the deck verbatim and let OCGCore
// shuffle via the canonical seed — this is what produced the raw-replay's
// prompt order. In normal mode, hand cards are reordered to the top so the
// fixture's declared opening hand is drawn deterministically.
let mainPushOrder: number[];
if (fullCanonicalReplay) {
  mainPushOrder = mainDeck;
} else {
  const handSet = new Set(hand.hand);
  const handPile: number[] = [];
  const restPile: number[] = [];
  for (const code of mainDeck) {
    if (handSet.has(code) && handPile.filter(c => c === code).length < hand.hand.filter(h => h === code).length) {
      handPile.push(code);
    } else {
      restPile.push(code);
    }
  }
  // Order: first push restPile (bottom of deck), then handPile (top → drawn first).
  mainPushOrder = [...restPile, ...handPile];
}
for (const code of mainPushOrder) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (core as any).duelNewCard(duel, {
    code, team: 0, duelist: 0, controller: 0,
    location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
  });
}
for (const code of extraDeck) {
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

// =============================================================================
// Bridge + scorer wiring
// =============================================================================

const bridge: OcgCoreBridge = {
  core,
  snapshot: () => wasmMemory.buffer.slice(0),
  restore: (snap) => {
    const cur = wasmMemory.buffer;
    if (cur.byteLength < snap.byteLength) {
      throw new Error(`[macro-dfs-poc] WASM memory shrank: ${cur.byteLength} < ${snap.byteLength}`);
    }
    new Uint8Array(cur, 0, snap.byteLength).set(new Uint8Array(snap));
    if (cur.byteLength > snap.byteLength) {
      new Uint8Array(cur, snap.byteLength).fill(0);
    }
  },
  captureFieldState: (duelId) => queryFieldState({
    core,
    nativeHandle: duelId,
    turn: 1,           // POC: turn tracking not threaded; scorer reads `turn`
                       // for some bonuses but not for matched detection.
    phase: 'MAIN1',
    getCardName,
  }),
};

const scorer = new InterruptionScorer(tags, weights);

const expectedBoardCardIds = (hand.expectedBoard ?? []).map(e => e.cardId);

function scoreState(fs: FieldState): { score: number; matched: number } {
  const { score } = scorer.scoreWithCards(fs);
  const onField = collectOnFieldIds(fs);
  const matched = expectedBoardCardIds.filter(id => onField.has(id)).length;
  return { score, matched };
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
// Policy + run
// =============================================================================

let policy: DefaultSubPromptPolicy | SeededCanonicalSubPromptPolicy = new DefaultSubPromptPolicy();
let snapshotCursors: (() => unknown) | undefined;
let restoreCursors: ((snap: unknown) => void) | undefined;
if (rawReplaySeedPath) {
  const rawReplay = JSON.parse(readFileSync(resolve(rawReplaySeedPath), 'utf-8'));
  const seeded = new SeededCanonicalSubPromptPolicy(rawReplay, { fullCanonicalReplay });
  policy = seeded;
  snapshotCursors = () => seeded.snapshotCursors();
  restoreCursors = (snap) => seeded.restoreCursors(snap as Map<number, number>);
  const mode = fullCanonicalReplay ? 'FULL-CANONICAL' : 'sub-prompt-only';
  console.log(`[macro-dfs-poc] using SeededCanonicalSubPromptPolicy (${mode}) from ${rawReplaySeedPath}`);
} else {
  console.log('[macro-dfs-poc] using DefaultSubPromptPolicy (no seed)');
}

const enumerator = new OcgMacroEnumerator(bridge);

const result: MacroDfsResult = runMacroDfs(duel, {
  nodeBudget,
  timeBudgetMs,
  maxDepth,
  expectedBoardCardIds,
  policy,
  enumerator,
  bridge,
  scoreState,
  snapshotPolicyCursors: snapshotCursors,
  restorePolicyCursors: restoreCursors,
  strictEntryPointSelection: fullCanonicalReplay,
});

// =============================================================================
// Report
// =============================================================================

const breakdown = result.bestFieldState
  ? scorer.scoreWithCards(result.bestFieldState).scoreBreakdown
  : undefined;

const totalProm = result.totalPromptsTraversed;
const totalMacros = result.totalNodesExplored;
const ratio = totalMacros > 0 ? (totalProm / totalMacros) : 0;

const output = {
  fixtureId,
  expectedBoardSize: expectedBoardCardIds.length,
  matched: result.bestMatched,
  matchedCardIds: result.bestMatchedCardIds,
  matchedCardNames: result.bestMatchedCardIds.map(getCardName),
  missingCardIds: result.bestMissingCardIds,
  missingCardNames: result.bestMissingCardIds.map(getCardName),
  bestScore: result.bestScore,
  scoreBreakdown: breakdown,
  bestPathDescriptions: result.bestPath.map(m => m.description),
  bestPathLength: result.bestPath.length,
  totalMacrosExplored: totalMacros,
  totalPromptsTraversed: totalProm,
  promptToMacroRatio: Number(ratio.toFixed(2)),
  wallTimeMs: result.wallTimeMs,
  stoppedReason: result.stoppedReason,
  policyStats: result.policyStats,
  entryPointSelections: result.policyStats.entryPointSelections,
  config: {
    nodeBudget,
    timeBudgetMs,
    maxDepth,
    rawReplaySeed: rawReplaySeedPath ?? null,
    fullCanonicalReplay,
  },
};

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(output, null, 2) + '\n', 'utf-8');

console.log('[macro-dfs-poc] ────────────────────────────────────────────────');
console.log(`[macro-dfs-poc] fixtureId          = ${fixtureId}`);
console.log(`[macro-dfs-poc] matched            = ${result.bestMatched}/${expectedBoardCardIds.length}`);
console.log(`[macro-dfs-poc] bestScore          = ${result.bestScore}`);
console.log(`[macro-dfs-poc] bestPath length    = ${result.bestPath.length} macros`);
console.log(`[macro-dfs-poc] macros explored    = ${totalMacros}`);
console.log(`[macro-dfs-poc] prompts traversed  = ${totalProm} (ratio ${ratio.toFixed(2)})`);
console.log(`[macro-dfs-poc] wall time          = ${result.wallTimeMs} ms`);
console.log(`[macro-dfs-poc] stopped            = ${result.stoppedReason}`);
console.log(`[macro-dfs-poc] policy stats       = trivial=${result.policyStats.trivialResolutions} seeded=${result.policyStats.seededResolutions} auto-pass=${result.policyStats.autoPassResolutions}`);
console.log(`[macro-dfs-poc] entry-point sel    = seeded=${result.policyStats.entryPointSelections.seeded} dfsBranched=${result.policyStats.entryPointSelections.dfsBranched}`);
if (result.bestMatchedCardIds.length > 0) {
  console.log('[macro-dfs-poc] matched cards:');
  result.bestMatchedCardIds.forEach(id => console.log(`           + ${id} ${getCardName(id)}`));
}
if (result.bestMissingCardIds.length > 0) {
  console.log('[macro-dfs-poc] missing cards:');
  result.bestMissingCardIds.forEach(id => console.log(`           - ${id} ${getCardName(id)}`));
}
const head = result.bestPath.slice(0, 12);
console.log(`[macro-dfs-poc] bestPath head (${head.length}/${result.bestPath.length}):`);
head.forEach((m, i) => console.log(`           ${i + 1}. ${m.description}`));
console.log(`[macro-dfs-poc] wrote ${outPath}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(core as any).destroyDuel(duel);
process.exit(0);
