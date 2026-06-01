#!/usr/bin/env node
// U3 (audit-4-modes-2026-06-01) — Enforce the Animation Parity Rule
// (CLAUDE.md "Animation Parity Rule") :
//
//   AnimationOrchestratorService MUST NOT import or reference
//   `DuelWebSocketService` or `DuelConnection` directly. Everything
//   goes through `AnimationDataSource` (token `ANIMATION_DATA_SOURCE`).
//
// The rule is what guarantees `ReplayDuelAdapter` and the PvP path can
// share the orchestrator unchanged — adding a direct WS dependency to
// the orchestrator silently breaks replay (the adapter does not
// implement DuelWebSocketService, only AnimationDataSource).
//
// Pre-U3, the rule lived only in CLAUDE.md prose. A future PR that
// adds `inject(DuelWebSocketService)` to the orchestrator for a quick
// fix compiles cleanly — the regression surfaces only when replay
// fails at runtime with `No provider for DuelWebSocketService` in
// `ReplayDuelAdapter` consumers.
//
// This script reads animation-orchestrator.service.ts, strips comments
// (to ignore prose mentions in the docblock), and fails if either of
// the two forbidden type names appears as code. ~50ms, dependency-free,
// runs both in pre-commit hook and the GitHub Actions workflow.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(
  __dirname, '..',
  'front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts',
);

const FORBIDDEN = ['DuelWebSocketService', 'DuelConnection'];

const src = readFileSync(target, 'utf-8');

// Strip block + line comments so docblock references are not flagged,
// while preserving newlines so byte offsets in `stripped` map 1:1 to
// line numbers in the original source. A bare `replace(..., '')` would
// collapse multi-line block comments and shift every subsequent offset.
// Conservative regex — does NOT handle comments inside string literals,
// but the orchestrator does not embed forbidden type names in strings.
const stripped = src
  .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
  .replace(/\/\/.*/g, '');

const violations = [];
for (const name of FORBIDDEN) {
  // Word-boundary regex so a hypothetical `DuelConnectionPool` would also
  // flag (sub-string would not catch it ; conversely a `xDuelConnection`
  // would not match — same behavior as the audit cleanup proposal).
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let m;
  while ((m = re.exec(stripped)) !== null) {
    // m.index is the offset into `stripped`, which now preserves the
    // original line layout (block comments → whitespace, newlines kept).
    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;
    violations.push({ name, line });
  }
}

if (violations.length > 0) {
  console.error(
    '\nU3 Animation Parity Rule violation : animation-orchestrator.service.ts MUST NOT reference DuelWebSocketService / DuelConnection.\n'
    + 'See CLAUDE.md "Animation Parity Rule" — all transport access must route through ANIMATION_DATA_SOURCE so ReplayDuelAdapter parity holds.\n'
    + '\nOffending references :\n'
    + violations.map(v => `  - ${v.name} at ${target}:${v.line}`).join('\n')
    + '\n',
  );
  process.exit(1);
}

console.log(`OK: animation-orchestrator.service.ts contains no forbidden references (DuelWebSocketService, DuelConnection).`);
