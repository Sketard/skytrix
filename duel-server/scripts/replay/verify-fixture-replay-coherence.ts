// =============================================================================
// verify-fixture-replay-coherence.ts — given a fixture-id and a raw-replay
// path, replay the raw-replay's deck through OCGCore (with the raw-replay's
// 4-bigint seed), capture the player-0 hand drawn at the first SELECT_IDLECMD,
// and compare it to the fixture's authored hand.
//
// This audits the methodological coherence between an authored fixture
// (hand[] + deckSeed) and the PvP raw-replay it claims to derive from. A
// fixture is "coherent" if, given the same deck and seed, OCGCore's shuffle
// would draw the same 5 cards into the player's HAND.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/verify-fixture-replay-coherence.ts \
//     --raw-replay=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener.raw-replay.json \
//     --fixture-id=branded-dracotail-opener \
//     --out=/tmp/coherence-branded.json
//
// The script auto-iterates the OCG core only until it reaches the first
// SELECT_IDLECMD for player 0 — no captured PvP responses are needed.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
} from '@n1xx1/ocgcore-wasm';

import {
  DATA_DIR,
  loadFixtureFile,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../../src/ocg-callbacks.js';

interface RawReplayFile {
  format: string;
  fixtureId: string;
  seed: string[];
  decks: [{ main: number[]; extra: number[] }, { main: number[]; extra: number[] }];
}

interface CoherenceResult {
  fixtureId: string;
  rawReplayPath: string;
  rawReplayFixtureId: string;
  rawReplaySeed: string[];
  fixtureDeckSeed: string;
  fixtureMainDeckLen: number;
  replayMainDeckLen: number;
  deckMainSortedDiffCount: number;
  deckExtraSortedDiffCount: number;
  fixtureHand: number[];
  replayDrawnHand: number[];
  fixtureHandNames: string[];
  replayDrawnHandNames: string[];
  cohesion: 'identical' | 'mismatch' | 'deck-mismatch' | 'no-hand-captured';
  delta: { onlyInFixture: number[]; onlyInReplay: number[] };
}

function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const rawReplayPath = parseArg('raw-replay');
const fixtureId = parseArg('fixture-id');
const outPath = parseArg('out');
if (!rawReplayPath || !fixtureId || !outPath) {
  console.error('[coherence] required: --raw-replay=<path> --fixture-id=<id> --out=<path>');
  process.exit(2);
}
const maxIterations = Number(parseArg('max-iterations') ?? '500');

const raw = JSON.parse(readFileSync(resolve(rawReplayPath), 'utf-8')) as RawReplayFile;
if (raw.format !== 'raw-replay-v1') {
  console.error(`[coherence] unexpected format: ${raw.format}`);
  process.exit(2);
}

const fixtureFile = loadFixtureFile();
const hand = fixtureFile.hands.find(h => h.id === fixtureId);
if (!hand) {
  console.error(`[coherence] fixture ${fixtureId} not found in solver-validation-decks.json`);
  process.exit(2);
}
const fixtureDeck = fixtureFile.decks[hand.deck];
if (!fixtureDeck) {
  console.error(`[coherence] deck ${hand.deck} for fixture ${fixtureId} not found`);
  process.exit(2);
}

// Compute deck-composition divergence (sorted comparison): a non-zero count
// means the raw-replay was captured from a *different decklist* than the
// fixture's authored deck — coherence is then meaningless (the OCG draw
// from the replay's deck would never match the fixture's hand even if seeds
// matched, because the deck cards differ).
function sortedDiffCount(a: readonly number[], b: readonly number[]): number {
  const sa = [...a].sort();
  const sb = [...b].sort();
  let diff = 0;
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    if (sa[i] !== sb[i]) diff++;
  }
  return diff;
}

const deckMainDiffCount = sortedDiffCount(raw.decks[0].main, fixtureDeck.main);
const deckExtraDiffCount = sortedDiffCount(raw.decks[0].extra, fixtureDeck.extra);

const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const nameStmt = cardDB.nameStmt;
const nameCache = new Map<number, string>();
function getName(id: number): string {
  if (id <= 0) return '';
  const cached = nameCache.get(id);
  if (cached !== undefined) return cached;
  const row = nameStmt.get(id) as { name?: string } | undefined;
  const name = row?.name ?? `#${id}`;
  nameCache.set(id, name);
  return name;
}

const core = await createCore({ sync: true } as never);
const seed: [bigint, bigint, bigint, bigint] = [
  BigInt(raw.seed[0]),
  BigInt(raw.seed[1]),
  BigInt(raw.seed[2]),
  BigInt(raw.seed[3]),
];
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
if (!duel) throw new Error('createDuel failed');

for (const name of STARTUP_SCRIPTS) {
  const content = scripts.startupScripts.get(name);
  if (content) (core as any).loadScript(duel, name, content);
}

// Load the raw-replay's full decks for both teams. OCGCore will shuffle and
// draw 5 to HAND on startDuel.
for (let team = 0; team < 2; team++) {
  const d = raw.decks[team];
  for (const code of d.main) {
    (core as any).duelNewCard(duel, {
      code, team, duelist: 0, controller: team,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of d.extra) {
    (core as any).duelNewCard(duel, {
      code, team, duelist: 0, controller: team,
      location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
}

(core as any).startDuel(duel);

function queryHand(controller: 0 | 1): number[] {
  const flags = OcgQueryFlags.CODE as number;
  const cards = (core as any).duelQueryLocation(duel, {
    flags, controller, location: OcgLocation.HAND,
  }) as Array<{ code?: number } | null>;
  return cards.filter(c => c != null && c.code != null).map(c => c!.code!);
}

// Auto-respond to RPS / SELECT_OPTION (first-or-second) — same defaults as
// replay-to-fixture.ts. We only iterate until the first SELECT_IDLECMD on
// the tracked player (the post-draw decision point).
function autoRespond(msg: Record<string, unknown>, msgType: number): Record<string, unknown> | null {
  switch (msgType) {
    case OcgMessageType.ROCK_PAPER_SCISSORS: {
      const playerIndex = (msg['player'] as number) ?? 0;
      return { type: 20, value: playerIndex === 0 ? 1 : 3 };
    }
    case OcgMessageType.SELECT_OPTION:
      return { type: 4, index: 0 };
    default:
      return null;
  }
}

let capturedHand: number[] | null = null;
let iter = 0;

mainLoop:
while (iter < maxIterations) {
  iter++;
  const status = (core as any).duelProcess(duel);
  const messages = (core as any).duelGetMessage(duel);

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const msgType = m['type'] as number;
    if (msgType === OcgMessageType.SELECT_IDLECMD && (m['player'] as number) === 0) {
      capturedHand = queryHand(0);
      break mainLoop;
    }
    const auto = autoRespond(m, msgType);
    if (auto) {
      (core as any).duelSetResponse(duel, auto);
    }
  }

  if (status === OcgProcessResult.END) break;
}

const fixtureHand = hand.hand;
const replayDrawnHand = capturedHand ?? [];

const fixtureSet = new Set(fixtureHand);
const replaySet = new Set(replayDrawnHand);
const onlyInFixture = fixtureHand.filter(c => !replaySet.has(c));
const onlyInReplay = replayDrawnHand.filter(c => !fixtureSet.has(c));

let cohesion: CoherenceResult['cohesion'];
if (capturedHand === null) cohesion = 'no-hand-captured';
else if (deckMainDiffCount > 0) cohesion = 'deck-mismatch';
else if (onlyInFixture.length === 0 && onlyInReplay.length === 0) cohesion = 'identical';
else cohesion = 'mismatch';

const result: CoherenceResult = {
  fixtureId,
  rawReplayPath,
  rawReplayFixtureId: raw.fixtureId,
  rawReplaySeed: raw.seed,
  fixtureDeckSeed: hand.deckSeed,
  fixtureMainDeckLen: fixtureDeck.main.length,
  replayMainDeckLen: raw.decks[0].main.length,
  deckMainSortedDiffCount: deckMainDiffCount,
  deckExtraSortedDiffCount: deckExtraDiffCount,
  fixtureHand,
  replayDrawnHand,
  fixtureHandNames: fixtureHand.map(getName),
  replayDrawnHandNames: replayDrawnHand.map(getName),
  cohesion,
  delta: { onlyInFixture, onlyInReplay },
};

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(result, null, 2) + '\n', 'utf-8');

console.log(`[coherence] ────────────────────────────────────────────────`);
console.log(`[coherence] fixtureId            = ${fixtureId}`);
console.log(`[coherence] rawReplayFixtureId   = ${raw.fixtureId}`);
console.log(`[coherence] rawReplaySeed        = [${raw.seed.join(', ')}]`);
console.log(`[coherence] fixtureDeckSeed      = ${hand.deckSeed}`);
console.log(`[coherence] deck-main diff count = ${deckMainDiffCount} (extra=${deckExtraDiffCount})`);
console.log(`[coherence] fixtureHand          = [${fixtureHand.join(', ')}]`);
console.log(`                                   ${fixtureHand.map(getName).join(' | ')}`);
console.log(`[coherence] replayDrawnHand      = [${replayDrawnHand.join(', ')}]`);
console.log(`                                   ${replayDrawnHand.map(getName).join(' | ')}`);
console.log(`[coherence] cohesion             = ${cohesion}`);
if (cohesion === 'mismatch' || cohesion === 'deck-mismatch') {
  console.log(`[coherence] onlyInFixture        = [${onlyInFixture.join(', ')}] ${onlyInFixture.map(getName).join(' | ')}`);
  console.log(`[coherence] onlyInReplay         = [${onlyInReplay.join(', ')}] ${onlyInReplay.map(getName).join(' | ')}`);
}
console.log(`[coherence] wrote ${outPath}`);

(core as any).destroyDuel(duel);
process.exit(cohesion === 'identical' ? 0 : 1);
