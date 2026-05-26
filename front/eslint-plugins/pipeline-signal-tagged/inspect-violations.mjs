// Diagnostic helper for the pipeline-signal-tagged rule.
//
// Usage:
//   node front/eslint-plugins/pipeline-signal-tagged/inspect-violations.mjs
//
// Prints a sorted listing of the rule violations across pvp/, with the
// specific signal names that need tagging in each file. Designed to make
// α.7b sub-lots planable.
//
// Workflow:
//   1. Backs up the current `allowed-files.json`.
//   2. Resets it to `[]`.
//   3. Runs eslint --format=json over pvp/.
//   4. Restores the original allowlist.
//   5. Parses + prints the per-file violations sorted by count desc.
//
// Side-effects: temporary file at the path. Restored on exit even on error.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ALLOWLIST_PATH = path.join(__dirname, 'allowed-files.json');
const FRONT_ROOT = path.resolve(__dirname, '..', '..');

const backup = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
let raw;
try {
  fs.writeFileSync(ALLOWLIST_PATH, '[]\n', 'utf8');
  try {
    raw = execSync(
      'npx eslint --no-warn-ignored --format json src/app/pages/pvp',
      { cwd: FRONT_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    raw = err.stdout?.toString() ?? '';
  }
} finally {
  fs.writeFileSync(ALLOWLIST_PATH, backup, 'utf8');
}

if (!raw) {
  console.error('No ESLint output captured. Aborting.');
  process.exit(2);
}
const report = JSON.parse(raw);
const violations = {};
let total = 0;
for (const file of report) {
  const msgs = (file.messages ?? []).filter(
    m => m.ruleId === 'skytrix-pipeline/pipeline-signal-tagged',
  );
  if (msgs.length === 0) continue;
  const rel = path.relative(FRONT_ROOT, file.filePath).split(path.sep).join('/');
  violations[rel] = msgs.map(m => {
    const match = /`([\w_]+)`/.exec(m.message);
    return match ? match[1] : '(anonymous)';
  });
  total += msgs.length;
}

console.log(`Total signaux non-tagués: ${total}`);
console.log(`Total fichiers: ${Object.keys(violations).length}\n`);

const sorted = Object.entries(violations).sort((a, b) => b[1].length - a[1].length);
for (const [f, sigs] of sorted) {
  console.log(`${f} (${sigs.length})`);
  for (const s of sigs) console.log(`  ${s}`);
}
