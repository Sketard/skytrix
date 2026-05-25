// Regenerate the baseline allowlist for the pipeline-signal-tagged rule.
//
// Workflow:
//   1. Run `node front/eslint-plugins/pipeline-signal-tagged/regenerate-baseline.mjs`
//      after a story tags more legacy signals.
//   2. The script empties `allowed-files.json`, runs ESLint with the rule
//      active everywhere, collects the files that still violate, and
//      writes them back to `allowed-files.json`.
//   3. Commit the diff with the story.
//
// The α.7 acceptance criterion is "allowed-files.json contains []" — at
// that point the rule polices the whole pipeline.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ALLOWLIST_PATH = path.join(__dirname, 'allowed-files.json');
const FRONT_ROOT = path.resolve(__dirname, '..', '..');

console.log(`Resetting ${path.relative(FRONT_ROOT, ALLOWLIST_PATH)} to []…`);
fs.writeFileSync(ALLOWLIST_PATH, '[]\n', 'utf8');

console.log(`Running eslint on src/app/pages/pvp/ to collect violations…`);
let raw;
try {
  // The plugin + rule are wired in `eslint.config.js` already; --format
  // json is the only flag we override. Allowed-files just got reset to
  // [] above, so this run will surface every legacy violation.
  raw = execSync(
    'npx eslint --no-warn-ignored --format json src/app/pages/pvp',
    { cwd: FRONT_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
} catch (err) {
  // ESLint exits non-zero when there are errors — that's exactly the
  // signal we want. The JSON output is on stdout regardless.
  raw = err.stdout?.toString() ?? '';
}

if (!raw) {
  console.error('No ESLint output captured — config likely failed to load. Aborting baseline regeneration.');
  process.exit(2);
}
const report = JSON.parse(raw);
const violatingFiles = new Set();
for (const file of report) {
  const hasRuleHit = (file.messages ?? []).some(
    m => m.ruleId === 'skytrix-pipeline/pipeline-signal-tagged',
  );
  if (!hasRuleHit) continue;
  // ESLint emits absolute paths; convert to project-relative POSIX.
  const rel = path.relative(FRONT_ROOT, file.filePath).split(path.sep).join('/');
  violatingFiles.add(rel);
}
const sorted = [...violatingFiles].sort();
fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
console.log(`Wrote ${sorted.length} entries to ${path.relative(FRONT_ROOT, ALLOWLIST_PATH)}.`);
if (sorted.length === 0) {
  console.log('✓ Baseline is empty — the rule is now policing the whole pipeline.');
} else {
  console.log(`  Top 5: ${sorted.slice(0, 5).join(', ')}`);
}
