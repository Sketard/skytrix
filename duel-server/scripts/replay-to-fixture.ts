// =============================================================================
// replay-to-fixture.ts — turn a PvP replay into a solver fixture + raw trajectory.
//
// Fetches a replay from the Spring Boot backend, feeds its captured responses
// to a fresh OCGCore duel, captures the player's initial hand + the final
// board state, then writes three artifacts:
//
//   1. Deck entry appended to solver-validation-decks.json (if not present)
//   2. Fixture entry appended to solver-validation-decks.json `hands[]`
//   3. Raw-replay trajectory file (response stream + seed) for faithful playback
//
// The raw-replay trajectory is bit-exact reproducible via OCGCore direct
// (bypasses the solver adapter). It's NOT consumable by the DFS solver; the
// fixture's `expectedBoard` + `hand` + `deckSeed` are what the solver sees.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/replay-to-fixture.ts \
//     --replay-id=a3f26150-dbfd-4fa7-b440-f508fef648e7 \
//     --fixture-id=snake-eye-yummy-opener \
//     --deck-id=snake-eye-yummy-sarcophagus-hollywood-wcq \
//     --description="..." \
//     [--player=0] [--api-url=http://localhost:8080/api] [--api-key=dev-internal-key]
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../src/ocg-callbacks.js';

// -----------------------------------------------------------------------------
// CLI args
// -----------------------------------------------------------------------------
function parseArg(name: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

interface Args {
  replayId: string;
  fixtureId: string;
  deckId: string;
  description: string;
  apiUrl: string;
  apiKey: string;
  player: 0 | 1;
  decksFile: string;
  trajectoriesDir: string;
  maxIterations: number;
}

function loadArgs(): Args {
  const replayId = parseArg('replay-id');
  const fixtureId = parseArg('fixture-id');
  const deckId = parseArg('deck-id');
  if (!replayId || !fixtureId || !deckId) {
    console.error('[replay-to-fixture] required: --replay-id --fixture-id --deck-id');
    process.exit(2);
  }
  const playerStr = parseArg('player') ?? '0';
  const player = (playerStr === '1' ? 1 : 0) as 0 | 1;
  const repoRoot = resolve(import.meta.dirname!, '../..');
  return {
    replayId,
    fixtureId,
    deckId,
    description: parseArg('description') ?? `Auto-generated from PvP replay ${replayId}`,
    apiUrl: parseArg('api-url') ?? process.env['SPRING_BOOT_API_URL'] ?? 'http://localhost:8080/api',
    apiKey: parseArg('api-key') ?? process.env['INTERNAL_API_KEY'] ?? 'dev-internal-key',
    player,
    decksFile: parseArg('decks-file') ?? join(repoRoot, '_bmad-output/planning-artifacts/research/solver-validation-decks.json'),
    trajectoriesDir: parseArg('trajectories-dir') ?? join(repoRoot, '_bmad-output/planning-artifacts/research/trajectories'),
    maxIterations: Number(parseArg('max-iterations') ?? '500'),
  };
}

// -----------------------------------------------------------------------------
// Replay fetch
// -----------------------------------------------------------------------------
interface ReplayApiResponse {
  id: string;
  player1Id: number;
  player2Id: number;
  metadata: {
    turnCount: number;
    result: string;
    date: string;
    scriptsHash: string;
    ocgcoreVersion: string;
  };
  replayData: {
    seed: string[];
    decks: [{ main: number[]; extra: number[] }, { main: number[]; extra: number[] }];
    playerResponses: { data: Record<string, unknown>; timestamp?: string }[];
  };
}

async function fetchReplay(args: Args): Promise<ReplayApiResponse> {
  const url = `${args.apiUrl}/internal/replays/${args.replayId}`;
  console.log(`[replay-to-fixture] fetching ${url}`);
  const res = await fetch(url, { headers: { 'X-Internal-Key': args.apiKey } });
  if (!res.ok) throw new Error(`Replay fetch failed: HTTP ${res.status}`);
  return await res.json() as ReplayApiResponse;
}

// -----------------------------------------------------------------------------
// OCGCore replay runner
// -----------------------------------------------------------------------------
// Expected response.data.type per OCG prompt message type. Used to
// auto-detect replay gaps (RPS/initial SELECT_OPTION not stored in playerResponses).
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

// Auto-response used for prompts present in the engine flow but NOT stored in
// playerResponses (RPS, first-or-second SELECT_OPTION). Must be deterministic
// so the fixture is reproducible.
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

// Query a zone's first card. `duelQuery` in ocgcore-wasm 0.1.1 returns null
// for occupied zones when multiple flags are OR'd together — so query each
// flag separately (same workaround as duel-worker.ts::queryCard).
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
  const flags = (OcgQueryFlags.CODE as number);
  const cards = core.duelQueryLocation(duel, { flags, controller, location: OcgLocation.HAND }) as Array<{ code?: number } | null>;
  return cards.filter(c => c != null && c.code != null).map(c => c!.code!);
}

function positionToString(pos: number): 'attack' | 'defense' | 'set' {
  if (pos === OcgPosition.FACEUP_ATTACK) return 'attack';
  if (pos === OcgPosition.FACEUP_DEFENSE) return 'defense';
  return 'set'; // facedown attack or facedown defense
}

interface ExpectedBoardEntry {
  zone: 'MZONE' | 'SZONE' | 'FIELD';
  cardId: number;
  cardName: string;
  position: 'attack' | 'defense' | 'set';
}

function captureExpectedBoard(core: any, duel: any, controller: 0 | 1, cardName: (id: number) => string): ExpectedBoardEntry[] {
  const out: ExpectedBoardEntry[] = [];
  // Main Monster Zones + EMZ (seq 0-6)
  for (let seq = 0; seq < 7; seq++) {
    const c = queryZoneCard(core, duel, controller, OcgLocation.MZONE, seq);
    if (c) out.push({ zone: 'MZONE', cardId: c.code, cardName: cardName(c.code), position: positionToString(c.position) });
  }
  // Spell/Trap Zones (seq 0-4)
  for (let seq = 0; seq < 5; seq++) {
    const c = queryZoneCard(core, duel, controller, OcgLocation.SZONE, seq);
    if (c) out.push({ zone: 'SZONE', cardId: c.code, cardName: cardName(c.code), position: positionToString(c.position) });
  }
  // Field Zone (seq 5 on SZONE in OCGCore convention, or FZONE location)
  const fz = queryZoneCard(core, duel, controller, OcgLocation.FZONE, 0);
  if (fz) out.push({ zone: 'FIELD', cardId: fz.code, cardName: cardName(fz.code), position: positionToString(fz.position) });
  return out;
}

interface RawReplayStep {
  stepIdx: number;
  promptType: number;
  promptTypeName: string;
  promptPlayer: number;
  response: Record<string, unknown>;
  autoRespond: boolean; // true if response was auto-generated (not from playerResponses)
}

interface RunResult {
  hand: number[];
  expectedBoard: ExpectedBoardEntry[];
  rawSteps: RawReplayStep[];
  iterationsUsed: number;
  terminated: 'responses-exhausted' | 'duel-end' | 'max-iterations';
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
  replay: ReplayApiResponse,
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

  // Load both decks into their respective sides
  for (let team = 0; team < 2; team++) {
    const deck = replay.replayData.decks[team];
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

  const rawSteps: RawReplayStep[] = [];
  const responses = replay.replayData.playerResponses;
  let responseIdx = 0;
  let capturedHand: number[] | null = null;
  let iter = 0;
  let terminated: RunResult['terminated'] = 'max-iterations';

  while (iter < args.maxIterations) {
    iter++;
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const msgType = (m['type'] as number);
      if (!isSelectPrompt(msgType)) continue;

      // Capture initial hand at the first SELECT_IDLECMD for the tracked player
      if (capturedHand === null
        && msgType === OcgMessageType.SELECT_IDLECMD
        && (m['player'] as number) === args.player) {
        capturedHand = queryHand(core, duel, args.player);
      }

      // Decide response: captured one if types match, otherwise auto-respond
      const expectedType = EXPECTED_RESPONSE_TYPE[msgType];
      const captured = responseIdx < responses.length ? responses[responseIdx].data : null;
      const capturedTypeMatches = captured != null && (captured['type'] as number) === expectedType;
      let response: Record<string, unknown> | null;
      let isAuto = false;

      if (capturedTypeMatches) {
        response = captured as Record<string, unknown>;
        responseIdx++;
      } else {
        response = autoRespond(m, msgType);
        isAuto = true;
        if (!response) {
          console.error(`[replay-to-fixture] no response for prompt type=${msgType} (no auto-respond, captured type mismatch)`);
          terminated = 'responses-exhausted';
          break;
        }
      }

      rawSteps.push({
        stepIdx: rawSteps.length,
        promptType: msgType,
        promptTypeName: OcgMessageType[msgType] ?? `type${msgType}`,
        promptPlayer: (m['player'] as number) ?? -1,
        response,
        autoRespond: isAuto,
      });
      core.duelSetResponse(duel, response);
    }

    if (status === OcgProcessResult.END) {
      terminated = 'duel-end';
      break;
    }
    if (responseIdx >= responses.length && !messages.some(mm => isSelectPrompt((mm as Record<string, unknown>)['type'] as number))) {
      // No more captured responses to feed + no pending select. Stop to capture board.
      // We still drain one more tick to let end-of-turn settle.
      const drainStatus = core.duelProcess(duel);
      const _drain = core.duelGetMessage(duel);
      if (drainStatus === OcgProcessResult.END) terminated = 'duel-end';
      else terminated = 'responses-exhausted';
      break;
    }
  }

  const hand = capturedHand ?? [];
  // DIAGNOSTIC: dump authoritative field view for both players before capture
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
  const expectedBoard = captureExpectedBoard(core, duel, args.player, cardName);

  core.destroyDuel(duel);
  cardDB.db.close();

  return { hand, expectedBoard, rawSteps, iterationsUsed: iter, terminated };
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
  }>;
}

function upsertDeckAndFixture(args: Args, replay: ReplayApiResponse, run: RunResult): void {
  const content = readFileSync(args.decksFile, 'utf-8');
  const data = JSON.parse(content) as DecksFileShape;

  // Upsert deck
  if (!data.decks[args.deckId]) {
    data.decks[args.deckId] = {
      main: [...replay.replayData.decks[args.player].main],
      extra: [...replay.replayData.decks[args.player].extra],
    };
    console.log(`[replay-to-fixture] added new deck '${args.deckId}' (main=${data.decks[args.deckId].main.length} extra=${data.decks[args.deckId].extra.length})`);
  } else {
    console.log(`[replay-to-fixture] deck '${args.deckId}' already exists — not overwriting`);
  }

  // First 2 bigints of replay.seed form the deckSeed in fixture format
  const deckSeed = `${replay.replayData.seed[0]},${replay.replayData.seed[1]}`;

  // Upsert fixture
  const existingIdx = data.hands.findIndex(h => h.id === args.fixtureId);
  const entry = {
    id: args.fixtureId,
    deck: args.deckId,
    description: args.description,
    hand: run.hand,
    deckSeed,
    maxDepth: 75,
    expectedBoard: run.expectedBoard,
    _seedFrozen: true,
  };
  if (existingIdx >= 0) {
    data.hands[existingIdx] = entry;
    console.log(`[replay-to-fixture] replaced fixture '${args.fixtureId}'`);
  } else {
    data.hands.push(entry);
    console.log(`[replay-to-fixture] added fixture '${args.fixtureId}'`);
  }

  writeFileSync(args.decksFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`[replay-to-fixture] wrote ${args.decksFile}`);
}

function writeRawTrajectory(args: Args, replay: ReplayApiResponse, run: RunResult): void {
  mkdirSync(args.trajectoriesDir, { recursive: true });
  const outPath = join(args.trajectoriesDir, `${args.fixtureId}.raw-replay.json`);
  const content = {
    format: 'raw-replay-v1',
    fixtureId: args.fixtureId,
    sourceReplayId: args.replayId,
    generatedAt: new Date().toISOString(),
    terminated: run.terminated,
    iterationsUsed: run.iterationsUsed,
    responseCount: run.rawSteps.length,
    playerTracked: args.player,
    seed: replay.replayData.seed,
    decks: replay.replayData.decks,
    steps: run.rawSteps,
  };
  writeFileSync(outPath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  console.log(`[replay-to-fixture] wrote ${outPath} (${run.rawSteps.length} steps)`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = loadArgs();
  if (!existsSync(args.decksFile)) {
    throw new Error(`solver-validation-decks.json not found at ${args.decksFile}`);
  }
  const replay = await fetchReplay(args);
  console.log(`[replay-to-fixture] replay: turnCount=${replay.metadata.turnCount} result=${replay.metadata.result} responses=${replay.replayData.playerResponses.length} ocgcore=${replay.metadata.ocgcoreVersion}`);

  const cardName = buildCardNameLookup(join(resolve(import.meta.dirname!, '../data'), 'cards.cdb'));
  const core = await createSyncCore();
  const cardDB = loadDatabase(join(resolve(import.meta.dirname!, '../data'), 'cards.cdb'));
  const scripts = loadScripts(join(resolve(import.meta.dirname!, '../data'), 'scripts_full'));
  const seed = replay.replayData.seed.map(s => BigInt(s)) as [bigint, bigint, bigint, bigint];
  const run = runReplayOnCore(core, cardDB, scripts, seed, args, replay, cardName);

  console.log(`[replay-to-fixture] termination=${run.terminated} iters=${run.iterationsUsed}`);
  console.log(`[replay-to-fixture] hand (${run.hand.length}): ${run.hand.map(id => `${id} ${cardName(id)}`).join(', ')}`);
  console.log(`[replay-to-fixture] expectedBoard (${run.expectedBoard.length} pieces):`);
  for (const p of run.expectedBoard) {
    console.log(`  - ${p.zone} ${p.cardId} ${p.cardName} (${p.position})`);
  }
  const autoCount = run.rawSteps.filter(s => s.autoRespond).length;
  console.log(`[replay-to-fixture] raw steps: ${run.rawSteps.length} (${autoCount} auto-responded, ${run.rawSteps.length - autoCount} from capture)`);

  upsertDeckAndFixture(args, replay, run);
  writeRawTrajectory(args, replay, run);

  console.log(`[replay-to-fixture] DONE`);
}

main().catch(err => {
  console.error('[replay-to-fixture] FATAL:', err);
  process.exit(1);
});
