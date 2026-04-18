// =============================================================================
// audit-sweep-coverage.ts — pre-flight check for tune-weights sweep specs.
//
// Given a sweep spec, statically predicts which {fixture × axis} cells can
// produce a non-zero signal. Axes that can't differentiate on ANY fixture,
// or fixtures that are blind to ALL tuned axes, are flagged as wasted runs.
//
// Motivation: coarse-v1-mini ran 9 candidates × 3 fixtures with latentDiscount
// on a deck (branded-dracotail) that has neither Super Poly nor Masquerena,
// guaranteeing zero signal on that axis × fixture combination before the
// sweep was even launched. This audit surfaces such mismatches ahead of time.
//
// Heuristics per axis (V1 — static prediction only, does not run DFS):
//   structural.F1_*        → fixture must have ritual monster + ritual spell
//   structural.F2_*        → fixture must have ≥1 card from tutor whitelist
//   structural.F3_*        → fixture must have ≥1 monster (almost always)
//   structural.globalCap   → conditional — only binds if components exceed cap
//   structural.latentDiscount → retired 2026-04-18 (Phase D V1 removed)
//   interruption.*         → cannot predict statically (depends on peak cards)
//
// Exit code 0 on full coverage, 1 when ≥1 axis has zero informative fixtures
// (hard signal to revise the spec before burning cycles).
//
// Usage:
//   cd duel-server
//   npx tsx scripts/audit-sweep-coverage.ts \
//     --spec=../_bmad-output/planning-artifacts/research/sweep-specs/coarse-v1.json
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase } from '../src/ocg-scripts.js';
import { buildCardMetadataMap, type CardMetadata } from '../src/solver/card-metadata.js';
import { loadStructuralTutorCards } from '../src/solver/solver-config-loader.js';

interface SweepSpec {
  axes: Record<string, number[]>;
  fixtureFilter?: readonly string[];
}

interface DeckEntry { main: number[]; extra: number[]; side?: number[]; _draft?: boolean }
interface HandEntry { id: string; deck: string; hand: number[]; _draft?: boolean }
interface FixtureFile { decks: Record<string, DeckEntry>; hands: HandEntry[] }

interface AxisPrediction {
  canDifferentiate: boolean;
  reason: string;
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function predictAxisSignal(
  axis: string,
  cardIds: readonly number[],
  metadata: ReadonlyMap<number, CardMetadata>,
  tutorIds: ReadonlySet<number>,
): AxisPrediction {
  if (axis.startsWith('structural.F1_')) {
    let hasRitMon = false;
    let hasRitSpell = false;
    for (const id of cardIds) {
      const m = metadata.get(id);
      if (!m) continue;
      if (m.isRitualMonster) hasRitMon = true;
      if (m.isRitualSpell) hasRitSpell = true;
    }
    if (hasRitMon && hasRitSpell) return { canDifferentiate: true, reason: 'ritual monster + ritual spell both present' };
    const missing: string[] = [];
    if (!hasRitMon) missing.push('ritual monster');
    if (!hasRitSpell) missing.push('ritual spell');
    return { canDifferentiate: false, reason: `missing ${missing.join(' + ')}` };
  }

  if (axis.startsWith('structural.F2_')) {
    let count = 0;
    for (const id of cardIds) if (tutorIds.has(id)) count++;
    if (count === 0) return { canDifferentiate: false, reason: 'no tutor-whitelist card in deck/hand/extra' };
    return { canDifferentiate: true, reason: `${count} tutor-whitelist card(s) in deck/hand/extra` };
  }

  if (axis.startsWith('structural.F3_')) {
    let count = 0;
    for (const id of cardIds) if (metadata.get(id)?.isMonster) count++;
    if (count === 0) return { canDifferentiate: false, reason: 'no monsters in deck/hand/extra' };
    return { canDifferentiate: true, reason: `${count} monster(s) across deck/hand/extra` };
  }

  if (axis === 'structural.globalCap') {
    // Conditional: globalCap only binds when the sum of F1+F2+F3 exceeds the
    // cap. Without running the DFS we cannot know the actual structural sum
    // at the peak, so we surface this as "weak prediction".
    return { canDifferentiate: true, reason: 'conditional — binds only when F1+F2+F3 exceeds cap at peak' };
  }

  if (axis === 'structural.latentDiscount') {
    return { canDifferentiate: false, reason: 'Phase D V1 retired 2026-04-18 — latentDiscount no longer tuned. Remove axis from spec.' };
  }

  if (axis.startsWith('interruption.')) {
    return { canDifferentiate: true, reason: 'interruption weight — dynamic, cannot predict without DFS (optimistic)' };
  }

  return { canDifferentiate: false, reason: `unknown axis prefix '${axis}'` };
}

async function main(): Promise<void> {
  const specPath = parseStringArg('spec');
  if (!specPath) {
    console.error('[audit] --spec=<path> required');
    process.exit(2);
  }
  const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
  const FIXTURE_PATH = resolve(
    import.meta.dirname!, '..', '..',
    '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
  );

  const spec = JSON.parse(readFileSync(resolve(specPath), 'utf-8')) as SweepSpec;
  const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as FixtureFile;

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const tutorCfg = loadStructuralTutorCards(DATA_DIR);
  const tutorIds: ReadonlySet<number> = new Set(Object.keys(tutorCfg.cards).map(s => Number(s)));

  const axes = Object.keys(spec.axes);
  const hands = fixtures.hands.filter(h => {
    if (h._draft === true) return false;
    if (spec.fixtureFilter && !spec.fixtureFilter.includes(h.id)) return false;
    return true;
  });

  // Union of all card ids needed for metadata.
  const allIds = new Set<number>();
  for (const h of hands) {
    const d = fixtures.decks[h.deck];
    if (!d) continue;
    for (const id of d.main) allIds.add(id);
    for (const id of d.extra) allIds.add(id);
    for (const id of h.hand) allIds.add(id);
  }
  const metadata = buildCardMetadataMap(cardDB, Array.from(allIds));

  console.log(`[audit] spec=${resolve(specPath)}`);
  console.log(`[audit] axes=[${axes.join(', ')}]  fixtures=${hands.length}`);
  console.log('');

  // Per-fixture predictions — one row per fixture, one column per axis.
  const matrix: Record<string, Record<string, AxisPrediction>> = {};
  const axisCoverage: Record<string, number> = {};
  for (const axis of axes) axisCoverage[axis] = 0;
  const fixtureCoverage: Record<string, number> = {};

  for (const h of hands) {
    const d = fixtures.decks[h.deck];
    if (!d) continue;
    const ids = [...d.main, ...d.extra, ...h.hand];
    const row: Record<string, AxisPrediction> = {};
    let count = 0;
    for (const axis of axes) {
      const p = predictAxisSignal(axis, ids, metadata, tutorIds);
      row[axis] = p;
      if (p.canDifferentiate) { axisCoverage[axis]++; count++; }
    }
    matrix[h.id] = row;
    fixtureCoverage[h.id] = count;
  }

  // Print matrix as table.
  const axisColWidth = Math.max(20, ...axes.map(a => a.length));
  const fixtureColWidth = Math.max(20, ...hands.map(h => h.id.length));
  const header = 'fixture'.padEnd(fixtureColWidth) + ' | ' + axes.map(a => a.padEnd(axisColWidth)).join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const h of hands) {
    const row = matrix[h.id];
    if (!row) continue;
    const cells = axes.map(a => (row[a].canDifferentiate ? 'YES' : 'no').padEnd(axisColWidth));
    console.log(h.id.padEnd(fixtureColWidth) + ' | ' + cells.join(' | '));
  }
  console.log('');

  // Per-axis summary.
  console.log('[audit] axis coverage across the filter:');
  let hasZero = false;
  for (const axis of axes) {
    const covered = axisCoverage[axis];
    const marker = covered === 0 ? '✗' : covered < hands.length / 2 ? '~' : '✓';
    console.log(`  ${marker} ${axis}  ${covered}/${hands.length} fixtures will differentiate`);
    if (covered === 0) hasZero = true;
  }
  console.log('');

  // Per-fixture summary.
  console.log('[audit] fixture coverage:');
  let blindFixtures = 0;
  for (const h of hands) {
    const c = fixtureCoverage[h.id];
    const marker = c === 0 ? '✗' : c < axes.length / 2 ? '~' : '✓';
    console.log(`  ${marker} ${h.id}  ${c}/${axes.length} axes active`);
    if (c === 0) blindFixtures++;
  }
  console.log('');

  // Detailed reasons per {fixture, axis} where prediction is negative.
  console.log('[audit] dead cells (axis cannot move this fixture):');
  let deadCells = 0;
  for (const h of hands) {
    const row = matrix[h.id];
    if (!row) continue;
    for (const axis of axes) {
      if (!row[axis].canDifferentiate) {
        console.log(`  ${h.id}  ×  ${axis}  ← ${row[axis].reason}`);
        deadCells++;
      }
    }
  }
  if (deadCells === 0) console.log('  (none — full coverage)');
  console.log('');

  // Final verdict.
  if (hasZero) {
    console.log('[audit] FAIL: at least one axis has zero informative fixtures — sweep would waste cycles');
    process.exit(1);
  } else if (blindFixtures > 0) {
    console.log(`[audit] WARN: ${blindFixtures} fixture(s) blind to every tuned axis — they contribute constant noise to aggregates`);
    process.exit(0);
  } else {
    console.log('[audit] PASS: every axis differentiates on ≥1 fixture, every fixture is touched by ≥1 axis');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[audit] FATAL:', err);
  process.exit(2);
});
