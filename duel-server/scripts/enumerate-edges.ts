// Mechanical edge enumeration over card-effects catalog JSONs.
//
// Given the extracted catalog for a list of cards, pair-level search:
//   for each effect EA that produces a game-state change,
//   find every effect EB whose trigger matches that change.
// Output: list of edges (EA → EB) with match reason.
//
// Current match patterns (v1):
//   1. Search-then-trigger: EA adds to hand (CATEGORY_TOHAND) → EB triggers on EVENT_TO_HAND
//      and EB's card matches EA's target filter (simpleFilter intersection with cards.cdb row).
//   2. Summon-then-trigger: EA Special Summons / NS / SS / Fusion / Synchro / Xyz / Link →
//      EB triggers on EVENT_SUMMON_SUCCESS / EVENT_SPSUMMON_SUCCESS.
//   3. GY-send-then-trigger: EA sends cards to GY (CATEGORY_TO_GRAVE) → EB triggers on EVENT_TO_GRAVE.
//   4. Fusion-material-then-trigger: EA Fusion Summons (CATEGORY_FUSION_SUMMON) → EB triggers on
//      EVENT_BE_MATERIAL.
//
// Usage: npx tsx scripts/enumerate-edges.ts [cardId1 cardId2 ...]
//   If cardIds omitted, reads every JSON under _bmad-output/solver-data/card-effects-catalog/.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// =============================================================================
// Schema (re-declared; could later import from a shared module)
// =============================================================================

interface FilterPredicate {
  kind: string;
  value?: unknown;
  inner?: FilterPredicate;
  source?: string;
}

interface SimpleFilter {
  predicates: readonly FilterPredicate[];
  complete: boolean;
}

interface FunctionRef {
  name?: string;
  inline?: string;
  simpleFilter?: SimpleFilter;
  opaque: boolean;
}

interface Effect {
  id: string;
  categories: readonly string[];
  types: readonly string[];
  properties: readonly string[];
  events: readonly string[];
  range?: string;
  countLimit?: { count: number; key: string };
  descriptionStringId?: string;
  condition?: FunctionRef;
  cost?: FunctionRef;
  target?: FunctionRef;
  operation?: FunctionRef;
  value?: FunctionRef | { literal: string };
  clonedFrom?: string;
  clonedTo?: readonly string[];
}

interface Catalog {
  cardId: number;
  name: string;
  effects: readonly Effect[];
}

interface CardProperties {
  cardId: number;
  name: string;
  type: number;
  level: number;        // masked to 8 bits (excludes pendulum scales)
  attribute: number;
  race: number;
  setcodes: readonly number[];
}

// =============================================================================
// Load catalogs + card properties
// =============================================================================

const catalogDir = join('..', '_bmad-output', 'solver-data', 'card-effects-catalog');
const cardDb = new Database(join('data', 'cards.cdb'), { readonly: true });
const cardStmt = cardDb.prepare('SELECT t.id, t.name, d.type, d.level, d.attribute, d.race, d.setcode FROM texts t LEFT JOIN datas d ON d.id = t.id WHERE t.id = ?');

function loadCardProperties(cardId: number): CardProperties | undefined {
  const row = cardStmt.get(cardId) as { id: number; name: string; type: number; level: number; attribute: number; race: number; setcode: number | bigint } | undefined;
  if (!row) return undefined;
  return {
    cardId: row.id,
    name: row.name,
    type: row.type ?? 0,
    level: (row.level ?? 0) & 0xff,
    attribute: row.attribute ?? 0,
    race: row.race ?? 0,
    setcodes: unpackSetcodes(row.setcode),
  };
}

function unpackSetcodes(v: number | bigint | null | undefined): number[] {
  let big = typeof v === 'bigint' ? v : BigInt(v ?? 0);
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const code = Number(big & 0xFFFFn);
    if (code !== 0) out.push(code);
    big >>= 16n;
  }
  return out;
}

// =============================================================================
// Predicate evaluation
// =============================================================================

const ATTR_HEX: Readonly<Record<string, number>> = {
  ATTRIBUTE_EARTH: 0x1, ATTRIBUTE_WATER: 0x2, ATTRIBUTE_FIRE: 0x4,
  ATTRIBUTE_WIND: 0x8, ATTRIBUTE_LIGHT: 0x10, ATTRIBUTE_DARK: 0x20,
  ATTRIBUTE_DIVINE: 0x40,
};
const RACE_HEX: Readonly<Record<string, number>> = {
  RACE_WARRIOR: 0x1, RACE_SPELLCASTER: 0x2, RACE_FAIRY: 0x4, RACE_FIEND: 0x8,
  RACE_ZOMBIE: 0x10, RACE_MACHINE: 0x20, RACE_AQUA: 0x40, RACE_PYRO: 0x80,
  RACE_ROCK: 0x100, RACE_WINGEDBEAST: 0x200, RACE_PLANT: 0x400, RACE_INSECT: 0x800,
  RACE_THUNDER: 0x1000, RACE_DRAGON: 0x2000, RACE_BEAST: 0x4000, RACE_BEASTWARRIOR: 0x8000,
  RACE_DINOSAUR: 0x10000, RACE_FISH: 0x20000, RACE_SEASERPENT: 0x40000, RACE_REPTILE: 0x80000,
  RACE_PSYCHIC: 0x100000, RACE_DIVINE: 0x200000, RACE_CREATORGOD: 0x400000, RACE_WYRM: 0x800000,
  RACE_CYBERSE: 0x1000000, RACE_ILLUSION: 0x2000000,
};
// Setcode constants resolved from archetype_setcode_constants.lua (re-used via inline parse).
const SET_HEX = loadSetcodeMap();

function loadSetcodeMap(): Readonly<Record<string, number>> {
  const path = join('data', 'scripts_full', 'archetype_setcode_constants.lua');
  const text = readFileSync(path, 'utf-8');
  const out: Record<string, number> = {};
  for (const m of text.matchAll(/^\s*SET_([A-Z0-9_]+)\s*=\s*0x([0-9a-fA-F]+)/gm)) {
    out[`SET_${m[1]}`] = parseInt(m[2], 16);
  }
  return out;
}

/** Evaluate a predicate against a candidate card's properties. Returns true, false, or 'unknown'. */
function evalPredicate(pred: FilterPredicate, card: CardProperties, sourceCardId: number): boolean | 'unknown' {
  switch (pred.kind) {
    case 'attribute':
      return ATTR_HEX[pred.value as string] === card.attribute;
    case 'race':
      return RACE_HEX[pred.value as string] === card.race;
    case 'level':
      return card.level === (pred.value as number);
    case 'levelAbove':
      return card.level >= (pred.value as number);
    case 'levelBelow':
      return card.level <= (pred.value as number);
    case 'code': {
      const v = pred.value;
      if (v === 'self') return card.cardId === sourceCardId;
      return card.cardId === (v as number);
    }
    case 'setCard': {
      const hex = SET_HEX[pred.value as string];
      if (hex === undefined) return 'unknown';
      // Setcode match: card's setcode list contains a hex where lower 12 bits match hex's lower 12 bits
      // OR hex equals exactly one of the card's setcodes. Simplified: exact match suffices for v1.
      return card.setcodes.includes(hex);
    }
    case 'monster':
      return (card.type & 0x1) !== 0;
    case 'spellTrap':
      return (card.type & 0x2) !== 0 || (card.type & 0x4) !== 0;
    case 'type':
      // TYPE_FUSION=0x40, TYPE_SYNCHRO=0x2000, TYPE_XYZ=0x800000, TYPE_LINK=0x4000000, etc.
      // For v1 resolve only the common ones.
      const typeMap: Record<string, number> = {
        TYPE_MONSTER: 0x1, TYPE_SPELL: 0x2, TYPE_TRAP: 0x4,
        TYPE_FUSION: 0x40, TYPE_RITUAL: 0x80, TYPE_TUNER: 0x1000,
        TYPE_SYNCHRO: 0x2000, TYPE_XYZ: 0x800000, TYPE_LINK: 0x4000000,
      };
      const mask = typeMap[pred.value as string];
      return mask !== undefined ? (card.type & mask) !== 0 : 'unknown';
    case 'not': {
      const inner = evalPredicate(pred.inner!, card, sourceCardId);
      return inner === 'unknown' ? 'unknown' : !inner;
    }
    // State-dependent predicates — assume true for static edge discovery. These
    // can still filter at runtime but do not gate edge identification.
    case 'faceup':
    case 'facedown':
    case 'ableToHand':
    case 'ableToGrave':
    case 'ableToGraveAsCost':
    case 'ableToDeck':
    case 'canBeSpecialSummoned':
    case 'canBeEffectTarget':
    case 'discardable':
    case 'ssetable':
    case 'setable':
    case 'relateToEffect':
    case 'location':
      return true;
    // Type-shape predicates on extra-deck monsters — check against card.type bits.
    case 'linkMonster':
      return (card.type & 0x4000000) !== 0;
    case 'xyzMonster':
      return (card.type & 0x800000) !== 0;
    case 'fusionMonster':
      return (card.type & 0x40) !== 0;
    case 'synchroMonster':
      return (card.type & 0x2000) !== 0;
    case 'link':
      // For Link monsters, `datas.level` stores the rating. Non-Link monsters fail.
      if ((card.type & 0x4000000) === 0) return false;
      return card.level === (pred.value as number);
    case 'raw':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Does `card` satisfy `filter`? Missing any `false` predicate fails; all-true or all-unknown-or-true passes as optimistic match. */
function cardMatchesFilter(
  filter: SimpleFilter,
  card: CardProperties,
  sourceCardId: number,
): { match: boolean; confidence: 'high' | 'medium' | 'low' } {
  let unknownCount = 0;
  for (const pred of filter.predicates) {
    const r = evalPredicate(pred, card, sourceCardId);
    if (r === false) return { match: false, confidence: 'high' };
    if (r === 'unknown') unknownCount++;
  }
  if (unknownCount === 0) return { match: true, confidence: 'high' };
  if (unknownCount < filter.predicates.length) return { match: true, confidence: 'medium' };
  return { match: true, confidence: 'low' };
}

// =============================================================================
// Edge enumeration
// =============================================================================

interface Edge {
  from: { cardId: number; name: string; effectId: string };
  to: { cardId: number; name: string; effectId: string };
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string[];
}

const SUMMON_EVENTS = new Set(['EVENT_SUMMON_SUCCESS', 'EVENT_SPSUMMON_SUCCESS']);
const HAND_EVENTS = new Set(['EVENT_TO_HAND']);
const GRAVE_EVENTS = new Set(['EVENT_TO_GRAVE']);
const MATERIAL_EVENTS = new Set(['EVENT_BE_MATERIAL']);
const DESTROYED_EVENTS = new Set(['EVENT_DESTROYED']);
const REMOVED_EVENTS = new Set(['EVENT_REMOVE']);
const LEAVE_FIELD_EVENTS = new Set(['EVENT_LEAVE_FIELD', 'EVENT_LEAVE_FIELD_P']);
const BATTLE_EVENTS = new Set(['EVENT_BATTLED', 'EVENT_DAMAGE_STEP_END']);

function produces(effect: Effect, kind: 'tohand' | 'summon' | 'tograve' | 'fusion-material' | 'destroy' | 'banish' | 'leave-field'): boolean {
  const cats = new Set(effect.categories);
  switch (kind) {
    case 'tohand':          return cats.has('CATEGORY_TOHAND') || cats.has('CATEGORY_SEARCH');
    case 'summon':          return cats.has('CATEGORY_SPECIAL_SUMMON');
    case 'tograve':         return cats.has('CATEGORY_TO_GRAVE') || cats.has('CATEGORY_LEAVE_GRAVE');
    case 'fusion-material': return cats.has('CATEGORY_FUSION_SUMMON');
    case 'destroy':         return cats.has('CATEGORY_DESTROY');
    case 'banish':          return cats.has('CATEGORY_REMOVE');
    case 'leave-field':     return cats.has('CATEGORY_LEAVE_FIELD') || cats.has('CATEGORY_DESTROY') || cats.has('CATEGORY_REMOVE') || cats.has('CATEGORY_TO_GRAVE');
  }
}

function triggersOn(effect: Effect, events: ReadonlySet<string>): boolean {
  return effect.events.some(ev => events.has(ev));
}

function enumerateEdges(catalogs: readonly Catalog[]): Edge[] {
  // Load properties for every card referenced.
  const propsByCard = new Map<number, CardProperties>();
  for (const c of catalogs) {
    const p = loadCardProperties(c.cardId);
    if (p) propsByCard.set(c.cardId, p);
  }

  const edges: Edge[] = [];

  for (const fromCat of catalogs) {
    for (const fromEff of fromCat.effects) {
      // Pattern 1: search-then-trigger (EA adds to hand)
      if (produces(fromEff, 'tohand') && fromEff.target?.simpleFilter) {
        for (const toCat of catalogs) {
          if (toCat.cardId === fromCat.cardId) continue;
          const toProps = propsByCard.get(toCat.cardId);
          if (!toProps) continue;
          const matched = cardMatchesFilter(fromEff.target.simpleFilter, toProps, fromCat.cardId);
          if (!matched.match) continue;
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, HAND_EVENTS)) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'search-then-trigger (add-to-hand → EVENT_TO_HAND, filter match)',
              confidence: matched.confidence,
              notes: toEff.condition?.inline?.includes('REASON_DRAW') ? ['target triggers only if NOT drawn — reason passed via add-from-deck qualifies'] : undefined,
            });
          }
        }
      }
      // Pattern 2: summon-then-trigger (EA summons a card)
      if (produces(fromEff, 'summon')) {
        for (const toCat of catalogs) {
          // Self-trigger allowed (e.g., a card's own SS triggers its own on-SS effect)
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, SUMMON_EVENTS)) continue;
            // Skip unless `toEff` is self-trigger (EFFECT_TYPE_SINGLE) — indicates card's own trigger
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            // Check filter on the SS'd card if available
            if (fromEff.target?.simpleFilter) {
              const toProps = propsByCard.get(toCat.cardId);
              if (!toProps) continue;
              const matched = cardMatchesFilter(fromEff.target.simpleFilter, toProps, fromCat.cardId);
              if (!matched.match) continue;
              edges.push({
                from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
                to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
                reason: 'summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match)',
                confidence: matched.confidence,
              });
            }
          }
        }
      }
      // Pattern 3: GY-send-then-trigger
      if (produces(fromEff, 'tograve')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, GRAVE_EVENTS)) continue;
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            // Can't always filter-match (GY-send target often unspecified). Report low confidence.
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'gy-send-then-trigger (→ EVENT_TO_GRAVE)',
              confidence: 'low',
              notes: ['filter not verified — GY-send target may not match; check manually'],
            });
          }
        }
      }
      // Pattern 4: Fusion-material-then-trigger
      if (produces(fromEff, 'fusion-material')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, MATERIAL_EVENTS)) continue;
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'fusion-material-then-trigger (→ EVENT_BE_MATERIAL)',
              confidence: 'low',
              notes: ['Fusion may not consume this card — depends on material selection'],
            });
          }
        }
      }
      // Pattern 5: destroy-then-trigger
      if (produces(fromEff, 'destroy')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, DESTROYED_EVENTS)) continue;
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'destroy-then-trigger (→ EVENT_DESTROYED)',
              confidence: 'low',
              notes: ['Destroy target may not be this card — depends on target selection'],
            });
          }
        }
      }
      // Pattern 6: banish-then-trigger
      if (produces(fromEff, 'banish')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, REMOVED_EVENTS)) continue;
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'banish-then-trigger (→ EVENT_REMOVE)',
              confidence: 'low',
              notes: ['Banish target may not be this card — depends on target selection'],
            });
          }
        }
      }
      // Pattern 7: leave-field-then-trigger (card leaves Monster Zone for any reason)
      if (produces(fromEff, 'leave-field')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, LEAVE_FIELD_EVENTS)) continue;
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'leave-field-then-trigger (→ EVENT_LEAVE_FIELD)',
              confidence: 'low',
              notes: ['Target may not be this card'],
            });
          }
        }
      }
      // Pattern 8: battle-then-trigger
      if (fromEff.categories.includes('CATEGORY_ATK_CHANGE') || fromEff.categories.includes('CATEGORY_DAMAGE')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, BATTLE_EVENTS)) continue;
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'battle-then-trigger (→ EVENT_BATTLED)',
              confidence: 'low',
            });
          }
        }
      }
    }
  }
  return edges;
}

// =============================================================================
// CLI
// =============================================================================

const argIds = process.argv.slice(2).map(Number).filter(Number.isFinite);

const availableIds = existsSync(catalogDir)
  ? readdirSync(catalogDir).filter(f => f.endsWith('.json')).map(f => Number(f.replace('.json', ''))).filter(Number.isFinite)
  : [];

const targetIds = argIds.length > 0 ? argIds : availableIds;

const catalogs: Catalog[] = [];
for (const id of targetIds) {
  const path = join(catalogDir, `${id}.json`);
  if (!existsSync(path)) {
    console.error(`[warn] no catalog for ${id}`);
    continue;
  }
  catalogs.push(JSON.parse(readFileSync(path, 'utf-8')) as Catalog);
}

console.log(`# Edge enumeration\n`);
console.log(`${catalogs.length} catalogs loaded.\n`);

// Surface summon-procedure clauses that represent material-rewrite or alt-SS rules.
// These are not pair-level edges but are critical for summon planning in discovery.
const specialProcCards: { cardId: number; name: string; clauses: string[] }[] = [];
for (const cat of catalogs) {
  const clauses: string[] = [];
  // 1. Non-trivial Summon.AddProcedure calls (captured as raw text).
  for (const proc of (cat as Catalog & { summonProcedures?: readonly { kind: string; rawCall: string }[] }).summonProcedures ?? []) {
    clauses.push(`${proc.kind} procedure: ${proc.rawCall}`);
  }
  // 2. EFFECT_SYNCHRO_LEVEL, EFFECT_CANNOT_BE_SYNCHRO_MATERIAL, EFFECT_EXTRA_MATERIAL and friends in events.
  for (const eff of cat.effects) {
    for (const ev of eff.events) {
      if (ev === 'EFFECT_SYNCHRO_LEVEL') clauses.push(`${eff.id}: material-rewrite via EFFECT_SYNCHRO_LEVEL (Link-as-Tuner / level-reassign clause)`);
      else if (ev === 'EFFECT_CANNOT_BE_SYNCHRO_MATERIAL') clauses.push(`${eff.id}: EFFECT_CANNOT_BE_SYNCHRO_MATERIAL (restricts material usage)`);
      else if (ev === 'EFFECT_EXTRA_LINK_MATERIAL') clauses.push(`${eff.id}: EFFECT_EXTRA_LINK_MATERIAL (extra Link material)`);
      else if (ev === 'EFFECT_EXTRA_FUSION_MATERIAL') clauses.push(`${eff.id}: EFFECT_EXTRA_FUSION_MATERIAL (extra Fusion material)`);
      else if (ev === 'EFFECT_EXTRA_XYZ_MATERIAL') clauses.push(`${eff.id}: EFFECT_EXTRA_XYZ_MATERIAL (extra Xyz material)`);
      else if (ev === 'EFFECT_SPSUMMON_CONDITION') clauses.push(`${eff.id}: EFFECT_SPSUMMON_CONDITION (alternative SS condition)`);
      else if (ev === 'EFFECT_SPSUMMON_PROC' || ev === 'EFFECT_SPSUMMON_PROC_G') clauses.push(`${eff.id}: ${ev} (custom SS procedure — alt-SS path)`);
    }
  }
  if (clauses.length > 0) specialProcCards.push({ cardId: cat.cardId, name: cat.name, clauses });
}

if (specialProcCards.length > 0) {
  console.log(`\n## Special summon procedures / material-rewrite clauses (${specialProcCards.length} cards)\n`);
  for (const sp of specialProcCards) {
    console.log(`- **${sp.name}** (${sp.cardId})`);
    for (const c of sp.clauses) console.log(`    - ${c}`);
  }
}

const edges = enumerateEdges(catalogs);
const byConfidence: Record<string, Edge[]> = { high: [], medium: [], low: [] };
for (const e of edges) byConfidence[e.confidence].push(e);

for (const conf of ['high', 'medium', 'low'] as const) {
  const bucket = byConfidence[conf];
  if (bucket.length === 0) continue;
  console.log(`\n## ${conf.toUpperCase()} confidence edges (${bucket.length})\n`);
  for (const e of bucket) {
    console.log(`- **${e.from.name} ${e.from.effectId}** → **${e.to.name} ${e.to.effectId}**`);
    console.log(`  Reason: ${e.reason}`);
    if (e.notes) for (const n of e.notes) console.log(`  Note: ${n}`);
  }
}

console.log(`\n---\nTotal edges: ${edges.length} (high: ${byConfidence.high.length}, medium: ${byConfidence.medium.length}, low: ${byConfidence.low.length})`);

cardDb.close();
