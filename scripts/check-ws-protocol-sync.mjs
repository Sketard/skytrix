#!/usr/bin/env node
// Verify ws-protocol files stay in sync between duel-server and Angular front-end.
//
// Audit finding H9 (commit) — the protocol was split from a 1.2k-LOC monolith
// into 6 logical files (shared / game / prompts / system / replay / solver)
// plus an index. Each split file is paired across the two sides:
//
//   duel-server/src/ws-protocol-X.ts  ↔  front/src/app/pages/pvp/duel-ws-X.types.ts
//
// Sync rule: the 6 split files must be byte-identical AFTER normalizing the
// `.js` import suffixes (back uses `from './ws-protocol-X.js'` for ESM
// resolution, front uses `from './duel-ws-X.types'`). The path stems differ
// too — both are normalized away before comparison.
//
// The two index files (ws-protocol.ts on back, duel-ws.types.ts on front) are
// NOT byte-checked: they have different import paths and slightly different
// re-export bodies. Their structural correctness is enforced by tsc.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/** Normalize a split-file's content for cross-side comparison:
 *  - strip `.js` suffix from import paths
 *  - rewrite back-side path stems (ws-protocol-X) → front-side stems (duel-ws-X.types)
 *
 *  After normalization, the back and front split files should be byte-identical.
 */
function normalize(content) {
  return content
    // back-side split file path: from './ws-protocol-shared.js' → from './duel-ws-shared.types'
    .replace(/from '\.\/ws-protocol-(\w+)\.js'/g, "from './duel-ws-$1.types'")
    // back-side index path: from './ws-protocol.js' → from './duel-ws.types'
    .replace(/from '\.\/ws-protocol\.js'/g, "from './duel-ws.types'")
    // front-side already in target form — idempotent
    ;
}

/** Normalize the file header comment that mentions paths/sync notes. The
 *  6 split files reference each other's path in their header comment; we
 *  only care that the type definitions match. */
function stripHeaderComment(content) {
  // Strip everything before the first non-comment, non-blank line.
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('//') || lines[i].trim() === '')) i++;
  return lines.slice(i).join('\n');
}

const splitFiles = [
  { back: 'ws-protocol-shared.ts', front: 'duel-ws-shared.types.ts' },
  { back: 'ws-protocol-game.ts',   front: 'duel-ws-game.types.ts' },
  { back: 'ws-protocol-prompts.ts', front: 'duel-ws-prompts.types.ts' },
  { back: 'ws-protocol-system.ts', front: 'duel-ws-system.types.ts' },
  { back: 'ws-protocol-replay.ts', front: 'duel-ws-replay.types.ts' },
  { back: 'ws-protocol-solver.ts', front: 'duel-ws-solver.types.ts' },
];

let mismatch = false;
for (const { back, front } of splitFiles) {
  const backPath = resolve(root, 'duel-server/src/' + back);
  const frontPath = resolve(root, 'front/src/app/pages/pvp/' + front);
  const backRaw = readFileSync(backPath, 'utf-8');
  const frontRaw = readFileSync(frontPath, 'utf-8');

  const backNorm = stripHeaderComment(normalize(backRaw));
  const frontNorm = stripHeaderComment(normalize(frontRaw));

  if (backNorm !== frontNorm) {
    console.error(`ERROR: ${back} ↔ ${front} are out of sync!`);
    mismatch = true;
  }
}

if (mismatch) {
  console.error('Fix: edit BOTH files in the same commit. See header comments for sync rule.');
  process.exit(1);
}

console.log('OK: 6 ws-protocol split files are in sync (modulo import path normalization).');
