// =============================================================================
// compare-trajectories.ts — Stage 2c (Phase 3 auto-discovery validation).
//
// Compares an authored canonical trajectory (hand-built reference, e.g.
// `_bmad-output/planning-artifacts/research/trajectories/<fixture>-recorded.json`)
// with an ML-extracted trajectory dump (Phase 3 Stage 1 output) for the same
// fixture. Surfaces the divergence step-by-step + Levenshtein edit distance
// over the (responseIndex, cardId) token sequence.
//
// Authored trajectory format: `{ fixtureId, steps: [{responseIndex, cardId,
// cardName, actionDescription, ...}] }` — produced by `record-trajectory.ts`.
// ML trajectory format: schema v1 from `dumpTrajectoryToFile`.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/compare-trajectories.ts \
//     --authored=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener-recorded.json \
//     --ml=data/trajectories/phase-b-v2-mlpv3-sd7/branded-dracotail-opener.json
// =============================================================================
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Step {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription?: string;
}

interface AuthoredFile {
  fixtureId: string;
  description?: string;
  steps: Step[];
}

interface MLTrajStep extends Step {
  step: number;
  promptType: string;
  actionVerb: string | null;
}

interface MLFile {
  fixtureId: string;
  outcome?: { score: number; matched: number; matchedTotal: number };
  trajectory: MLTrajStep[];
}

function parseArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function token(s: Step): string {
  return `${s.responseIndex}:${s.cardId}`;
}

/** Standard Levenshtein edit distance with operation backtrace. */
function editDistance(a: string[], b: string[]): { distance: number; ops: Array<{ op: 'match' | 'sub' | 'ins' | 'del'; aIdx: number; bIdx: number }> } {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  // Backtrack ops
  const ops: Array<{ op: 'match' | 'sub' | 'ins' | 'del'; aIdx: number; bIdx: number }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ op: 'match', aIdx: i - 1, bIdx: j - 1 });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.unshift({ op: 'sub', aIdx: i - 1, bIdx: j - 1 });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.unshift({ op: 'del', aIdx: i - 1, bIdx: -1 });
      i--;
    } else {
      ops.unshift({ op: 'ins', aIdx: -1, bIdx: j - 1 });
      j--;
    }
  }
  return { distance: dp[m][n], ops };
}

function fmtStep(s: Step | undefined): string {
  if (!s) return '∅';
  const pass = s.responseIndex === -1 && s.cardId === 0;
  if (pass) return '(pass)';
  return `${s.cardName || '?'} (rIdx=${s.responseIndex}, cid=${s.cardId})`;
}

function main(): void {
  const authoredPath = parseArg('authored');
  const mlPath = parseArg('ml');
  if (!authoredPath || !mlPath) {
    console.error('Usage: --authored=<path> --ml=<path>');
    process.exit(2);
  }
  const authored = JSON.parse(readFileSync(resolve(authoredPath), 'utf-8')) as AuthoredFile;
  const ml = JSON.parse(readFileSync(resolve(mlPath), 'utf-8')) as MLFile;

  if (authored.fixtureId !== ml.fixtureId) {
    console.warn(`[warn] fixtureId mismatch: authored=${authored.fixtureId}  ml=${ml.fixtureId}`);
  }

  const aTokens = authored.steps.map(token);
  const mTokens = ml.trajectory.map(token);

  console.log(`Fixture: ${authored.fixtureId}`);
  if (authored.description) console.log(`Authored description: ${authored.description}`);
  if (ml.outcome) console.log(`ML outcome: score=${ml.outcome.score}  matched=${ml.outcome.matched}/${ml.outcome.matchedTotal}`);
  console.log(`Authored steps: ${aTokens.length}`);
  console.log(`ML steps:       ${mTokens.length}`);

  const { distance, ops } = editDistance(aTokens, mTokens);
  const maxLen = Math.max(aTokens.length, mTokens.length);
  const similarity = maxLen > 0 ? (1 - distance / maxLen) * 100 : 0;
  console.log(`Edit distance: ${distance}  (similarity ${similarity.toFixed(1)}% over max-length basis)`);

  // Per-op breakdown
  const counts = { match: 0, sub: 0, ins: 0, del: 0 };
  for (const o of ops) counts[o.op]++;
  console.log(`Op breakdown: match=${counts.match}  sub=${counts.sub}  ins(authored→ml extra)=${counts.ins}  del(authored extra)=${counts.del}`);

  // Common-prefix length (first divergence)
  let commonPrefix = 0;
  for (let i = 0; i < Math.min(aTokens.length, mTokens.length); i++) {
    if (aTokens[i] !== mTokens[i]) break;
    commonPrefix++;
  }
  console.log(`Common prefix: ${commonPrefix} step(s)`);

  console.log('═'.repeat(78));
  console.log('Step-by-step alignment:');
  console.log('  ✓=match  ~=substitution  +=ml-only  -=authored-only');
  for (const o of ops) {
    const aStep = o.aIdx >= 0 ? authored.steps[o.aIdx] : undefined;
    const mStep = o.bIdx >= 0 ? ml.trajectory[o.bIdx] : undefined;
    const sym = o.op === 'match' ? '✓' : o.op === 'sub' ? '~' : o.op === 'ins' ? '+' : '-';
    const aLabel = aStep ? `[A${o.aIdx}] ${fmtStep(aStep)}` : ''.padEnd(40);
    const mLabel = mStep ? `[M${o.bIdx}] ${fmtStep(mStep)}` : '';
    console.log(`  ${sym} ${aLabel.padEnd(50)} ${o.op === 'match' ? '==' : o.op === 'sub' ? '!=' : '  '} ${mLabel}`);
  }
}

main();
