// =============================================================================
// analyze-pathbeta-v2.ts — post-hoc analysis of a Path β v2 subagent run.
//
// Inputs:
//   --fixture-id=<FIXTURE_ID>   the fixture the subagent worked on
//   --best-plan=<path>          (optional) path to the subagent's best plan
//                               .json (default: v2-summary.md is parsed for it)
//   --pvp-replay=<path>         (optional) reference PvP raw-replay for diff
//
// Reads from data/path-beta-poc/<FIXTURE_ID>/:
//   - v2-cot-log.jsonl
//   - v2-summary.md
//   - v2-self-criticism.md
//   - v2-deck-audit.md
//   - v2-attempt-*-result.json (highest-matched picked as best)
//
// Outputs:
//   - stats summary on stdout
//   - data/path-beta-poc/<FIXTURE_ID>/v2-analysis-report.md (markdown report)
//
// Usage:
//   cd duel-server
//   npx tsx scripts/analyze-pathbeta-v2.ts \
//     --fixture-id=branded-dracotail-opener \
//     [--pvp-replay=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener.raw-replay.json]
// =============================================================================

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const fixtureId = parseArg('fixture-id');
if (!fixtureId) {
  console.error('[analyze] required: --fixture-id=<FIXTURE_ID>');
  process.exit(2);
}
const pvpReplayArg = parseArg('pvp-replay');
const bestPlanArg = parseArg('best-plan');

const REPO_ROOT = resolve(import.meta.dirname!, '../..');
const FIXTURE_DIR = join(REPO_ROOT, 'duel-server/data/path-beta-poc', fixtureId);
const COT_LOG = join(FIXTURE_DIR, 'v2-cot-log.jsonl');
const SUMMARY = join(FIXTURE_DIR, 'v2-summary.md');
const SELF_CRITIC = join(FIXTURE_DIR, 'v2-self-criticism.md');
const DECK_AUDIT = join(FIXTURE_DIR, 'v2-deck-audit.md');
const REPORT_OUT = join(FIXTURE_DIR, 'v2-analysis-report.md');

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
interface CotEntry {
  event: 'hypothesis' | 'constraint_found' | 'stall' | 'eliminate' | 'rule_uncertainty' | 'verdict';
  attempt?: number;
  line?: string;
  rationale?: string;
  alternatives_considered?: Array<{ name: string; reason_eliminated: string; verified: boolean }>;
  constraint?: string;
  blocks?: string[];
  rule_ref?: string;
  verified?: boolean;
  matched?: number;
  diverged_at_step?: number;
  engine_response?: string;
  my_hypothesis?: string;
  card?: string;
  reason?: string;
  claim?: string;
  context?: string;
  need_verification?: boolean;
  score?: number;
  supporting_attempts?: number[];
  unverified_assumptions?: string[];
}

// -----------------------------------------------------------------------------
// CoT log parsing
// -----------------------------------------------------------------------------
function readCotLog(): CotEntry[] {
  if (!existsSync(COT_LOG)) {
    console.warn(`[analyze] CoT log not found: ${COT_LOG}`);
    return [];
  }
  const raw = readFileSync(COT_LOG, 'utf-8');
  const entries: CotEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as CotEntry);
    } catch (e) {
      console.warn(`[analyze] CoT log parse error on line: ${line.slice(0, 80)}...`);
    }
  }
  return entries;
}

// -----------------------------------------------------------------------------
// Best result detection
// -----------------------------------------------------------------------------
interface AttemptResult {
  path: string;
  attempt: number;
  matched: number;
  expectedBoardSize: number;
  score: number;
  stoppedReason: string;
  divergence: unknown;
  missingCardIds: number[];
}

function findBestAttempt(): AttemptResult | null {
  if (!existsSync(FIXTURE_DIR)) return null;
  const files = readdirSync(FIXTURE_DIR).filter(f => f.match(/^v2-attempt-\d+-result\.json$/));
  let best: AttemptResult | null = null;
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8'));
      const num = parseInt(f.match(/v2-attempt-(\d+)/)![1], 10);
      const cur: AttemptResult = {
        path: join(FIXTURE_DIR, f),
        attempt: num,
        matched: r.matched ?? 0,
        expectedBoardSize: r.expectedBoardSize ?? 0,
        score: r.score ?? 0,
        stoppedReason: r.stoppedReason ?? 'unknown',
        divergence: r.divergence ?? null,
        missingCardIds: r.missingCardIds ?? [],
      };
      if (!best || cur.matched > best.matched || (cur.matched === best.matched && cur.score > best.score)) {
        best = cur;
      }
    } catch {
      // skip malformed
    }
  }
  return best;
}

// -----------------------------------------------------------------------------
// Rule citation extraction
// -----------------------------------------------------------------------------
function extractRuleRefs(entries: CotEntry[]): Map<string, number> {
  const refs = new Map<string, number>();
  for (const e of entries) {
    if (e.rule_ref && e.rule_ref !== 'none') {
      refs.set(e.rule_ref, (refs.get(e.rule_ref) ?? 0) + 1);
    }
  }
  return refs;
}

// -----------------------------------------------------------------------------
// Trajectory-diff invocation (if PvP replay available)
// -----------------------------------------------------------------------------
function runTrajectoryDiff(bestResult: AttemptResult, pvpReplayPath: string): string {
  // Need to dump traces first for both sides.
  const tmpDir = join(REPO_ROOT, '_tmp-pathbeta-analysis', fixtureId);
  mkdirSync(tmpDir, { recursive: true });
  const adapterTrace = join(tmpDir, 'adapter.trace.jsonl');
  const pvpTrace = join(tmpDir, 'pvp.trace.jsonl');
  const diffOut = join(tmpDir, 'diff.json');

  // Re-run replay-trajectory-cli with --dump-trace to get the adapter prompt trace.
  const planFile = bestResult.path.replace(/-result\.json$/, '.json');
  const r1 = spawnSync('npx', [
    'tsx', 'scripts/replay-trajectory-cli.ts',
    `--fixture-id=${fixtureId}`,
    `--plan-file=${planFile}`,
    `--out=${join(tmpDir, 'adapter-result.json')}`,
    `--dump-trace=${adapterTrace}`,
  ], { cwd: join(REPO_ROOT, 'duel-server'), shell: true, encoding: 'utf-8' });
  if (r1.status !== 0) {
    return `[diff] adapter trace dump failed: ${r1.stderr?.slice(0, 200)}`;
  }

  // Run raw-replay-verify with --dump-prompt-trace to get the PvP-direct trace.
  const r2 = spawnSync('npx', [
    'tsx', 'scripts/raw-replay-verify.ts',
    `--raw-replay=${pvpReplayPath}`,
    `--fixture-id=${fixtureId}`,
    `--out=${join(tmpDir, 'pvp-result.json')}`,
    `--dump-prompt-trace=${pvpTrace}`,
  ], { cwd: join(REPO_ROOT, 'duel-server'), shell: true, encoding: 'utf-8' });
  if (r2.status !== 0) {
    return `[diff] PvP trace dump failed: ${r2.stderr?.slice(0, 200)}`;
  }

  // Run trajectory-diff.
  const r3 = spawnSync('npx', [
    'tsx', 'scripts/trajectory-diff.ts',
    `--pvp-trace=${pvpTrace}`,
    `--adapter-trace=${adapterTrace}`,
    `--out=${diffOut}`,
  ], { cwd: join(REPO_ROOT, 'duel-server'), shell: true, encoding: 'utf-8' });

  // Parse the diff result for the report.
  if (!existsSync(diffOut)) {
    return '[diff] trajectory-diff produced no output';
  }
  const diff = JSON.parse(readFileSync(diffOut, 'utf-8'));
  const lines: string[] = [];
  lines.push(`- PvP exploratory prompts: ${diff.pvpTotal}`);
  lines.push(`- Adapter exploratory prompts: ${diff.adapterTotal}`);
  lines.push(`- Aligned prompts: ${diff.aligned}`);
  if (diff.firstDivergence) {
    const fd = diff.firstDivergence;
    lines.push(`- **First divergence at aligned step ${fd.alignedStep}**:`);
    lines.push(`  - promptType: ${fd.pvpPromptType}`);
    lines.push(`  - PvP picked: ${fd.pvpPicked}`);
    lines.push(`  - Adapter picked: ${fd.adapterPicked} (source=${fd.pickSource})`);
    lines.push(`  - reason: ${fd.reason}`);
  } else {
    lines.push(`- No divergence in aligned range — trajectories matched semantically through ${diff.aligned} prompts`);
    if (diff.pvpTotal !== diff.adapterTotal) {
      lines.push(`  - Cardinality mismatch: PvP=${diff.pvpTotal} vs adapter=${diff.adapterTotal}`);
    }
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Build the analysis report
// -----------------------------------------------------------------------------
function buildReport(): string {
  const cot = readCotLog();
  const best = findBestAttempt();
  const refs = extractRuleRefs(cot);

  // Tally events by type
  const eventCounts = new Map<string, number>();
  for (const e of cot) eventCounts.set(e.event, (eventCounts.get(e.event) ?? 0) + 1);

  // Verified vs unverified ratio
  const verifiable = cot.filter(e => e.verified !== undefined);
  const verifiedCount = verifiable.filter(e => e.verified === true).length;
  const unverifiedCount = verifiable.filter(e => e.verified === false).length;
  const verifiedPct = verifiable.length > 0
    ? Math.round((verifiedCount / verifiable.length) * 100)
    : 0;

  // Unverified assumptions list
  const unverifiedItems = cot.filter(e => e.verified === false);
  const ruleUncertainties = cot.filter(e => e.event === 'rule_uncertainty' && e.need_verification === true);
  const eliminateUnverified = cot.filter(e => e.event === 'eliminate' && e.verified === false);

  // Stalls
  const stalls = cot.filter(e => e.event === 'stall');

  // Verdict
  const verdict = cot.find(e => e.event === 'verdict');

  // Rule refs sorted by frequency
  const refsSorted = [...refs.entries()].sort((a, b) => b[1] - a[1]);

  // Build markdown
  const lines: string[] = [];
  lines.push(`# Path β v2 analysis report — ${fixtureId}`);
  lines.push('');
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');

  // Outcome section
  lines.push('## Outcome');
  if (best) {
    lines.push(`- Best attempt: #${best.attempt}`);
    lines.push(`- Matched: ${best.matched}/${best.expectedBoardSize}`);
    lines.push(`- Score: ${best.score}`);
    lines.push(`- Stopped reason: ${best.stoppedReason}`);
    if (best.missingCardIds.length > 0) {
      lines.push(`- Missing cardIds: ${best.missingCardIds.join(', ')}`);
    }
    lines.push(`- Plan file: ${best.path.replace(/-result\.json$/, '.json')}`);
  } else {
    lines.push('- No attempt result found.');
  }
  lines.push('');

  if (verdict) {
    lines.push(`**Subagent verdict**: claim=\`${verdict.claim}\`, supporting attempts=\`${verdict.supporting_attempts?.join(',') ?? '?'}\``);
    if (verdict.unverified_assumptions && verdict.unverified_assumptions.length > 0) {
      lines.push(`**Self-flagged unverified assumptions**:`);
      for (const a of verdict.unverified_assumptions) lines.push(`  - ${a}`);
    }
    lines.push('');
  }

  // CoT log statistics
  lines.push('## CoT log statistics');
  lines.push(`- Total entries: ${cot.length}`);
  lines.push('');
  lines.push('### Event type breakdown');
  lines.push('');
  lines.push('| Event | Count |');
  lines.push('|---|---|');
  for (const [k, v] of [...eventCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');

  lines.push('### Verification ratio');
  lines.push(`- Entries with \`verified\` field: ${verifiable.length}`);
  lines.push(`- Verified (true): ${verifiedCount}`);
  lines.push(`- Unverified (false): ${unverifiedCount}`);
  lines.push(`- **Verification rate**: ${verifiedPct}%`);
  lines.push('');

  // Rule citations
  lines.push('## Rule citations from canonical doc');
  if (refsSorted.length === 0) {
    lines.push('- No rule references cited in the CoT log.');
    lines.push('  ⚠ This may indicate the subagent did not consult the canonical doc, or did not log rule_ref properly.');
  } else {
    lines.push('');
    lines.push('| Section ref | Times cited |');
    lines.push('|---|---|');
    for (const [k, v] of refsSorted) lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');

  // Methodology gaps
  lines.push('## Methodology gaps (action items)');
  lines.push('');
  lines.push('### Rule uncertainties (rules applied from memory, not from canonical doc)');
  if (ruleUncertainties.length === 0) {
    lines.push('- None flagged.');
  } else {
    for (const u of ruleUncertainties) {
      lines.push(`- **Claim**: "${u.claim}"`);
      lines.push(`  - Context: ${u.context}`);
    }
  }
  lines.push('');

  lines.push('### Card eliminations with `verified: false`');
  if (eliminateUnverified.length === 0) {
    lines.push('- None: every elimination cited a verified rule or empirical evidence.');
  } else {
    for (const e of eliminateUnverified) {
      lines.push(`- **Card**: ${e.card}`);
      lines.push(`  - Reason: ${e.reason}`);
      lines.push(`  - Rule ref: ${e.rule_ref ?? 'none'}`);
    }
  }
  lines.push('');

  lines.push('### Stalls (divergence + subagent diagnosis)');
  if (stalls.length === 0) {
    lines.push('- No stalls recorded.');
  } else {
    for (const s of stalls) {
      lines.push(`- **Attempt ${s.attempt}**: matched=${s.matched}, diverged at step ${s.diverged_at_step}`);
      if (s.engine_response) lines.push(`  - Engine response: ${s.engine_response}`);
      if (s.my_hypothesis) lines.push(`  - Subagent hypothesis: ${s.my_hypothesis}`);
    }
  }
  lines.push('');

  // PvP trajectory diff (if available)
  const pvpReplayPath = pvpReplayArg ?? join(
    REPO_ROOT,
    '_bmad-output/planning-artifacts/research/trajectories',
    `${fixtureId}.raw-replay.json`,
  );
  lines.push('## Trajectory diff vs PvP raw-replay');
  if (best && existsSync(pvpReplayPath)) {
    lines.push('');
    const diffSummary = runTrajectoryDiff(best, pvpReplayPath);
    lines.push(diffSummary);
  } else if (!best) {
    lines.push('- No best attempt available — diff skipped.');
  } else {
    lines.push(`- No PvP raw-replay found at \`${pvpReplayPath}\` — diff skipped.`);
    lines.push('  (Only fixtures with a recorded PvP replay can be diffed against ground truth.)');
  }
  lines.push('');

  // Artifacts links
  lines.push('## Artifacts');
  lines.push(`- CoT log: \`${COT_LOG}\``);
  if (existsSync(SUMMARY)) lines.push(`- Subagent summary: \`${SUMMARY}\``);
  if (existsSync(SELF_CRITIC)) lines.push(`- Self-criticism: \`${SELF_CRITIC}\``);
  if (existsSync(DECK_AUDIT)) lines.push(`- Deck audit: \`${DECK_AUDIT}\``);
  if (best) lines.push(`- Best plan: \`${best.path.replace(/-result\.json$/, '.json')}\``);
  lines.push('');

  // Methodology improvement suggestions (heuristic)
  lines.push('## Methodology improvement candidates');
  const suggestions: string[] = [];
  if (verifiedPct < 50 && verifiable.length > 5) {
    suggestions.push(`Verification rate is ${verifiedPct}% (<50%) — the subagent applied many rules from memory. Strengthen the canonical doc coverage or the prompt's "verify before claiming" gate.`);
  }
  if (refsSorted.length === 0 && cot.length > 5) {
    suggestions.push(`No rule references cited despite ${cot.length} CoT entries — the subagent did not anchor reasoning to canonical sections. Consider mandating section citations in the CoT schema.`);
  }
  if (eliminateUnverified.length > 3) {
    suggestions.push(`${eliminateUnverified.length} card eliminations were unverified — false ceiling risk. Mandate empirical verification (a 1-attempt plan testing the assumption) before any "card unreachable" claim.`);
  }
  if (stalls.length === 0 && best && best.stoppedReason !== 'completed') {
    suggestions.push(`Best attempt did not complete (${best.stoppedReason}) but no stalls logged — CoT discipline gap.`);
  }
  if (suggestions.length === 0) {
    lines.push('- No mechanical issues detected from the heuristics. Manual review recommended for nuanced gaps.');
  } else {
    for (const s of suggestions) lines.push(`- ${s}`);
  }
  lines.push('');

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
const report = buildReport();
mkdirSync(dirname(REPORT_OUT), { recursive: true });
writeFileSync(REPORT_OUT, report, 'utf-8');

// Stdout: concise summary
console.log(`[analyze] ${fixtureId}`);
const cot = readCotLog();
const best = findBestAttempt();
console.log(`[analyze]   CoT entries: ${cot.length}`);
if (best) {
  console.log(`[analyze]   best matched: ${best.matched}/${best.expectedBoardSize} score=${best.score}`);
}
const verifiable = cot.filter(e => e.verified !== undefined);
const verifiedCount = verifiable.filter(e => e.verified === true).length;
console.log(`[analyze]   verification rate: ${verifiable.length > 0 ? Math.round((verifiedCount / verifiable.length) * 100) : 0}% (${verifiedCount}/${verifiable.length})`);
console.log(`[analyze]   wrote ${REPORT_OUT}`);
