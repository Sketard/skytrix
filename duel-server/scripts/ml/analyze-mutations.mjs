#!/usr/bin/env node
// =============================================================================
// analyze-mutations.mjs — post-hoc forensic analysis of an ES training trace.
//
// Reads `meta.json` + `mutations.jsonl` from a training-logs run directory
// and surfaces three views that answer "what was rejected and why?":
//
//   1. Per-gen survivor stats — acceptance rate, mean ΔFit (accepted vs rejected),
//      mean |delta|. Shows σ calibration (acceptance ≈ 20% per Rechenberg).
//   2. Top-K worst rejects + best accepts — concrete examples with the 3 edges
//      whose perturbation magnitude was largest. "This mutation tanked because
//      it slammed edge X by Δ=+1.8."
//   3. Per-edge gradient estimate — Pearson corr(delta_i, ΔFit) across ALL
//      offspring. Edges with strongly negative corr are "fragile" (perturbing
//      hurts); edges with strongly positive corr are the implicit learning
//      direction the ES is climbing.
//
// Usage:
//   node scripts/analyze-mutations.mjs                       # auto-pick latest run
//   node scripts/analyze-mutations.mjs <traceDir>            # specific run
//   node scripts/analyze-mutations.mjs <traceDir> --json=out.json  # also dump
//   node scripts/analyze-mutations.mjs <traceDir> --top=10   # K for top lists
// =============================================================================

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter(a => a.startsWith('--')).map(a => {
    const eq = a.indexOf('=');
    return eq < 0 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const positional = argv.filter(a => !a.startsWith('--'));
const TOP_K = Number(flags.top ?? 5);

let traceDir = positional[0];
if (!traceDir) {
  const root = resolve(import.meta.dirname!, '..', '..', '..', 'data', 'training-logs');
  if (!existsSync(root)) {
    console.error(`[analyze-mutations] no training-logs dir at ${root}`);
    process.exit(1);
  }
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, mtime: statSync(join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (dirs.length === 0) {
    console.error('[analyze-mutations] no run directory found under training-logs');
    process.exit(1);
  }
  traceDir = join(root, dirs[0].name);
  console.log(`[analyze-mutations] auto-selected: ${traceDir}`);
}
traceDir = resolve(traceDir);

// -----------------------------------------------------------------------------
// Load
// -----------------------------------------------------------------------------

const metaPath = join(traceDir, 'meta.json');
const mutPath = join(traceDir, 'mutations.jsonl');
if (!existsSync(metaPath) || !existsSync(mutPath)) {
  console.error(`[analyze-mutations] expected meta.json + mutations.jsonl in ${traceDir}`);
  process.exit(1);
}
const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
const muts = readFileSync(mutPath, 'utf-8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

if (muts.length === 0) {
  console.error('[analyze-mutations] mutations.jsonl is empty — was --no-trace passed?');
  process.exit(1);
}

const dim = meta.activeEdgeCount;
const edgeIds = meta.edgeIdsOrdered;
if (!Array.isArray(edgeIds) || edgeIds.length !== dim) {
  console.error(`[analyze-mutations] meta.edgeIdsOrdered length ≠ activeEdgeCount`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Per-generation aggregates
// -----------------------------------------------------------------------------

const byGen = new Map();
for (const m of muts) {
  let g = byGen.get(m.gen);
  if (!g) {
    g = { gen: m.gen, n: 0, accepted: 0, rejected: 0,
          sumDfAccept: 0, sumDfReject: 0,
          sumAbsDelta: 0, sumAbsDeltaCount: 0, sigma: m.sigma };
    byGen.set(m.gen, g);
  }
  g.n++;
  if (m.survivedAsParent) { g.accepted++; g.sumDfAccept += m.deltaFitness; }
  else                    { g.rejected++; g.sumDfReject += m.deltaFitness; }
  for (const d of m.deltas) g.sumAbsDelta += Math.abs(d);
  g.sumAbsDeltaCount += m.deltas.length;
}
const gens = [...byGen.values()].sort((a, b) => a.gen - b.gen);

// -----------------------------------------------------------------------------
// Top rejects + accepts
// -----------------------------------------------------------------------------

const sortedByDf = [...muts].sort((a, b) => a.deltaFitness - b.deltaFitness);
const worstRejects = sortedByDf.filter(m => !m.survivedAsParent).slice(0, TOP_K);
const bestAccepts = [...sortedByDf].reverse().filter(m => m.survivedAsParent).slice(0, TOP_K);

function topDeltaEdges(m, k = 3) {
  const arr = m.deltas.map((d, i) => ({ i, d, abs: Math.abs(d) }));
  arr.sort((a, b) => b.abs - a.abs);
  return arr.slice(0, k).map(x => ({ edgeId: edgeIds[x.i], delta: x.d }));
}

// -----------------------------------------------------------------------------
// Per-edge Pearson corr(delta_i, ΔFit) over all offspring
// + mean delta among survivors (= implicit learning direction)
// -----------------------------------------------------------------------------

const N = muts.length;
const sumD = new Float64Array(dim);
const sumD2 = new Float64Array(dim);
const sumDF = new Float64Array(dim);   // Σ delta_i × ΔFit
const sumF = muts.reduce((s, m) => s + m.deltaFitness, 0);
const sumF2 = muts.reduce((s, m) => s + m.deltaFitness * m.deltaFitness, 0);
const sumDsurv = new Float64Array(dim);
let nSurv = 0;
for (const m of muts) {
  for (let i = 0; i < dim; i++) {
    const d = m.deltas[i];
    sumD[i] += d;
    sumD2[i] += d * d;
    sumDF[i] += d * m.deltaFitness;
  }
  if (m.survivedAsParent) {
    nSurv++;
    for (let i = 0; i < dim; i++) sumDsurv[i] += m.deltas[i];
  }
}

const meanF = sumF / N;
const varF = sumF2 / N - meanF * meanF;
const stdF = Math.sqrt(Math.max(0, varF));

const edgeStats = new Array(dim);
for (let i = 0; i < dim; i++) {
  const meanD = sumD[i] / N;
  const varD = sumD2[i] / N - meanD * meanD;
  const stdD = Math.sqrt(Math.max(0, varD));
  const cov = sumDF[i] / N - meanD * meanF;
  const corr = (stdD > 0 && stdF > 0) ? cov / (stdD * stdF) : 0;
  edgeStats[i] = {
    edgeId: edgeIds[i],
    meanDelta: meanD,
    meanDeltaSurvivors: nSurv > 0 ? sumDsurv[i] / nSurv : 0,
    corr,
  };
}

// Top fragile (most negative corr) and top-learning (most positive corr).
const sortedByCorr = [...edgeStats].sort((a, b) => a.corr - b.corr);
const fragile = sortedByCorr.slice(0, TOP_K);
const learning = [...sortedByCorr].reverse().slice(0, TOP_K);
// Strongest survivor-mean (= implicit ES direction).
const survivorDir = [...edgeStats]
  .sort((a, b) => Math.abs(b.meanDeltaSurvivors) - Math.abs(a.meanDeltaSurvivors))
  .slice(0, TOP_K);

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

function fmt(n, digits = 3) { return Number.isFinite(n) ? n.toFixed(digits) : 'NaN'; }
function pct(n) { return (n * 100).toFixed(0) + '%'; }
function sign(n) { return n >= 0 ? '+' : ''; }

console.log(`\n═══ analyze-mutations ═══`);
console.log(`Run:        ${meta.runId}`);
console.log(`Fixture:    ${meta.fixture}`);
console.log(`Tier:       ${meta.tier}  μ=${meta.mu}  λ=${meta.lambda}  gens=${meta.generations}  seed=${meta.seed}`);
console.log(`Dim:        ${dim} active edges`);
console.log(`Baseline:   fitness=${fmt(meta.baselineFitness, 2)}`);
console.log(`Offspring:  ${N} total (${nSurv} survived = ${pct(nSurv / N)})`);

console.log(`\n[1] σ calibration / per-gen survivor stats`);
console.log(`gen | total  acc  rej  acceptRate  meanΔfit(acc)  meanΔfit(rej)  mean|Δ|  σ`);
for (const g of gens) {
  const accRate = g.n > 0 ? g.accepted / g.n : 0;
  const meanDfA = g.accepted > 0 ? g.sumDfAccept / g.accepted : NaN;
  const meanDfR = g.rejected > 0 ? g.sumDfReject / g.rejected : NaN;
  const meanAbsD = g.sumAbsDeltaCount > 0 ? g.sumAbsDelta / g.sumAbsDeltaCount : 0;
  console.log(
    `${String(g.gen).padStart(3)} | ${String(g.n).padStart(5)}  ${String(g.accepted).padStart(3)}  ${String(g.rejected).padStart(3)}` +
    `  ${pct(accRate).padStart(10)}` +
    `  ${(sign(meanDfA) + fmt(meanDfA, 2)).padStart(13)}` +
    `  ${(sign(meanDfR) + fmt(meanDfR, 2)).padStart(13)}` +
    `  ${fmt(meanAbsD, 3).padStart(7)}` +
    `  ${fmt(g.sigma, 3)}`,
  );
}
console.log(`Rechenberg target: accept rate ≈ 20%. Persistently <10% → σ too large; >30% → σ too small.`);

console.log(`\n[2] Top ${TOP_K} worst rejects (largest fitness drop)`);
for (const m of worstRejects) {
  console.log(`  gen=${m.gen} child=${m.childIdx}  ΔFit=${sign(m.deltaFitness)}${fmt(m.deltaFitness, 2)}  parentFit=${fmt(m.parentFitness, 2)}→${fmt(m.childFitness, 2)}  σ=${fmt(m.sigma, 3)}`);
  for (const e of topDeltaEdges(m)) {
    console.log(`     |Δ| edge: ${e.edgeId.padEnd(40)}  Δ=${sign(e.delta)}${fmt(e.delta, 3)}`);
  }
}

console.log(`\n[2'] Top ${TOP_K} best accepts (largest fitness gain)`);
for (const m of bestAccepts) {
  console.log(`  gen=${m.gen} child=${m.childIdx}  ΔFit=${sign(m.deltaFitness)}${fmt(m.deltaFitness, 2)}  parentFit=${fmt(m.parentFitness, 2)}→${fmt(m.childFitness, 2)}  σ=${fmt(m.sigma, 3)}`);
  for (const e of topDeltaEdges(m)) {
    console.log(`     |Δ| edge: ${e.edgeId.padEnd(40)}  Δ=${sign(e.delta)}${fmt(e.delta, 3)}`);
  }
}

console.log(`\n[3] Per-edge Pearson corr(Δ_edge, ΔFit) — N=${N} offspring`);
console.log(`Strongly NEGATIVE corr = "fragile" (perturbing this edge tends to hurt).`);
console.log(`Strongly POSITIVE corr = ES is implicitly learning to push this edge in the same direction as its delta.\n`);

console.log(`Most fragile (top ${TOP_K} by negative corr):`);
for (const e of fragile) {
  console.log(`  corr=${sign(e.corr)}${fmt(e.corr, 3)}  meanΔ=${sign(e.meanDelta)}${fmt(e.meanDelta, 3)}  edge=${e.edgeId}`);
}

console.log(`\nMost learning-aligned (top ${TOP_K} by positive corr):`);
for (const e of learning) {
  console.log(`  corr=${sign(e.corr)}${fmt(e.corr, 3)}  meanΔ=${sign(e.meanDelta)}${fmt(e.meanDelta, 3)}  edge=${e.edgeId}`);
}

console.log(`\n[3'] Implicit learning direction — top ${TOP_K} edges by |meanΔ| among ${nSurv} survivors:`);
for (const e of survivorDir) {
  console.log(`  meanΔ_surv=${sign(e.meanDeltaSurvivors)}${fmt(e.meanDeltaSurvivors, 3)}  corr=${sign(e.corr)}${fmt(e.corr, 3)}  edge=${e.edgeId}`);
}

// -----------------------------------------------------------------------------
// Optional JSON dump
// -----------------------------------------------------------------------------

if (flags.json) {
  const out = {
    runId: meta.runId,
    fixture: meta.fixture,
    dim,
    nOffspring: N,
    nSurvived: nSurv,
    perGen: gens,
    worstRejects: worstRejects.map(m => ({ ...m, topDeltas: topDeltaEdges(m) })),
    bestAccepts: bestAccepts.map(m => ({ ...m, topDeltas: topDeltaEdges(m) })),
    edgeStats,
  };
  const outPath = resolve(flags.json);
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`\n[analyze-mutations] JSON dump → ${outPath}`);
}
