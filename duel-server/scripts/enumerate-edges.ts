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
//                                            [--json=<out.json>]
//   If cardIds omitted, reads every JSON under _bmad-output/solver-data/card-effects-catalog/.
//   If --json=<out.json> passed, also writes the edges array as JSON to that
//   path (for programmatic consumption by validate-bridge --candidates).

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
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
  // v8 exhaustive-predicate fields — used by composite / attr-compare kinds.
  predicates?: readonly FilterPredicate[];  // `or` kind: sub-predicates to OR together
  attr?: string;                             // `attrCompare`: which card attribute (level/atk/def/overlayCount/...)
  op?: string;                               // `attrCompare`: comparison operator (==, >, <, >=, <=)
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

interface OperationAction {
  kind: string;
  target?: string;
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
  operation?: FunctionRef & { actions?: readonly OperationAction[] };
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

/** Resolve a `|`-separated mask value (e.g. "RACE_DRAGON|RACE_SPELLCASTER") via
 *  the given hex map. Returns the bitwise-OR of all recognized tokens, or
 *  undefined if any token is unknown. Handles single tokens too. */
function resolveOrMask(value: string, map: Readonly<Record<string, number>>): number | undefined {
  const parts = value.split('|').map(s => s.trim()).filter(s => s.length > 0);
  let combined = 0;
  for (const p of parts) {
    const hex = map[p];
    if (hex === undefined) return undefined;
    combined |= hex;
  }
  return combined;
}

/** Evaluate a predicate against a candidate card's properties. Returns true, false, or 'unknown'. */
function evalPredicate(pred: FilterPredicate, card: CardProperties, sourceCardId: number): boolean | 'unknown' {
  switch (pred.kind) {
    case 'attribute': {
      // Phase 14: handle OR-mask values like "ATTRIBUTE_LIGHT|ATTRIBUTE_DARK".
      const mask = resolveOrMask(pred.value as string, ATTR_HEX);
      if (mask === undefined) return 'unknown';
      return (card.attribute & mask) !== 0;
    }
    case 'race': {
      const mask = resolveOrMask(pred.value as string, RACE_HEX);
      if (mask === undefined) return 'unknown';
      return (card.race & mask) !== 0;
    }
    case 'level':
      return card.level === (pred.value as number);
    case 'levelAbove':
      return card.level >= (pred.value as number);
    case 'levelBelow':
      return card.level <= (pred.value as number);
    case 'code': {
      const v = pred.value;
      if (v === 'self') return card.cardId === sourceCardId;
      // Parser emits `{value: null}` (JSON-serialized NaN) when the IsCode arg
      // is an unresolved constant like `CARD_ALBAZ`. Don't hard-fail on those —
      // return 'unknown' so the outer filter stays optimistic.
      if (v === null || v === undefined || typeof v !== 'number' || Number.isNaN(v)) return 'unknown';
      return card.cardId === v;
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
    // Composite: `or` — true if any sub-predicate true, false only if all false.
    case 'or': {
      let anyTrue = false, anyUnknown = false;
      for (const p of pred.predicates ?? []) {
        const r = evalPredicate(p, card, sourceCardId);
        if (r === true) anyTrue = true;
        else if (r === 'unknown') anyUnknown = true;
      }
      if (anyTrue) return true;
      if (anyUnknown) return 'unknown';
      return false;
    }
    // State-dependent predicates — assume true for static edge discovery. These
    // can still filter at runtime but do not gate edge identification.
    case 'faceup':
    case 'facedown':
    case 'ableToHand':
    case 'ableToGrave':
    case 'ableToGraveAsCost':
    case 'ableToDeck':
    case 'ableToRemove':
    case 'ableToExtra':
    case 'canBeSpecialSummoned':
    case 'canBeEffectTarget':
    case 'canBeXyzMaterial':
    case 'discardable':
    case 'ssetable':
    case 'setable':
    case 'relateToEffect':
    case 'releasableByEffect':
    case 'uniqueOnField':
    case 'attackPos':
    case 'defensePos':
    case 'onField':
    case 'location':
      return true;
    // Banlist state — catalog cards treated as legal. `not forbidden` is the
    // common usage; returning false here makes the negation pass for all cards.
    case 'forbidden':
      return false;
    // Runtime-history predicates — can't be determined statically from cdb.
    // Return unknown so the filter doesn't spuriously exclude valid matches,
    // but confidence downgrades to medium/low.
    case 'fusionSummoned':
    case 'synchroSummoned':
    case 'xyzSummoned':
    case 'linkSummoned':
    case 'negatable':
    case 'negatableSpellTrap':
    case 'disabled':
    case 'controler':
    case 'previousControler':
    case 'reason':
    case 'listsCode':
    case 'listsCodeAsMaterial':
    case 'gameState':
      return 'unknown';
    // Type-shape predicates on extra-deck monsters — check against card.type bits.
    case 'linkMonster':
      return (card.type & 0x4000000) !== 0;
    case 'xyzMonster':
      return (card.type & 0x800000) !== 0;
    case 'fusionMonster':
      return (card.type & 0x40) !== 0;
    case 'synchroMonster':
      return (card.type & 0x2000) !== 0;
    case 'ritualMonster':
      return (card.type & 0x1) !== 0 && (card.type & 0x80) !== 0;
    case 'trapMonster':
      return (card.type & 0x100) !== 0;
    case 'monsterCard':
      return (card.type & 0x1) !== 0;
    case 'spell':
      return (card.type & 0x2) !== 0;
    case 'trap':
      return (card.type & 0x4) !== 0;
    case 'continuousSpell':
      return (card.type & 0x2) !== 0 && (card.type & 0x20000) !== 0;
    case 'continuousTrap':
      return (card.type & 0x4) !== 0 && (card.type & 0x20000) !== 0;
    case 'fieldSpell':
      return (card.type & 0x2) !== 0 && (card.type & 0x80000) !== 0;
    case 'ritualSpell':
      return (card.type & 0x2) !== 0 && (card.type & 0x80) !== 0;
    case 'normalSpellTrap': {
      // Normal Spell/Trap = S/T without any sub-type flag. Excludes continuous,
      // quickplay, field, ritual-spell, equip, counter-trap.
      const isST = (card.type & 0x2) !== 0 || (card.type & 0x4) !== 0;
      if (!isST) return false;
      const subTypeMask = 0x80 | 0x10000 | 0x20000 | 0x40000 | 0x80000 | 0x100000;
      return (card.type & subTypeMask) === 0;
    }
    // `originalType` compares against pre-runtime-conversion type. For catalog
    // cards, card.type IS the original type (cdb stores native type). Same
    // semantics as `type` for our use.
    case 'originalType': {
      const typeMap: Record<string, number> = {
        TYPE_MONSTER: 0x1, TYPE_SPELL: 0x2, TYPE_TRAP: 0x4,
        TYPE_FUSION: 0x40, TYPE_RITUAL: 0x80, TYPE_TUNER: 0x1000,
        TYPE_SYNCHRO: 0x2000, TYPE_XYZ: 0x800000, TYPE_LINK: 0x4000000,
      };
      const mask = typeMap[pred.value as string];
      return mask !== undefined ? (card.type & mask) !== 0 : 'unknown';
    }
    case 'link':
      // For Link monsters, `datas.level` stores the rating. Non-Link monsters fail.
      if ((card.type & 0x4000000) === 0) return false;
      return card.level === (pred.value as number);
    case 'linkBelow':
      if ((card.type & 0x4000000) === 0) return false;
      return card.level <= (pred.value as number);
    case 'rank':
      // Xyz rank is stored in datas.level, same column as monster level.
      if ((card.type & 0x800000) === 0) return false;
      return card.level === (pred.value as number);
    case 'rankBelow':
      if ((card.type & 0x800000) === 0) return false;
      return card.level <= (pred.value as number);
    // attrCompare: {attr, op, value}. We resolve `level` statically; other attrs
    // (atk/def/overlayCount) are runtime-dependent → unknown.
    case 'attrCompare': {
      if (pred.attr !== 'level') return 'unknown';
      const v = pred.value as number;
      switch (pred.op) {
        case '==': return card.level === v;
        case '!=': return card.level !== v;
        case '>':  return card.level >   v;
        case '>=': return card.level >=  v;
        case '<':  return card.level <   v;
        case '<=': return card.level <=  v;
        default:   return 'unknown';
      }
    }
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
const CHAIN_EVENTS = new Set(['EVENT_CHAINING']);

// Categories that handtraps / chain-reactive cards typically watch for.
// A toEff producing one of these is a plausible chain target — we emit a
// chain-link edge so RL has signal that "handtrap X may react to card Y".
// State-bound (depends on opponent's actual chain context); confidence kept low.
const CHAIN_REACTIVE_CATEGORIES = new Set([
  'CATEGORY_TOHAND',          // searches → Ash, Belle
  'CATEGORY_SEARCH',          // tutors → Ash, Belle
  'CATEGORY_SPECIAL_SUMMON',  // SS → Maxx C, Mulcharmy, Veiler-class
  'CATEGORY_TO_GRAVE',        // mill → Ash
  'CATEGORY_DRAW',            // draw → Ash
  'CATEGORY_DECKDES',         // deck destruction → Ash
  'CATEGORY_DESTROY',         // destroy → Ogre, Belle (some)
  'CATEGORY_DISABLE',         // negate → Ogre
  'CATEGORY_REMOVE',          // banish-eff
]);

function produces(effect: Effect, kind: 'tohand' | 'summon' | 'tograve' | 'fusion-material' | 'destroy' | 'banish' | 'leave-field'): boolean {
  const cats = new Set(effect.categories);
  switch (kind) {
    case 'tohand':          return cats.has('CATEGORY_TOHAND') || cats.has('CATEGORY_SEARCH');
    case 'summon':          return cats.has('CATEGORY_SPECIAL_SUMMON');
    // CATEGORY_LEAVE_GRAVE means "card leaves GY" (revive/banish from GY) —
    // the OPPOSITE of "sends to GY". Only CATEGORY_TO_GRAVE matches the
    // gy-send-then-trigger pattern.
    case 'tograve':         return cats.has('CATEGORY_TO_GRAVE');
    case 'fusion-material': return cats.has('CATEGORY_FUSION_SUMMON');
    case 'destroy':         return cats.has('CATEGORY_DESTROY');
    case 'banish':          return cats.has('CATEGORY_REMOVE');
    case 'leave-field':     return cats.has('CATEGORY_LEAVE_FIELD') || cats.has('CATEGORY_DESTROY') || cats.has('CATEGORY_REMOVE') || cats.has('CATEGORY_TO_GRAVE');
  }
}

function triggersOn(effect: Effect, events: ReadonlySet<string>): boolean {
  return effect.events.some(ev => events.has(ev));
}

// True when every Special Summon action in the operation body targets the
// handler itself (`c` or `e:GetHandler()`). Such effects only summon "this card"
// and cannot legitimately be the source of a cross-card summon-then-trigger
// edge — pattern 2 must skip them. Returns false when no SS action is captured
// (signal absent → preserve the candidate).
function isSelfTargetingSS(eff: Effect): boolean {
  const ss = eff.operation?.actions?.filter(
    a => a.kind === 'special-summon' || a.kind === 'special-summon-step',
  ) ?? [];
  if (ss.length === 0) return false;
  return ss.every(a => a.target === 'c' || a.target === 'e:GetHandler()');
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
        const fromSelfSS = isSelfTargetingSS(fromEff);
        // Phase 15 — AND-intersect target.simpleFilter AND operation.simpleFilter
        // (both pruning when present). Phase 12 used `??` (operation overrides
        // target) which over-broadened in cases like Phryxul.e1a where target
        // says `[Dracotail, not(self)]` (the SS-pick filter) but operation says
        // `[ableToHand]` (the follow-up SendtoHand filter). With `??`, operation
        // erased the not(self) constraint → 100 bogus Phryxul-as-source edges +
        // 4 false-positive Phryxul self-trigger tier-A. With AND, the most
        // restrictive filter wins. One for One still benefits: target=`[monster,
        // ableToGraveAsCost]` AND operation=`[level=1, canBeSpecialSummoned]`
        // gives a tight intersection.
        const ssFilters = [fromEff.target?.simpleFilter, fromEff.operation?.simpleFilter]
          .filter((f): f is SimpleFilter => f !== undefined);
        for (const toCat of catalogs) {
          // Self-SS source can only trigger ITS OWN on-summon effects — skip
          // cross-card pairings to suppress ~750 bogus candidates per batch.
          if (fromSelfSS && toCat.cardId !== fromCat.cardId) continue;
          // Self-trigger allowed (e.g., a card's own SS triggers its own on-SS effect)
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, SUMMON_EVENTS)) continue;
            // Skip unless `toEff` is self-trigger (EFFECT_TYPE_SINGLE) — indicates card's own trigger
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            if (ssFilters.length === 0) continue;  // no filter info → skip (was the legacy gate)
            const toProps = propsByCard.get(toCat.cardId);
            if (!toProps) continue;
            // Conjunction: every present filter must match. Track lowest confidence.
            let minConf: 'high' | 'medium' | 'low' = 'high';
            let allMatched = true;
            for (const f of ssFilters) {
              const matched = cardMatchesFilter(f, toProps, fromCat.cardId);
              if (!matched.match) { allMatched = false; break; }
              if (matched.confidence === 'low') minConf = 'low';
              else if (matched.confidence === 'medium' && minConf === 'high') minConf = 'medium';
            }
            if (!allMatched) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'summon-then-trigger (SS → EVENT_SUMMON_SUCCESS, filter match)',
              confidence: minConf,
            });
          }
        }
      }
      // Pattern 3: GY-send-then-trigger
      if (produces(fromEff, 'tograve')) {
        for (const toCat of catalogs) {
          // Phase 10a — filter intersection: when source has a complete target
          // filter, prune to-cards that statically can't satisfy it. Mirrors
          // pattern 1 / 2 logic.
          if (fromEff.target?.simpleFilter?.complete) {
            const toProps = propsByCard.get(toCat.cardId);
            if (toProps && !cardMatchesFilter(fromEff.target.simpleFilter, toProps, fromCat.cardId).match) continue;
          }
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
          // Phase 10a — filter intersection (same rationale as pattern 3).
          if (fromEff.target?.simpleFilter?.complete) {
            const toProps = propsByCard.get(toCat.cardId);
            if (toProps && !cardMatchesFilter(fromEff.target.simpleFilter, toProps, fromCat.cardId).match) continue;
          }
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
          // Phase 10d — filter intersection (same rationale as patterns 3/5).
          if (fromEff.target?.simpleFilter?.complete) {
            const toProps = propsByCard.get(toCat.cardId);
            if (toProps && !cardMatchesFilter(fromEff.target.simpleFilter, toProps, fromCat.cardId).match) continue;
          }
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
          // Phase 10d — filter intersection (same rationale as patterns 3/5/6).
          if (fromEff.target?.simpleFilter?.complete) {
            const toProps = propsByCard.get(toCat.cardId);
            if (toProps && !cardMatchesFilter(fromEff.target.simpleFilter, toProps, fromCat.cardId).match) continue;
          }
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
      // Pattern 9: chain-link-then-trigger (handtraps + chain-reactive cards).
      // Source has EVENT_CHAINING trigger (Ash Blossom, Veiler, Belle, Ogre,
      // Maxx C, Mulcharmy, etc.) — emit edges to every cross-card effect that
      // produces a chain-reactable category. Confidence is intrinsically low:
      // the actual reaction is gated on opp's chain context (player ownership,
      // chained card category, location), which the static enumerator cannot
      // resolve. RL still benefits — it can learn that handtrap X has any
      // signal at all on cards in its potential reaction set.
      if (triggersOn(fromEff, CHAIN_EVENTS)) {
        for (const toCat of catalogs) {
          // Cross-card only — handtraps don't react to their own activation.
          if (toCat.cardId === fromCat.cardId) continue;
          for (const toEff of toCat.effects) {
            // toEff must produce ≥1 category that handtraps watch for.
            if (!toEff.categories.some(c => CHAIN_REACTIVE_CATEGORIES.has(c))) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'chain-link-then-trigger (→ EVENT_CHAINING, category match)',
              confidence: 'low',
              notes: ['Reactive — fires only when chained effect matches handtrap-specific filter (per-card category subset)'],
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

const jsonOutputArg = process.argv.find(a => a.startsWith('--json='));
const jsonOutputPath = jsonOutputArg?.slice('--json='.length);
const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const argIds = positionalArgs.map(Number).filter(Number.isFinite);

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

if (jsonOutputPath) {
  // Emit edges + card-properties snapshot for validate-bridge --candidates to
  // consume without re-querying cards.cdb.
  const cardIdxProps: Record<number, CardProperties> = {};
  for (const cat of catalogs) {
    const p = loadCardProperties(cat.cardId);
    if (p) cardIdxProps[cat.cardId] = p;
  }
  writeFileSync(jsonOutputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    cardCount: catalogs.length,
    cardProperties: cardIdxProps,
    edges,
  }, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  console.log(`\n[json] wrote ${edges.length} edges + ${Object.keys(cardIdxProps).length} card props to ${jsonOutputPath}`);
}

cardDb.close();
