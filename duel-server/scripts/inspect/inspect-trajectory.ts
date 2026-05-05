// =============================================================================
// inspect-trajectory.ts — Stage 2a (Phase 3 auto-discovery validation).
//
// Pretty-prints a trajectory dump file produced by `--dump-trajectories`
// (see scripts/evaluate-structural.ts + Phase 3 Stage 1 memo). State features
// are grouped by axis (A turn/phase/LP, B hand, C self-board, D opp-board,
// E resource pools, F interruption, S engine-derived, T axis E tempo) so a
// human can read what the solver was looking at when it picked each action.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/inspect-trajectory.ts \
//     --in=data/trajectories/phase-b-v2-mlpv3-sd7/branded-dracotail-opener.json
//
//   # Batch summary across a corpus dir:
//   npx tsx scripts/inspect-trajectory.ts \
//     --dir=data/trajectories/phase-b-v2-mlpv3-sd7 --summary
//
//   # Compact mode (no per-step features, just the action sequence):
//   npx tsx scripts/inspect-trajectory.ts --in=<file> --compact
// =============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

interface TrajectoryStep {
  step: number;
  promptType: string;
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
  actionVerb: string | null;
  stateFeatures: Record<string, number>;
  actionFeatures: Record<string, number>;
}

interface TrajectoryDumpFile {
  schemaVersion: number;
  fixtureId: string;
  deckLabel: string;
  weightsBasename: string | null;
  weightsArch: string | null;
  outcome: {
    score: number;
    matched: number;
    matchedTotal: number;
    matchedCardIds: number[];
    missingCardIds: number[];
    nodesExplored: number;
    wallMs: number;
    terminationReason: string;
  };
  trajectory: TrajectoryStep[];
}

// State feature axis grouping (mirrors STATE_FEATURE_NAMES § order in
// state-feature-extractor.ts).
const STATE_AXES: Record<string, string[]> = {
  'A. Turn/phase/LP': [
    'turn_norm', 'phase_main1', 'phase_main2', 'phase_battle_active',
    'is_self_turn', 'lp_self_norm', 'normal_summon_used',
  ],
  'B. Hand composition': [
    'hand_size', 'hand_monsters_count', 'hand_extra_deck_in_hand',
    'hand_spells_count', 'hand_quickplay_count', 'hand_traps_count',
    'hand_disrupters_count', 'hand_tuners_count', 'hand_low_level_count',
    'hand_pendulum_count', 'hand_has_dupes',
  ],
  'C. Self-board': [
    'monsters_self_count', 'links_self_count', 'xyz_self_count',
    'synchros_self_count', 'fusions_self_count', 'pendulums_active_count',
    'pendulum_scales_set', 'field_spell_self_present', 'spell_traps_self_count',
    'spell_traps_facedown_count', 'total_overlay_units_self',
    'field_value_proxy_self', 'mzones_open_count', 'extra_zones_available',
  ],
  'D. Opp-board': [
    'monsters_opp_count', 'spell_traps_opp_count', 'field_spell_opp_present',
    'opp_overlay_units',
  ],
  'E. Resource pools': [
    'gy_total_count', 'gy_monsters_count', 'banished_self_count',
    'deck_remaining_count', 'extra_remaining_count', 'extra_pendulums_count',
  ],
  'F. Interruption state': [
    'interruption_pieces_field_count', 'interruption_score_proxy',
    'omninegate_count', 'floodgate_count', 'negate_total_count',
    'interruption_pieces_hand_count', 'unique_interruption_types_field',
    'gy_revival_targets_count',
  ],
  'S. Engine-derived axis D': [
    'hand_combo_potential_engine', 'hand_dead_card_count_engine',
  ],
  'T. Axis E tempo': [
    'special_summons_this_turn_norm', 'effects_activated_this_turn_norm',
    'distinct_cards_used_this_turn_norm', 'chain_resolutions_this_turn_norm',
    'cards_drawn_this_turn_norm', 'cards_searched_this_turn_norm',
  ],
};

function fmtNum(n: number): string {
  if (n === 0) return '·   ';
  if (n === 1) return '1   ';
  return n.toFixed(2).padStart(4);
}

function activeFeatures(features: Record<string, number>, threshold = 0): string[] {
  return Object.entries(features)
    .filter(([, v]) => Math.abs(v) > threshold)
    .map(([k, v]) => `${k}=${fmtNum(v).trim()}`);
}

function inspectFile(path: string, opts: { compact?: boolean }): void {
  const j = JSON.parse(readFileSync(path, 'utf-8')) as TrajectoryDumpFile;
  console.log('═'.repeat(78));
  console.log(`Fixture: ${j.fixtureId}  (deck=${j.deckLabel})`);
  console.log(`Weights: ${j.weightsBasename ?? '(vanilla)'} ${j.weightsArch ?? ''}`);
  console.log(`Outcome: score=${j.outcome.score}  matched=${j.outcome.matched}/${j.outcome.matchedTotal}` +
    `  nodes=${j.outcome.nodesExplored}  walk=${j.outcome.wallMs}ms  term=${j.outcome.terminationReason}`);
  console.log(`Steps:   ${j.trajectory.length}`);

  if (j.outcome.matched < j.outcome.matchedTotal) {
    const missingIds = new Set(j.outcome.missingCardIds);
    console.log(`Missing: ${[...missingIds].join(', ')}`);
  }

  if (j.trajectory.length === 0) {
    console.log(`(empty mainPath — DFS reached no terminal worth recording)`);
    return;
  }

  console.log('─'.repeat(78));

  for (const s of j.trajectory) {
    const verb = s.actionVerb ?? '(no-verb)';
    const head = `[${String(s.step).padStart(2)}] ${s.promptType.padEnd(18)} ${verb.padEnd(20)} ${s.cardName} (cid=${s.cardId})`;
    console.log(head);
    if (s.actionDescription && !s.actionDescription.startsWith(s.promptType)) {
      console.log(`     desc: ${s.actionDescription}`);
    }
    if (opts.compact) continue;

    // Active state features grouped by axis
    for (const [axisName, keys] of Object.entries(STATE_AXES)) {
      const active = keys
        .filter(k => s.stateFeatures[k] !== undefined && Math.abs(s.stateFeatures[k]) > 0.001)
        .map(k => `${k}=${fmtNum(s.stateFeatures[k]).trim()}`);
      if (active.length > 0) {
        console.log(`     ${axisName.padEnd(28)}: ${active.join(', ')}`);
      }
    }
    // Active action features (filter to non-zero, group all on one line)
    const actActive = activeFeatures(s.actionFeatures);
    if (actActive.length > 0) {
      console.log(`     action features            : ${actActive.join(', ')}`);
    }
    console.log('');
  }
}

interface SummaryRow {
  fixtureId: string;
  steps: number;
  score: number;
  matched: string;
  topVerbs: string;
  uniquePromptTypes: number;
  termReason: string;
}

function summarizeDir(dir: string): void {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  console.log(`Trajectory corpus: ${dir}`);
  console.log(`Files: ${files.length}`);
  console.log('═'.repeat(78));

  const rows: SummaryRow[] = [];
  let totalSteps = 0;
  const verbTotals: Record<string, number> = {};
  const promptTypeTotals: Record<string, number> = {};

  for (const f of files) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TrajectoryDumpFile;
    const verbs: Record<string, number> = {};
    const promptTypes = new Set<string>();
    for (const s of j.trajectory) {
      const v = s.actionVerb ?? '(no-verb)';
      verbs[v] = (verbs[v] ?? 0) + 1;
      verbTotals[v] = (verbTotals[v] ?? 0) + 1;
      promptTypes.add(s.promptType);
      promptTypeTotals[s.promptType] = (promptTypeTotals[s.promptType] ?? 0) + 1;
    }
    totalSteps += j.trajectory.length;
    const topVerbs = Object.entries(verbs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    rows.push({
      fixtureId: j.fixtureId,
      steps: j.trajectory.length,
      score: j.outcome.score,
      matched: `${j.outcome.matched}/${j.outcome.matchedTotal}`,
      topVerbs,
      uniquePromptTypes: promptTypes.size,
      termReason: j.outcome.terminationReason,
    });
  }

  // Per-fixture table
  console.log('Fixture'.padEnd(45) + 'Steps  Score  Matched  Prompts  Top verbs');
  console.log('-'.repeat(78));
  for (const r of rows) {
    console.log(
      r.fixtureId.padEnd(45) +
      String(r.steps).padStart(5) +
      String(r.score).padStart(7) +
      r.matched.padStart(9) +
      String(r.uniquePromptTypes).padStart(9) +
      '  ' + r.topVerbs,
    );
  }
  console.log('─'.repeat(78));
  console.log(`Total steps across corpus: ${totalSteps}`);
  console.log('');
  console.log('Verb distribution (corpus-wide):');
  const sortedVerbs = Object.entries(verbTotals).sort((a, b) => b[1] - a[1]);
  for (const [v, c] of sortedVerbs) {
    const pct = ((c / totalSteps) * 100).toFixed(1);
    console.log(`  ${v.padEnd(28)} ${String(c).padStart(4)} (${pct}%)`);
  }
  console.log('');
  console.log('Prompt-type distribution:');
  const sortedPrompts = Object.entries(promptTypeTotals).sort((a, b) => b[1] - a[1]);
  for (const [p, c] of sortedPrompts) {
    const pct = ((c / totalSteps) * 100).toFixed(1);
    console.log(`  ${p.padEnd(28)} ${String(c).padStart(4)} (${pct}%)`);
  }
}

function parseArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function main(): void {
  const inPath = parseArg('in');
  const dir = parseArg('dir');
  const compact = process.argv.includes('--compact');
  const summary = process.argv.includes('--summary');

  if (inPath) {
    inspectFile(inPath, { compact });
    return;
  }
  if (dir) {
    if (summary) {
      summarizeDir(dir);
      return;
    }
    const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    for (const f of files) {
      inspectFile(join(dir, f), { compact });
      console.log('');
    }
    return;
  }
  console.error('Usage: --in=<file> [--compact]  OR  --dir=<dir> [--summary] [--compact]');
  process.exit(2);
}

main();
