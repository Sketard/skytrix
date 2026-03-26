/**
 * Combo Path Solver — Proof of Concept
 *
 * Goals:
 * 1. Measure OCGCore per-action latency (duelProcess + duelSetResponse)
 * 2. Measure replay-from-scratch cost (create duel + replay N responses)
 * 3. Implement basic DFS exploring SELECT_IDLECMD actions
 * 4. Report: nodes explored, branching factor, time per node, total time
 *
 * Approach:
 * - Goldfish mode: player 0 combos, player 1 auto-passes everything
 * - Branching only at SELECT_IDLECMD (main phase choices)
 * - All other SELECT_* auto-responded with first valid option
 * - State forking via replay-from-scratch (OCGCore is forward-only)
 */

import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
  type OcgCoreSync,
  type OcgDuelHandle,
} from '@n1xx1/ocgcore-wasm';
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';

// =============================================================================
// Config
// =============================================================================

const DATA_DIR = resolve(import.meta.dirname!, '../data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');

const MAX_DEPTH = 15;
const MAX_NODES = 500;
const MAX_TIME_MS = 30_000;  // 30 second hard cap
const PLAYER = 0;             // Solver controls player 0
const OPPONENT = 1;           // Auto-pass player 1

const DUEL_SEED: [bigint, bigint, bigint, bigint] = [42n, 123n, 456n, 789n];

// =============================================================================
// Card Database
// =============================================================================

const db = new Database(DB_PATH, { readonly: true });
const cardStmt = db.prepare(
  'SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?',
);
const nameStmt = db.prepare('SELECT name FROM texts WHERE id = ?');

function cardReader(code: number) {
  const row = cardStmt.get(code) as any;
  if (!row) return null;
  const setcodes: number[] = [];
  let sc = BigInt(row.setcode);
  for (let i = 0; i < 4; i++) {
    const val = Number(sc & 0xFFFFn);
    if (val) setcodes.push(val);
    sc >>= 16n;
  }
  return {
    code: row.id, alias: row.alias, setcodes, type: row.type,
    level: row.level & 0xFF, lscale: (row.level >> 24) & 0xFF, rscale: (row.level >> 16) & 0xFF,
    attack: row.atk, defense: row.def, race: BigInt(row.race), attribute: row.attribute,
  };
}

function getCardName(code: number): string {
  const row = nameStmt.get(code) as any;
  return row?.name ?? `#${code}`;
}

function scriptReader(name: string): string | null {
  for (const sub of ['', 'official', 'goat', 'pre-release']) {
    const path = sub ? join(SCRIPTS_DIR, sub, name) : join(SCRIPTS_DIR, name);
    if (existsSync(path)) return readFileSync(path, 'utf-8');
  }
  return null;
}

// =============================================================================
// Startup Scripts
// =============================================================================

const STARTUP_SCRIPTS = [
  'constant.lua', 'utility.lua', 'archetype_setcode_constants.lua',
  'card_counter_constants.lua', 'cards_specific_functions.lua', 'deprecated_functions.lua',
  'proc_equip.lua', 'proc_fusion.lua', 'proc_fusion_spell.lua', 'proc_gemini.lua',
  'proc_link.lua', 'proc_maximum.lua', 'proc_normal.lua', 'proc_pendulum.lua',
  'proc_compat.lua', 'proc_persistent.lua', 'proc_ritual.lua', 'proc_spirit.lua',
  'proc_synchro.lua', 'proc_union.lua', 'proc_workaround.lua', 'proc_xyz.lua',
];

// =============================================================================
// Decks
// =============================================================================

// Vanilla deck — baseline measurement (low branching)
const VANILLA_DECK = {
  main: [
    43096270, 43096270, 43096270, // Alexandrite Dragon (Lv4 Normal)
    69247929, 69247929, 69247929, // Gene-Warped Warwolf (Lv4 Normal)
    64788463, 64788463, 64788463, // Luster Dragon (Lv4 Normal)
    66788016, 66788016, 66788016, // Vorse Raider (Lv4 Normal)
    76184692, 76184692, 76184692, // Mechanicalchaser (Lv4 Normal)
    55144522, 55144522, 55144522, // Pot of Greed
    5318639, 5318639, 5318639,    // Mystical Space Typhoon
    83764718, 83764718, 83764718, // Monster Reborn
    70368879, 70368879, 70368879, // Upstart Goblin
    85309439,                      // Luster Dragon #2
  ],
  extra: [],
};

// Combo deck — realistic branching (draw spells + effect monsters + extra deck)
const COMBO_DECK = {
  main: [
    // Effect monsters (summonable, trigger effects)
    40044918, 40044918, 40044918, // Elemental HERO Stratos (search on summon)
    423585, 423585,               // Summoner Monk (discard spell → SS Lv4 from deck)
    63977008, 63977008,           // Junk Synchron (Lv3 Tuner, SS Lv2 from GY)
    97268402, 97268402,           // Effect Veiler (Lv1 Tuner)
    53855409, 53855409,           // Doppelwarrior (SS when warrior SS'd)
    26202165,                      // Sangan (search on leave field)
    41386308,                      // Mathematician (send Lv4- from deck to GY)
    14558127,                      // Ash Blossom (Lv3 Tuner)
    // Draw/search spells (create new options in hand)
    55144522, 55144522, 55144522, // Pot of Greed (draw 2)
    70368879, 70368879, 70368879, // Upstart Goblin (draw 1)
    32807846, 32807846, 32807846, // Reinforcement of the Army (search warrior)
    213326, 213326,               // E - Emergency Call (search E HERO)
    83764718, 83764718,           // Monster Reborn (revive from GY)
    81439173, 81439173,           // Foolish Burial (send from deck to GY)
    8949584,                       // A Hero Lives (SS E HERO from deck, pay half LP)
    24094653,                      // Polymerization (fusion summon)
    2295440,                       // One for One (discard → SS Lv1 from deck)
    79571449,                      // Graceful Charity (draw 3 discard 2)
  ],
  extra: [
    // Fusion
    35809262,                      // Elemental HERO Flame Wingman
    // Synchro (Lv5-8)
    29071332,                      // Armory Arm (Lv4 Synchro)
    50091196,                      // Formula Synchron (Lv2 Synchro, draw 1)
    60800381,                      // Junk Warrior (Lv5 Synchro)
    50321796,                      // Brionac (Lv6 Synchro)
    73580471,                      // Black Rose Dragon (Lv7 Synchro)
    44508094,                      // Stardust Dragon (Lv8 Synchro)
    // XYZ
    84013237,                      // Number 39: Utopia (Rank 4)
    95992081,                      // Leviair the Sea Dragon (Rank 3)
    // Link
    41999284,                      // Linkuriboh (Link-1)
    98978921,                      // Link Spider (Link-1)
    60303245,                      // Salamangreat Almiraj (Link-1)
    2857636,                       // Knightmare Phoenix (Link-2)
    75452921,                      // Knightmare Cerberus (Link-2)
    38342335,                      // Knightmare Unicorn (Link-3)
  ],
};

// Active deck selection — switch between VANILLA_DECK and COMBO_DECK
const DECK = COMBO_DECK;

const FILLER_DECK = {
  // Opponent needs a valid 40-card deck
  main: Array(40).fill(43096270), // 40x Alexandrite Dragon
  extra: [],
};

// =============================================================================
// Auto-Respond (non-branching decisions)
// =============================================================================

function autoRespond(msg: any): any {
  switch (msg.type) {
    case OcgMessageType.SELECT_BATTLECMD:
      if (msg.to_ep) return { type: 0, action: 3 };
      if (msg.to_m2) return { type: 0, action: 2 };
      return { type: 0, action: 3 };
    case OcgMessageType.SELECT_IDLECMD:
      // Opponent auto-passes: go to EP
      if (msg.to_ep) return { type: 1, action: 7 };
      if (msg.to_bp) return { type: 1, action: 6 };
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
    case OcgMessageType.SELECT_DISFIELD: {
      // Pick first available zone from field_mask
      const places = decodeFieldMask(msg.field_mask, msg.count);
      return { type: msg.type === OcgMessageType.SELECT_PLACE ? 10 : 9, places };
    }
    case OcgMessageType.SELECT_POSITION:
      return { type: 11, position: OcgPosition.FACEUP_ATTACK };
    case OcgMessageType.SELECT_TRIBUTE:
      return { type: 12, indicies: Array.from({ length: msg.min }, (_, i) => i) };
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
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: 20, value: msg.player === 0 ? 1 : 3 }; // P0 scissors, P1 paper → P0 wins
    default:
      return null;
  }
}

function decodeFieldMask(mask: number, count: number): { player: number; location: number; sequence: number }[] {
  const places: { player: number; location: number; sequence: number }[] = [];
  // Bits 0-4: player 0 MZONE, 5-7: unused, 8-12: player 0 SZONE
  // Bits 16-20: player 1 MZONE, 24-28: player 1 SZONE
  // field_mask marks UNAVAILABLE zones, so we pick from bits that are 0
  for (let p = 0; p < 2 && places.length < count; p++) {
    for (let seq = 0; seq < 5 && places.length < count; seq++) {
      const bit = p * 16 + seq;
      if (!(mask & (1 << bit))) {
        places.push({ player: p, location: OcgLocation.MZONE, sequence: seq });
      }
    }
    for (let seq = 0; seq < 5 && places.length < count; seq++) {
      const bit = p * 16 + 8 + seq;
      if (!(mask & (1 << bit))) {
        places.push({ player: p, location: OcgLocation.SZONE, sequence: seq });
      }
    }
  }
  return places;
}

// =============================================================================
// Duel Factory — Create + setup + replay responses
// =============================================================================

interface DuelContext {
  core: OcgCoreSync;
  duel: OcgDuelHandle;
}

function createDuel(core: OcgCoreSync): OcgDuelHandle {
  const duel = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: DUEL_SEED,
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader,
    scriptReader,
    errorHandler: () => {},
  });
  if (!duel) throw new Error('Failed to create duel');

  // Load startup scripts
  for (const name of STARTUP_SCRIPTS) {
    const content = scriptReader(name);
    if (content) core.loadScript(duel, name, content);
  }

  // Load decks
  for (const code of DECK.main) {
    core.duelNewCard(duel, {
      code, team: 0, duelist: 0, controller: 0,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of DECK.extra) {
    core.duelNewCard(duel, {
      code, team: 0, duelist: 0, controller: 0,
      location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of FILLER_DECK.main) {
    core.duelNewCard(duel, {
      code, team: 1, duelist: 0, controller: 1,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }

  core.startDuel(duel);
  return duel;
}

/** Create a new duel and replay a sequence of responses to reach a specific state. */
function replayToState(core: OcgCoreSync, responses: any[]): DuelContext {
  const duel = createDuel(core);
  for (const resp of responses) {
    runUntilWaiting(core, duel); // Process until OCGCore asks for input
    core.duelSetResponse(duel, resp);
  }
  return { core, duel };
}

// =============================================================================
// Duel Loop Helpers
// =============================================================================

interface LoopResult {
  status: number;
  selectMsg: any | null;       // The SELECT_* message that caused WAITING for our player
  allMessages: any[];
  processCallCount: number;
}

/** Run duelProcess in a loop until WAITING (for our player) or END. Auto-respond opponent & non-branching prompts. */
function runUntilPlayerPrompt(core: OcgCoreSync, duel: OcgDuelHandle): LoopResult {
  let processCallCount = 0;
  const allMessages: any[] = [];

  while (true) {
    processCallCount++;
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);
    allMessages.push(...messages);

    if (status === OcgProcessResult.END) {
      return { status, selectMsg: null, allMessages, processCallCount };
    }

    if (status === OcgProcessResult.WAITING) {
      // Find the SELECT_* message that needs a response
      const selectMsg = messages.find((m: any) => isSelectMessage(m.type));
      if (!selectMsg) {
        // Shouldn't happen, but safety
        return { status, selectMsg: null, allMessages, processCallCount };
      }

      // If it's for our player AND it's SELECT_IDLECMD → return for branching
      if (selectMsg.player === PLAYER && selectMsg.type === OcgMessageType.SELECT_IDLECMD) {
        return { status, selectMsg, allMessages, processCallCount };
      }

      // Otherwise auto-respond and continue
      const resp = autoRespond(selectMsg);
      if (resp) {
        core.duelSetResponse(duel, resp);
      } else {
        console.warn(`No auto-response for message type ${selectMsg.type}`);
        return { status, selectMsg, allMessages, processCallCount };
      }
    }
    // CONTINUE → loop again
  }
}

/** Run until WAITING (any player) or END. Used during replay. */
function runUntilWaiting(core: OcgCoreSync, duel: OcgDuelHandle): void {
  while (true) {
    const status = core.duelProcess(duel);
    if (status === OcgProcessResult.END || status === OcgProcessResult.WAITING) return;
  }
}

function isSelectMessage(type: number): boolean {
  return [
    OcgMessageType.SELECT_IDLECMD, OcgMessageType.SELECT_BATTLECMD,
    OcgMessageType.SELECT_CARD, OcgMessageType.SELECT_CHAIN,
    OcgMessageType.SELECT_EFFECTYN, OcgMessageType.SELECT_YESNO,
    OcgMessageType.SELECT_OPTION, OcgMessageType.SELECT_PLACE,
    OcgMessageType.SELECT_DISFIELD, OcgMessageType.SELECT_POSITION,
    OcgMessageType.SELECT_TRIBUTE, OcgMessageType.SELECT_COUNTER,
    OcgMessageType.SELECT_SUM, OcgMessageType.SELECT_UNSELECT_CARD,
    OcgMessageType.SORT_CARD, OcgMessageType.SORT_CHAIN,
    OcgMessageType.ROCK_PAPER_SCISSORS,
  ].includes(type);
}

// =============================================================================
// SELECT_IDLECMD Action Enumeration
// =============================================================================

interface IdleAction {
  label: string;
  response: any;
}

function enumerateIdleActions(msg: any): IdleAction[] {
  const actions: IdleAction[] = [];

  if (msg.summons) {
    for (let i = 0; i < msg.summons.length; i++) {
      const card = msg.summons[i];
      actions.push({
        label: `Summon ${getCardName(card.code)} [${i}]`,
        response: { type: 1, action: 0, index: i },
      });
    }
  }

  if (msg.special_summons) {
    for (let i = 0; i < msg.special_summons.length; i++) {
      const card = msg.special_summons[i];
      actions.push({
        label: `SpSummon ${getCardName(card.code)} [${i}]`,
        response: { type: 1, action: 1, index: i },
      });
    }
  }

  if (msg.activates) {
    for (let i = 0; i < msg.activates.length; i++) {
      const card = msg.activates[i];
      actions.push({
        label: `Activate ${getCardName(card.code)} [${i}]`,
        response: { type: 1, action: 5, index: i },
      });
    }
  }

  if (msg.spell_sets) {
    for (let i = 0; i < msg.spell_sets.length; i++) {
      const card = msg.spell_sets[i];
      actions.push({
        label: `Set S/T ${getCardName(card.code)} [${i}]`,
        response: { type: 1, action: 4, index: i },
      });
    }
  }

  if (msg.monster_sets) {
    for (let i = 0; i < msg.monster_sets.length; i++) {
      const card = msg.monster_sets[i];
      actions.push({
        label: `Set Mon ${getCardName(card.code)} [${i}]`,
        response: { type: 1, action: 3, index: i },
      });
    }
  }

  if (msg.pos_changes) {
    for (let i = 0; i < msg.pos_changes.length; i++) {
      const card = msg.pos_changes[i];
      actions.push({
        label: `Reposition ${getCardName(card.code)} [${i}]`,
        response: { type: 1, action: 2, index: i },
      });
    }
  }

  // Phase transitions (always last — these are "end turn" type actions)
  if (msg.to_bp) {
    actions.push({ label: 'To Battle Phase', response: { type: 1, action: 6 } });
  }
  if (msg.to_ep) {
    actions.push({ label: 'To End Phase', response: { type: 1, action: 7 } });
  }

  return actions;
}

// =============================================================================
// Board Evaluation (simple: count monsters on field)
// =============================================================================

function evaluateBoard(core: OcgCoreSync, duel: OcgDuelHandle): number {
  const field = core.duelQueryField(duel);
  const player = field.players[PLAYER];
  let score = 0;

  // Count monsters on field (null or position 0 means empty)
  for (const card of player.monsters) {
    if (card && card.position !== 0) score += 10;
  }

  // Count set spells/traps
  for (const card of player.spells) {
    if (card && card.position !== 0) score += 3;
  }

  return score;
}

// =============================================================================
// DFS Solver — tracks ALL responses for correct replay
// =============================================================================

interface SolverStats {
  nodesExplored: number;
  branchingFactors: number[];
  replayCosts: number[];       // ms per replay
  maxDepth: number;
  bestScore: number;
  bestPath: string[];
}

interface DFSNode {
  responses: any[];   // ALL responses from duel start to this branch point
  labels: string[];   // Human-readable action labels (IDLECMD decisions only)
}

/**
 * Run a duel from scratch with given responses, then continue until next
 * SELECT_IDLECMD (for our player) or END. Auto-responds all intermediate
 * prompts and appends them to the response list.
 *
 * Returns the SELECT_IDLECMD message (or null if ended), the updated
 * response list (including all auto-responses), and the board score.
 */
function exploreNode(
  core: OcgCoreSync,
  responsesToReplay: any[],
): { idleMsg: any | null; allResponses: any[]; score: number; replayMs: number } {
  const replayStart = performance.now();
  const duel = createDuel(core);

  // Phase 1: Replay all recorded responses
  for (const resp of responsesToReplay) {
    // Process until OCGCore asks for input
    let status: number;
    while (true) {
      status = core.duelProcess(duel);
      if (status === OcgProcessResult.END || status === OcgProcessResult.WAITING) break;
    }
    if (status === OcgProcessResult.END) {
      const score = evaluateBoard(core, duel);
      core.destroyDuel(duel);
      return { idleMsg: null, allResponses: responsesToReplay, score, replayMs: performance.now() - replayStart };
    }
    core.duelSetResponse(duel, resp);
  }

  const replayMs = performance.now() - replayStart;

  // Phase 2: Continue running, auto-responding non-IDLECMD prompts
  const newResponses = [...responsesToReplay];

  while (true) {
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    if (status === OcgProcessResult.END) {
      const score = evaluateBoard(core, duel);
      core.destroyDuel(duel);
      return { idleMsg: null, allResponses: newResponses, score, replayMs };
    }

    if (status === OcgProcessResult.WAITING) {
      const selectMsg = messages.find((m: any) => isSelectMessage(m.type));
      if (!selectMsg) {
        const score = evaluateBoard(core, duel);
        core.destroyDuel(duel);
        return { idleMsg: null, allResponses: newResponses, score, replayMs };
      }

      // If it's our player's SELECT_IDLECMD → return for branching
      if (selectMsg.player === PLAYER && selectMsg.type === OcgMessageType.SELECT_IDLECMD) {
        const score = evaluateBoard(core, duel);
        core.destroyDuel(duel);
        return { idleMsg: selectMsg, allResponses: newResponses, score, replayMs };
      }

      // Otherwise auto-respond and record
      const resp = autoRespond(selectMsg);
      if (resp) {
        newResponses.push(resp);
        core.duelSetResponse(duel, resp);
      } else {
        console.warn(`  No auto-response for type ${selectMsg.type}`);
        const score = evaluateBoard(core, duel);
        core.destroyDuel(duel);
        return { idleMsg: null, allResponses: newResponses, score, replayMs };
      }
    }
    // CONTINUE → loop
  }
}

async function solveDFS(core: OcgCoreSync): Promise<SolverStats> {
  const stats: SolverStats = {
    nodesExplored: 0,
    branchingFactors: [],
    replayCosts: [],
    maxDepth: 0,
    bestScore: -1,
    bestPath: [],
  };

  // Explore the root: run from scratch with no prior responses
  console.log('  Exploring root node...');
  const rootResult = exploreNode(core, []);

  if (!rootResult.idleMsg) {
    console.log('  No SELECT_IDLECMD found — duel ended before player turn');
    return stats;
  }

  const initActions = enumerateIdleActions(rootResult.idleMsg);
  stats.branchingFactors.push(initActions.length);
  console.log(`  Initial branching factor: ${initActions.length} actions`);
  for (const a of initActions) console.log(`    - ${a.label}`);
  console.log(`  Pre-IDLECMD auto-responses: ${rootResult.allResponses.length}`);

  // Initialize DFS stack
  const stack: DFSNode[] = [];
  for (const action of initActions) {
    stack.push({
      responses: [...rootResult.allResponses, action.response],
      labels: [action.label],
    });
  }

  const startTime = performance.now();

  while (stack.length > 0) {
    if (stats.nodesExplored >= MAX_NODES) {
      console.log(`  [LIMIT] Max nodes reached (${MAX_NODES})`);
      break;
    }
    if (performance.now() - startTime > MAX_TIME_MS) {
      console.log(`  [LIMIT] Time limit reached (${MAX_TIME_MS}ms)`);
      break;
    }

    const node = stack.pop()!;
    stats.nodesExplored++;
    const depth = node.labels.length;
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    if (depth > MAX_DEPTH) continue;

    // Replay + explore
    const result = exploreNode(core, node.responses);
    stats.replayCosts.push(result.replayMs);

    // Evaluate
    if (result.score > stats.bestScore) {
      stats.bestScore = result.score;
      stats.bestPath = [...node.labels];
    }

    // Branch if we got another SELECT_IDLECMD
    if (result.idleMsg) {
      const actions = enumerateIdleActions(result.idleMsg);
      stats.branchingFactors.push(actions.length);

      for (const action of actions) {
        stack.push({
          responses: [...result.allResponses, action.response],
          labels: [...node.labels, action.label],
        });
      }
    }

    // Progress logging every 50 nodes
    if (stats.nodesExplored % 50 === 0) {
      const elapsed = performance.now() - startTime;
      console.log(`  [${stats.nodesExplored} nodes] depth=${depth} stack=${stack.length} best=${stats.bestScore} elapsed=${elapsed.toFixed(0)}ms`);
    }
  }

  return stats;
}

// =============================================================================
// Benchmarks
// =============================================================================

async function benchmarkDuelCreation(core: OcgCoreSync, iterations: number): Promise<void> {
  console.log(`\n--- Benchmark: Duel Creation (${iterations} iterations) ---`);
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const duel = createDuel(core);
    times.push(performance.now() - t0);
    core.destroyDuel(duel);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`  Avg: ${avg.toFixed(2)}ms | Min: ${min.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);
}

async function benchmarkDuelProcess(core: OcgCoreSync): Promise<void> {
  console.log('\n--- Benchmark: duelProcess latency ---');
  const duel = createDuel(core);
  const times: number[] = [];
  let calls = 0;

  while (calls < 200) {
    const t0 = performance.now();
    const status = core.duelProcess(duel);
    times.push(performance.now() - t0);
    calls++;

    const messages = core.duelGetMessage(duel);
    if (status === OcgProcessResult.END) break;

    if (status === OcgProcessResult.WAITING) {
      const selectMsg = messages.find((m: any) => isSelectMessage(m.type));
      if (selectMsg) {
        const resp = autoRespond(selectMsg);
        if (resp) core.duelSetResponse(duel, resp);
        else break;
      }
    }
  }

  core.destroyDuel(duel);

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`  ${calls} calls | Avg: ${avg.toFixed(3)}ms | Median: ${median.toFixed(3)}ms | P95: ${p95.toFixed(3)}ms`);
}

async function benchmarkReplay(core: OcgCoreSync): Promise<void> {
  console.log('\n--- Benchmark: Replay-from-scratch cost ---');

  // First, collect a full turn of responses
  const responses: any[] = [];
  const duel = createDuel(core);
  let turnCount = 0;

  while (responses.length < 30 && turnCount < 3) {
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      if (msg.type === OcgMessageType.NEW_TURN) turnCount++;
    }

    if (status === OcgProcessResult.END) break;
    if (status === OcgProcessResult.WAITING) {
      const selectMsg = messages.find((m: any) => isSelectMessage(m.type));
      if (selectMsg) {
        const resp = autoRespond(selectMsg);
        if (resp) {
          responses.push(resp);
          core.duelSetResponse(duel, resp);
        } else break;
      }
    }
  }
  core.destroyDuel(duel);

  console.log(`  Collected ${responses.length} responses over ${turnCount} turns`);

  // Benchmark replaying different depths
  for (const depth of [5, 10, 15, 20, responses.length]) {
    if (depth > responses.length) continue;
    const subset = responses.slice(0, depth);
    const times: number[] = [];

    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const d = createDuel(core);
      for (const resp of subset) {
        runUntilWaiting(core, d);
        core.duelSetResponse(d, resp);
      }
      times.push(performance.now() - t0);
      core.destroyDuel(d);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`  Depth ${depth}: avg ${avg.toFixed(2)}ms per replay (20 runs)`);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('=== Combo Path Solver — Proof of Concept ===\n');

  // 1. Initialize OCGCore
  console.log('1. Loading OCGCore WASM...');
  const t0 = performance.now();
  const core = await createCore({ sync: true });
  const loadTime = performance.now() - t0;
  const version = core.getVersion();
  console.log(`   OCGCore v${version[0]}.${version[1]} loaded in ${loadTime.toFixed(0)}ms\n`);

  // 2. Benchmarks
  await benchmarkDuelCreation(core, 50);
  await benchmarkDuelProcess(core);
  await benchmarkReplay(core);

  // 3. DFS Solver
  console.log('\n--- DFS Solver (Turn 1 exploration) ---');
  const solverStart = performance.now();
  const stats = await solveDFS(core);
  const solverTime = performance.now() - solverStart;

  // 4. Report
  console.log('\n=== RESULTS ===\n');
  console.log(`Nodes explored:     ${stats.nodesExplored}`);
  console.log(`Max depth:          ${stats.maxDepth}`);
  console.log(`Best score:         ${stats.bestScore}`);
  console.log(`Best path:`);
  for (const step of stats.bestPath) console.log(`  → ${step}`);

  if (stats.branchingFactors.length > 0) {
    const avgBF = stats.branchingFactors.reduce((a, b) => a + b, 0) / stats.branchingFactors.length;
    console.log(`\nAvg branching factor: ${avgBF.toFixed(1)}`);
  }

  if (stats.replayCosts.length > 0) {
    const avgReplay = stats.replayCosts.reduce((a, b) => a + b, 0) / stats.replayCosts.length;
    const maxReplay = Math.max(...stats.replayCosts);
    console.log(`Avg replay cost:      ${avgReplay.toFixed(2)}ms`);
    console.log(`Max replay cost:      ${maxReplay.toFixed(2)}ms`);
  }

  console.log(`\nTotal solver time:    ${solverTime.toFixed(0)}ms`);
  console.log(`Nodes/sec:            ${(stats.nodesExplored / (solverTime / 1000)).toFixed(0)}`);

  // Cleanup
  db.close();
  console.log('\n=== POC Complete ===');
}

main().catch(console.error);
