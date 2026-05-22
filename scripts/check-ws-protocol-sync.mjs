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
//
// The same paired-file discipline extends to the Game Log builder brick
// (Lot 0d). `game-log-types.ts` and `game-log-builder.ts` live under
// `game-log/` on the back and `pvp/game-log/` on the front — a finished pure
// brick physically shared, no shared package (brownfield, no new deps). The
// game-log files differ from the ws-protocol files in two ways the normalizer
// must absorb: they sit in a sub-directory so they import the protocol files
// via `../` (not `./`), and they cross-import each other (`game-log-types` ↔
// `game-log-builder`). Both are handled by `normalizeGameLog` below.

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

/** Normalize a game-log paired file for cross-side comparison.
 *
 *  The game-log files (`game-log-types.ts`, `game-log-builder.ts`) live in a
 *  sub-directory, so — unlike the ws-protocol split files — they import the
 *  protocol via `../` and import each other via `./`. The back side keeps the
 *  `.js` ESM suffix and the `ws-protocol-*` stems; the front side drops the
 *  suffix and uses the `duel-ws-*.types` stems. This rewrites the back form
 *  to the front form so the two copies reduce to byte-identical.
 */
function normalizeGameLog(content) {
  return content
    // protocol split-file imports: '../ws-protocol-shared.js' → '../duel-ws-shared.types'
    .replace(/from '\.\.\/ws-protocol-(\w+)\.js'/g, "from '../duel-ws-$1.types'")
    // protocol index import: '../ws-protocol.js' → '../duel-ws.types'
    .replace(/from '\.\.\/ws-protocol\.js'/g, "from '../duel-ws.types'")
    // game-log cross-import: './game-log-types.js' → './game-log-types'
    .replace(/from '\.\/(game-log-\w+)\.js'/g, "from './$1'")
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

// Each paired file declares its own paths (the layouts differ between the two
// families) and the normalizer that reduces the two sides to a common form.
const pairedFiles = [
  // The 6 ws-protocol split files — flat layout, `./` imports.
  ...[
    { back: 'ws-protocol-shared.ts', front: 'duel-ws-shared.types.ts' },
    { back: 'ws-protocol-game.ts',   front: 'duel-ws-game.types.ts' },
    { back: 'ws-protocol-prompts.ts', front: 'duel-ws-prompts.types.ts' },
    { back: 'ws-protocol-system.ts', front: 'duel-ws-system.types.ts' },
    { back: 'ws-protocol-replay.ts', front: 'duel-ws-replay.types.ts' },
    { back: 'ws-protocol-solver.ts', front: 'duel-ws-solver.types.ts' },
  ].map(p => ({
    backPath: 'duel-server/src/' + p.back,
    frontPath: 'front/src/app/pages/pvp/' + p.front,
    label: `${p.back} ↔ ${p.front}`,
    normalizer: normalize,
  })),
  // The 2 Game Log builder files — `game-log/` sub-directory, `../` imports.
  ...[
    'game-log-types.ts',
    'game-log-builder.ts',
  ].map(name => ({
    backPath: 'duel-server/src/game-log/' + name,
    frontPath: 'front/src/app/pages/pvp/game-log/' + name,
    label: `game-log/${name} ↔ pvp/game-log/${name}`,
    normalizer: normalizeGameLog,
  })),
];

let mismatch = false;
for (const { backPath, frontPath, label, normalizer } of pairedFiles) {
  const backRaw = readFileSync(resolve(root, backPath), 'utf-8');
  const frontRaw = readFileSync(resolve(root, frontPath), 'utf-8');

  const backNorm = stripHeaderComment(normalizer(backRaw));
  const frontNorm = stripHeaderComment(normalizer(frontRaw));

  if (backNorm !== frontNorm) {
    console.error(`ERROR: ${label} are out of sync!`);
    mismatch = true;
  }
}

if (mismatch) {
  console.error('Fix: edit BOTH files in the same commit. See header comments for sync rule.');
  process.exit(1);
}

console.log(
  `OK: ${pairedFiles.length} paired protocol/game-log files are in sync ` +
  '(modulo import path normalization).',
);
