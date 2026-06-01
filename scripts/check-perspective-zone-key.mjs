#!/usr/bin/env node
// C4 (audit-4-modes-2026-06-01) — Enforce the Perspective Convention
// (CLAUDE.md "Perspective Convention" + "Relativizer routing discipline (F6)") :
//
//   Any index used to build a DOM zone key `${ZONE_ID}-${X}` MUST be
//   relative (0 = viewer, 1 = opponent). Absolute server P0/P1 indices
//   accidentally used in the trailing slot route messages to the wrong
//   board half — a recurring bug class documented in the
//   `perspective-bug-hunt-2026-05-20` memory (EMZ resolver,
//   linkedZoneMap controller absolu, boardStateAfter per-event).
//
// Pre-C4, the rule lived only in CLAUDE.md prose. F6 routed every
// existing site through `ctx.relativePlayer()` or a `rel*` local, but
// nothing prevented a new PR from re-introducing the inline
// `=== ownIdx ? 0 : 1` idiom — or worse, using a raw `card.player`
// (absolute) as the trailing slot.
//
// This script walks every `*.ts` file under
// `front/src/app/pages/pvp/`, finds template literals of the shape
// `${ZONE_ID}-${...}` (and `${ZONE_ID}-${...}-${...}` for the
// composite hand-chain key), and fails if the trailing slot
// expression is not one of:
//
//   - A bare identifier matching the relativizer whitelist below
//   - A member-access path containing `relativePlayer` / `rel` / `rp`
//   - A call expression to `relativePlayer(`
//
// Exit code 1 with a per-site report. ~50 ms, dependency-free, runs
// in pre-commit + GitHub Actions alongside check-animation-parity.

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', 'front/src/app/pages/pvp');

const ZONE_IDS = ['MZONE', 'SZONE', 'HAND', 'GY', 'DECK', 'EXTRA', 'BANISH', 'FIELD', 'EMZ'];

// Bare identifiers that are provably relative by naming convention.
// `i` is allowed for the `RenderedBoardStateService` per-relative-player
// loop where i ∈ {0, 1} indexes _relative_ players. `relativePlayer` is
// the canonical parameter name in `pvp-zone.utils.ts`.
const RELATIVIZER_NAMES = new Set([
  'rel', 'rp', 'relPlayer', 'relativePlayer', 'opponentRel', 'otherRel', 'i',
]);

// Pattern : `${ZONE_ID}-${...}` — single trailing slot.
// We capture the trailing `${...}` expression for inspection. The
// non-greedy `[^`]*?` between the ZONE_ID and the final ${} keeps the
// match scoped to one template literal.
const ZONE_RE = new RegExp(
  '`(' + ZONE_IDS.join('|') + ')-(?:\\$\\{[^}]+\\}-)*\\$\\{([^}]+)\\}',
  'g',
);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function isRelativizerExpression(expr) {
  const trimmed = expr.trim();
  if (RELATIVIZER_NAMES.has(trimmed)) return true;
  // Method calls on ctx / this : `this.ctx.relativePlayer(...)`,
  // `this.duelCtx.relativePlayer(...)`, `ctx.relativePlayer(...)`.
  if (/\brelativePlayer\s*\(/.test(trimmed)) return true;
  // Property chains explicitly tagged relative : `something.rel`,
  // `link.relPlayer`, `link.sequence` (sequence is NOT a player slot,
  // it's a card index — allowed because pvp-board-container builds
  // `HAND-${relPlayer}-${link.sequence}` where the perspective gate
  // is on relPlayer, the sequence is just a card position).
  if (/\.(rel|rp|relPlayer|relativePlayer)$/.test(trimmed)) return true;
  if (/\.sequence$/.test(trimmed)) return true;
  return false;
}

const files = walk(ROOT);
const violations = [];

for (const file of files) {
  if (file.endsWith('.spec.ts')) continue;
  const src = readFileSync(file, 'utf-8');
  // Strip block + line comments while preserving line offsets so we
  // can report accurate line numbers (same trick as check-animation-parity).
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*/g, '');

  let m;
  ZONE_RE.lastIndex = 0;
  while ((m = ZONE_RE.exec(stripped)) !== null) {
    const [matchText, zoneId, trailingExpr] = m;
    if (isRelativizerExpression(trailingExpr)) continue;
    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;
    violations.push({
      file,
      line,
      zoneId,
      trailingExpr: trailingExpr.trim(),
      matchText,
    });
  }
}

if (violations.length > 0) {
  console.error(
    '\nC4 Perspective Convention violation : template literals `${ZONE_ID}-${X}` MUST use a relative player index.\n'
    + 'See CLAUDE.md "Perspective Convention" (rule 1) + "Relativizer routing discipline (F6)".\n'
    + '\nAllowed trailing expressions :\n'
    + `  - bare identifier in {${[...RELATIVIZER_NAMES].join(', ')}}\n`
    + '  - call to relativePlayer(...)\n'
    + '  - member access ending in .rel / .rp / .relPlayer / .relativePlayer\n'
    + '  - .sequence (allowed for composite ${zone}-${rel}-${sequence} keys)\n'
    + '\nOffending sites :\n'
    + violations.map(v => `  - ${v.file}:${v.line} — \`${v.zoneId}-...\${${v.trailingExpr}}\``).join('\n')
    + '\n',
  );
  process.exit(1);
}

console.log(`OK: scanned ${files.length} TS files, no perspective-zone-key violations.`);
