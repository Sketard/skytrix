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

// Bare identifiers that are provably relative by naming convention. The
// `relativePlayer` entry is the canonical parameter name in `pvp-zone.utils.ts`.
const RELATIVIZER_NAMES = new Set([
  'rel', 'rp', 'relPlayer', 'relativePlayer', 'opponentRel', 'otherRel',
]);

// `i` is dangerously polluted as a variable name (loop indexes, sequence,
// chain links — anything). We allow it ONLY in files known to iterate
// relative-player indices ; everywhere else `i` must be flagged. Add to this
// allowlist with a code-review justification ; never broaden silently.
//
// D1 (audit-4-modes-2026-06-01 review) — file-scoped `i` allowlist.
const I_ALLOWED_FILE_BASENAMES = new Set([
  'rendered-board-state.service.ts',
]);

// Pattern : `${ZONE_ID}-${slot1}[-${slot2}…]` — multi-slot template literal.
// We capture the ZONE_ID and the FULL multi-slot body so a second pass can
// extract every `${...}` slot. The perspective gate requires that EVERY
// non-trailing slot be relative. The trailing slot may be a card index
// (`.sequence`) when at least one earlier slot was relative — e.g.
// `HAND-${relPlayer}-${link.sequence}` ; an absolute key like
// `HAND-${card.sequence}` is rejected because no slot is relative.
//
// #1 (audit review) — `[^}]+` does not match balanced braces. An expression
// like `${this.foo({a: 1}).rel}` would truncate at the first `}`. We catch
// this by detecting an opening `(` or `[` in any slot expression and report
// it as "complex expression — manual review required" instead of trying to
// match against the whitelist (which would silently accept a truncated
// prefix).
const ZONE_RE = new RegExp(
  '`(' + ZONE_IDS.join('|') + ')((?:-\\$\\{[^}]+\\})+)',
  'g',
);
const SLOT_RE = /\$\{([^}]+)\}/g;

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

function isRelativizerExpression(expr, fileBasename) {
  const trimmed = expr.trim();
  if (RELATIVIZER_NAMES.has(trimmed)) return true;
  // D1 (audit review) — `i` is allowed only in files that provably iterate
  // relative-player indices. Everywhere else it likely indexes cards,
  // chain links, or sequence numbers — none of which are player slots.
  if (trimmed === 'i' && I_ALLOWED_FILE_BASENAMES.has(fileBasename)) return true;
  // Method calls on ctx / this : `this.ctx.relativePlayer(...)`,
  // `this.duelCtx.relativePlayer(...)`, `ctx.relativePlayer(...)`.
  if (/\brelativePlayer\s*\(/.test(trimmed)) return true;
  // Property chains explicitly tagged relative : `something.rel`,
  // `link.relPlayer`.
  if (/\.(rel|rp|relPlayer|relativePlayer)$/.test(trimmed)) return true;
  return false;
}

/**
 * Card-index expressions allowed ONLY as the trailing slot of a multi-slot
 * key when at least one earlier slot is provably relative (e.g.
 * `HAND-${relPlayer}-${link.sequence}`). They are NEVER allowed as the
 * sole slot — that would let `HAND-${card.sequence}` (absolute) through.
 */
function isCardIndexExpression(expr) {
  return /\.sequence$/.test(expr.trim());
}

/**
 * #1 (audit review) — detect when a captured slot is structurally complex
 * (contains `(`, `[`, or function-call braces that the `[^}]+` regex could
 * not match safely). Such slots are reported as needing manual review.
 */
function isComplexExpression(expr) {
  return /[([]/.test(expr);
}

const files = walk(ROOT);
const violations = [];

for (const file of files) {
  if (file.endsWith('.spec.ts')) continue;
  const src = readFileSync(file, 'utf-8');
  // Strip block + line comments while preserving line offsets so we can
  // report accurate line numbers. #2 (audit review) — the bare
  // `.replace(/\/\/.*/g, '')` shifts subsequent offsets AND swallows `//`
  // sequences inside string/template literals (e.g. URLs). Replace each
  // matched character with a space so columns and lines stay aligned.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*/g, (match) => ' '.repeat(match.length));

  const basename = file.split(/[\\/]/).pop();

  let m;
  ZONE_RE.lastIndex = 0;
  while ((m = ZONE_RE.exec(stripped)) !== null) {
    const [matchText, zoneId, slotsBody] = m;
    // Parse every ${...} slot from the captured body.
    const slots = [];
    let sm;
    SLOT_RE.lastIndex = 0;
    while ((sm = SLOT_RE.exec(slotsBody)) !== null) slots.push(sm[1]);

    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;

    // #1 — any complex slot poisons the whole match (regex truncation risk).
    const anyComplex = slots.some(isComplexExpression);
    if (anyComplex) {
      violations.push({
        file, line, zoneId,
        trailingExpr: slots.map(s => s.trim()).join('-'),
        matchText, complex: true,
      });
      continue;
    }

    // Validation : at least one slot must be a proven relativizer. Card-
    // index (`.sequence`) slots are allowed only when paired with a
    // relativizer slot somewhere in the same key — never as the sole slot.
    const hasRel = slots.some(s => isRelativizerExpression(s, basename));
    const allOk = hasRel && slots.every(
      s => isRelativizerExpression(s, basename) || isCardIndexExpression(s),
    );
    if (allOk) continue;

    violations.push({
      file, line, zoneId,
      trailingExpr: slots.map(s => s.trim()).join('-'),
      matchText, complex: false,
    });
  }
}

if (violations.length > 0) {
  const simple = violations.filter(v => !v.complex);
  const complex = violations.filter(v => v.complex);
  let msg = '\nC4 Perspective Convention violation : template literals `${ZONE_ID}-${X}` MUST use a relative player index.\n'
    + 'See CLAUDE.md "Perspective Convention" (rule 1) + "Relativizer routing discipline (F6)".\n'
    + '\nAllowed slot expressions (every slot must be one of) :\n'
    + `  - bare identifier in {${[...RELATIVIZER_NAMES].join(', ')}}\n`
    + `  - bare 'i' only in files: {${[...I_ALLOWED_FILE_BASENAMES].join(', ')}}\n`
    + '  - call to relativePlayer(...)\n'
    + '  - member access ending in .rel / .rp / .relPlayer / .relativePlayer\n'
    + '  - .sequence — allowed ONLY when paired with a relativizer slot in the same key\n'
    + '    (e.g. `HAND-${relPlayer}-${link.sequence}`).\n';
  if (simple.length > 0) {
    msg += '\nOffending sites :\n'
      + simple.map(v => `  - ${v.file}:${v.line} — \`${v.zoneId}-${v.trailingExpr}\``).join('\n')
      + '\n';
  }
  if (complex.length > 0) {
    msg += '\nComplex expressions — manual review required (regex truncated at first `}`) :\n'
      + complex.map(v => `  - ${v.file}:${v.line} — \`${v.zoneId}-${v.trailingExpr}…\``).join('\n')
      + '\nRefactor the complex slot into a named local (`const rel = ...`) so the gate can verify it.\n';
  }
  console.error(msg);
  process.exit(1);
}

console.log(`OK: scanned ${files.length} TS files, no perspective-zone-key violations.`);
