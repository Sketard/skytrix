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

  // ── P6: Add missing TYPE branch to query parser ──
  // OcgQueryFlags.TYPE (8) is declared in the bundle's d.ts and corresponds
  // to the live-altered card type bitmask (Effect/Tuner/Synchro/Xyz/Link/
  // Pendulum/Flip/...) — distinct from the static `type` field on the card
  // DB. Without this branch, querying TYPE returns `{}` and any "is this
  // card currently a Tuner / Synchro / etc." check is impossible. C++ writes
  // it as a single u32 value (verified against edo9300/ygopro-core
  // card.cpp::get_infos QUERY_TYPE branch).
  //
  // Insert the new branch right after E.ALIAS (matches d.ts ordering).
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/dist/index.js',
    label: 'TYPE parser — add missing branch',
    from:  's===E.ALIAS&&o===4)t.alias=e.u32();else if(s===E.LEVEL',
    to:    's===E.ALIAS&&o===4)t.alias=e.u32();else if(s===E.TYPE&&o===4)t.type=e.u32();else if(s===E.LEVEL',
  },

  // ── P5: Fix OVERLAY_CARD query parser — wrong flag tag matched ──
  // The parser branches on `s === E.TARGET_CARD` but assigns to `t.overlayCards`
  // and decodes the buffer as `u32 count + u32×count code`. Per the bundle's
  // own d.ts: TARGET_CARD → `targetCards: OcgCardQueryInfoCard[]` (refs),
  // OVERLAY_CARD → `overlayCards: number[]` (codes). The decode logic is
  // correct for OVERLAY_CARD; only the flag tag is wrong. Querying a Xyz with
  // `OcgQueryFlags.OVERLAY_CARD` therefore returns `{}` (no case matches),
  // and querying with TARGET_CARD returns `{overlayCards: []}` (wrong payload
  // decoded as overlay). Net effect: every Xyz monster's overlay list is
  // empty in BoardState, so the rendered Xyz appears with no materials —
  // visible bug on Rank-Up summons (Wise King → Marksman Tell) but actually
  // affects every Xyz summon.
  //
  // Fix: rewire the existing parser branch to match OVERLAY_CARD instead of
  // TARGET_CARD. We don't decode TARGET_CARD anywhere in the codebase, so
  // dropping that (already-broken) path is harmless.
  //
  // P5 MUST run before P7: P7's anchor matches the post-P5 form
  // (`s===E.OVERLAY_CARD&&o>=4){t.overlayCards=[];...`). On a fresh install
  // P5 must rewrite the flag tag first so P7's anchor exists.
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/dist/index.js',
    label: 'OVERLAY_CARD parser — match OVERLAY_CARD, not TARGET_CARD',
    from:  's===E.TARGET_CARD&&o>=4){t.overlayCards=[];',
    to:    's===E.OVERLAY_CARD&&o>=4){t.overlayCards=[];',
  },

  // ── P7: Add missing TARGET_CARD branch to query parser ──
  // OcgQueryFlags.TARGET_CARD (32768) is declared in the bundle's d.ts as
  // `targetCards: OcgCardQueryInfoCard[]` — list of persistent effect-target
  // links on this card (Equip Spell targets accessed from the equipped side,
  // Number 39 Utopia material chases, Chaos Hunter banished tracking, etc.).
  // Distinct from EQUIP_CARD (single ref, only set on the equipping spell)
  // and OVERLAY_CARD (Xyz materials as raw u32 codes).
  //
  // C++ writes `u32 count + count × {u8 controller, u8 location, u32 sequence,
  // u32 position}` (verified against edo9300/ygopro-core card.cpp::get_infos
  // QUERY_TARGET_CARD branch). The 10-byte per-card layout matches the
  // existing `p(e)` helper used by EQUIP_CARD/REASON_CARD.
  //
  // Insert after the OVERLAY_CARD branch (depends on P5 rewrite).
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/dist/index.js',
    label: 'TARGET_CARD parser — add missing branch',
    from:  's===E.OVERLAY_CARD&&o>=4){t.overlayCards=[];let r=e.u32();for(let S=0;S<r;S++)t.overlayCards.push(e.u32())}',
    to:    's===E.OVERLAY_CARD&&o>=4){t.overlayCards=[];let r=e.u32();for(let S=0;S<r;S++)t.overlayCards.push(e.u32())}else if(s===E.TARGET_CARD&&o>=4){t.targetCards=[];let r=e.u32();for(let S=0;S<r;S++)t.targetCards.push(p(e))}',
  },

  // ── P8: Fix SORT_CARD response encoder (spurious length prefix) ──
  // The encoder writes i8(order.length) before the rank bytes, but OCGCore C++
  // reads N bytes directly (N = number of cards from the SORT_CARD message).
  // The length byte is misread as rank[0]; since N == number of cards (e.g. 4),
  // it's out of range [0, N-1] → OCGCore sends RETRY for every manual sort.
  // Fix: remove the i8(order.length) prefix so only the rank bytes are written.
  {
    file: 'node_modules/@n1xx1/ocgcore-wasm/dist/index.js',
    label: 'SORT_CARD encoder — remove spurious length prefix',
    from:  'case 15:if(!e.order){t.i8(-1);break}t.i8(e.order.length);for(let r of e.order)t.i8(r);break;',
    to:    'case 15:if(!e.order){t.i8(-1);break}for(let r of e.order)t.i8(r);break;',
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
