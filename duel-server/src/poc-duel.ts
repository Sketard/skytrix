import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
} from "@n1xx1/ocgcore-wasm";
import Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// --- Paths ---
const DATA_DIR = resolve(import.meta.dirname!, "../data");
const DB_PATH = join(DATA_DIR, "cards.cdb");
const SCRIPTS_DIR = join(DATA_DIR, "scripts_full");

// --- Card Database ---
const db = new Database(DB_PATH, { readonly: true });
const cardStmt = db.prepare(
  "SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?"
);

function cardReader(code: number) {
  const row = cardStmt.get(code) as any;
  if (!row) return null;

  // Decode setcodes from the packed integer
  const setcodes: number[] = [];
  let sc = BigInt(row.setcode);
  for (let i = 0; i < 4; i++) {
    const val = Number(sc & 0xFFFFn);
    if (val) setcodes.push(val);
    sc >>= 16n;
  }

  return {
    code: row.id,
    alias: row.alias,
    setcodes,
    type: row.type,
    level: row.level & 0xFF,
    lscale: (row.level >> 24) & 0xFF,
    rscale: (row.level >> 16) & 0xFF,
    attack: row.atk,
    defense: row.def,
    race: BigInt(row.race),
    attribute: row.attribute,
  };
}

// --- Script Reader ---
function scriptReader(name: string): string | null {
  // Scripts are named like "c46986414.lua" or "utility.lua"
  // Search in multiple locations
  const locations = [
    join(SCRIPTS_DIR, name),
    join(SCRIPTS_DIR, "official", name),
    join(SCRIPTS_DIR, "goat", name),
    join(SCRIPTS_DIR, "pre-release", name),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  }

  console.warn(`  [Script] NOT FOUND: ${name}`);
  return null;
}

// --- Simple decks for testing ---
// Mix of Level 4 normal monsters (summonable) + spells + traps
const DECK_1 = {
  main: [
    // Level 4 normal monsters (can be normal summoned)
    38232082, 38232082, 38232082, // Alexandrite Dragon (ATK 2000, Lv4 Normal)
    69247929, 69247929, 69247929, // Gene-Warped Warwolf (ATK 2000, Lv4 Normal)
    6368038, 6368038, 6368038,   // Mystical Space Typhoon
    83764718, 83764718, 83764718, // Monster Reborn
    5318639, 5318639, 5318639,   // Pot of Greed
    44095762, 44095762, 44095762, // Mirror Force
    4031928, 4031928, 4031928,   // Swords of Revealing Light
    // More Level 4 normals to reach 40
    64788463, 64788463, 64788463, // Luster Dragon (ATK 1900, Lv4 Normal)
    66788016, 66788016, 66788016, // Vorse Raider (ATK 1900, Lv4 Normal)
    76184692, 76184692, 76184692, // Mechanicalchaser (ATK 1850, Lv4 Normal)
    55144522, 55144522, 55144522, // Insect Knight (ATK 1900, Lv4 Normal)
    85309439,                      // Luster Dragon #2 (ATK 1900, Lv4 Normal)
  ],
  extra: [],
};

const DECK_2 = {
  main: [...DECK_1.main],
  extra: [],
};

// --- Auto-player: responds to all SELECT messages with first valid option ---
function autoRespond(msg: any): any {
  switch (msg.type) {
    case OcgMessageType.SELECT_BATTLECMD:
      // If we can attack, attack; otherwise go to EP
      if (msg.attacks?.length > 0) {
        return { type: 0, action: 1, index: 0 }; // SELECT_BATTLECMD: attack with first
      }
      if (msg.to_ep) return { type: 0, action: 3 }; // To EP
      if (msg.to_m2) return { type: 0, action: 2 }; // To M2
      return { type: 0, action: 3 }; // To EP

    case OcgMessageType.SELECT_IDLECMD:
      // If we can summon, summon first; otherwise go to BP or EP
      if (msg.summons?.length > 0) {
        return { type: 1, action: 0, index: 0 }; // Normal summon first
      }
      if (msg.to_bp) return { type: 1, action: 6 }; // To BP
      if (msg.to_ep) return { type: 1, action: 7 }; // To EP
      return { type: 1, action: 7 }; // To EP

    case OcgMessageType.SELECT_EFFECTYN:
      return { type: 2, yes: true };

    case OcgMessageType.SELECT_YESNO:
      return { type: 3, yes: false }; // Say no by default

    case OcgMessageType.SELECT_OPTION:
      return { type: 4, index: 0 };

    case OcgMessageType.SELECT_CARD:
      // Select minimum required cards, starting from index 0
      return { type: 5, indicies: Array.from({ length: msg.min }, (_, i) => i) };

    case OcgMessageType.SELECT_CHAIN:
      return { type: 8, index: null }; // Don't chain (pass)

    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD:
      return { type: 10, places: [{ player: msg.player, location: OcgLocation.MZONE, sequence: 2 }] };

    case OcgMessageType.SELECT_POSITION:
      return { type: 11, position: OcgPosition.FACEUP_ATTACK };

    case OcgMessageType.SELECT_TRIBUTE:
      return { type: 12, indicies: Array.from({ length: msg.min }, (_, i) => i) };

    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: 20, value: 2 }; // Rock

    case OcgMessageType.SELECT_COUNTER:
      return { type: 13, counters: msg.cards.map(() => 0) };

    case OcgMessageType.SELECT_SUM:
      return { type: 14, indicies: [0] };

    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (msg.can_finish) return { type: 7, index: null }; // Finish
      return { type: 7, index: 0 };

    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return { type: 15, order: null }; // Default order

    case OcgMessageType.ANNOUNCE_RACE:
      return { type: 16, races: [1n] }; // Warrior

    case OcgMessageType.ANNOUNCE_ATTRIB:
      return { type: 17, attributes: [32] }; // DARK

    case OcgMessageType.ANNOUNCE_CARD:
      return { type: 18, card: 46986414 }; // Dark Magician

    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: 19, value: Number(msg.options[0]) };

    default:
      return null;
  }
}

// --- Message type names for readable logging ---
const MSG_NAMES: Record<number, string> = {
  [OcgMessageType.START]: "START",
  [OcgMessageType.NEW_TURN]: "NEW_TURN",
  [OcgMessageType.NEW_PHASE]: "NEW_PHASE",
  [OcgMessageType.DRAW]: "DRAW",
  [OcgMessageType.MOVE]: "MOVE",
  [OcgMessageType.SUMMONING]: "SUMMONING",
  [OcgMessageType.SUMMONED]: "SUMMONED",
  [OcgMessageType.SPSUMMONING]: "SPSUMMONING",
  [OcgMessageType.SPSUMMONED]: "SPSUMMONED",
  [OcgMessageType.ATTACK]: "ATTACK",
  [OcgMessageType.BATTLE]: "BATTLE",
  [OcgMessageType.DAMAGE]: "DAMAGE",
  [OcgMessageType.RECOVER]: "RECOVER",
  [OcgMessageType.LPUPDATE]: "LPUPDATE",
  [OcgMessageType.WIN]: "WIN",
  [OcgMessageType.CHAINING]: "CHAINING",
  [OcgMessageType.CHAIN_SOLVED]: "CHAIN_SOLVED",
  [OcgMessageType.SELECT_IDLECMD]: "SELECT_IDLECMD",
  [OcgMessageType.SELECT_BATTLECMD]: "SELECT_BATTLECMD",
  [OcgMessageType.SELECT_CARD]: "SELECT_CARD",
  [OcgMessageType.SELECT_CHAIN]: "SELECT_CHAIN",
  [OcgMessageType.SELECT_EFFECTYN]: "SELECT_EFFECTYN",
  [OcgMessageType.SELECT_POSITION]: "SELECT_POSITION",
  [OcgMessageType.SELECT_PLACE]: "SELECT_PLACE",
  [OcgMessageType.SHUFFLE_DECK]: "SHUFFLE_DECK",
  [OcgMessageType.SHUFFLE_HAND]: "SHUFFLE_HAND",
};

// --- Main ---
async function main() {
  console.log("=== Skytrix Duel Server PoC ===\n");

  // 1. Initialize core
  console.log("1. Loading OCGCore WASM...");
  const core = await createCore({ sync: true });
  const version = core.getVersion();
  console.log(`   OCGCore v${version[0]}.${version[1]} loaded\n`);

  // 2. Create duel
  console.log("2. Creating duel (Master Rule 5, 8000 LP)...");
  const duel = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: [42n, 123n, 456n, 789n],
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader,
    scriptReader,
    errorHandler: (type, text) => {
      if (!text.includes("script not found")) {
        console.error(`   [OCG] ${text}`);
      }
    },
  });

  if (!duel) {
    console.error("   FAILED to create duel!");
    process.exit(1);
  }
  console.log("   Duel created.\n");

  // 2b. Pre-load startup Lua scripts (utility, constants, procedures)
  console.log("2b. Loading startup Lua scripts...");
  const startupScripts = [
    "constant.lua",
    "utility.lua",
    "archetype_setcode_constants.lua",
    "card_counter_constants.lua",
    "cards_specific_functions.lua",
    "deprecated_functions.lua",
    "proc_equip.lua",
    "proc_fusion.lua",
    "proc_fusion_spell.lua",
    "proc_gemini.lua",
    "proc_link.lua",
    "proc_maximum.lua",
    "proc_normal.lua",
    "proc_pendulum.lua",
    "proc_ritual.lua",
    "proc_spirit.lua",
    "proc_synchro.lua",
    "proc_toon.lua",
    "proc_union.lua",
    "proc_xyz.lua",
  ];
  let loaded = 0;
  for (const name of startupScripts) {
    const path = join(SCRIPTS_DIR, name);
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const ok = core.loadScript(duel, name, content);
      if (ok) loaded++;
      else console.warn(`   Failed to load: ${name}`);
    } else {
      console.warn(`   Not found: ${name}`);
    }
  }
  console.log(`   Loaded ${loaded}/${startupScripts.length} startup scripts.\n`);

  // 3. Load decks
  console.log("3. Loading decks...");
  for (const code of DECK_1.main) {
    core.duelNewCard(duel, {
      code,
      team: 0,
      duelist: 0,
      controller: 0,
      location: OcgLocation.DECK,
      sequence: 0,
      position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of DECK_1.extra) {
    core.duelNewCard(duel, {
      code,
      team: 0,
      duelist: 0,
      controller: 0,
      location: OcgLocation.EXTRA,
      sequence: 0,
      position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of DECK_2.main) {
    core.duelNewCard(duel, {
      code,
      team: 1,
      duelist: 0,
      controller: 1,
      location: OcgLocation.DECK,
      sequence: 0,
      position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  console.log(`   Player 1: ${DECK_1.main.length} main, ${DECK_1.extra.length} extra`);
  console.log(`   Player 2: ${DECK_2.main.length} main, ${DECK_2.extra.length} extra\n`);

  // 4. Start duel
  console.log("4. Starting duel...");
  core.startDuel(duel);
  console.log("   Duel started!\n");

  // 5. Game loop
  console.log("5. Running game loop (max 200 iterations)...\n");
  let iterations = 0;
  const MAX_ITERATIONS = 200;
  let turnCount = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const status = core.duelProcess(duel);

    // Read messages
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      const name = MSG_NAMES[msg.type] || `MSG_${msg.type}`;

      // Log interesting messages
      if (msg.type === OcgMessageType.NEW_TURN) {
        turnCount++;
        console.log(`--- Turn ${turnCount} (Player ${(msg as any).player}) ---`);
      } else if (msg.type === OcgMessageType.DRAW) {
        const draw = msg as any;
        console.log(`  DRAW: Player ${draw.player} drew ${draw.drawn?.length ?? 0} card(s)`);
      } else if (msg.type === OcgMessageType.SUMMONING) {
        const summon = msg as any;
        console.log(`  SUMMON: Card ${summon.code} at zone ${summon.location}:${summon.sequence}`);
      } else if (msg.type === OcgMessageType.ATTACK) {
        console.log(`  ATTACK!`);
      } else if (msg.type === OcgMessageType.DAMAGE) {
        const dmg = msg as any;
        console.log(`  DAMAGE: Player ${dmg.player} takes ${dmg.amount} damage`);
      } else if (msg.type === OcgMessageType.LPUPDATE) {
        const lp = msg as any;
        console.log(`  LP UPDATE: Player ${lp.player} -> ${lp.lp} LP`);
      } else if (msg.type === OcgMessageType.WIN) {
        const win = msg as any;
        console.log(`\n*** Player ${win.player} WINS! (reason: ${win.reason}) ***`);
      } else if (msg.type === OcgMessageType.CHAINING) {
        const chain = msg as any;
        console.log(`  CHAIN: Card ${chain.code} activated`);
      }

      // Respond to SELECT messages
      const response = autoRespond(msg);
      if (response) {
        core.duelSetResponse(duel, response);
      }
    }

    if (status === OcgProcessResult.END) {
      console.log("\nDuel ended.");
      break;
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.log(`\nStopped after ${MAX_ITERATIONS} iterations (${turnCount} turns completed).`);
  }

  // 6. Query final state
  console.log("\n6. Final board state:");
  const field = core.duelQueryField(duel);
  for (let p = 0; p < 2; p++) {
    const player = field.players[p];
    console.log(`   Player ${p}: LP=${player.lp}, Hand=${player.hand_size}, Deck=${player.deck_size}, GY=${player.grave_size}, Banished=${player.banish_size}`);
  }

  // Cleanup
  core.destroyDuel(duel);
  db.close();
  console.log("\n=== PoC Complete ===");
}

main().catch(console.error);
