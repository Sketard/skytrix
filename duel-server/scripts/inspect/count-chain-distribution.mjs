import { readFileSync } from 'fs';

const fixtures = [
  'ddd-pendulum-opener',
  'branded-dracotail-opener',
  'snake-eye-yummy-opener',
];

for (const fix of fixtures) {
  const path = `_bmad-output/solver-data/phase-1-baselines/plan-replay/${fix}.trace.jsonl`;
  let lines;
  try {
    lines = readFileSync(path, 'utf-8').trim().split('\n');
  } catch {
    console.log(`[skip] ${fix} — no trace`);
    continue;
  }
  const counts = {};
  let chain1 = 0, chain2 = 0, chainNplus = 0, chainPickedPass = 0;
  let yn1 = 0, yn2 = 0, ynPickedNo = 0, ynPickedYes = 0;
  for (const l of lines) {
    const j = JSON.parse(l);
    counts[j.promptType] = (counts[j.promptType] ?? 0) + 1;
    if (j.promptType === 'SELECT_CHAIN') {
      const n = j.legal.length;
      if (n === 1) chain1++;
      else if (n === 2) chain2++;
      else chainNplus++;
      if (j.picked?.responseIndex === -1) chainPickedPass++;
      // N=1 sub-distribution: is the only legal action a pass sentinel?
      if (n === 1) {
        const sole = j.legal[0];
        const isPass = sole.responseIndex === -1 || sole.cardId === 0;
        if (isPass) {
          counts.__chain1_pass = (counts.__chain1_pass ?? 0) + 1;
        } else {
          counts.__chain1_forced = (counts.__chain1_forced ?? 0) + 1;
        }
      }
    } else if (j.promptType === 'SELECT_EFFECTYN' || j.promptType === 'SELECT_YESNO') {
      const n = j.legal.length;
      if (n === 1) yn1++;
      else if (n === 2) yn2++;
      const picked = j.picked?.responseIndex;
      if (picked === 0) ynPickedNo++;
      else if (picked === 1) ynPickedYes++;
    }
  }
  console.log(`\n=== ${fix} (total ${lines.length} prompts) ===`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }
  console.log(`  SELECT_CHAIN distribution: N=1: ${chain1}, N=2: ${chain2}, N>2: ${chainNplus}; picked=pass: ${chainPickedPass}/${chain1+chain2+chainNplus}`);
  console.log(`  EFFECTYN/YESNO distribution: N=1: ${yn1}, N=2: ${yn2}; picked=no(idx0): ${ynPickedNo}, yes(idx1): ${ynPickedYes}`);
}
