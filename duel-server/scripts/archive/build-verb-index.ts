// Build verb-index.json — pre-computed YGO-verb tagging for the Phase B
// graph-ml-v2 ranker MVP v3 features.
//
// Reads:  _bmad-output/solver-data/card-effects-catalog/*.json
// Writes: duel-server/data/derived/verb-index.json
//
// Output schema (v1):
//   {
//     schemaVersion: 1,
//     builtAt: ISO date,
//     catalogParserVersion: "v7-gate-strip",
//     cards: {
//       <cardId>: {
//         verbs:    string[],   // YGO verbs detected in any effect.operation
//         costs:    string[],   // verbs detected in any effect.cost
//         noCost:   boolean,    // true if every effect has empty/missing cost
//         summonProcedureKinds: string[],  // ['Xyz', 'Fusion', ...] from summonProcedures
//       }
//     },
//     stats: { ... aggregate counts ... }
//   }
//
// Verbs (YGO vocabulary, not OCGCore engine vocabulary):
//   add-from-deck         operation has send-to-hand AND LOCATION_DECK detected
//   add-from-gy           send-to-hand AND LOCATION_GRAVE
//   return-to-hand        send-to-hand AND LOCATION_ONFIELD/_MZONE/_SZONE
//   add-to-hand-other     send-to-hand with no clear source signal
//   special-summon        operation has special-summon
//   discard-effect        operation has discard (not in cost)
//   mill-self-deck        operation has send-to-grave AND LOCATION_DECK
//   send-to-grave-other   send-to-grave without deck-range signal (mostly destroy/cost)
//   destroy               operation has destroy
//   banish                operation has banish
//   draw                  operation has draw
//
// Costs:
//   discard               cost has discard
//   tribute               cost has tribute or release (synonyms in OCGCore)
//   banish-self           cost has banish with target='c' (the source card itself)
//   send-to-gy-cost       cost has send-to-grave (sacrifice without banish)
//
// Source-range detection is heuristic: the parser's `simpleFilter` is
// incomplete for ~25% of conditions/targets (audit Q4, 2026-04-26). We fall
// back to LOCATION_* token co-occurrence inside the same effect's JSON blob
// when the simpleFilter doesn't carry an explicit `location` predicate.
// This is lossy but bounded: the audit measured 9/25 send-to-grave cards
// co-occurring with LOCATION_DECK — i.e., the heuristic does not over-fire
// catastrophically.
//
// Usage: npx tsx scripts/build-verb-index.ts
//        (no flags; reads full catalog, writes data/derived/verb-index.json)

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Schema (subset of catalog, only what we need)
// =============================================================================

interface FilterPredicate {
  kind: string;
  value?: unknown;
  args?: readonly unknown[];
}
interface SimpleFilter {
  predicates: readonly FilterPredicate[];
  complete: boolean;
}
interface FunctionRef {
  name?: string;
  opaque?: boolean;
  simpleFilter?: SimpleFilter;
  actions?: readonly OperationAction[];
}
interface OperationAction {
  kind: string;
  method?: string;
  target?: string;
  argHints?: readonly string[];
}
interface Effect {
  id: string;
  categories?: readonly string[];
  range?: string;
  condition?: FunctionRef;
  cost?: FunctionRef;
  target?: FunctionRef;
  operation?: FunctionRef;
}
interface SummonProcedure {
  kind: 'Synchro' | 'Fusion' | 'Xyz' | 'Link' | 'Pendulum' | 'Ritual';
}
interface Catalog {
  cardId: number;
  name: string;
  parserVersion?: string;
  summonProcedures?: readonly SummonProcedure[];
  effects: readonly Effect[];
}

// =============================================================================
// Verb vocabulary
// =============================================================================

const ALL_VERBS = [
  'add-from-deck',
  'add-from-gy',
  'return-to-hand',
  'add-to-hand-other',
  'special-summon',
  'discard-effect',
  'mill-self-deck',
  'send-to-grave-other',
  'destroy',
  'banish',
  'draw',
] as const;

const ALL_COSTS = [
  'discard',
  'tribute',
  'banish-self',
  'send-to-gy-cost',
] as const;

type Verb = typeof ALL_VERBS[number];
type Cost = typeof ALL_COSTS[number];

// =============================================================================
// Heuristic helpers
// =============================================================================

const DECK_TOKENS = ['LOCATION_DECK'];
const GY_TOKENS = ['LOCATION_GRAVE'];
const FIELD_TOKENS = ['LOCATION_ONFIELD', 'LOCATION_MZONE', 'LOCATION_SZONE'];

function effectBlob(eff: Effect): string {
  // Stringify the effect once; keyword search runs against this blob.
  return JSON.stringify(eff);
}

function blobHas(blob: string, tokens: readonly string[]): boolean {
  for (const t of tokens) {
    if (blob.includes(t)) return true;
  }
  return false;
}

function classifySendToHand(eff: Effect, blob: string): Verb {
  // Priority: deck > gy > field > other. Most YGO tutors are deck → hand.
  if (blobHas(blob, DECK_TOKENS)) return 'add-from-deck';
  if (blobHas(blob, GY_TOKENS)) return 'add-from-gy';
  if (blobHas(blob, FIELD_TOKENS)) return 'return-to-hand';
  return 'add-to-hand-other';
}

function classifySendToGrave(eff: Effect, blob: string): Verb {
  // If LOCATION_DECK present, treat as mill (deck → GY). Otherwise, generic.
  if (blobHas(blob, DECK_TOKENS)) return 'mill-self-deck';
  return 'send-to-grave-other';
}

// =============================================================================
// Per-card extraction
// =============================================================================

interface CardEntry {
  verbs: Verb[];
  costs: Cost[];
  noCost: boolean;
  summonProcedureKinds: string[];
}

function extractCard(catalog: Catalog): CardEntry {
  const verbs = new Set<Verb>();
  const costs = new Set<Cost>();
  let anyCostNonEmpty = false;
  let anyEffectHasCost = false;

  for (const eff of catalog.effects ?? []) {
    const blob = effectBlob(eff);

    // ---- operation actions → verbs ----
    const opActions = eff.operation?.actions ?? [];
    for (const a of opActions) {
      switch (a.kind) {
        case 'send-to-hand':
          verbs.add(classifySendToHand(eff, blob));
          break;
        case 'send-to-grave':
          verbs.add(classifySendToGrave(eff, blob));
          break;
        case 'special-summon':
          verbs.add('special-summon');
          break;
        case 'discard':
        case 'discard-hand':
          // discard appearing in operation = effect-discard (not cost)
          verbs.add('discard-effect');
          break;
        case 'destroy':
          verbs.add('destroy');
          break;
        case 'banish':
          verbs.add('banish');
          break;
        case 'draw':
          verbs.add('draw');
          break;
        // Other action kinds (hint, declare-operation, register-effect, etc.)
        // are not surfaced as verbs — they're meta or filter-only operations.
      }
    }

    // ---- cost actions → costs ----
    // The v7 catalog encodes costs in two ways:
    //  (a) inline action list (e.g., kind === 'discard-hand', 'tribute',
    //      'send-to-grave') — when the parser fully unrolled the cost body.
    //  (b) helper reference via `cost.name` (e.g., 's.discost', 's.cost',
    //      's.effcost', 's.spcost') — when the cost was a helper call the
    //      parser did not unroll.
    // Approach: treat both as cost evidence; map helper-name patterns to
    // approximate cost categories; helpers without a clear pattern fall
    // back to "anyCostNonEmpty=true" without a specific cost tag (so F10
    // `noCost` is correct, but specific cost features stay 0).
    if (eff.cost !== undefined) anyEffectHasCost = true;
    const costActions = eff.cost?.actions ?? [];
    for (const a of costActions) {
      switch (a.kind) {
        case 'discard':
        case 'discard-hand':
          costs.add('discard');
          anyCostNonEmpty = true;
          break;
        case 'tribute':
        case 'release':
          costs.add('tribute');
          anyCostNonEmpty = true;
          break;
        case 'banish':
          // banish-as-cost; target='c' is self-banish (most common modern
          // engine pattern). Other targets are rare here.
          costs.add('banish-self');
          anyCostNonEmpty = true;
          break;
        case 'send-to-grave':
          costs.add('send-to-gy-cost');
          anyCostNonEmpty = true;
          break;
      }
    }
    // Helper-name pattern recognition runs INDEPENDENTLY of action-kind
    // detection: the helper name often carries semantic intent (e.g.,
    // `s.discost` = "discard cost") that may not align with the literal
    // unrolled action kind (e.g., `tribute` for a helper that wraps both).
    // When inline actions and helper name disagree, both signals are
    // surfaced (a card can carry multiple cost tags).
    const costName = eff.cost?.name ?? '';
    if (costName) {
      const lc = costName.toLowerCase();
      // Heuristics: 'discost' = discard cost; 'rmcost' = remove (banish) cost;
      // 'gyspcost' = GY-self-banish-then-SS; 'selfspcost' = self-banish-SS.
      // Generic '.cost' / '.effcost' / '.spcost' = unspecified cost
      // (presence-only signal — flips noCost without specific tag).
      if (lc.includes('discost')) {
        costs.add('discard');
        anyCostNonEmpty = true;
      }
      if (lc.includes('rmcost')) {
        costs.add('banish-self');
        anyCostNonEmpty = true;
      }
      if (lc.includes('selfspcost') || lc.includes('gyspcost')) {
        // Self-SS cost or GY-SS cost — typical pattern: banish self from
        // GY to SS something else.
        costs.add('banish-self');
        anyCostNonEmpty = true;
      }
      if (lc.includes('cost')) {
        // Generic helper — we know there's a cost (flips noCost), specific
        // tag may already have been added above.
        anyCostNonEmpty = true;
      }
    }
  }

  // noCost = true if either no effect declared a cost OR all declared costs
  // were empty/meta. This is the boolean for the F10 `act_no_cost` feature.
  const noCost = !anyCostNonEmpty;

  return {
    verbs: ALL_VERBS.filter(v => verbs.has(v)),
    costs: ALL_COSTS.filter(c => costs.has(c)),
    noCost,
    summonProcedureKinds: Array.from(
      new Set((catalog.summonProcedures ?? []).map(sp => sp.kind))
    ),
  };
}

// =============================================================================
// Aggregate stats
// =============================================================================

interface Stats {
  cardsTotal: number;
  cardsWithVerb: Record<Verb, number>;
  cardsWithCost: Record<Cost, number>;
  cardsNoCost: number;
  cardsWithSummonProcedure: Record<string, number>;
}

function buildStats(entries: Record<string, CardEntry>): Stats {
  const verbCounts = Object.fromEntries(
    ALL_VERBS.map(v => [v, 0])
  ) as Record<Verb, number>;
  const costCounts = Object.fromEntries(
    ALL_COSTS.map(c => [c, 0])
  ) as Record<Cost, number>;
  const procCounts: Record<string, number> = {};
  let noCostCount = 0;
  let total = 0;

  for (const cid of Object.keys(entries)) {
    const e = entries[cid];
    total++;
    for (const v of e.verbs) verbCounts[v]++;
    for (const c of e.costs) costCounts[c]++;
    if (e.noCost) noCostCount++;
    for (const k of e.summonProcedureKinds) {
      procCounts[k] = (procCounts[k] ?? 0) + 1;
    }
  }

  return {
    cardsTotal: total,
    cardsWithVerb: verbCounts,
    cardsWithCost: costCounts,
    cardsNoCost: noCostCount,
    cardsWithSummonProcedure: procCounts,
  };
}

// =============================================================================
// Main
// =============================================================================

function main(): void {
  const catalogDir = join(__dirname, '..', '..', '_bmad-output', 'solver-data', 'card-effects-catalog');
  const outPath = join(__dirname, '..', 'data', 'derived', 'verb-index.json');

  const files = readdirSync(catalogDir).filter(f => f.endsWith('.json'));
  const cards: Record<string, CardEntry> = {};
  let parserVersionSeen: string | undefined;

  for (const f of files) {
    const blob = readFileSync(join(catalogDir, f), 'utf-8');
    const catalog = JSON.parse(blob) as Catalog;
    if (!parserVersionSeen) parserVersionSeen = catalog.parserVersion;
    cards[String(catalog.cardId)] = extractCard(catalog);
  }

  const stats = buildStats(cards);

  const out = {
    schemaVersion: 1,
    builtAt: new Date().toISOString().slice(0, 10),
    catalogParserVersion: parserVersionSeen ?? 'unknown',
    catalogDir: 'card-effects-catalog/',
    cards,
    stats,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  // Console report
  console.log(`verb-index built from ${files.length} catalog files → ${outPath}`);
  console.log();
  console.log('=== Verb coverage (cards with at least one effect carrying the verb) ===');
  for (const v of ALL_VERBS) {
    console.log(`  ${v.padEnd(22)} ${stats.cardsWithVerb[v]}`);
  }
  console.log();
  console.log('=== Cost coverage ===');
  for (const c of ALL_COSTS) {
    console.log(`  ${c.padEnd(22)} ${stats.cardsWithCost[c]}`);
  }
  console.log(`  ${'(no-cost card)'.padEnd(22)} ${stats.cardsNoCost}`);
  console.log();
  console.log('=== Summon-procedure coverage ===');
  for (const [k, n] of Object.entries(stats.cardsWithSummonProcedure).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${n}`);
  }
}

main();
