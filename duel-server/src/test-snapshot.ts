/**
 * Test: Can we snapshot/restore WASM memory to fork duel state?
 */
import createCore, {
  OcgDuelMode, OcgLocation, OcgPosition, OcgProcessResult, OcgMessageType,
} from '@n1xx1/ocgcore-wasm';
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const DATA_DIR = resolve(import.meta.dirname!, '../data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');
const db = new Database(DB_PATH, { readonly: true });
const cardStmt = db.prepare('SELECT id,ot,alias,setcode,type,atk,def,level,race,attribute,category FROM datas WHERE id=?');

function cardReader(code: number) {
  const row = cardStmt.get(code) as any;
  if (!row) return null;
  const setcodes: number[] = [];
  let sc = BigInt(row.setcode);
  for (let i = 0; i < 4; i++) { const v = Number(sc & 0xFFFFn); if (v) setcodes.push(v); sc >>= 16n; }
  return { code: row.id, alias: row.alias, setcodes, type: row.type,
    level: row.level & 0xFF, lscale: (row.level >> 24) & 0xFF, rscale: (row.level >> 16) & 0xFF,
    attack: row.atk, defense: row.def, race: BigInt(row.race), attribute: row.attribute };
}

function scriptReader(name: string): string | null {
  for (const sub of ['', 'official']) {
    const p = sub ? join(SCRIPTS_DIR, sub, name) : join(SCRIPTS_DIR, name);
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  return null;
}

const STARTUP = [
  'constant.lua','utility.lua','archetype_setcode_constants.lua','card_counter_constants.lua',
  'cards_specific_functions.lua','deprecated_functions.lua','proc_equip.lua','proc_fusion.lua',
  'proc_fusion_spell.lua','proc_gemini.lua','proc_link.lua','proc_maximum.lua','proc_normal.lua',
  'proc_pendulum.lua','proc_compat.lua','proc_persistent.lua','proc_ritual.lua','proc_spirit.lua',
  'proc_synchro.lua','proc_union.lua','proc_workaround.lua','proc_xyz.lua',
];

const DECK = Array(40).fill(43096270); // 40x Alexandrite Dragon

// --- Hook WASM memory ---
let wasmMemory: WebAssembly.Memory | null = null;
const origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async function (...args: any[]) {
  const result = await (origInstantiate as any).apply(this, args);
  const inst = result.instance ?? result;
  for (const v of Object.values(inst.exports)) {
    if (v instanceof WebAssembly.Memory) { wasmMemory = v; break; }
  }
  return result;
} as any;

function autoRespond(msg: any): any {
  switch (msg.type) {
    case OcgMessageType.SELECT_IDLECMD:
      if (msg.summons?.length > 0) return { type: 1, action: 0, index: 0 };
      if (msg.to_ep) return { type: 1, action: 7 };
      return { type: 1, action: 7 };
    case OcgMessageType.SELECT_BATTLECMD:
      if (msg.to_ep) return { type: 0, action: 3 };
      return { type: 0, action: 3 };
    case OcgMessageType.SELECT_CHAIN: return { type: 8, index: null };
    case OcgMessageType.SELECT_EFFECTYN: return { type: 2, yes: true };
    case OcgMessageType.SELECT_POSITION: return { type: 11, position: OcgPosition.FACEUP_ATTACK };
    case OcgMessageType.ROCK_PAPER_SCISSORS: return { type: 20, value: msg.player === 0 ? 1 : 3 };
    default: return null;
  }
}

function isSelect(type: number) {
  return [OcgMessageType.SELECT_IDLECMD, OcgMessageType.SELECT_BATTLECMD,
    OcgMessageType.SELECT_CHAIN, OcgMessageType.SELECT_EFFECTYN,
    OcgMessageType.SELECT_POSITION, OcgMessageType.ROCK_PAPER_SCISSORS].includes(type);
}

async function main() {
  console.log('=== WASM Memory Snapshot Test ===\n');

  const core = await createCore({ sync: true });
  if (!wasmMemory) { console.log('ERROR: No WASM memory captured'); return; }

  console.log('WASM memory size:', (wasmMemory.buffer.byteLength / 1024 / 1024).toFixed(1), 'MB');

  // Create duel
  const duel = core.createDuel({
    flags: OcgDuelMode.MODE_MR5, seed: [42n, 123n, 456n, 789n],
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader, scriptReader, errorHandler: () => {},
  });
  if (!duel) { console.log('Failed to create duel'); return; }

  for (const name of STARTUP) {
    const c = scriptReader(name);
    if (c) core.loadScript(duel, name, c);
  }
  for (const code of DECK) {
    core.duelNewCard(duel, { code, team: 0, duelist: 0, controller: 0, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK });
  }
  for (const code of DECK) {
    core.duelNewCard(duel, { code, team: 1, duelist: 0, controller: 1, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK });
  }
  core.startDuel(duel);

  // Run until player 0 gets SELECT_IDLECMD
  let idleMsg: any = null;
  while (!idleMsg) {
    const st = core.duelProcess(duel);
    const msgs = core.duelGetMessage(duel);
    if (st === OcgProcessResult.END) break;
    if (st === OcgProcessResult.WAITING) {
      const sel = msgs.find((m: any) => isSelect(m.type));
      if (sel && sel.type === OcgMessageType.SELECT_IDLECMD && sel.player === 0) {
        idleMsg = sel;
        break; // Don't respond yet — this is our branch point
      }
      if (sel) {
        const r = autoRespond(sel);
        if (r) core.duelSetResponse(duel, r);
      }
    }
  }

  if (!idleMsg) { console.log('No IDLECMD reached'); return; }

  const summonCount = idleMsg.summons?.length ?? 0;
  console.log(`\nReached SELECT_IDLECMD with ${summonCount} summons, ${idleMsg.activates?.length ?? 0} activates`);

  // Record pre-snapshot state
  const f1 = core.duelQueryField(duel);
  const hand1 = f1.players[0].hand_size;
  const deck1 = f1.players[0].deck_size;
  const mons1 = f1.players[0].monsters.filter((m: any) => m && m.position !== 0).length;
  console.log(`\n--- BEFORE snapshot --- Hand=${hand1} Deck=${deck1} Monsters=${mons1}`);

  // SNAPSHOT at the branch point (before responding to IDLECMD)
  const t0 = performance.now();
  const snapshot = wasmMemory.buffer.slice(0);
  const snapMs = performance.now() - t0;
  console.log(`  Snapshot: ${snapMs.toFixed(2)}ms (${(snapshot.byteLength / 1024 / 1024).toFixed(1)}MB)`);

  // --- BRANCH A: Normal summon card 0, then end turn ---
  console.log('\n--- Branch A: Normal Summon [0] ---');
  core.duelSetResponse(duel, { type: 1, action: 0, index: 0 }); // summon first
  // Run until next IDLECMD or end
  let branchAField: any = null;
  for (let i = 0; i < 20; i++) {
    const st = core.duelProcess(duel);
    const msgs = core.duelGetMessage(duel);
    if (st === OcgProcessResult.END) break;
    if (st === OcgProcessResult.WAITING) {
      const sel = msgs.find((m: any) => isSelect(m.type));
      if (sel && sel.type === OcgMessageType.SELECT_IDLECMD) {
        branchAField = core.duelQueryField(duel);
        break;
      }
      if (sel) {
        const r = autoRespond(sel);
        if (r) core.duelSetResponse(duel, r);
      }
    }
  }
  if (branchAField) {
    const monsA = branchAField.players[0].monsters.filter((m: any) => m && m.position !== 0).length;
    const handA = branchAField.players[0].hand_size;
    console.log(`  After summon: Hand=${handA} Monsters=${monsA}`);
  }

  // --- RESTORE snapshot ---
  const t1 = performance.now();
  new Uint8Array(wasmMemory.buffer).set(new Uint8Array(snapshot));
  const restoreMs = performance.now() - t1;
  console.log(`\n  Restore: ${restoreMs.toFixed(2)}ms`);

  // Verify state is back
  const f3 = core.duelQueryField(duel);
  const hand3 = f3.players[0].hand_size;
  const mons3 = f3.players[0].monsters.filter((m: any) => m && m.position !== 0).length;
  console.log(`  After restore: Hand=${hand3} Monsters=${mons3}`);
  console.log(`  State matches pre-snapshot? ${hand3 === hand1 && mons3 === mons1 ? 'YES ✓' : 'NO ✗'}`);

  // --- BRANCH B: Go to End Phase instead ---
  console.log('\n--- Branch B: To End Phase ---');
  core.duelSetResponse(duel, { type: 1, action: 7 }); // to EP
  let branchBField: any = null;
  for (let i = 0; i < 20; i++) {
    const st = core.duelProcess(duel);
    const msgs = core.duelGetMessage(duel);
    if (st === OcgProcessResult.END) break;
    if (st === OcgProcessResult.WAITING) {
      const sel = msgs.find((m: any) => isSelect(m.type));
      if (sel && sel.type === OcgMessageType.SELECT_IDLECMD) {
        branchBField = core.duelQueryField(duel);
        break;
      }
      if (sel) {
        const r = autoRespond(sel);
        if (r) core.duelSetResponse(duel, r);
      }
    }
  }
  if (branchBField) {
    const monsB = branchBField.players[0].monsters.filter((m: any) => m && m.position !== 0).length;
    const handB = branchBField.players[0].hand_size;
    const deckB = branchBField.players[0].deck_size;
    console.log(`  After EP: Hand=${handB} Deck=${deckB} Monsters=${monsB}`);
  }

  // --- Summary ---
  console.log('\n=== SNAPSHOT RESULTS ===');
  console.log(`  Snapshot time: ${snapMs.toFixed(2)}ms`);
  console.log(`  Restore time:  ${restoreMs.toFixed(2)}ms`);
  console.log(`  Total fork:    ${(snapMs + restoreMs).toFixed(2)}ms`);
  console.log(`  vs Replay:     ~65ms`);
  console.log(`  Speedup:       ${(65 / (snapMs + restoreMs)).toFixed(1)}x`);
  if (branchAField && branchBField) {
    const monsA = branchAField.players[0].monsters.filter((m: any) => m && m.position !== 0).length;
    const monsB = branchBField.players[0].monsters.filter((m: any) => m && m.position !== 0).length;
    console.log(`\n  Branch A monsters: ${monsA}, Branch B monsters: ${monsB}`);
    console.log(`  Branches diverge?  ${monsA !== monsB ? 'YES ✓ — FORKING WORKS!' : 'SAME (both branches identical)'}`);
  }

  core.destroyDuel(duel);
  db.close();
}

main().catch(console.error);
