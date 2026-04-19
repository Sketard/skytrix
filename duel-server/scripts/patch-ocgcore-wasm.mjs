/**
 * Post-install patches for @n1xx1/ocgcore-wasm v0.1.1.
 *
 * All patches are string-replace based (idempotent, order-independent).
 * Each entry: { file, label, from, to }
 *
 * Run via: node scripts/patch-ocgcore-wasm.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const patches = [
  // ── P1: Fix module re-exports (missing default export + wrong relative path) ──
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/_dist/mod.d.ts',
    label: 'mod.d.ts re-export path + default',
    from:  'export * from "./dist/index.d.ts";',
    to:    'export * from "../dist/index.d.ts";\nexport { default } from "../dist/index.d.ts";',
  },
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/mod.js',
    label: 'mod.js default re-export',
    from:  'export * from "./dist/index.js";\n//# sourceMappingURL=mod.js.map',
    to:    'export * from "./dist/index.js";\nexport { default } from "./dist/index.js";\n//# sourceMappingURL=mod.js.map',
  },

  // ── P2: Fix SELECT_SUM parser (missing position field) ──
  // The edo9300 OCGCore writes 18 bytes per card:
  //   code(u32), controller(u8), location(u8), sequence(u32), position(u32), sum_param(u32)
  // But the parser only reads 14 bytes (skips position), so it reads position
  // as amount and all subsequent cards are shifted by 4 bytes.
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/dist/index.js',
    label: 'SELECT_SUM parser — add missing position(u32)',
    from:
      'selects:Array.from({length:e.u32()},()=>({code:e.u32(),controller:e.u8(),location:e.u8(),sequence:e.u32(),amount:e.u32()})),' +
      'selects_must:Array.from({length:e.u32()},()=>({code:e.u32(),controller:e.u8(),location:e.u8(),sequence:e.u32(),amount:e.u32()}))',
    to:
      'selects:Array.from({length:e.u32()},()=>({code:e.u32(),controller:e.u8(),location:e.u8(),sequence:e.u32(),position:e.u32(),amount:e.u32()})),' +
      'selects_must:Array.from({length:e.u32()},()=>({code:e.u32(),controller:e.u8(),location:e.u8(),sequence:e.u32(),position:e.u32(),amount:e.u32()}))',
  },

  // ── P3: Fix OCG_CardData marshalling — rscale + link_marker offsets (ptrSize=4 branch) ──
  // The binding writes lscale@40, then skips offset 44, writing rscale@48 and
  // link_marker@52. The upstream C++ struct OCG_CardData uses natural alignment
  // (uint64 race already falls at offset 24 — a multiple of 8 — so no padding is
  // inserted), giving: lscale@40, rscale@44, link_marker@48. C++ therefore reads
  // link_marker from offset 48 where the binding wrote rscale (= 0 for non-
  // Pendulum cards). Net effect: every Link monster's arrow bitmask is lost,
  // so rule "Extra Deck Link may land on a Link-arrow-pointed MZ" never fires.
  //
  // Anchor includes attack@32 + defense@36 + lscale@40 to disambiguate from the
  // ptrSize≠4 (wasm64) branch which uses different attack/defense offsets.
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/dist/index.js',
    label: 'OCG_CardData marshalling — rscale 48→44, link_marker 52→48',
    from:
      'e.setInt32(32,t.attack??0,!0),e.setInt32(36,t.defense??0,!0),' +
      'e.setUint32(40,t.lscale??0,!0),e.setUint32(48,t.rscale??0,!0),' +
      'e.setUint32(52,t.link_marker??0,!0))',
    to:
      'e.setInt32(32,t.attack??0,!0),e.setInt32(36,t.defense??0,!0),' +
      'e.setUint32(40,t.lscale??0,!0),e.setUint32(44,t.rscale??0,!0),' +
      'e.setUint32(48,t.link_marker??0,!0))',
  },

  // ── P4: Polyfill Duel.GetReasonEffect / Duel.GetReasonPlayer in proc_workaround.lua ──
  // proc_workaround.lua monkey-patches Duel.Overlay (line 431-457) to add an
  // EVENT_MOVE raise after Xyz materials are attached. The patch calls
  // Duel.GetReasonEffect() at the very first line. These functions exist in
  // upstream edo9300/ygopro-core (libduel.cpp lines 4154/4158) but are NOT
  // bound in @n1xx1/ocgcore-wasm 0.1.1 — calling them yields nil → crash:
  //   "[string \"proc_workaround.lua\"]:438: attempt to call a nil value (field 'GetReasonEffect')"
  //
  // The crash happens INSIDE the wrapped Duel.Overlay BEFORE the original
  // C++ Duel.Overlay (oldfunc) is called → xyz_overlay processor never runs
  // → Xyz materials are never moved off the field → Xyz monster summons
  // "ghost-style" with 0 overlays.
  //
  // Empirical repro (PVP + solver): NS Eldam + NS Swen + Xyz Totem Bird
  // leaves M1=Eldam, M2=Swen, M3=Totem Bird (overlay=null) instead of
  // expected M1=∅, M2=∅, M3=Totem Bird (overlay=[Eldam, Swen]).
  //
  // The error is silenced by `errorHandler: () => {}` in ocgcore-adapter.ts
  // (set OCG_DEBUG=1 to surface lua errors to console).
  //
  // Polyfill: prepend stub functions returning nil/PLAYER_NONE to
  // proc_workaround.lua. The wrapped Duel.Overlay then defaults `re=nil` and
  // `rp=PLAYER_NONE`, calls the original Duel.Overlay, and EVENT_MOVE raises
  // with no reason effect — same behavior as if no SS was effect-driven.
  // Worst-case downside: cards that conditionally trigger on EVENT_MOVE +
  // reason_effect (e.g. Guiding Quem, Despian Luluwalilith) would miss the
  // re argument — but those triggers were already unreachable in our build
  // since the wrapper crashed before raising at all. Polyfill is strictly
  // an improvement.
  {
    file: 'data/scripts_full/proc_workaround.lua',
    label: 'proc_workaround.lua — polyfill GetReasonEffect / GetReasonPlayer',
    from: '--Utilities to be added to the core',
    to: '--Utilities to be added to the core\n\n-- POLYFILL: Duel.GetReasonEffect / Duel.GetReasonPlayer\n-- Bound in upstream edo9300/ygopro-core (libduel.cpp 4154/4158) but missing\n-- in @n1xx1/ocgcore-wasm 0.1.1. The Duel.Overlay monkey-patch below (line\n-- ~438) crashes without these. Strip both polyfills if/when the underlying\n-- WASM build adds the bindings (see patch-ocgcore-wasm.mjs P4 for context).\nif not Duel.GetReasonEffect then Duel.GetReasonEffect=function() return nil end end\nif not Duel.GetReasonPlayer then Duel.GetReasonPlayer=function() return PLAYER_NONE end end\n',
  },

];

let failed = 0;

for (const { file, label, from, to } of patches) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    console.error(`[patch] FAIL  ${label} — file not found: ${file}`);
    failed++;
    continue;
  }

  if (content.includes(to)) {
    console.log(`[patch] OK    ${label} (already applied)`);
  } else if (content.includes(from)) {
    writeFileSync(file, content.replace(from, to));
    console.log(`[patch] APPLY ${label}`);
  } else {
    console.error(`[patch] FAIL  ${label} — pattern not found (library version changed?)`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`[patch] ${failed} patch(es) failed — check @n1xx1/ocgcore-wasm version.`);
  process.exit(1);
}
