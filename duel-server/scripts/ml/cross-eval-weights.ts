// cross-eval-weights.ts — evaluate each trained-weights file on every other
// fixture to detect cross-fixture regressions. Boots OCGCore once and runs
// 3×3 evaluations (3 weight files × 3 trained fixtures) plus a no-weights
// baseline column. Prints a pivoted score / matched-actions table.
//
// Usage: npx tsx scripts/cross-eval-weights.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { setupEvaluationContext, runFixture, DATA_DIR } from '../eval/evaluate-structural.js';
import { GraphGuidedRanker } from '../../src/solver/ml/graph-guided-ranker.js';
import type { GraphWeights } from '../../src/solver/ml/graph-weights-types.js';

const FIXTURES = [
  'branded-dracotail-opener',
  'snake-eye-yummy-opener',
  'ryzeal-mitsurugi-opener',
];

const WEIGHTS = [
  { label: 'baseline (none)', file: null },
  { label: 'branded-v8',      file: 'tier-a-branded-v8.json' },
  { label: 'snake-eye-v8',    file: 'tier-a-snake-eye-v8.json' },
  { label: 'ryzeal-mits-v8',  file: 'tier-a-ryzeal-mits-v8.json' },
];

function loadWeights(file: string | null): GraphWeights | undefined {
  if (file === null) return undefined;
  const raw = JSON.parse(readFileSync(join(DATA_DIR, 'trained-weights', file), 'utf-8'));
  return raw as GraphWeights;
}

async function main(): Promise<void> {
  console.log('[cross-eval] booting...');
  const ctx = await setupEvaluationContext();
  console.log('[cross-eval] OCGCore ready, running 4×3 = 12 evals\n');

  // [weightsLabel][fixtureId] → { fitness, matched }
  const grid: Record<string, Record<string, { fitness: number; matched: number; matchedTotal: number; expl: number; nodes: number }>> = {};

  for (const w of WEIGHTS) {
    grid[w.label] = {};
    const tuned = loadWeights(w.file);
    const dfsRanker = tuned
      ? (() => { const gr = new GraphGuidedRanker(ctx.ranker); gr.setWeights(tuned); return gr; })()
      : ctx.ranker;

    for (const fixId of FIXTURES) {
      const hand = ctx.fixture.hands.find(h => h.id === fixId);
      if (!hand) { console.error(`fixture ${fixId} not found`); continue; }

      const result = await runFixture(
        ctx.adapter, ctx.scorer, ctx.ranker, ctx.fixture, hand,
        ctx.allConfigs, 4000, 200, { dfsRanker },
      );
      grid[w.label][fixId] = {
        fitness: result.score,
        matched: result.matched,
        matchedTotal: result.matchedTotal,
        expl: result.explorationScore,
        nodes: result.nodesExplored,
      };
      const r = grid[w.label][fixId];
      console.log(`  [${w.label}] × ${fixId} → fit=${r.fitness.toFixed(2)} matched=${r.matched}/${r.matchedTotal} expl=${r.expl.toFixed(1)} nodes=${r.nodes}`);
    }
  }

  ctx.dispose();

  // ----- Pivoted summary -----
  console.log('\n=== CROSS-EVAL MATRIX (fitness) ===');
  console.log('weights\\fixture'.padEnd(22) + FIXTURES.map(f => f.replace('-opener','').padStart(20)).join(' '));
  for (const w of WEIGHTS) {
    const row = w.label.padEnd(22) + FIXTURES.map(f => {
      const r = grid[w.label][f];
      return (r ? r.fitness.toFixed(1) : 'n/a').padStart(20);
    }).join(' ');
    console.log(row);
  }

  console.log('\n=== CROSS-EVAL MATRIX (matched / total) ===');
  console.log('weights\\fixture'.padEnd(22) + FIXTURES.map(f => f.replace('-opener','').padStart(20)).join(' '));
  for (const w of WEIGHTS) {
    const row = w.label.padEnd(22) + FIXTURES.map(f => {
      const r = grid[w.label][f];
      return (r ? `${r.matched}/${r.matchedTotal}` : 'n/a').padStart(20);
    }).join(' ');
    console.log(row);
  }

  // ----- Regression detection -----
  console.log('\n=== REGRESSION DETECTION (vs baseline) ===');
  for (const w of WEIGHTS.slice(1)) {
    let regressions = 0, improvements = 0;
    for (const f of FIXTURES) {
      const base = grid['baseline (none)'][f];
      const r = grid[w.label][f];
      if (!base || !r) continue;
      const dF = r.fitness - base.fitness;
      const dM = r.matched - base.matched;
      const tag = dF < -1 ? '⚠ REGRESSION' : dF > 1 ? '✓ improvement' : '· flat';
      console.log(`  [${w.label}] × ${f.replace('-opener','')}: Δfit ${dF >= 0 ? '+' : ''}${dF.toFixed(2)} Δmatched ${dM >= 0 ? '+' : ''}${dM} ${tag}`);
      if (dF < -1) regressions++;
      else if (dF > 1) improvements++;
    }
    console.log(`  → ${w.label}: ${improvements} improvement(s), ${regressions} regression(s)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
