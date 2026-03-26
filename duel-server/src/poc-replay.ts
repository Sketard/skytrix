/**
 * POC Replay — Validates the 3 core replay mechanisms:
 *   1. Capture seed+responses → replay deterministically
 *   2. Seek performance (fast-forward benchmark)
 *   3. Fork (stop replay mid-way, continue with new auto-responses)
 *
 * Usage: npx tsx src/poc-replay.ts
 */
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
} from '@n1xx1/ocgcore-wasm';
import Database from 'better-sqlite3';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// --- Types ---
interface CapturedResponse {
  index: number;
  data: unknown;
  promptType: number;
}

interface ReplayData {
  seed: [bigint, bigint, bigint, bigint];
  decks: [{ main: number[]; extra: number[] }, { main: number[]; extra: number[] }];
  playerResponses: CapturedResponse[];
}

interface DuelResult {
  messages: { type: number }[];
  finalLP: [number, number];
  turnCount: number;
}

// --- Paths ---
const DATA_DIR = resolve(import.meta.dirname!, '../data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');

// --- Card Database ---
function openDB() {
  const db = new Database(DB_PATH, { readonly: true });
  const cardStmt = db.prepare(
    'SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?'
  );
  return { db, cardStmt };
}

function createCardReader(cardStmt: Database.Statement) {
  return (code: number) => {
    const row = cardStmt.get(code) as any;
    if (!row) return null;
    const setcodes: number[] = [];
    let sc = BigInt(row.setcode);
    for (let i = 0; i < 4; i++) {
      const val = Number(sc & 0xffffn);
      if (val) setcodes.push(val);
      sc >>= 16n;
    }
    return {
      code: row.id,
      alias: row.alias,
      setcodes,
      type: row.type,
      level: row.level & 0xff,
      lscale: (row.level >> 24) & 0xff,
      rscale: (row.level >> 16) & 0xff,
      attack: row.atk,
      defense: row.def,
      race: BigInt(row.race),
      attribute: row.attribute,
    };
  };
}

function createScriptReader() {
  return (name: string): string | null => {
    const locations = [
      join(SCRIPTS_DIR, name),
      join(SCRIPTS_DIR, 'official', name),
      join(SCRIPTS_DIR, 'goat', name),
      join(SCRIPTS_DIR, 'pre-release', name),
    ];
    for (const path of locations) {
      if (existsSync(path)) return readFileSync(path, 'utf-8');
    }
    return null;
  };
}

// --- Startup Scripts ---
const STARTUP_SCRIPTS = [
  'constant.lua',
  'utility.lua',
  'archetype_setcode_constants.lua',
  'card_counter_constants.lua',
  'cards_specific_functions.lua',
  'deprecated_functions.lua',
  'proc_equip.lua',
  'proc_fusion.lua',
  'proc_fusion_spell.lua',
  'proc_gemini.lua',
  'proc_link.lua',
  'proc_maximum.lua',
  'proc_normal.lua',
  'proc_pendulum.lua',
  'proc_ritual.lua',
  'proc_spirit.lua',
  'proc_synchro.lua',
  'proc_toon.lua',
  'proc_union.lua',
  'proc_xyz.lua',
];

// --- Test Decks ---
const DECK_1 = {
  main: [
    38232082, 38232082, 38232082,
    69247929, 69247929, 69247929,
    6368038, 6368038, 6368038,
    83764718, 83764718, 83764718,
    5318639, 5318639, 5318639,
    44095762, 44095762, 44095762,
    4031928, 4031928, 4031928,
    64788463, 64788463, 64788463,
    66788016, 66788016, 66788016,
    76184692, 76184692, 76184692,
    55144522, 55144522, 55144522,
    85309439,
  ],
  extra: [],
};
const DECK_2 = { main: [...DECK_1.main], extra: [] };

// --- Auto-respond (from poc-duel.ts) ---
function autoRespond(msg: any): any {
  switch (msg.type) {
    case OcgMessageType.SELECT_BATTLECMD:
      if (msg.attacks?.length > 0) return { type: 0, action: 1, index: 0 };
      if (msg.to_ep) return { type: 0, action: 3 };
      if (msg.to_m2) return { type: 0, action: 2 };
      return { type: 0, action: 3 };
    case OcgMessageType.SELECT_IDLECMD:
      if (msg.summons?.length > 0) return { type: 1, action: 0, index: 0 };
      if (msg.to_bp) return { type: 1, action: 6 };
      if (msg.to_ep) return { type: 1, action: 7 };
      return { type: 1, action: 7 };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: 2, yes: true };
    case OcgMessageType.SELECT_YESNO:
      return { type: 3, yes: false };
    case OcgMessageType.SELECT_OPTION:
      return { type: 4, index: 0 };
    case OcgMessageType.SELECT_CARD:
      return { type: 5, indicies: Array.from({ length: msg.min }, (_, i) => i) };
    case OcgMessageType.SELECT_CHAIN:
      return { type: 8, index: null };
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD:
      return { type: 10, places: [{ player: msg.player, location: OcgLocation.MZONE, sequence: 2 }] };
    case OcgMessageType.SELECT_POSITION:
      return { type: 11, position: OcgPosition.FACEUP_ATTACK };
    case OcgMessageType.SELECT_TRIBUTE:
      return { type: 12, indicies: Array.from({ length: msg.min }, (_, i) => i) };
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: 20, value: 2 };
    case OcgMessageType.SELECT_COUNTER:
      return { type: 13, counters: msg.cards.map(() => 0) };
    case OcgMessageType.SELECT_SUM:
      return { type: 14, indicies: [0] };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (msg.can_finish) return { type: 7, index: null };
      return { type: 7, index: 0 };
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return { type: 15, order: null };
    case OcgMessageType.ANNOUNCE_RACE:
      return { type: 16, races: [1n] };
    case OcgMessageType.ANNOUNCE_ATTRIB:
      return { type: 17, attributes: [32] };
    case OcgMessageType.ANNOUNCE_CARD:
      return { type: 18, card: 46986414 };
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: 19, value: Number(msg.options[0]) };
    default:
      return null;
  }
}

// --- SELECT_* type check ---
function isSelectMessage(type: number): boolean {
  return [
    OcgMessageType.SELECT_IDLECMD, OcgMessageType.SELECT_BATTLECMD,
    OcgMessageType.SELECT_EFFECTYN, OcgMessageType.SELECT_YESNO,
    OcgMessageType.SELECT_OPTION, OcgMessageType.SELECT_CARD,
    OcgMessageType.SELECT_CHAIN, OcgMessageType.SELECT_PLACE,
    OcgMessageType.SELECT_POSITION, OcgMessageType.SELECT_TRIBUTE,
    OcgMessageType.SELECT_COUNTER, OcgMessageType.SELECT_SUM,
    OcgMessageType.SELECT_DISFIELD, OcgMessageType.SELECT_UNSELECT_CARD,
    OcgMessageType.SORT_CARD, OcgMessageType.SORT_CHAIN,
    OcgMessageType.ANNOUNCE_RACE, OcgMessageType.ANNOUNCE_ATTRIB,
    OcgMessageType.ANNOUNCE_CARD, OcgMessageType.ANNOUNCE_NUMBER,
    OcgMessageType.ROCK_PAPER_SCISSORS,
  ].includes(type);
}

// --- Core helpers ---
function loadStartupScripts(core: any, duel: any) {
  for (const name of STARTUP_SCRIPTS) {
    const path = join(SCRIPTS_DIR, name);
    if (existsSync(path)) {
      core.loadScript(duel, name, readFileSync(path, 'utf-8'));
    }
  }
}

function loadDecks(core: any, duel: any, decks: ReplayData['decks']) {
  for (let team = 0; team < 2; team++) {
    const deck = decks[team as 0 | 1];
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
}

function createDuelInstance(core: any, seed: ReplayData['seed'], cardStmt: Database.Statement) {
  return core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed,
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader: createCardReader(cardStmt),
    scriptReader: createScriptReader(),
    errorHandler: () => {},
  });
}

// ============================================================
// STEP 1: CAPTURE — Run a duel and capture seed + responses
// ============================================================
async function runCapture(core: any, cardStmt: Database.Statement): Promise<{ replay: ReplayData; result: DuelResult }> {
  const seed: ReplayData['seed'] = [42n, 123n, 456n, 789n];
  const decks: ReplayData['decks'] = [
    { main: [...DECK_1.main], extra: [...DECK_1.extra] },
    { main: [...DECK_2.main], extra: [...DECK_2.extra] },
  ];
  const responses: CapturedResponse[] = [];
  const allMessages: { type: number }[] = [];

  const duel = createDuelInstance(core, seed, cardStmt);
  loadStartupScripts(core, duel);
  loadDecks(core, duel, decks);
  core.startDuel(duel);

  let turnCount = 0;
  let finalLP: [number, number] = [8000, 8000];
  let iterations = 0;

  while (iterations++ < 500) {
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      allMessages.push({ type: msg.type });

      if (msg.type === OcgMessageType.NEW_TURN) turnCount++;
      if (msg.type === OcgMessageType.LPUPDATE) {
        finalLP[(msg as any).player] = (msg as any).lp;
      }

      // Capture via wrapper pattern (ADR-1)
      const response = autoRespond(msg);
      if (response) {
        responses.push({ index: responses.length, data: response, promptType: msg.type });
        core.duelSetResponse(duel, response);
      }
    }

    if (status === OcgProcessResult.END) break;
  }

  core.destroyDuel(duel);

  return {
    replay: { seed, decks, playerResponses: responses },
    result: { messages: allMessages, finalLP, turnCount },
  };
}

// ============================================================
// STEP 2: REPLAY — Replay from captured data, compare results
// ============================================================
function runReplay(core: any, replay: ReplayData, cardStmt: Database.Statement): DuelResult {
  const duel = createDuelInstance(core, replay.seed, cardStmt);
  loadStartupScripts(core, duel);
  loadDecks(core, duel, replay.decks);
  core.startDuel(duel);

  const allMessages: { type: number }[] = [];
  let responseIndex = 0;
  let turnCount = 0;
  let finalLP: [number, number] = [8000, 8000];
  let iterations = 0;

  while (iterations++ < 500) {
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      allMessages.push({ type: msg.type });

      if (msg.type === OcgMessageType.NEW_TURN) turnCount++;
      if (msg.type === OcgMessageType.LPUPDATE) {
        finalLP[(msg as any).player] = (msg as any).lp;
      }

      if (isSelectMessage(msg.type)) {
        if (responseIndex >= replay.playerResponses.length) {
          throw new Error(`Replay ran out of responses at index ${responseIndex}`);
        }
        const captured = replay.playerResponses[responseIndex];
        if (captured.promptType !== msg.type) {
          throw new Error(
            `Replay diverged at response ${responseIndex}: expected prompt ${captured.promptType}, got ${msg.type}`
          );
        }
        core.duelSetResponse(duel, captured.data);
        responseIndex++;
      }
    }

    if (status === OcgProcessResult.END) break;
  }

  core.destroyDuel(duel);
  return { messages: allMessages, finalLP, turnCount };
}

// ============================================================
// STEP 3: SEEK BENCHMARK — Fast-forward full replay, measure time
// ============================================================
function runSeekBenchmark(core: any, replay: ReplayData, cardStmt: Database.Statement): number {
  const start = performance.now();

  const duel = createDuelInstance(core, replay.seed, cardStmt);
  loadStartupScripts(core, duel);
  loadDecks(core, duel, replay.decks);
  core.startDuel(duel);

  let responseIndex = 0;
  let iterations = 0;

  while (iterations++ < 500) {
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      if (isSelectMessage(msg.type) && responseIndex < replay.playerResponses.length) {
        core.duelSetResponse(duel, replay.playerResponses[responseIndex].data);
        responseIndex++;
      }
    }

    if (status === OcgProcessResult.END) break;
  }

  core.destroyDuel(duel);
  return performance.now() - start;
}

// ============================================================
// STEP 4: FORK — Stop replay mid-way, continue with auto-responses
// ============================================================
function runFork(core: any, replay: ReplayData, forkAtResponse: number, cardStmt: Database.Statement): { additionalResponses: number; forkedLP: [number, number] } {
  const duel = createDuelInstance(core, replay.seed, cardStmt);
  loadStartupScripts(core, duel);
  loadDecks(core, duel, replay.decks);
  core.startDuel(duel);

  let responseIndex = 0;
  let iterations = 0;
  let forked = false;
  let additionalResponses = 0;
  let finalLP: [number, number] = [8000, 8000];

  while (iterations++ < 500) {
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      if (msg.type === OcgMessageType.LPUPDATE) {
        finalLP[(msg as any).player] = (msg as any).lp;
      }

      if (isSelectMessage(msg.type)) {
        if (!forked && responseIndex < forkAtResponse) {
          // Replay mode: use captured responses
          core.duelSetResponse(duel, replay.playerResponses[responseIndex].data);
          responseIndex++;
        } else {
          // Solo mode: fork happened, use auto-responses
          if (!forked) {
            forked = true;
          }
          const response = autoRespond(msg);
          if (response) {
            core.duelSetResponse(duel, response);
            additionalResponses++;
          }
        }
      }
    }

    if (status === OcgProcessResult.END) break;
  }

  core.destroyDuel(duel);
  return { additionalResponses, forkedLP: finalLP };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('=== POC Replay — Skytrix Duel Server ===\n');

  const core = await createCore({ sync: true });
  const { db, cardStmt } = openDB();

  try {
    // --- STEP 1: Capture ---
    console.log('STEP 1: CAPTURE — Running a full duel with auto-responses...');
    const { replay, result: captureResult } = await runCapture(core, cardStmt);
    console.log(`  ✓ Capture: ${replay.playerResponses.length} responses captured`);
    console.log(`    ${captureResult.messages.length} messages, ${captureResult.turnCount} turns`);
    console.log(`    Final LP: P0=${captureResult.finalLP[0]}, P1=${captureResult.finalLP[1]}\n`);

    // Save replay to file for inspection
    const replayJson = JSON.stringify(replay, (_, v) => typeof v === 'bigint' ? v.toString() + 'n' : v, 2);
    writeFileSync(join(DATA_DIR, 'poc-replay-data.json'), replayJson);
    console.log(`  → Saved to data/poc-replay-data.json (${(replayJson.length / 1024).toFixed(1)} KB)\n`);

    // --- STEP 2: Replay ---
    console.log('STEP 2: REPLAY — Replaying from captured data...');
    const replayResult = runReplay(core, replay, cardStmt);

    const messagesMatch = captureResult.messages.length === replayResult.messages.length
      && captureResult.messages.every((m, i) => m.type === replayResult.messages[i].type);
    const lpMatch = captureResult.finalLP[0] === replayResult.finalLP[0]
      && captureResult.finalLP[1] === replayResult.finalLP[1];

    if (messagesMatch && lpMatch) {
      console.log(`  ✓ Replay: DETERMINISTIC`);
      console.log(`    Same ${replayResult.messages.length} messages, same final LP`);
    } else {
      console.log(`  ✗ Replay: DIVERGED`);
      console.log(`    Messages: ${captureResult.messages.length} vs ${replayResult.messages.length} (${messagesMatch ? 'match' : 'MISMATCH'})`);
      console.log(`    LP: [${captureResult.finalLP}] vs [${replayResult.finalLP}] (${lpMatch ? 'match' : 'MISMATCH'})`);
    }
    console.log(`    Turns: ${replayResult.turnCount}\n`);

    // --- STEP 3: Seek Benchmark ---
    console.log('STEP 3: SEEK BENCHMARK — Fast-forward full replay (5 runs)...');
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      times.push(runSeekBenchmark(core, replay, cardStmt));
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    console.log(`  ✓ Seek: avg ${avg.toFixed(0)}ms, min ${min.toFixed(0)}ms, max ${max.toFixed(0)}ms`);
    console.log(`    ${replay.playerResponses.length} responses replayed per run`);
    console.log(`    Performance gate: ${avg < 2000 ? 'PASS (< 2s)' : 'FAIL (> 2s) — checkpoints needed'}\n`);

    // --- STEP 4: Fork ---
    const forkPoint = Math.floor(replay.playerResponses.length / 2);
    console.log(`STEP 4: FORK — Forking at response ${forkPoint}/${replay.playerResponses.length}...`);
    const forkResult = runFork(core, replay, forkPoint, cardStmt);
    console.log(`  ✓ Fork at response ${forkPoint}: duel continued`);
    console.log(`    ${forkResult.additionalResponses} additional auto-responses after fork`);
    console.log(`    Forked final LP: P0=${forkResult.forkedLP[0]}, P1=${forkResult.forkedLP[1]}\n`);

    // --- Summary ---
    console.log('=== POC RESULTS ===');
    console.log(`  ✓ Capture:  ${replay.playerResponses.length} responses (${(replayJson.length / 1024).toFixed(1)} KB)`);
    console.log(`  ${messagesMatch && lpMatch ? '✓' : '✗'} Replay:   ${messagesMatch && lpMatch ? 'deterministic' : 'DIVERGED'} — ${replayResult.messages.length} messages, LP [${replayResult.finalLP}]`);
    console.log(`  ${avg < 2000 ? '✓' : '✗'} Seek:     ${avg.toFixed(0)}ms avg (${avg < 2000 ? 'PASS' : 'FAIL'})`);
    console.log(`  ✓ Fork:     ${forkResult.additionalResponses} responses after fork point`);
    console.log('\n=== POC Complete ===');

  } finally {
    db.close();
  }
}

main().catch(console.error);
