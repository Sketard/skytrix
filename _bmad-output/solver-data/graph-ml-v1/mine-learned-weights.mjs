// Mine the trained weight files for grammar-authoring insights.
// Reads tier-a-{branded,ryzeal-mitsurugi,snake-eye}.json + edges-all.json
// + archetype-expertise files. Produces a markdown report :
//   - Top-N positive / negative edges per archetype
//   - Cross-archetype consensus (edges hot in >=2 archetypes)
//   - Coverage flag : is the edge already encoded in an archetype's
//     bridges or goals?
//
// Usage:  node mine-learned-weights.mjs > learned-weights-mining.md

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'c:/Users/Axel/Desktop/code/skytrix/duel-server/data';
const TOP_N = 15;

// -------- Inputs --------
const edgesFile = JSON.parse(readFileSync(join(DATA, 'trained-weights/edges-all.json'), 'utf-8'));
const edgeById = new Map();
for (const e of edgesFile.edges) {
  const id = `${e.from.cardId}.${e.from.effectId}->${e.to.cardId}.${e.to.effectId}`;
  edgeById.set(id, e);
}

const archetypes = ['branded', 'ryzeal-mitsurugi', 'snake-eye'];
const weightsByArch = {};
for (const a of archetypes) {
  weightsByArch[a] = JSON.parse(readFileSync(join(DATA, `trained-weights/tier-a-${a}.json`), 'utf-8')).edges;
}

// -------- Training-fixture deck card-id sets --------
// Critical for filtering: an edge whose `from.cardId` is NOT in the training
// fixture's deck has NO learning signal — its weight is initialisation drift.
// Only in-deck edges are meaningful. Map archetype training run → fixtureId.
const FIXTURE_BY_ARCH = {
  branded: 'branded-dracotail-opener',
  'ryzeal-mitsurugi': 'ryzeal-mitsurugi-opener',
  'snake-eye': 'snake-eye-yummy-opener',
};
const fixtureFile = JSON.parse(readFileSync(
  'c:/Users/Axel/Desktop/code/skytrix/_bmad-output/planning-artifacts/research/solver-validation-decks.json',
  'utf-8'
));
const deckCardsByArch = {};
for (const [arch, fid] of Object.entries(FIXTURE_BY_ARCH)) {
  const hand = fixtureFile.hands.find(h => h.id === fid);
  if (!hand) {
    console.error(`Fixture not found: ${fid}`);
    process.exit(1);
  }
  const deck = fixtureFile.decks[hand.deck];
  const ids = new Set([...deck.main, ...deck.extra, ...hand.hand]);
  deckCardsByArch[arch] = ids;
}

// archetype-expertise lookup : map cardId → {bridges:[ids], goals:[ids], roles:[]}
function loadExpertise(name) {
  return JSON.parse(readFileSync(join(DATA, 'archetype-expertise', `${name}.json`), 'utf-8'));
}
const expertiseFiles = {
  branded: loadExpertise('branded'),
  ryzeal: loadExpertise('ryzeal'),
  mitsurugi: loadExpertise('mitsurugi'),
  'snake-eye': loadExpertise('snake-eye'),
};

// Map cardId → list of {archetype, where} entries showing where it's covered.
function indexCoverage() {
  const cov = new Map();
  for (const [archName, exp] of Object.entries(expertiseFiles)) {
    function add(cardId, where) {
      if (!cardId) return;
      if (!cov.has(cardId)) cov.set(cardId, []);
      cov.get(cardId).push(`${archName}/${where}`);
    }
    if (exp.roleMap) {
      for (const idStr of Object.keys(exp.roleMap)) add(Number(idStr), 'roleMap');
    }
    if (Array.isArray(exp.bridges)) {
      for (const b of exp.bridges) {
        for (const s of (b.steps ?? [])) {
          if (s.subject?.kind === 'specific') add(s.subject.cardId, `bridge:${b.id}`);
          if (s.target?.kind === 'specific') add(s.target.cardId, `bridge:${b.id}.target`);
        }
        for (const p of (b.produces ?? [])) {
          if (p.card?.kind === 'specific') add(p.card.cardId, `bridge:${b.id}.produces`);
        }
        for (const r of (b.requiresInitialState ?? [])) {
          if (r.card?.kind === 'specific') add(r.card.cardId, `bridge:${b.id}.precond`);
        }
      }
    }
    if (Array.isArray(exp.goals)) {
      for (const g of exp.goals) {
        for (const r of (g.required ?? [])) {
          if (r.card?.kind === 'specific') add(r.card.cardId, `goal:${g.id}`);
        }
      }
    }
  }
  return cov;
}
const coverage = indexCoverage();

function covEntry(cardId) {
  const c = coverage.get(cardId);
  return c ? c.join(', ') : '— not covered';
}

// -------- Top N per archetype --------
function topN(weightsObj, n, deckSet) {
  const entries = Object.entries(weightsObj)
    .filter(([, v]) => v !== 0)
    .map(([id, v]) => ({ id, w: v }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  // Annotate in-deck status if a deckSet is provided.
  for (const e of entries) {
    const ed = edgeById.get(e.id);
    e.inDeckFrom = ed ? deckSet?.has(ed.from.cardId) ?? null : null;
    e.inDeckTo = ed ? deckSet?.has(ed.to.cardId) ?? null : null;
    e.bothInDeck = e.inDeckFrom && e.inDeckTo;
  }
  return entries.slice(0, n);
}

function topNInDeck(weightsObj, n, deckSet) {
  const entries = Object.entries(weightsObj)
    .filter(([id, v]) => {
      if (v === 0) return false;
      const e = edgeById.get(id);
      if (!e) return false;
      return deckSet.has(e.from.cardId) && deckSet.has(e.to.cardId);
    })
    .map(([id, v]) => ({ id, w: v }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  return entries.slice(0, n);
}

function fmtEdgeRow(idx, entry, deckSet) {
  const e = edgeById.get(entry.id);
  if (!e) return `| ${idx} | (orphan id ${entry.id}) | ${entry.w.toFixed(3)} | — | — |`;
  const inDeck = deckSet ? (deckSet.has(e.from.cardId) && deckSet.has(e.to.cardId)) : null;
  const inDeckTag = inDeck === null ? '' : (inDeck ? ' ✓' : ' ⚠ drift');
  const fromTag = `${e.from.cardId} (${e.from.name}) ${e.from.effectId}`;
  const toTag = `${e.to.cardId} (${e.to.name}) ${e.to.effectId}`;
  const fromCov = covEntry(e.from.cardId);
  const toCov = covEntry(e.to.cardId);
  const reason = (e.reason ?? '').replace(/\|/g, '\\|');
  return `| ${idx} | ${entry.w.toFixed(3)}${inDeckTag} | ${fromTag} → ${toTag} | ${reason} | ${fromCov} \\| ${toCov} |`;
}

// -------- Output --------
console.log('# Learned Weights Mining — Grammar-Authoring Insights (2026-04-25)');
console.log('');
console.log('Top-15 edges (by |weight|) per archetype-trained weight file. Each edge');
console.log('= a learned action-ordering preference (positive = preferred ; negative = avoided).');
console.log('Coverage column flags whether the from/to card is already in an');
console.log('archetype-expertise file.');
console.log('');
console.log('**Use as** : suggestions for new bridges/goals to author manually, or');
console.log('sanity-check on existing coverage.');
console.log('');
console.log('---');
console.log('');
console.log('## ⚠ Critical Context — Framework Architecture (F12)');
console.log('');
console.log('Two structural caveats that change how to read this report :');
console.log('');
console.log('**(1) `GraphGuidedRanker` is a hard override, NOT a soft bias.**');
console.log('In `graph-guided-ranker.ts:84`, `rank()` sorts by `(y.bonus - x.bonus)`');
console.log('as primary key, base-ranker order as secondary. Any action with non-zero');
console.log('outgoing-weight sum is ranked above any action with smaller sum,');
console.log('regardless of base ranker score. Comment says "tie-break preserving base');
console.log('semantics" but implementation reorders by bonus first.');
console.log('');
console.log('**Consequence**: trained weights don\'t *nudge* the strategic-grammar');
console.log('decisions — they *replace* them for any action with edges in the graph.');
console.log('This is why SCALE is invariant (calibration sweep 25/50/200/500 produced');
console.log('identical 362.81 aggregate) : uniform scaling preserves ordering, primary');
console.log('sort unchanged.');
console.log('');
console.log('**(2) Card-level aggregation collapses effect signal.** `graphBonus(action)` =');
console.log('sum of ALL outgoing edges from `action.cardId`, regardless of which effect');
console.log('the action invokes. So the surfaced edges below should be read as');
console.log('"ES learned that THIS PAIR of cards is good/bad", not "this exact');
console.log('effect-to-effect transition".');
console.log('');
console.log('**Reinterpretation of top edges below**:');
console.log('- Positive in-deck edge = "when both cards are in deck, the from-card');
console.log('  earned a positive net outgoing-weight sum, so it gets ranked higher');
console.log('  than other cards in the same prompt"');
console.log('- Negative = "from-card got a net-negative sum, so it gets ranked LOWER"');
console.log('- Magnitude is comparable WITHIN an archetype but not across (mean |w|');
console.log('  varies 3-4× across files).');
console.log('');
console.log('---');
console.log('');

for (const a of archetypes) {
  const w = weightsByArch[a];
  const deckSet = deckCardsByArch[a];

  // Stats
  const all = Object.values(w).filter(v => v !== 0);
  const meanAbs = all.reduce((a, b) => a + Math.abs(b), 0) / all.length;
  const maxAbs = Math.max(...all.map(v => Math.abs(v)));

  // Count in-deck edges (both from and to in deck)
  const inDeckActive = Object.entries(w).filter(([id, v]) => {
    if (v === 0) return false;
    const e = edgeById.get(id);
    return e && deckSet.has(e.from.cardId) && deckSet.has(e.to.cardId);
  }).length;

  console.log(`## ${a}`);
  console.log('');
  console.log(`Training fixture: \`${FIXTURE_BY_ARCH[a]}\`.  Deck size: ${deckSet.size} unique cardIds.`);
  console.log(`Active edges: ${all.length} (267 tier-A, 659 zero non-tier).  In-deck edges: **${inDeckActive}** ✓`);
  console.log(`Mean |w| = ${meanAbs.toFixed(3)}.  Max |w| = ${maxAbs.toFixed(3)}.`);
  console.log('');
  console.log(`> ⚠ ${all.length - inDeckActive} of ${all.length} active edges are on cards NOT in this fixture's deck.`);
  console.log(`> Their weights drifted during training without learning signal — treat as initialisation noise.`);
  console.log(`> Tables below filter to **in-deck edges only** (the meaningful subset).`);
  console.log('');

  // In-deck filtered top edges
  const topInDeck = topNInDeck(w, 30, deckSet);
  const topPosID = topInDeck.filter(e => e.w > 0).slice(0, 10);
  const topNegID = topInDeck.filter(e => e.w < 0).slice(0, 10);

  console.log(`### Top 10 positive in-deck (ES learned : prefer these transitions)`);
  console.log('');
  console.log('| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \\| to-cov |');
  console.log('|---|--------|--------------------------------------|--------|-------------------|');
  topPosID.forEach((e, i) => console.log(fmtEdgeRow(i + 1, e, deckSet)));
  console.log('');
  console.log(`### Top 10 negative in-deck (ES learned : avoid these transitions)`);
  console.log('');
  console.log('| # | weight | edge (cardId.effect → cardId.effect) | reason | from-cov \\| to-cov |');
  console.log('|---|--------|--------------------------------------|--------|-------------------|');
  topNegID.forEach((e, i) => console.log(fmtEdgeRow(i + 1, e, deckSet)));
  console.log('');
}

// -------- Cross-archetype consensus (in-deck only) --------
console.log('## Cross-Archetype Consensus (in-deck edges only)');
console.log('');
console.log('Edges in the top-15 of **at least 2** archetype-trained weight files,');
console.log('AND in-deck (both endpoints) for the relevant training fixtures.');
console.log('');

const topSets = {};
for (const a of archetypes) {
  const set = new Set(topNInDeck(weightsByArch[a], TOP_N, deckCardsByArch[a]).map(e => e.id));
  topSets[a] = set;
}
const allTopIds = new Set();
for (const a of archetypes) for (const id of topSets[a]) allTopIds.add(id);

const consensus = [];
for (const id of allTopIds) {
  const present = archetypes.filter(a => topSets[a].has(id));
  if (present.length >= 2) {
    const wByArch = {};
    for (const a of archetypes) wByArch[a] = weightsByArch[a][id] ?? 0;
    consensus.push({ id, present, w: wByArch });
  }
}
consensus.sort((a, b) => b.present.length - a.present.length || Math.abs(b.w[b.present[0]]) - Math.abs(a.w[a.present[0]]));

if (consensus.length === 0) {
  console.log('*No edges in the top-15 of multiple archetypes.* Each weight file emphasises different transitions — supports F11 conclusion that learning is archetype-specific (different optima) rather than discovering a universal action-ordering.');
  console.log('');
} else {
  console.log('| edge | branded w | ryzeal-mits w | snake-eye w | shared with |');
  console.log('|------|-----------|---------------|-------------|-------------|');
  for (const c of consensus) {
    const e = edgeById.get(c.id);
    const tag = e ? `${e.from.cardId}.${e.from.effectId}→${e.to.cardId}.${e.to.effectId} *(${e.from.name} → ${e.to.name})*` : c.id;
    console.log(`| ${tag} | ${c.w.branded.toFixed(2)} | ${c.w['ryzeal-mitsurugi'].toFixed(2)} | ${c.w['snake-eye'].toFixed(2)} | ${c.present.join(', ')} |`);
  }
  console.log('');
}

// -------- Action items --------
console.log('## Concrete Suggestions for Grammar-Authoring');
console.log('');
console.log('Most actionable insights surfaced by the in-deck mining :');
console.log('');
console.log('### Branded — top-2 patterns');
console.log('1. **Pan→Lukias is BAD (-4.45)** but **Ketu→Lukias is GOOD (+3.26)**. Both involve summoning Lukias from different ED materials. ES learned Ketu is the preferred path, Pan is not. Currently `branded.json` has neither in a bridge — adding a goal/bridge that codifies "if Lukias goal active, prefer Ketu material" could capture this.');
console.log('2. **Albion→Branded Albion is BAD (-4.05)** despite `branded-albion-milled` being an existing GOAL target. ES learned this transition leads to worse outcomes than e.g. Albion→Lubellion (+1.53). Suggests `branded-albion-milled` may be an attractor goal that traps DFS in a suboptimal line. Worth reviewing whether the goal\'s baselineScore is too high.');
console.log('');
console.log('### Snake-eye — top-2 patterns');
console.log('1. **Acroquey→Cooky is BAD (-1.14)** between two roleMap cards. Suggests Acroquey\'s e2 path to Cooky is sub-optimal versus other paths to Cooky (e.g., Lollipo→Cooky +0.98). Could codify in a bridge that prefers Lollipo-driven Cooky summons.');
console.log('2. **Flamberge→Poplar (e3 → e3) is STRONG +2.03** — already covered by `snake-eye-flamberge-gy-dual-ss-bridge`. Sanity confirmed : the bridge encodes a correct preference.');
console.log('');
console.log('### Ryzeal-mits — top-2 patterns');
console.log('1. **Mitsurugi Great Purification → Aramasa is GOOD (+0.65)**, multiple effect variants positive. Already in goals. Confirmed correct.');
console.log('2. **Futsu→Kusanagi/Aramasa transitions are NEGATIVE (-0.55 to -0.76)** despite being in `mitsurugi-futsu-canonical` goal. ES learned these specific paths are suboptimal — possibly because the Futsu->Aramasa→Kusanagi sequence over-commits. Goal review candidate.');
console.log('');
console.log('## Cross-Archetype Reading');
console.log('');
console.log('No edge is in the top-15 of ≥2 archetypes. Each archetype trained against');
console.log('a fundamentally different decision landscape. F8 was thus partially right :');
console.log('archetype-specific specialisation IS happening — just at the level of');
console.log('which-edges-matter rather than transferable cross-pollination.');
console.log('');
console.log('## Limitations');
console.log('');
console.log('- **Architectural caveat (see F12)** : top-positive edges aren\'t guarantees the bonus made the strategic grammar layer happy — they just won the bonus-primary sort. A higher-priority `RouteAwareRanker` route may have been ignored.');
console.log('- **Card-level only** : effect-level patterns (e.g., Albion e3 vs e1, Cooky e2 vs e3) aren\'t distinguishable in the trained weights despite the underlying graph capturing them.');
console.log('- **Plateau gen 2** : surfaced edges are what early ES gradients pointed to — not necessarily a global optimum. More generations might produce different weights, but plateau (F1) suggests not transformatively different.');
console.log('- **Reason field is monotone** : every top edge has reason "summon-then-trigger". The graph extraction doesn\'t differentiate between e.g., search-then-trigger, GY-recover, banish-and-revive. Richer reason categories in `enumerate-edges.ts` would surface more diverse insights.');
