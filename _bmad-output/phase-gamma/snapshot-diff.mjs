#!/usr/bin/env node
// =============================================================================
// snapshot-diff.mjs — γ commit 7c parity comparator
// -----------------------------------------------------------------------------
// Usage :
//   node _bmad-output/phase-gamma/snapshot-diff.mjs <v1.json> <gamma.json>
//
// Compares two `window.__skytrixDebug.snapshot()` outputs (cf. CLAUDE.md
// "Debugging Animations" Layer 2) field by field, ignoring channels known
// to be ephemeral (DOM rects, in-flight floats with timing-variable
// fields, base timestamps). Prints a JSON-shaped diff to stdout + a
// summary line to stderr.
//
// Exit codes :
//   0 — diff is empty (modulo ephemeral fields).
//   1 — diff non-empty : the two snapshots structurally differ.
//   2 — usage error / missing file.
//
// Used by the manual T2-T10 checklist (commit 7d parity step). NOT a
// fully-general diff tool — calibrated for the snapshot shape produced
// by `DuelDebugService.snapshot()`.
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Field paths to ignore. Each entry matches `path.join(...keys)` against
// any nested location in the snapshot tree. Wildcards : `*` matches a
// single key segment.
const IGNORE_PATHS = [
  'domZones',                       // getBoundingClientRect : impure read
  'domZones.*',
  'inFlightFloats.*.duration',      // timing-variable
  'inFlightFloats.*.startedAt',     // wall-clock
  'landedFloats.*.timestamp',       // wall-clock
  'landedFloats.*.landedAt',        // wall-clock
  'capturedAt',                     // snapshot() timestamp
];

function shouldIgnore(pathStr) {
  for (const pattern of IGNORE_PATHS) {
    // Convert wildcard pattern to RegExp : `.` literal, `*` → `[^.]+`.
    const re = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$',
    );
    if (re.test(pathStr)) return true;
  }
  return false;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function diffRecursive(a, b, pathPrefix = '') {
  if (shouldIgnore(pathPrefix)) return null;

  // Both nullish or strictly equal primitives.
  if (a === b) return null;
  if (a == null && b == null) return null;

  // Different types → record both.
  if (typeof a !== typeof b) {
    return { left: a, right: b, reason: 'type-mismatch' };
  }

  // Arrays — compare length + per-index.
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { left: a, right: b, reason: `length ${a.length} !== ${b.length}` };
    }
    const itemDiffs = {};
    for (let i = 0; i < a.length; i++) {
      const sub = diffRecursive(a[i], b[i], `${pathPrefix}.${i}`);
      if (sub !== null) itemDiffs[i] = sub;
    }
    return Object.keys(itemDiffs).length === 0 ? null : itemDiffs;
  }
  // Mixed array / non-array → mismatch.
  if (Array.isArray(a) !== Array.isArray(b)) {
    return { left: a, right: b, reason: 'array/non-array-mismatch' };
  }

  // Objects — compare key sets + recurse.
  if (isObject(a) && isObject(b)) {
    const result = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const childPath = pathPrefix ? `${pathPrefix}.${k}` : k;
      if (!(k in a)) {
        if (!shouldIgnore(childPath)) result[k] = { right: b[k], reason: 'missing-in-left' };
        continue;
      }
      if (!(k in b)) {
        if (!shouldIgnore(childPath)) result[k] = { left: a[k], reason: 'missing-in-right' };
        continue;
      }
      const sub = diffRecursive(a[k], b[k], childPath);
      if (sub !== null) result[k] = sub;
    }
    return Object.keys(result).length === 0 ? null : result;
  }

  // Primitive mismatch.
  return { left: a, right: b };
}

function main() {
  const [, , leftPath, rightPath] = process.argv;
  if (!leftPath || !rightPath) {
    process.stderr.write(
      `Usage: node ${path.basename(__filename)} <v1.json> <gamma.json>\n` +
      `  Diffs two snapshots, ignoring ${IGNORE_PATHS.length} ephemeral paths.\n` +
      `  Exit 0 = equal modulo ephemeral, 1 = differ, 2 = usage error.\n`,
    );
    process.exit(2);
  }

  let left, right;
  try {
    left = JSON.parse(fs.readFileSync(path.resolve(leftPath), 'utf8'));
  } catch (e) {
    process.stderr.write(`failed to read ${leftPath} : ${e.message}\n`);
    process.exit(2);
  }
  try {
    right = JSON.parse(fs.readFileSync(path.resolve(rightPath), 'utf8'));
  } catch (e) {
    process.stderr.write(`failed to read ${rightPath} : ${e.message}\n`);
    process.exit(2);
  }

  const diff = diffRecursive(left, right);
  if (diff === null) {
    process.stderr.write(`✓ snapshots equal (modulo ${IGNORE_PATHS.length} ephemeral paths)\n`);
    process.exit(0);
  }
  process.stdout.write(JSON.stringify(diff, null, 2) + '\n');
  // Compact summary on stderr — one-liner for CI logs.
  const flatKeys = [];
  function walk(node, p = '') {
    if (node === null || typeof node !== 'object') return;
    if ('left' in node || 'right' in node || 'reason' in node) {
      flatKeys.push(p);
      return;
    }
    for (const k of Object.keys(node)) walk(node[k], p ? `${p}.${k}` : k);
  }
  walk(diff);
  process.stderr.write(`✗ snapshots differ on ${flatKeys.length} path(s) :\n`);
  for (const k of flatKeys.slice(0, 20)) process.stderr.write(`  - ${k}\n`);
  if (flatKeys.length > 20) process.stderr.write(`  ... and ${flatKeys.length - 20} more\n`);
  process.exit(1);
}

main();
