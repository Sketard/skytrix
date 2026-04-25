// Audit `edges-all.json` for false-positive `summon-then-trigger` edges :
// the toEff has a `condition.simpleFilter` predicate (e.g. fusionSummoned)
// that the fromEff's summon-type cannot satisfy.
//
// Reads :
//   - duel-server/data/trained-weights/edges-all.json
//   - _bmad-output/solver-data/card-effects-catalog/<cardId>.json
// Writes :
//   - learned-weights-fp-report.md  (markdown summary)
//   - edges-validated.json          (subset of edges that pass precision check)

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'c:/Users/Axel/Desktop/code/skytrix';
const CATALOG_DIR = join(ROOT, '_bmad-output/solver-data/card-effects-catalog');
const EDGES_PATH = join(ROOT, 'duel-server/data/trained-weights/edges-all.json');
const OUT_DIR = join(ROOT, '_bmad-output/solver-data/graph-ml-v1');

// -------- Load catalog --------
const catalogByCardId = new Map();
for (const f of readdirSync(CATALOG_DIR)) {
  if (!f.endsWith('.json')) continue;
  const c = JSON.parse(readFileSync(join(CATALOG_DIR, f), 'utf-8'));
  catalogByCardId.set(c.cardId, c);
}

const edges = JSON.parse(readFileSync(EDGES_PATH, 'utf-8')).edges;

function findEffect(cardId, effectId) {
  const cat = catalogByCardId.get(cardId);
  if (!cat) return null;
  return cat.effects.find(e => e.id === effectId) ?? null;
}

// -------- False-positive detection --------
//
// Predicates on toEff.condition that gate the trigger by summon-type :
//   fusionSummoned  → from must have CATEGORY_FUSION_SUMMON
//   synchroSummoned → from must produce a Synchro Summon (no separate category;
//                     check via summon-procedure category — heuristic)
//   xyzSummoned     → idem Xyz
//   linkSummoned    → idem Link
//   ritualSummoned  → idem Ritual

const SUMMON_TYPE_GATES = {
  fusionSummoned: 'CATEGORY_FUSION_SUMMON',
  // The other summon-types don't have explicit categories in catalog v7 ;
  // we'll mark them "needs manual review" until parser exposes them.
  synchroSummoned: '__NEEDS_PARSER_UPGRADE__',
  xyzSummoned:     '__NEEDS_PARSER_UPGRADE__',
  linkSummoned:    '__NEEDS_PARSER_UPGRADE__',
  ritualSummoned:  '__NEEDS_PARSER_UPGRADE__',
};

function hasSummonGate(toEff) {
  const preds = toEff?.condition?.simpleFilter?.predicates ?? [];
  for (const p of preds) {
    if (SUMMON_TYPE_GATES[p.kind] !== undefined) {
      return p.kind;
    }
  }
  return null;
}

const reasons = {
  validated: 0,
  notSummonThenTrigger: 0,
  fpFusionSummonedMismatch: 0,
  needsParserUpgrade: 0,
  toEffectMissing: 0,
  fromEffectMissing: 0,
};

const validatedEdges = [];
const falsePositives = [];
const needsManualReview = [];

for (const edge of edges) {
  if (!edge.reason.startsWith('summon-then-trigger')) {
    reasons.notSummonThenTrigger++;
    validatedEdges.push(edge);
    continue;
  }

  const toEff = findEffect(edge.to.cardId, edge.to.effectId);
  if (!toEff) {
    reasons.toEffectMissing++;
    needsManualReview.push({ edge, why: 'to-effect not in catalog' });
    continue;
  }

  const gateKind = hasSummonGate(toEff);
  if (gateKind === null) {
    reasons.validated++;
    validatedEdges.push(edge);
    continue;
  }

  const requiredCategory = SUMMON_TYPE_GATES[gateKind];

  if (requiredCategory === '__NEEDS_PARSER_UPGRADE__') {
    reasons.needsParserUpgrade++;
    needsManualReview.push({ edge, why: `to-effect requires ${gateKind} but parser doesn't expose this on from-effect categories` });
    validatedEdges.push(edge); // optimistic — keep until we have parser support
    continue;
  }

  const fromEff = findEffect(edge.from.cardId, edge.from.effectId);
  if (!fromEff) {
    reasons.fromEffectMissing++;
    needsManualReview.push({ edge, why: 'from-effect not in catalog' });
    continue;
  }

  const fromCats = new Set(fromEff.categories ?? []);
  if (!fromCats.has(requiredCategory)) {
    reasons.fpFusionSummonedMismatch++;
    falsePositives.push({
      edge,
      gateKind,
      fromCategories: [...fromCats],
      reasonFp: `to-effect gated by ${gateKind} but from-effect lacks ${requiredCategory}`,
    });
    continue;
  }

  reasons.validated++;
  validatedEdges.push(edge);
}

// -------- Markdown report --------
const lines = [];
lines.push('# Edge Validation — `summon-then-trigger` Precision Audit (2026-04-25)');
lines.push('');
lines.push(`Audits all ${edges.length} edges in \`edges-all.json\`. Focus : pattern 2`);
lines.push('(`summon-then-trigger`) edges where the to-effect has a `condition.simpleFilter`');
lines.push('predicate that gates the trigger by summon-type (e.g., `fusionSummoned`).');
lines.push(`The current \`enumerate-edges.ts:506\` only checks the event code, not the`);
lines.push('condition predicates → false-positives slip through.');
lines.push('');
lines.push('## Outcome');
lines.push('');
lines.push('| Outcome | Count |');
lines.push('|---|---:|');
lines.push(`| Edges not in scope (other patterns) | ${reasons.notSummonThenTrigger} |`);
lines.push(`| Validated (no summon-type gate) | ${reasons.validated} |`);
lines.push(`| **False-positive (fusionSummoned mismatch)** | **${reasons.fpFusionSummonedMismatch}** |`);
lines.push(`| Needs parser upgrade (synchro/xyz/link/ritual gates) | ${reasons.needsParserUpgrade} |`);
lines.push(`| Catalog miss (to-effect) | ${reasons.toEffectMissing} |`);
lines.push(`| Catalog miss (from-effect) | ${reasons.fromEffectMissing} |`);
lines.push(`| **TOTAL** | **${edges.length}** |`);
lines.push('');

if (falsePositives.length > 0) {
  lines.push('## False-Positive Edges (`fusionSummoned` mismatch)');
  lines.push('');
  lines.push('to-effect requires Fusion Summon trigger, from-effect produces a generic SS or non-Fusion summon.');
  lines.push('');
  lines.push('| from | to | from-categories |');
  lines.push('|------|-----|-----------------|');
  for (const fp of falsePositives) {
    const fromTag = `${fp.edge.from.cardId} (${fp.edge.from.name}) ${fp.edge.from.effectId}`;
    const toTag = `${fp.edge.to.cardId} (${fp.edge.to.name}) ${fp.edge.to.effectId}`;
    lines.push(`| ${fromTag} | ${toTag} | ${fp.fromCategories.join(', ')} |`);
  }
  lines.push('');
}

if (needsManualReview.length > 0 && needsManualReview.length <= 50) {
  lines.push('## Needs Manual Review (parser upgrade or catalog miss)');
  lines.push('');
  lines.push('| from | to | reason |');
  lines.push('|------|-----|--------|');
  for (const r of needsManualReview.slice(0, 50)) {
    const fromTag = `${r.edge.from.cardId} (${r.edge.from.name}) ${r.edge.from.effectId}`;
    const toTag = `${r.edge.to.cardId} (${r.edge.to.name}) ${r.edge.to.effectId}`;
    lines.push(`| ${fromTag} | ${toTag} | ${r.why} |`);
  }
  if (needsManualReview.length > 50) lines.push(`| ... | ... | (${needsManualReview.length - 50} more) |`);
  lines.push('');
}

lines.push('## Recommendations');
lines.push('');
lines.push('1. **Patch `enumerate-edges.ts:506`** : when `toEff.condition.simpleFilter.predicates` contains a `fusionSummoned` (and other summon-type) gate, intersect with `fromEff.categories` membership of the corresponding category. Reject the edge when the gate is incompatible.');
lines.push('2. **Parser upgrade for non-Fusion summon types** : currently the catalog only marks `CATEGORY_FUSION_SUMMON` explicitly. Synchro/Xyz/Link/Ritual summons need their own category flags (or a normalised "summon-type" enum) so the validator can apply the same logic.');
lines.push('3. **Re-train weights with cleaned graph** : every false-positive edge ate ES gradient capacity without yielding learning signal. After cleanup, the same training budget should produce sharper weights.');
lines.push('');

writeFileSync(join(OUT_DIR, 'edge-validation-report.md'), lines.join('\n'));
writeFileSync(join(OUT_DIR, 'edges-validated.json'), JSON.stringify({ edges: validatedEdges, falsePositives, needsManualReview }, null, 2));

// Console summary
console.log(`edges total: ${edges.length}`);
console.log(`  not in scope (non-summon-then-trigger): ${reasons.notSummonThenTrigger}`);
console.log(`  validated (no gate): ${reasons.validated}`);
console.log(`  FALSE-POSITIVE (fusionSummoned mismatch): ${reasons.fpFusionSummonedMismatch}`);
console.log(`  needs parser upgrade: ${reasons.needsParserUpgrade}`);
console.log(`  to-effect missing in catalog: ${reasons.toEffectMissing}`);
console.log(`  from-effect missing in catalog: ${reasons.fromEffectMissing}`);
console.log(`\nWrote: ${join(OUT_DIR, 'edge-validation-report.md')}`);
console.log(`Wrote: ${join(OUT_DIR, 'edges-validated.json')}`);
