// =============================================================================
// probe-f1-sanity.ts — single-shot sanity check that F1 fires correctly on
// a synthetic Mitsurugi state (Habakiri + Mitsurugi Ritual in hand).
//
// No fixture, no DFS. Just loads metadata + weights, builds a minimal
// FieldState, invokes computeStructuralValue, prints featureScores.
//
// Expected: F1_ritualUnlock > 0 since co-presence is satisfied.
// =============================================================================

import { join, resolve } from 'node:path';

import { loadDatabase } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
import { computeStructuralValue } from '../src/solver/structural-value-computer.js';
import type { FieldState } from '../src/solver/solver-types.js';

const HABAKIRI = 13332685;          // Ritual Monster, LV8
const MITSURUGI_RITUAL = 81560239;  // Ritual Spell
const ICE_RYZEAL = 8633261;         // Non-ritual Effect Monster (tribute fodder)

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

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
const cardMetadata = buildCardMetadataMap(cardDB, [HABAKIRI, MITSURUGI_RITUAL, ICE_RYZEAL]);

console.log('\n[f1-sanity] CardMetadataMap built:');
for (const [cid, meta] of cardMetadata) {
  console.log(`  #${cid}  type=0x${meta.type.toString(16)}  lvl=${meta.level}  ` +
    `isRitualMonster=${meta.isRitualMonster}  isRitualSpell=${meta.isRitualSpell}  ` +
    `isMonster=${meta.isMonster}  isSpell=${meta.isSpell}`);
}

// Case A: ritual monster alone (F1 should be 0 — no spell)
{
  const fs = emptyFieldState();
  fs.zones.HAND.push({ cardId: HABAKIRI, cardName: 'Habakiri', position: 'facedown', overlayCount: 0 });
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights);
  console.log(`\n[f1-sanity] Case A (Habakiri alone): F1=${r.featureScores.F1_ritualUnlock}  total=${r.totalStructural}`);
}

// Case B: ritual monster + ritual spell, no tribute fodder (F1 should = W*1 only)
{
  const fs = emptyFieldState();
  fs.zones.HAND.push({ cardId: HABAKIRI, cardName: 'Habakiri', position: 'facedown', overlayCount: 0 });
  fs.zones.HAND.push({ cardId: MITSURUGI_RITUAL, cardName: 'Mitsurugi Ritual', position: 'facedown', overlayCount: 0 });
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights);
  console.log(`[f1-sanity] Case B (Habakiri + Ritual):  F1=${r.featureScores.F1_ritualUnlock}  total=${r.totalStructural}`);
}

// Case C: ritual monster + ritual spell + non-ritual fodder (F1 should = W + tributeFodderBonus)
{
  const fs = emptyFieldState();
  fs.zones.HAND.push({ cardId: HABAKIRI, cardName: 'Habakiri', position: 'facedown', overlayCount: 0 });
  fs.zones.HAND.push({ cardId: MITSURUGI_RITUAL, cardName: 'Mitsurugi Ritual', position: 'facedown', overlayCount: 0 });
  fs.zones.HAND.push({ cardId: ICE_RYZEAL, cardName: 'Ice Ryzeal', position: 'facedown', overlayCount: 0 });
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights);
  console.log(`[f1-sanity] Case C (Habakiri + Ritual + Ice Ryzeal): F1=${r.featureScores.F1_ritualUnlock}  total=${r.totalStructural}`);
}

// Case D: turn 2 gate (F1 must be 0)
{
  const fs = emptyFieldState();
  fs.turn = 2;
  fs.zones.HAND.push({ cardId: HABAKIRI, cardName: 'Habakiri', position: 'facedown', overlayCount: 0 });
  fs.zones.HAND.push({ cardId: MITSURUGI_RITUAL, cardName: 'Mitsurugi Ritual', position: 'facedown', overlayCount: 0 });
  const r = computeStructuralValue(fs, undefined, cardMetadata, allConfigs.structuralWeights);
  console.log(`[f1-sanity] Case D (turn 2 gate):         F1=${r.featureScores.F1_ritualUnlock}  total=${r.totalStructural}`);
}

// Case E: no cardMetadata (production legacy path)
{
  const fs = emptyFieldState();
  fs.zones.HAND.push({ cardId: HABAKIRI, cardName: 'Habakiri', position: 'facedown', overlayCount: 0 });
  fs.zones.HAND.push({ cardId: MITSURUGI_RITUAL, cardName: 'Mitsurugi Ritual', position: 'facedown', overlayCount: 0 });
  const r = computeStructuralValue(fs, undefined, undefined, allConfigs.structuralWeights);
  console.log(`[f1-sanity] Case E (no metadata):          F1=${r.featureScores.F1_ritualUnlock}  total=${r.totalStructural}`);
}

process.exit(0);
