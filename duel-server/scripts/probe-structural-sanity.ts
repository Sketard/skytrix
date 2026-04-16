// =============================================================================
// probe-structural-sanity.ts — unit-test-style sanity checks for every
// structural-value feature. No fixture, no DFS — synthetic FieldStates
// invoke computeStructuralValue directly and assert expected scores.
//
// Runs all active features (F1, F2, ...) in one pass. Extend with new
// cases as features land.
// =============================================================================

import { join, resolve } from 'node:path';

import { loadDatabase } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
import { computeStructuralValue } from '../src/solver/structural-value-computer.js';
import type { FieldState, ActivationLog } from '../src/solver/solver-types.js';

const HABAKIRI = 13332685;          // Ritual Monster LV8
const FUTSU = 55397172;             // Ritual Monster LV8
const MITSURUGI_RITUAL = 81560239;  // Ritual Spell
const MITSURUGI_MIRROR = 49721684;  // Ritual Spell
const SAJI = 18176525;              // Tutor combo-starter
const PRAYERS = 45171524;           // Tutor engine-glue
const ICE_RYZEAL = 8633261;         // Tutor engine-glue
const SWORD_RYZEAL = 35844557;      // Tutor engine-glue
const RYZEAL_DETONATOR = 34909328;  // Tutor engine-glue
const UNTAGGED_MONSTER = 42141493;  // Fuwalos — handtrap, not a tutor

function emptyFieldState(): FieldState {
  const zones: FieldState['zones'] = {
    M1: [], M2: [], M3: [], M4: [], M5: [],
    EMZ_L: [], EMZ_R: [],
    S1: [], S2: [], S3: [], S4: [], S5: [],
    FIELD: [], HAND: [], GY: [], BANISHED: [], EXTRA: [], DECK: [],
  };
  return {
    zones,
    lifePoints: [8000, 8000],
    turn: 1,
    phase: 'MAIN1',
  };
}

function card(cid: number, name: string) {
  return { cardId: cid, cardName: name, position: 'facedown' as const, overlayCount: 0 };
}

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
const cardMetadata = buildCardMetadataMap(cardDB, [
  HABAKIRI, FUTSU, MITSURUGI_RITUAL, MITSURUGI_MIRROR,
  SAJI, PRAYERS, ICE_RYZEAL, SWORD_RYZEAL, RYZEAL_DETONATOR,
  UNTAGGED_MONSTER,
]);

console.log('\n[sanity] CardMetadataMap built:');
for (const [cid, meta] of cardMetadata) {
  console.log(`  #${cid}  type=0x${meta.type.toString(16)}  ` +
    `isRitualMonster=${meta.isRitualMonster}  isRitualSpell=${meta.isRitualSpell}  isMonster=${meta.isMonster}`);
}

let passed = 0, failed = 0;
function check(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: expected=${expected} actual=${actual}`);
  if (ok) passed++; else failed++;
}

// =============================================================================
// F1 — Ritual Unlock Co-Presence
// =============================================================================

console.log('\n[sanity] ─── F1 Ritual Unlock Co-Presence ───');

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F1.A Habakiri alone (no spell)', r.featureScores.F1_ritualUnlock, 0);
}

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  fs.zones.HAND.push(card(MITSURUGI_RITUAL, 'Mitsurugi Ritual'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F1.B Habakiri + Ritual (no fodder)', r.featureScores.F1_ritualUnlock, 3);
}

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  fs.zones.HAND.push(card(MITSURUGI_RITUAL, 'Mitsurugi Ritual'));
  fs.zones.HAND.push(card(ICE_RYZEAL, 'Ice Ryzeal'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F1.C Habakiri + Ritual + Ice Ryzeal (fodder)', r.featureScores.F1_ritualUnlock, 4);
}

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  fs.zones.HAND.push(card(FUTSU, 'Futsu'));
  fs.zones.HAND.push(card(MITSURUGI_RITUAL, 'Mitsurugi Ritual'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F1.D 2 ritual monsters + spell (self-tribute)', r.featureScores.F1_ritualUnlock, 4);
}

{
  const fs = emptyFieldState();
  fs.turn = 2;
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  fs.zones.HAND.push(card(MITSURUGI_RITUAL, 'Mitsurugi Ritual'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F1.E turn 2 gate', r.featureScores.F1_ritualUnlock, 0);
}

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  fs.zones.HAND.push(card(MITSURUGI_RITUAL, 'Mitsurugi Ritual'));
  const r = computeStructuralValue(fs, undefined, undefined, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F1.F no metadata gate', r.featureScores.F1_ritualUnlock, 0);
}

// =============================================================================
// F2 — Tutor Chain Potency
// =============================================================================

console.log('\n[sanity] ─── F2 Tutor Chain Potency ───');

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(UNTAGGED_MONSTER, 'Fuwalos'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F2.A no tutor present', r.featureScores.F2_tutorChain, 0);
}

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(SAJI, 'Saji'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F2.B Saji fresh in hand', r.featureScores.F2_tutorChain, 3);
}

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(SAJI, 'Saji'));
  fs.zones.HAND.push(card(PRAYERS, 'Prayers'));
  fs.zones.M1.push(card(ICE_RYZEAL, 'Ice Ryzeal'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F2.C Saji + Prayers + Ice Ryzeal (sum 7)', r.featureScores.F2_tutorChain, 7);
}

{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(SAJI, 'Saji'));
  fs.zones.HAND.push(card(PRAYERS, 'Prayers'));
  fs.zones.M1.push(card(ICE_RYZEAL, 'Ice Ryzeal'));
  fs.zones.M2.push(card(SWORD_RYZEAL, 'Sword Ryzeal'));
  fs.zones.M3.push(card(RYZEAL_DETONATOR, 'Ryzeal Detonator'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F2.D all 5 tutors (sum 11 → cap 8)', r.featureScores.F2_tutorChain, 8);
}

{
  const fs = emptyFieldState();
  fs.zones.M1.push(card(SAJI, 'Saji'));
  const activationLog: ActivationLog = new Map([[SAJI, [0]]]);
  const r = computeStructuralValue(fs, activationLog, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F2.E Saji consumed (not fresh)', r.featureScores.F2_tutorChain, 0);
}

{
  const fs = emptyFieldState();
  fs.zones.GY.push(card(SAJI, 'Saji'));
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('F2.F Saji in GY (out of scan zones)', r.featureScores.F2_tutorChain, 0);
}

// =============================================================================
// Combined F1 + F2 — canonical Mitsurugi opening states
// =============================================================================

console.log('\n[sanity] ─── Combined F1 + F2 (Mitsurugi opening) ───');

// Post-Prayers→Saji: Saji in hand, Prayers consumed in GY. F1=0 (no spell
// yet). F2=3 (Saji fresh).
{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  fs.zones.HAND.push(card(SAJI, 'Saji'));
  fs.zones.HAND.push(card(UNTAGGED_MONSTER, 'Fuwalos'));
  fs.zones.GY.push(card(PRAYERS, 'Prayers'));
  const activationLog: ActivationLog = new Map([[PRAYERS, [0]]]);
  const r = computeStructuralValue(fs, activationLog, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('Combined.1 post-Prayers→Saji (F1=0, F2=3)', r.totalStructural, 3);
  console.log(`     F1=${r.featureScores.F1_ritualUnlock} F2=${r.featureScores.F2_tutorChain}`);
}

// Post-Saji→Ritual: Saji on field (consumed), Mitsurugi Ritual in hand,
// Habakiri still in hand, Fuwalos as fodder.
// F1 = 3 (Habakiri + Ritual) + 1 (Fuwalos fodder) = 4.
// F2 = 0 (Saji consumed).
{
  const fs = emptyFieldState();
  fs.zones.HAND.push(card(HABAKIRI, 'Habakiri'));
  fs.zones.HAND.push(card(MITSURUGI_RITUAL, 'Mitsurugi Ritual'));
  fs.zones.HAND.push(card(UNTAGGED_MONSTER, 'Fuwalos'));
  fs.zones.M1.push(card(SAJI, 'Saji'));
  fs.zones.GY.push(card(PRAYERS, 'Prayers'));
  const activationLog: ActivationLog = new Map([[PRAYERS, [0]], [SAJI, [0]]]);
  const r = computeStructuralValue(fs, activationLog, cardMetadata, allConfigs.structuralWeights, allConfigs.structuralTutorCards);
  check('Combined.2 post-Saji→Ritual (F1=4, F2=0)', r.totalStructural, 4);
  console.log(`     F1=${r.featureScores.F1_ritualUnlock} F2=${r.featureScores.F2_tutorChain}`);
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n[sanity] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
