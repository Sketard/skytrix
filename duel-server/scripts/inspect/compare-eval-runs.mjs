import { readFileSync } from 'fs';

const a = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
const b = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
const labelA = process.argv[4] ?? 'A';
const labelB = process.argv[5] ?? 'B';

const fixIds = new Set([...Object.keys(a.fixtures), ...Object.keys(b.fixtures)]);
console.log(`\n${'fixture'.padEnd(50)} ${labelA.padStart(15)} ${labelB.padStart(15)} ${'Δmatched'.padStart(10)} ${'Δscore'.padStart(10)}`);
console.log('-'.repeat(102));
let regressions = 0, improvements = 0, sameMatch = 0;
let totalDeltaMatched = 0, totalDeltaScore = 0;
for (const id of [...fixIds].sort()) {
  const ra = a.fixtures[id];
  const rb = b.fixtures[id];
  if (!ra || !rb) {
    console.log(`${id.padEnd(50)} ${'MISSING'.padStart(15)} ${'MISSING'.padStart(15)}`);
    continue;
  }
  const dm = rb.matched - ra.matched;
  const ds = rb.score - ra.score;
  totalDeltaMatched += dm;
  totalDeltaScore += ds;
  if (dm > 0) improvements++;
  else if (dm < 0) regressions++;
  else sameMatch++;
  const flag = dm > 0 ? '↑' : dm < 0 ? '↓' : ' ';
  console.log(`${id.padEnd(50)} ${(ra.matched + '/' + ra.matchedTotal + ' ' + ra.score.toFixed(1)).padStart(15)} ${(rb.matched + '/' + rb.matchedTotal + ' ' + rb.score.toFixed(1)).padStart(15)} ${flag} ${String(dm).padStart(8)} ${ds.toFixed(1).padStart(10)}`);
}
console.log('-'.repeat(102));
console.log(`Total Δ:                                               ${'matched'.padStart(15)} ${'score'.padStart(15)} ${String(totalDeltaMatched).padStart(10)} ${totalDeltaScore.toFixed(1).padStart(10)}`);
console.log(`Improvements: ${improvements}, Regressions: ${regressions}, Same matched: ${sameMatch}`);
