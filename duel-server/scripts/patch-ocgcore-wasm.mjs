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
