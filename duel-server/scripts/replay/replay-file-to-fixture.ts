// =============================================================================
// replay-file-to-fixture.ts — turn an existing raw-replay JSON file into a
// solver fixture. Sibling of replay-to-fixture.ts but reads from the local
// `.raw-replay.json` instead of fetching from the Spring Boot API.
//
// Used when the API replay record is gone (rotated, dev-DB reset) but the
// raw-replay file is still on disk. Faithfully reproduces the same OCGCore
// startup → response loop as replay-to-fixture.ts and writes:
//
//   1. Deck entry appended to solver-validation-decks.json (if not present)
//   2. Fixture entry appended/replaced in solver-validation-decks.json
//      (writes only when --apply is passed; otherwise dry-run prints to stdout)
//
// Importantly, this script writes the deckSeed as the **full 4 bigints**
// (replay-to-fixture.ts truncates to 2, which is OK only for the WebSocket
// `/api/solver/start` path that constructs the missing 2 from randomBytes).
// For an authored fixture meant to be byte-exact-reproducible from a PvP
// replay, all 4 are required. The solver's evaluator
// (evaluate-structural.ts:557) and ocgcore-adapter.ts:735 both accept
// `deckSeed.length >= 4` and use the first 4 verbatim.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/replay-file-to-fixture.ts \
//     --raw-replay=../_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json \
//     --fixture-id=ddd-pendulum-opener-v2 \
//     --deck-id=ddd-doom-queen-machinex-variant \
//     --description="..." \
//     [--apply] [--player=0]
//
// --apply  : write to solver-validation-decks.json. Without it, runs in
//            dry-run mode and prints the would-be entry to /tmp.
// =============================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
  OcgQueryFlags,
} from '@n1xx1/ocgcore-wasm';
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../../src/ocg-callbacks.js';

// -----------------------------------------------------------------------------
// CLI args
// -----------------------------------------------------------------------------
function parseArg(name: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

interface Args {
  rawReplayPath: string;
  fixtureId: string;
  deckId: string;
  description: string;
  player: 0 | 1;
  decksFile: string;
  outDryRun: string;
  apply: boolean;
  maxIterations: number;
}

function loadArgs(): Args {
  const rawReplayPath = parseArg('raw-replay');
  const fixtureId = parseArg('fixture-id');
  const deckId = parseArg('deck-id');
  if (!rawReplayPath || !fixtureId || !deckId) {
    console.error('[replay-file-to-fixture] required: --raw-replay --fixture-id --deck-id');
    process.exit(2);
  }
  const playerStr = parseArg('player') ?? '0';
  const player = (playerStr === '1' ? 1 : 0) as 0 | 1;
  const repoRoot = resolve(import.meta.dirname!, '..', '..', '..');
  return {
    rawReplayPath: resolve(rawReplayPath),
    fixtureId,
    deckId,
    description: parseArg('description') ?? `Auto-generated from raw-replay file ${rawReplayPath}`,
    player,
    decksFile: parseArg('decks-file') ?? join(repoRoot, '_bmad-output/planning-artifacts/research/solver-validation-decks.json'),
    outDryRun: parseArg('out-dry-run') ?? `/tmp/${fixtureId}-fixture-from-replay.json`,
    apply: process.argv.includes('--apply'),
    maxIterations: Number(parseArg('max-iterations') ?? '1500'),
  };
}

// -----------------------------------------------------------------------------
// Raw-replay file reader (mirrors raw-replay-v1 schema)
// -----------------------------------------------------------------------------
interface RawReplayFile {
  format: string;
  fixtureId: string;
  sourceReplayId?: string;
  generatedAt?: string;
  terminated?: string;
  iterationsUsed?: number;
  responseCount: number;
  playerTracked: 0 | 1;
  seed: string[];
  decks: [{ main: number[]; extra: number[] }, { main: number[]; extra: number[] }];
  steps: Array<{
    stepIdx: number;
    promptType: number;
    promptTypeName: string;
    promptPlayer: number;
    response: Record<string, unknown>;
    autoRespond: boolean;
  }>;
}

function loadRawReplay(path: string): RawReplayFile {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as RawReplayFile;
  if (raw.format !== 'raw-replay-v1') {
    throw new Error(`unexpected raw-replay format: ${raw.format}`);
  }
  if (!Array.isArray(raw.seed) || raw.seed.length !== 4) {
    throw new Error(`raw-replay seed must have 4 bigints, got ${raw.seed?.length}`);
  }
  return raw;
}

// -----------------------------------------------------------------------------
// OCGCore replay runner — mirrors replay-to-fixture.ts:runReplayOnCore
// -----------------------------------------------------------------------------
const EXPECTED_RESPONSE_TYPE: Partial<Record<number, number>> = {
  [OcgMessageType.SELECT_BATTLECMD]: 0,
  [OcgMessageType.SELECT_IDLECMD]: 1,
  [OcgMessageType.SELECT_EFFECTYN]: 2,
  [OcgMessageType.SELECT_YESNO]: 3,
  [OcgMessageType.SELECT_OPTION]: 4,
  [OcgMessageType.SELECT_CARD]: 5,
  [OcgMessageType.SELECT_UNSELECT_CARD]: 7,
  [OcgMessageType.SELECT_CHAIN]: 8,
  [OcgMessageType.SELECT_PLACE]: 10,
  [OcgMessageType.SELECT_DISFIELD]: 10,
  [OcgMessageType.SELECT_POSITION]: 11,
  [OcgMessageType.SELECT_TRIBUTE]: 12,
  [OcgMessageType.SELECT_COUNTER]: 13,
  [OcgMessageType.SELECT_SUM]: 14,
  [OcgMessageType.SORT_CARD]: 15,
  [OcgMessageType.SORT_CHAIN]: 15,
  [OcgMessageType.ANNOUNCE_RACE]: 16,
  [OcgMessageType.ANNOUNCE_ATTRIB]: 17,
  [OcgMessageType.ANNOUNCE_CARD]: 18,
  [OcgMessageType.ANNOUNCE_NUMBER]: 19,
  [OcgMessageType.ROCK_PAPER_SCISSORS]: 20,
};

function isSelectPrompt(type: number): boolean {
  return type in EXPECTED_RESPONSE_TYPE;
}

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

function queryZoneCard(core: any, duel: any, controller: 0 | 1, location: number, sequence: number): {
  code: number;
  position: number;
} | null {
  const q = (flags: number) => core.duelQuery(duel, { flags, controller, location, sequence, overlaySequence: 0 }) as Record<string, unknown> | null;
  const codeInfo = q(OcgQueryFlags.CODE as number);
  const code = codeInfo ? (codeInfo['code'] as number | undefined) : undefined;
  if (!code) return null;
  const posInfo = q(OcgQueryFlags.POSITION as number);
  const position = posInfo ? ((posInfo['position'] as number) ?? 0) : 0;
  return { code, position };
}

function queryHand(core: any, duel: any, controller: 0 | 1): number[] {
  const flags = OcgQueryFlags.CODE as number;
  const cards = core.duelQueryLocation(duel, { flags, controller, location: OcgLocation.HAND }) as Array<{ code?: number } | null>;
  return cards.filter(c => c != null && c.code != null).map(c => c!.code!);
}

function positionToString(pos: number): 'attack' | 'defense' | 'set' {
  if (pos === OcgPosition.FACEUP_ATTACK) return 'attack';
  if (pos === OcgPosition.FACEUP_DEFENSE) return 'defense';
  return 'set';
}

interface ExpectedBoardEntry {
  zone: 'MZONE' | 'SZONE' | 'FIELD';
  cardId: number;
  cardName: string;
  position: 'attack' | 'defense' | 'set';
}

function captureExpectedBoard(core: any, duel: any, controller: 0 | 1, cardName: (id: number) => string): ExpectedBoardEntry[] {
  const out: ExpectedBoardEntry[] = [];
  for (let seq = 0; seq < 7; seq++) {
    const c = queryZoneCard(core, duel, controller, OcgLocation.MZONE, seq);
    if (c) out.push({ zone: 'MZONE', cardId: c.code, cardName: cardName(c.code), position: positionToString(c.position) });
  }
  for (let seq = 0; seq < 5; seq++) {
    const c = queryZoneCard(core, duel, controller, OcgLocation.SZONE, seq);
    if (c) out.push({ zone: 'SZONE', cardId: c.code, cardName: cardName(c.code), position: positionToString(c.position) });
  }
  const fz = queryZoneCard(core, duel, controller, OcgLocation.FZONE, 0);
  if (fz) out.push({ zone: 'FIELD', cardId: fz.code, cardName: cardName(fz.code), position: positionToString(fz.position) });
  return out;
}

interface RunResult {
  hand: number[];
  expectedBoard: ExpectedBoardEntry[];
  iterationsUsed: number;
  terminated: 'responses-exhausted' | 'duel-end' | 'max-iterations';
  rawStepsConsumed: number;
}

async function createSyncCore(): Promise<any> {
  return await createCore({ sync: true } as never);
}

function runReplayOnCore(
  core: any,
  cardDB: ReturnType<typeof loadDatabase>,
  scripts: ReturnType<typeof loadScripts>,
  seed: [bigint, bigint, bigint, bigint],
  args: Args,
  raw: RawReplayFile,
  cardName: (id: number) => string,
): RunResult {
  const duel = core.createDuel({
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
    if (content) core.loadScript(duel, name, content);
  }

  for (let team = 0; team < 2; team++) {
    const deck = raw.decks[team];
    for (const code of deck.main) {
      core.duelNewCard(duel, {
        code, team, duelist: 0, controller: team,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
    for (const code of deck.extra) {
      core.duelNewCard(duel, {
        code, team, duelist: 0, controller: team,
        location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
  }

  core.startDuel(duel);

  // Replay using the captured `steps[].response` directly. raw-replay-v1
  // stores responses 1:1 with the actual prompt order — including auto-RPS /
  // SELECT_OPTION responses, since the original replay-to-fixture pipeline
  // already wrote them. So we don't need the API's auto-respond fallback
  // unless the raw-replay file is missing them (legacy files).
  const steps = raw.steps;
  let stepIdx = 0;
  let capturedHand: number[] | null = null;
  let iter = 0;
  let terminated: RunResult['terminated'] = 'max-iterations';

  while (iter < args.maxIterations) {
    iter++;
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const msgType = m['type'] as number;
      if (!isSelectPrompt(msgType)) continue;

      if (capturedHand === null
        && msgType === OcgMessageType.SELECT_IDLECMD
        && (m['player'] as number) === args.player) {
        capturedHand = queryHand(core, duel, args.player);
      }

      const expectedType = EXPECTED_RESPONSE_TYPE[msgType];
      const captured = stepIdx < steps.length ? steps[stepIdx].response : null;
      const capturedTypeMatches = captured != null && (captured['type'] as number) === expectedType;
      let response: Record<string, unknown> | null;

      if (capturedTypeMatches) {
        response = captured as Record<string, unknown>;
        stepIdx++;
      } else {
        response = autoRespond(m, msgType);
        if (!response) {
          console.error(`[replay-file-to-fixture] no response for prompt type=${msgType} stepIdx=${stepIdx} (captured type mismatch)`);
          terminated = 'responses-exhausted';
          break;
        }
      }
      core.duelSetResponse(duel, response);
    }

    if (status === OcgProcessResult.END) {
      terminated = 'duel-end';
      break;
    }
    if (stepIdx >= steps.length && !messages.some(mm => isSelectPrompt((mm as Record<string, unknown>)['type'] as number))) {
      const drainStatus = core.duelProcess(duel);
      core.duelGetMessage(duel);
      if (drainStatus === OcgProcessResult.END) terminated = 'duel-end';
      else terminated = 'responses-exhausted';
      break;
    }
  }

  // DIAGNOSTIC: dump field state for both players before capture
  try {
    const field = core.duelQueryField(duel) as { players: Array<{ monsters: Array<{ position?: number } | null>; spells: Array<{ position?: number } | null>; field?: { position?: number } | null; lp?: number }> };
    for (let p = 0; p < 2; p++) {
      const pp = field.players[p];
      const mz = (pp.monsters ?? []).map((s, i) => s && s.position ? `${['M1','M2','M3','M4','M5','EMZ_L','EMZ_R'][i]}(pos=${s.position})` : null).filter(Boolean).join(', ');
      const sz = (pp.spells ?? []).map((s, i) => s && s.position ? `${['S1','S2','S3','S4','S5','PZ_L','PZ_R'][i] ?? `SZ${i}`}(pos=${s.position})` : null).filter(Boolean).join(', ');
      const fz = pp.field && pp.field.position ? `FIELD(pos=${pp.field.position})` : '';
      console.log(`[diag] P${p} LP=${pp.lp} MZ=[${mz}] SZ=[${sz}] ${fz}`);
    }
  } catch (e) { console.log('[diag] duelQueryField failed:', e); }

  const hand = capturedHand ?? [];
  const expectedBoard = captureExpectedBoard(core, duel, args.player, cardName);

  core.destroyDuel(duel);
  cardDB.db.close();

  return { hand, expectedBoard, iterationsUsed: iter, terminated, rawStepsConsumed: stepIdx };
}

// -----------------------------------------------------------------------------
// CardDB-backed name resolution
// -----------------------------------------------------------------------------
function buildCardNameLookup(dbPath: string): (id: number) => string {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const stmt = db.prepare('SELECT name FROM texts WHERE id = ?');
  const cache = new Map<number, string>();
  return (id: number): string => {
    if (cache.has(id)) return cache.get(id)!;
    const row = stmt.get(id) as { name?: string } | undefined;
    const name = row?.name ?? `unknown-${id}`;
    cache.set(id, name);
    return name;
  };
}

// -----------------------------------------------------------------------------
// Output writers
// -----------------------------------------------------------------------------
interface DecksFileShape {
  _meta: Record<string, unknown>;
  decks: Record<string, { main: number[]; extra: number[]; _source?: string }>;
  hands: Array<{
    id: string;
    deck: string;
    description: string;
    hand: number[];
    deckSeed: string;
    maxDepth?: number;
    expectedBoard: ExpectedBoardEntry[];
    _seedFrozen?: boolean;
    _replayDerivedFrom?: string;
  }>;
}

function buildFixtureEntry(args: Args, raw: RawReplayFile, run: RunResult): {
  deck: { main: number[]; extra: number[]; _source: string };
  hand: DecksFileShape['hands'][number];
} {
  const deck = {
    main: [...raw.decks[args.player].main],
    extra: [...raw.decks[args.player].extra],
    _source: `raw-replay ${raw.sourceReplayId ?? raw.fixtureId}`,
  };
  // 4-bigint deckSeed (full): preserves byte-exact OCGCore reproducibility
  // from the originating PvP replay. Solver evaluator (evaluate-structural.ts)
  // and ocgcore-adapter both accept length>=4 verbatim.
  const deckSeed = raw.seed.join(',');
  const handEntry: DecksFileShape['hands'][number] = {
    id: args.fixtureId,
    deck: args.deckId,
    description: args.description,
    hand: run.hand,
    deckSeed,
    maxDepth: 75,
    expectedBoard: run.expectedBoard,
    _seedFrozen: true,
    _replayDerivedFrom: raw.sourceReplayId ?? raw.fixtureId,
  };
  return { deck, hand: handEntry };
}

function applyToDecksFile(args: Args, deck: { main: number[]; extra: number[]; _source: string }, hand: DecksFileShape['hands'][number]): void {
  const content = readFileSync(args.decksFile, 'utf-8');
  const data = JSON.parse(content) as DecksFileShape;

  if (!data.decks[args.deckId]) {
    data.decks[args.deckId] = deck;
    console.log(`[replay-file-to-fixture] added new deck '${args.deckId}' (main=${deck.main.length} extra=${deck.extra.length})`);
  } else {
    console.log(`[replay-file-to-fixture] deck '${args.deckId}' already exists — not overwriting`);
  }

  const existingIdx = data.hands.findIndex(h => h.id === args.fixtureId);
  if (existingIdx >= 0) {
    data.hands[existingIdx] = hand;
    console.log(`[replay-file-to-fixture] replaced fixture '${args.fixtureId}'`);
  } else {
    data.hands.push(hand);
    console.log(`[replay-file-to-fixture] added fixture '${args.fixtureId}'`);
  }

  writeFileSync(args.decksFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`[replay-file-to-fixture] wrote ${args.decksFile}`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = loadArgs();
  if (!existsSync(args.decksFile)) {
    throw new Error(`solver-validation-decks.json not found at ${args.decksFile}`);
  }
  if (!existsSync(args.rawReplayPath)) {
    throw new Error(`raw-replay file not found at ${args.rawReplayPath}`);
  }
  const raw = loadRawReplay(args.rawReplayPath);
  console.log(`[replay-file-to-fixture] raw-replay: fixtureId=${raw.fixtureId} steps=${raw.responseCount} player=${args.player}`);
  console.log(`[replay-file-to-fixture] seed=[${raw.seed.join(', ')}]`);
  console.log(`[replay-file-to-fixture] deck[player=${args.player}]: main=${raw.decks[args.player].main.length} extra=${raw.decks[args.player].extra.length}`);

  const cardName = buildCardNameLookup(join(resolve(import.meta.dirname!, '..', '..', '..', 'data'), 'cards.cdb'));
  const core = await createSyncCore();
  const cardDB = loadDatabase(join(resolve(import.meta.dirname!, '..', '..', '..', 'data'), 'cards.cdb'));
  const scripts = loadScripts(join(resolve(import.meta.dirname!, '..', '..', '..', 'data'), 'scripts_full'));
  const seed = raw.seed.map(s => BigInt(s)) as [bigint, bigint, bigint, bigint];
  const run = runReplayOnCore(core, cardDB, scripts, seed, args, raw, cardName);

  console.log(`[replay-file-to-fixture] termination=${run.terminated} iters=${run.iterationsUsed} stepsConsumed=${run.rawStepsConsumed}/${raw.steps.length}`);
  console.log(`[replay-file-to-fixture] hand (${run.hand.length}): ${run.hand.map(id => `${id} ${cardName(id)}`).join(', ')}`);
  console.log(`[replay-file-to-fixture] expectedBoard (${run.expectedBoard.length} pieces):`);
  for (const p of run.expectedBoard) {
    console.log(`  - ${p.zone} ${p.cardId} ${p.cardName} (${p.position})`);
  }

  const { deck, hand } = buildFixtureEntry(args, raw, run);

  if (args.apply) {
    applyToDecksFile(args, deck, hand);
  } else {
    const dryRun = { deck: { id: args.deckId, ...deck }, hand };
    writeFileSync(args.outDryRun, JSON.stringify(dryRun, null, 2) + '\n', 'utf-8');
    console.log(`[replay-file-to-fixture] DRY-RUN — wrote ${args.outDryRun} (use --apply to commit to ${args.decksFile})`);
  }

  console.log(`[replay-file-to-fixture] DONE`);
}

main().catch(err => {
  console.error('[replay-file-to-fixture] FATAL:', err);
  process.exit(1);
});
