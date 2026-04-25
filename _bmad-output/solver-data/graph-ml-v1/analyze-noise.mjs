// Analyze per-fixture variance across N untuned runs.
// Usage:  node analyze-noise.mjs <run1.json> <run2.json> [run3.json...]
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error('Usage: node analyze-noise.mjs <run1.json> <run2.json> [...]');
  process.exit(2);
}

const runs = files.map(f => JSON.parse(readFileSync(f, 'utf-8')));
const fixtureIds = Object.keys(runs[0].fixtures);

function stats(xs) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { mean, std, min, max };
}

console.log(`\nFiles: ${files.map(f => f.split('/').pop()).join(', ')}`);
console.log(`\n${'fixture'.padEnd(48)}  ${'score-mean'.padStart(11)} ${'score-std'.padStart(10)} ${'score-min'.padStart(10)} ${'score-max'.padStart(10)} ${'match-mean'.padStart(11)} ${'match-std'.padStart(10)}`);
console.log('-'.repeat(110));

let aggregateMaxStd = 0, aggregateMaxRange = 0;
const aggregateScores = runs.map(r => r.aggregate.cumulativeScore);
const aggregateMatched = runs.map(r => r.aggregate.cumulativeMatched);

for (const fid of fixtureIds) {
  const scores = runs.map(r => r.fixtures[fid]?.score ?? NaN);
  const matched = runs.map(r => r.fixtures[fid]?.matched ?? NaN);
  const sStat = stats(scores);
  const mStat = stats(matched);
  if (sStat.std > aggregateMaxStd) aggregateMaxStd = sStat.std;
  if (sStat.max - sStat.min > aggregateMaxRange) aggregateMaxRange = sStat.max - sStat.min;
  const flag = sStat.std > 0.5 ? ' ⚠' : '';
  console.log(
    fid.padEnd(48) + '  ' +
    sStat.mean.toFixed(2).padStart(11) + ' ' +
    sStat.std.toFixed(3).padStart(10) + ' ' +
    sStat.min.toFixed(2).padStart(10) + ' ' +
    sStat.max.toFixed(2).padStart(10) + ' ' +
    mStat.mean.toFixed(2).padStart(11) + ' ' +
    mStat.std.toFixed(3).padStart(10) +
    flag,
  );
}

const aggSStat = stats(aggregateScores);
const aggMStat = stats(aggregateMatched);
console.log('-'.repeat(110));
console.log(
  'AGGREGATE'.padEnd(48) + '  ' +
  aggSStat.mean.toFixed(2).padStart(11) + ' ' +
  aggSStat.std.toFixed(3).padStart(10) + ' ' +
  aggSStat.min.toFixed(2).padStart(10) + ' ' +
  aggSStat.max.toFixed(2).padStart(10) + ' ' +
  aggMStat.mean.toFixed(2).padStart(11) + ' ' +
  aggMStat.std.toFixed(3).padStart(10),
);
console.log(`\nMax per-fixture σ:   ${aggregateMaxStd.toFixed(3)}`);
console.log(`Max per-fixture range: ${aggregateMaxRange.toFixed(3)}`);
console.log(`Aggregate score range: ${(aggSStat.max - aggSStat.min).toFixed(3)} over ${runs.length} runs`);
