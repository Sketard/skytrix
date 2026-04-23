// =============================================================================
// poc-wasm-snapshot.ts — Proof of concept for WASM Memory snapshot/restore
// as a replacement for forkViaReplay. Target: ×6-9 throughput (per research
// poc-solver-results-2026-03-22.md).
//
// Strategy:
//   1. Monkey-patch WebAssembly.instantiate(Streaming) to capture the
//      WebAssembly.Instance when @n1xx1/ocgcore-wasm loads.
//   2. Scan instance.exports for a WebAssembly.Memory — the ocgcore-wasm
//      bundle exports it as `.r` (confirmed by disassembly: `L=w.r`).
//   3. Create a vanilla-deck duel, advance to a WAITING prompt — this is our
//      reference state S1.
//   4. Measure:
//        a. createDuel (baseline = forkViaReplay lower bound)
//        b. memory.buffer.slice(0) — snapshot cost
//        c. new Uint8Array(memory.buffer).set(snap) — restore cost
//   5. Correctness: snapshot at S1 → advance to S2 → restore → advance same
//      path → compare field hash — MUST match.
//
// Run: npx tsx scripts/poc-wasm-snapshot.ts
// =============================================================================

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Step 1: Install capture hooks BEFORE importing ocgcore-wasm.
// ---------------------------------------------------------------------------
const captured: { instances: WebAssembly.Instance[] } = { instances: [] };
const origInstantiate = WebAssembly.instantiate;
const origInstantiateStreaming = WebAssembly.instantiateStreaming;

// Both overloads (bytes/module) return either an Instance or a {module,instance}.
WebAssembly.instantiate = function patchedInstantiate(this: any, ...args: any[]): any {
  const p = (origInstantiate as any).apply(this, args);
  return Promise.resolve(p).then((result: any) => {
    const inst = result instanceof WebAssembly.Instance ? result : result?.instance;
    if (inst) captured.instances.push(inst);
    return result;
  });
} as any;

if (typeof WebAssembly.instantiateStreaming === 'function') {
  WebAssembly.instantiateStreaming = function patchedStreaming(this: any, ...args: any[]): any {
    const p = (origInstantiateStreaming as any).apply(this, args);
    return Promise.resolve(p).then((result: any) => {
      const inst = result?.instance;
      if (inst) captured.instances.push(inst);
      return result;
    });
  } as any;
}

// Now import — loading will trigger one of the hooked instantiations.
const ocgcoreMod = await import('@n1xx1/ocgcore-wasm');
const createCore = ocgcoreMod.default;
const { OcgDuelMode, OcgLocation, OcgPosition, OcgProcessResult, OcgMessageType } = ocgcoreMod;

// ---------------------------------------------------------------------------
// Step 2: Locate the WebAssembly.Memory in captured exports.
// ---------------------------------------------------------------------------
function findMemory(): WebAssembly.Memory {
  for (const inst of captured.instances) {
    for (const [name, exp] of Object.entries(inst.exports)) {
      if (exp instanceof WebAssembly.Memory) {
        console.log(`[POC] Found WebAssembly.Memory at export "${name}"`);
        return exp;
      }
    }
  }
  throw new Error('[POC] No WebAssembly.Memory found in captured instances');
}

// ---------------------------------------------------------------------------
// Step 3: Boot the core (sync). This fires the hook above.
// ---------------------------------------------------------------------------
const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');

console.log('[POC] Booting ocgcore-wasm (sync)...');
const t0 = performance.now();
const core = await createCore({ sync: true });
console.log(`[POC] Boot: ${(performance.now() - t0).toFixed(1)}ms, ${captured.instances.length} WASM instance(s) captured`);

const memory = findMemory();
console.log(`[POC] Memory: ${memory.buffer.byteLength} bytes (${(memory.buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);

// Restore originals (not strictly needed — nothing else instantiates).
WebAssembly.instantiate = origInstantiate;
WebAssembly.instantiateStreaming = origInstantiateStreaming;

// ---------------------------------------------------------------------------
// Step 4: Minimal duel setup (reused from solver-poc.ts).
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH, { readonly: true });
const cardStmt = db.prepare(
  'SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?',
);

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

function scriptReader(name: string): string | null {
  for (const sub of ['', 'official', 'goat', 'pre-release']) {
    const path = sub ? join(SCRIPTS_DIR, sub, name) : join(SCRIPTS_DIR, name);
    if (existsSync(path)) return readFileSync(path, 'utf-8');
  }
  return null;
}

const STARTUP_SCRIPTS = [
  'constant.lua', 'utility.lua', 'archetype_setcode_constants.lua',
  'card_counter_constants.lua', 'cards_specific_functions.lua', 'deprecated_functions.lua',
  'proc_equip.lua', 'proc_fusion.lua', 'proc_fusion_spell.lua', 'proc_gemini.lua',
  'proc_link.lua', 'proc_maximum.lua', 'proc_normal.lua', 'proc_pendulum.lua',
  'proc_compat.lua', 'proc_persistent.lua', 'proc_ritual.lua', 'proc_spirit.lua',
  'proc_synchro.lua', 'proc_union.lua', 'proc_workaround.lua', 'proc_xyz.lua',
];

// Vanilla deck — low branching for deterministic POC.
const DECK_MAIN = [
  43096270, 43096270, 43096270, 69247929, 69247929, 69247929,
  64788463, 64788463, 64788463, 66788016, 66788016, 66788016,
  76184692, 76184692, 76184692, 55144522, 55144522, 55144522,
  5318639, 5318639, 5318639, 83764718, 83764718, 83764718,
  70368879, 70368879, 70368879, 85309439,
];
const FILLER = Array(40).fill(43096270);
const SEED: [bigint, bigint, bigint, bigint] = [42n, 123n, 456n, 789n];

function createDuel(): any {
  const duel = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: SEED,
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader,
    scriptReader,
    errorHandler: () => {},
  });
  if (!duel) throw new Error('createDuel failed');
  for (const name of STARTUP_SCRIPTS) {
    const content = scriptReader(name);
    if (content) core.loadScript(duel, name, content);
  }
  for (const code of DECK_MAIN) {
    core.duelNewCard(duel, {
      code, team: 0, duelist: 0, controller: 0,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of FILLER) {
    core.duelNewCard(duel, {
      code, team: 1, duelist: 0, controller: 1,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  core.startDuel(duel);
  return duel;
}

function isSelect(type: number): boolean {
  return type >= OcgMessageType.SELECT_BATTLECMD && type <= OcgMessageType.ROCK_PAPER_SCISSORS;
}

function autoRespond(msg: any): any {
  switch (msg.type) {
    case OcgMessageType.SELECT_BATTLECMD: return { type: 0, action: 3 };
    case OcgMessageType.SELECT_IDLECMD:   return { type: 1, action: 7 };
    case OcgMessageType.SELECT_EFFECTYN:  return { type: 2, yes: true };
    case OcgMessageType.SELECT_YESNO:     return { type: 3, yes: false };
    case OcgMessageType.SELECT_OPTION:    return { type: 4, index: 0 };
    case OcgMessageType.SELECT_CARD:      return { type: 5, indicies: Array.from({ length: msg.min }, (_, i) => i) };
    case OcgMessageType.SELECT_CHAIN:     return { type: 8, index: null };
    case OcgMessageType.SELECT_PLACE:     return { type: 10, places: [{ player: 0, location: OcgLocation.MZONE, sequence: 0 }] };
    case OcgMessageType.SELECT_POSITION:  return { type: 11, position: OcgPosition.FACEUP_ATTACK };
    case OcgMessageType.ROCK_PAPER_SCISSORS: return { type: 20, value: msg.player === 0 ? 1 : 3 };
    default: return null;
  }
}

/** Run duelProcess until END or WAITING. Auto-respond all prompts. Returns count of responses sent. */
function runUntilFirstIdle(duel: any, maxResponses = 50): number {
  let responses = 0;
  while (responses < maxResponses) {
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);
    if (status === OcgProcessResult.END) return responses;
    if (status === OcgProcessResult.WAITING) {
      const sel = messages.find((m: any) => isSelect(m.type));
      if (!sel) return responses;
      // Stop at first SELECT_IDLECMD for player 0 — our reference state.
      if (sel.type === OcgMessageType.SELECT_IDLECMD && sel.player === 0) return responses;
      const resp = autoRespond(sel);
      if (!resp) return responses;
      core.duelSetResponse(duel, resp);
      responses++;
    }
  }
  return responses;
}

// Hash the buffer bytes (FNV-1a 32-bit over sparse sample) for correctness check.
// Full hash would be slow; sampling every 64th byte is enough to catch drift.
function sampleHash(): number {
  const view = new Uint8Array(memory.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i += 64) {
    h = ((h ^ view[i]!) * 0x01000193) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Step 5: Baseline — time to createDuel + advance to first IDLECMD.
// ---------------------------------------------------------------------------
console.log('\n=== BASELINE: createDuel + runUntilFirstIdle ===');
const BASELINE_ITERS = 5;
const baselineTimes: number[] = [];
for (let i = 0; i < BASELINE_ITERS; i++) {
  const t = performance.now();
  const duel = createDuel();
  runUntilFirstIdle(duel);
  const elapsed = performance.now() - t;
  baselineTimes.push(elapsed);
  core.destroyDuel?.(duel);
  console.log(`  iter ${i}: ${elapsed.toFixed(2)}ms  (buffer now ${memory.buffer.byteLength} bytes)`);
}
const baselineMedian = baselineTimes.slice().sort((a, b) => a - b)[Math.floor(BASELINE_ITERS / 2)]!;
console.log(`  median: ${baselineMedian.toFixed(2)}ms`);

// ---------------------------------------------------------------------------
// Step 6: Set up reference state S1 (duel advanced to first IDLECMD).
// ---------------------------------------------------------------------------
console.log('\n=== SETUP: reference state S1 ===');
const refDuel = createDuel();
runUntilFirstIdle(refDuel);
const hashS1 = sampleHash();
const bufSize = memory.buffer.byteLength;
console.log(`S1 hash=${hashS1.toString(16)}  buffer=${bufSize} bytes`);

// ---------------------------------------------------------------------------
// Step 7: Snapshot cost (100 iters).
// ---------------------------------------------------------------------------
console.log('\n=== MEASURE: snapshot cost (buffer.slice) ===');
const SNAP_ITERS = 100;
const snapTimes: number[] = [];
let snap: ArrayBuffer | null = null;
for (let i = 0; i < SNAP_ITERS; i++) {
  const t = performance.now();
  snap = memory.buffer.slice(0);
  snapTimes.push(performance.now() - t);
}
snapTimes.sort((a, b) => a - b);
const snapMedian = snapTimes[Math.floor(SNAP_ITERS / 2)]!;
const snapP90 = snapTimes[Math.floor(SNAP_ITERS * 0.9)]!;
console.log(`  median=${snapMedian.toFixed(3)}ms  p90=${snapP90.toFixed(3)}ms  min=${snapTimes[0]!.toFixed(3)}  max=${snapTimes[snapTimes.length - 1]!.toFixed(3)}`);

// ---------------------------------------------------------------------------
// Step 8: Restore cost (100 iters).
// ---------------------------------------------------------------------------
console.log('\n=== MEASURE: restore cost (Uint8Array.set) ===');
if (!snap) throw new Error('snap missing');
const snapView = new Uint8Array(snap);
const RESTORE_ITERS = 100;
const restoreTimes: number[] = [];
for (let i = 0; i < RESTORE_ITERS; i++) {
  const t = performance.now();
  new Uint8Array(memory.buffer, 0, snapView.byteLength).set(snapView);
  restoreTimes.push(performance.now() - t);
}
restoreTimes.sort((a, b) => a - b);
const restoreMedian = restoreTimes[Math.floor(RESTORE_ITERS / 2)]!;
const restoreP90 = restoreTimes[Math.floor(RESTORE_ITERS * 0.9)]!;
console.log(`  median=${restoreMedian.toFixed(3)}ms  p90=${restoreP90.toFixed(3)}ms  min=${restoreTimes[0]!.toFixed(3)}  max=${restoreTimes[restoreTimes.length - 1]!.toFixed(3)}`);

// ---------------------------------------------------------------------------
// Step 9: Correctness — snapshot at S1, advance to S2, restore, verify.
// ---------------------------------------------------------------------------
console.log('\n=== CORRECTNESS: snapshot → advance → restore → verify ===');

// Take a fresh snapshot at S1.
const snapS1 = memory.buffer.slice(0);
const snapS1View = new Uint8Array(snapS1);
console.log(`  snapshot S1: hash=${sampleHash().toString(16)}  size=${snapS1.byteLength}`);

// Advance: send "End Phase" from SELECT_IDLECMD, then run until next player 0 IDLECMD (turn 2).
const endPhase = { type: 1, action: 7 };
core.duelSetResponse(refDuel, endPhase);
const extraResponses = runUntilFirstIdle(refDuel, 30);
const hashS2 = sampleHash();
console.log(`  advanced to S2 (+${extraResponses} responses): hash=${hashS2.toString(16)}  buffer=${memory.buffer.byteLength}`);
if (hashS1 === hashS2) {
  console.error('  ⚠️  S1 and S2 have same hash — hash is not sensitive enough for this test');
}

// Restore.
const tRestore = performance.now();
if (memory.buffer.byteLength < snapS1.byteLength) {
  console.error(`  ⚠️  buffer shrunk from ${snapS1.byteLength} to ${memory.buffer.byteLength} — impossible`);
}
new Uint8Array(memory.buffer, 0, snapS1View.byteLength).set(snapS1View);
// Zero any pages that grew after the snapshot — their contents from S2 could otherwise
// poison the restored heap if the WASM allocator decides to reuse them.
if (memory.buffer.byteLength > snapS1.byteLength) {
  new Uint8Array(memory.buffer, snapS1.byteLength).fill(0);
}
const restoreElapsed = performance.now() - tRestore;
const hashAfterRestore = sampleHash();
console.log(`  restored:  hash=${hashAfterRestore.toString(16)}  (expect match S1=${hashS1.toString(16)})  [${restoreElapsed.toFixed(2)}ms]`);

if (hashAfterRestore !== hashS1) {
  console.error('  ❌ Hash mismatch after restore — snapshot restore failed');
  process.exit(1);
}
console.log('  ✅ Restored state hash matches S1');

// Replay-forward: advance the restored duel the same way → must reach same S2 hash.
console.log('\n  Replaying forward from restored state...');
let replayDuel: any = refDuel;
try {
  core.duelSetResponse(replayDuel, endPhase);
} catch (err) {
  console.error(`  ❌ duelSetResponse threw on restored handle: ${String(err)}`);
  process.exit(1);
}
const replayExtra = runUntilFirstIdle(replayDuel, 30);
const hashReplay = sampleHash();
console.log(`  after replay (+${replayExtra} responses): hash=${hashReplay.toString(16)}  (expect match S2=${hashS2.toString(16)})`);
if (hashReplay !== hashS2) {
  console.error('  ❌ Replay from restored state did not reproduce S2 — WASM snapshot insufficient for forking');
  process.exit(2);
}
console.log('  ✅ Forward replay from restored state reproduces S2 exactly');

// ---------------------------------------------------------------------------
// Step 10: Summary — extrapolate throughput gain.
// ---------------------------------------------------------------------------
console.log('\n=== SUMMARY ===');
const forkCost = snapMedian + restoreMedian;
const speedup = baselineMedian / forkCost;
console.log(`Baseline fork-via-replay (createDuel + initial advance):  ${baselineMedian.toFixed(2)}ms`);
console.log(`Snapshot + restore:                                       ${forkCost.toFixed(3)}ms  (snap=${snapMedian.toFixed(3)} + restore=${restoreMedian.toFixed(3)})`);
console.log(`Speedup:                                                  ${speedup.toFixed(1)}×`);
console.log();
console.log('Note: baseline here is the minimum fork-via-replay cost (duel creation + startup only).');
console.log('Real DFS forks replay a response history on top, so the actual speedup on deep combo');
console.log('nodes will be even larger than this ratio.');

db.close();
