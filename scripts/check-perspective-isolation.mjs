#!/usr/bin/env node
// Verify that `AnimationOrchestratorService.notifyPerspectiveSwitch` is called
// from exactly ONE site in the front codebase: `SoloDuelOrchestratorService.switchPerspective`.
//
// γ post-review M10 (2026-05-28) — replaces the vacuous Karma T7 test that
// asserted only `expect(adapterModule.ReplayDuelAdapter).toBeDefined()`. The
// real invariant is "no replay-side or other-component caller exists" — a
// static grep across the front sources, which Karma cannot perform.
//
// Pattern : `.notifyPerspectiveSwitch(` in any .ts file under front/src.
// Allowed sites :
//   - the declaration in `animation-orchestrator.service.ts` (`notifyPerspectiveSwitch(`
//     pattern matches the method signature itself)
//   - the single call in `solo-duel-orchestrator.service.ts`
//   - test spec files (`.spec.ts`) — tests legitimately invoke or mock it
//
// Any other match means a new caller has crept in and the γ doctrine
// "SoloDuelOrchestratorService is the SOLE driver of perspective flips"
// is at risk. The script exits 1 with the offending file:line.

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const frontSrc = resolve(root, 'front/src');

const ALLOWED_PROD = new Set([
  // The declaration — the method definition itself matches the regex.
  'front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts',
  // The sole legitimate caller — SOLO orchestrator's switchPerspective.
  'front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts',
]);

const PATTERN = /\.notifyPerspectiveSwitch\s*\(/g;

/** Walk a directory tree, returning every .ts file path (relative to root). */
function walkTs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      // Skip node_modules and any build artefact dir.
      if (entry === 'node_modules' || entry === 'dist' || entry === '.angular') continue;
      walkTs(p, out);
    } else if (st.isFile() && p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

let violations = 0;
for (const absPath of walkTs(frontSrc)) {
  // Normalize to a root-relative posix path. When `root` is the filesystem
  // root (`/`, as in the duel-server Docker image where scripts/ lives at
  // /scripts/ and the front sources are COPY'd under /front/), `root + '/'`
  // would be `//` and never match — strip a leading slash too so the path
  // matches the ALLOWED_PROD entries (which have no leading slash).
  const rel = absPath
    .replace(root + '\\', '')
    .replace(/\\/g, '/')
    .replace(root + '/', '')
    .replace(/^\//, '');
  // Specs are always allowed — they legitimately mock or invoke
  // `notifyPerspectiveSwitch` to test the wiring.
  if (rel.endsWith('.spec.ts')) continue;
  // Allowed prod sites — declaration + sole caller.
  if (ALLOWED_PROD.has(rel)) continue;
  const content = readFileSync(absPath, 'utf-8');
  const matches = [...content.matchAll(PATTERN)];
  if (matches.length === 0) continue;
  for (const m of matches) {
    // Compute the line number from the match index.
    const before = content.slice(0, m.index);
    const line = before.split('\n').length;
    console.error(`ERROR: unexpected notifyPerspectiveSwitch caller at ${rel}:${line}`);
    violations++;
  }
}

if (violations > 0) {
  console.error('');
  console.error('Fix: SoloDuelOrchestratorService.switchPerspective is the SOLE legitimate');
  console.error('driver of perspective flips (γ doctrine, post-review M10). If a new caller');
  console.error('is legitimate, add its path to ALLOWED_PROD in this script AND document why.');
  process.exit(1);
}

console.log('OK: notifyPerspectiveSwitch is called only from SoloDuelOrchestratorService.');
