// Mechanical edge enumeration over card-effects catalog JSONs.
//
// Given the extracted catalog for a list of cards, pair-level search:
//   for each effect EA that produces a game-state change,
//   find every effect EB whose trigger matches that change.
// Output: list of edges (EA → EB) with match reason.
//
// Match patterns (v2 — exhaustivity sweep 2026-04-25):
//   1.  Search-then-trigger:    CATEGORY_TOHAND/SEARCH        → EVENT_TO_HAND
//   2.  Summon-then-trigger:    CATEGORY_SPECIAL_SUMMON       → EVENT_(SP)SUMMON_SUCCESS
//   3.  GY-send-then-trigger:   CATEGORY_TOGRAVE              → EVENT_TO_GRAVE
//   4.  Fusion-material-trig.:  CATEGORY_FUSION_SUMMON        → EVENT_BE_MATERIAL
//   5.  Destroy-then-trigger:   CATEGORY_DESTROY              → EVENT_DESTROYED
//   6.  Banish-then-trigger:    CATEGORY_REMOVE               → EVENT_REMOVE
//   7.  Leave-field-trigger:    CATEGORY_DESTROY/REMOVE/      → EVENT_LEAVE_FIELD(_P)
//                                CATEGORY_TOGRAVE/TODECK/
//                                CATEGORY_TOHAND
//   8.  Battle-then-trigger:    CATEGORY_ATKCHANGE/DAMAGE     → EVENT_BATTLED / EVENT_DAMAGE_STEP_END
//   9.  Chain-link reactive:    EVENT_CHAINING/SOLVING (htp)  → from-side category produced
//   10. Release-then-trigger:   CATEGORY_RELEASE              → EVENT_RELEASE
//   11. Leave-grave-trigger:    CATEGORY_LEAVE_GRAVE          → EVENT_LEAVE_GRAVE
//   12. Chain-resolved-trig.:   EVENT_CHAIN_SOLVED on to-eff  ← any from production
//   13. Material-then-summon:   from-card matches a slot      → on-summon trigger of ED apex
//                                filter in to-card's
//                                summonProcedures.decoded
//   14. Alt-SS-proc-precond:    from-card matches the target/ → on-summon trigger of to-card
//                                cost filter of a
//                                EFFECT_SPSUMMON_PROC effect
//   15. Be-target-then-trigger: from-effect targets to-card   → EVENT_BE_TARGET on to-effect
//                                (filter intersection)
//   16. Damage-then-trigger:    CATEGORY_DAMAGE/RECOVER       → EVENT_DAMAGE / EVENT_RECOVER
//   17. Equip-then-trigger:     CATEGORY_EQUIP                → EVENT_EQUIP
//   18. Flip/pos-then-trigger:  CATEGORY_POSITION/FLIP        → EVENT_FLIP / EVENT_CHANGE_POS /
//                                                                EVENT_FLIP_SUMMON_SUCCESS
//
// Filter precision is enforced via:
//   - target ∩ operation filter intersection (Phase 15) for Patterns 1, 2 and family.
//   - Summon-type gates (fusionSummoned/synchroSummoned/xyzSummoned/linkSummoned/
//     ritualSummoned) on to-effect condition predicates, matched against
//     from-card's inferred summon-type (categories or summonProcedures self-SS).
//   - REASON_FUSION/SYNCHRO/XYZ/RITUAL predicates on to-effect condition gates.
//   - listsCode / listsCodeAsMaterial against to-card's listedNames.
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

interface ResolvedHelper {
  helper: string;
  kind: string;
  params?: Readonly<Record<string, unknown>>;
}

interface SlotRequirement {
  role: 'tuner' | 'non-tuner' | 'material' | 'fallen-of-albaz' | 'extra';
  min?: number;
  max?: number;
  filter?: ResolvedHelper | { raw: string } | { simpleFilter: SimpleFilter };
}

interface DecodedProcedure {
  slots: readonly SlotRequirement[];
  extras?: readonly string[];
  notes?: readonly string[];
}

interface SummonProcedure {
  kind: 'Synchro' | 'Fusion' | 'Xyz' | 'Link' | 'Pendulum' | 'Ritual';
  rawCall: string;
  opaque: boolean;
  decoded?: DecodedProcedure;
}

interface Catalog {
  cardId: number;
  name: string;
  listedNames?: readonly number[];
  listedSeries?: readonly string[];
  summonProcedures?: readonly SummonProcedure[];
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
  /** From catalog `listedNames` — card codes this card considers "listed".
   *  Used by `listsCode` / `listsCodeAsMaterial` predicate evaluation. */
  listedNames: readonly number[];
}

// =============================================================================
// Load catalogs + card properties
// =============================================================================

const catalogDir = join('..', '_bmad-output', 'solver-data', 'card-effects-catalog');
const cardDb = new Database(join('data', 'cards.cdb'), { readonly: true });
const cardStmt = cardDb.prepare('SELECT t.id, t.name, d.type, d.level, d.attribute, d.race, d.setcode FROM texts t LEFT JOIN datas d ON d.id = t.id WHERE t.id = ?');

function loadCardProperties(cardId: number, listedNames: readonly number[] = []): CardProperties | undefined {
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
    listedNames,
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
// TYPE_X bitmask constants from ocgcore (constant.lua). Used to evaluate the
// `type` predicate against `card.type` — supports `+` / `|` OR-masks via
// `resolveOrMask`, e.g., `TYPE_FUSION+TYPE_SYNCHRO+TYPE_XYZ+TYPE_LINK`.
const TYPE_HEX: Readonly<Record<string, number>> = {
  TYPE_MONSTER: 0x1, TYPE_SPELL: 0x2, TYPE_TRAP: 0x4,
  TYPE_NORMAL: 0x10, TYPE_EFFECT: 0x20, TYPE_FUSION: 0x40,
  TYPE_RITUAL: 0x80, TYPE_TRAPMONSTER: 0x100, TYPE_SPIRIT: 0x200,
  TYPE_UNION: 0x400, TYPE_DUAL: 0x800, TYPE_TUNER: 0x1000,
  TYPE_SYNCHRO: 0x2000, TYPE_TOKEN: 0x4000, TYPE_QUICKPLAY: 0x10000,
  TYPE_CONTINUOUS: 0x20000, TYPE_EQUIP: 0x40000, TYPE_FIELD: 0x80000,
  TYPE_COUNTER: 0x100000, TYPE_FLIP: 0x200000, TYPE_TOON: 0x400000,
  TYPE_XYZ: 0x800000, TYPE_PENDULUM: 0x1000000, TYPE_SPSUMMON: 0x2000000,
  TYPE_LINK: 0x4000000,
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

// CARD_* card-code constants from card_counter_constants.lua + constant.lua.
// Used to resolve summon-procedure slot filters like `{raw: 'CARD_ALBAZ'}` to a
// concrete card id, and to evaluate `code` predicates whose value is one of
// these named constants instead of a literal number.
const CARD_CODE_CONSTANTS = loadCardCodeConstants();

function loadCardCodeConstants(): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const file of ['card_counter_constants.lua', 'constant.lua']) {
    const path = join('data', 'scripts_full', file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf-8');
    for (const m of text.matchAll(/^\s*(CARD_[A-Z0-9_]+)\s*=\s*(\d+)/gm)) {
      out[m[1]] = Number(m[2]);
    }
  }
  return out;
}

/** Resolve a `|`- or `+`-separated mask value (e.g. "RACE_DRAGON|RACE_SPELLCASTER",
 *  "TYPE_FUSION+TYPE_SYNCHRO+TYPE_XYZ+TYPE_LINK") via the given hex map. Both
 *  separators are accepted because Lua source uses `+` for SetCategory/SetType
 *  composition (`TYPE_FUSION+TYPE_SYNCHRO`) while parser-decoded `or` chains
 *  emit `|`. Returns the bitwise-OR of all recognized tokens, or undefined if
 *  any token is unknown. Handles single tokens too. */
function resolveOrMask(value: string, map: Readonly<Record<string, number>>): number | undefined {
  const parts = value.split(/[|+]/).map(s => s.trim()).filter(s => s.length > 0);
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
      // is an unresolved CARD_* constant. Resolve it via CARD_CODE_CONSTANTS;
      // fall back to 'unknown' only when the token is genuinely unknown.
      if (typeof v === 'string') {
        const resolved = CARD_CODE_CONSTANTS[v];
        if (resolved !== undefined) return card.cardId === resolved;
        return 'unknown';
      }
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
    case 'type': {
      // TYPE_X bitmask. Slot filters often use OR-masks like
      // `TYPE_FUSION+TYPE_SYNCHRO+TYPE_XYZ+TYPE_LINK` (Mirrorjade) or
      // `TYPE_NORMAL+TYPE_EFFECT`. Use `resolveOrMask` so multi-token
      // values evaluate concretely instead of returning 'unknown'.
      const mask = resolveOrMask(pred.value as string, TYPE_HEX);
      if (mask === undefined) return 'unknown';
      return (card.type & mask) !== 0;
    }
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
    case 'gameState':
      return 'unknown';
    // listsCode / listsCodeAsMaterial: catalog stores `listedNames` per card,
    // populated from `s.listed_names = {...}`. Evaluate concretely when the
    // predicate value resolves to a numeric card-code (literal, CARD_* constant,
    // or `id` self-reference) and the candidate's listedNames table is available.
    case 'listsCode':
    case 'listsCodeAsMaterial': {
      const raw = pred.value;
      let target: number | undefined;
      if (typeof raw === 'number' && Number.isFinite(raw)) target = raw;
      else if (typeof raw === 'string') {
        if (raw === 'id') target = sourceCardId;
        else if (/^\d+$/.test(raw)) target = Number(raw);
        else if (raw in CARD_CODE_CONSTANTS) target = CARD_CODE_CONSTANTS[raw];
      }
      if (target === undefined) return 'unknown';
      // Catalog cards always carry their own id implicitly. Match own id too —
      // a card "lists itself" trivially via the card-code system.
      if (card.cardId === target) return true;
      return card.listedNames.includes(target);
    }
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
      const mask = resolveOrMask(pred.value as string, TYPE_HEX);
      if (mask === undefined) return 'unknown';
      return (card.type & mask) !== 0;
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

/** AND-intersect a list of present filters. Empty list = no constraint (true,
 *  high). Tracks the lowest confidence across present filters. Mirrors the
 *  Phase 15 conjunction logic so search/summon/destroy/banish patterns can
 *  share precision discipline. */
function cardMatchesAllFilters(
  filters: readonly SimpleFilter[],
  card: CardProperties,
  sourceCardId: number,
): { match: boolean; confidence: 'high' | 'medium' | 'low' } {
  if (filters.length === 0) return { match: true, confidence: 'high' };
  let minConf: 'high' | 'medium' | 'low' = 'high';
  for (const f of filters) {
    const r = cardMatchesFilter(f, card, sourceCardId);
    if (!r.match) return { match: false, confidence: 'high' };
    if (r.confidence === 'low') minConf = 'low';
    else if (r.confidence === 'medium' && minConf === 'high') minConf = 'medium';
  }
  return { match: true, confidence: minConf };
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
const MATERIAL_EVENTS = new Set(['EVENT_BE_MATERIAL', 'EVENT_BE_PRE_MATERIAL']);
const DESTROYED_EVENTS = new Set(['EVENT_DESTROYED']);
const REMOVED_EVENTS = new Set(['EVENT_REMOVE']);
const LEAVE_FIELD_EVENTS = new Set(['EVENT_LEAVE_FIELD', 'EVENT_LEAVE_FIELD_P']);
const BATTLE_EVENTS = new Set(['EVENT_BATTLED', 'EVENT_DAMAGE_STEP_END', 'EVENT_BATTLE_DESTROYED', 'EVENT_BATTLE_DESTROYING']);
// Pattern 9 covers chain-link reactivity (handtraps). EVENT_CHAINING fires
// when ANY effect activates a chain link; EVENT_CHAIN_SOLVING fires once the
// link is added and about to resolve. Both are cooperatively used by handtraps
// (some trigger pre-, some post-add).
const CHAIN_EVENTS = new Set(['EVENT_CHAINING', 'EVENT_CHAIN_SOLVING']);
const RELEASE_EVENTS = new Set(['EVENT_RELEASE']);
const LEAVE_GRAVE_EVENTS = new Set(['EVENT_LEAVE_GRAVE']);
const CHAIN_RESOLVED_EVENTS = new Set(['EVENT_CHAIN_SOLVED', 'EVENT_BREAK_EFFECT']);
const SS_PROC_EVENTS = new Set(['EFFECT_SPSUMMON_PROC', 'EFFECT_SPSUMMON_PROC_G']);
const BE_TARGET_EVENTS = new Set(['EVENT_BE_TARGET']);
const DAMAGE_EVENTS = new Set(['EVENT_DAMAGE', 'EVENT_RECOVER', 'EVENT_BATTLE_DAMAGE']);
const EQUIP_EVENTS = new Set(['EVENT_EQUIP']);
// Position changes — flip-summon success fires its own event distinct from
// generic position change. Flip effect triggers (face-down → face-up via
// flip summon) use FLIP_SUMMON_SUCCESS.
const POSITION_EVENTS = new Set(['EVENT_FLIP', 'EVENT_CHANGE_POS', 'EVENT_FLIP_SUMMON_SUCCESS']);

// Categories that handtraps / chain-reactive cards typically watch for.
// A toEff producing one of these is a plausible chain target — we emit a
// chain-link edge so RL has signal that "handtrap X may react to card Y".
// State-bound (depends on opponent's actual chain context); confidence kept low.
const CHAIN_REACTIVE_CATEGORIES = new Set([
  'CATEGORY_TOHAND',          // searches → Ash, Belle
  'CATEGORY_SEARCH',          // tutors → Ash, Belle
  'CATEGORY_SPECIAL_SUMMON',  // SS → Maxx C, Mulcharmy, Veiler-class
  'CATEGORY_TOGRAVE',         // mill → Ash  (was the typo-bugged 'CATEGORY_TO_GRAVE')
  'CATEGORY_DRAW',            // draw → Ash
  'CATEGORY_DECKDES',         // deck destruction → Ash
  'CATEGORY_DESTROY',         // destroy → Ogre, Belle (some)
  'CATEGORY_DISABLE',         // negate → Ogre
  'CATEGORY_REMOVE',          // banish-eff
]);

type ProducesKind =
  | 'tohand' | 'summon' | 'tograve' | 'fusion-material'
  | 'destroy' | 'banish' | 'leave-field' | 'release'
  | 'leave-grave' | 'atk-or-damage' | 'damage-or-recover'
  | 'equip' | 'flip-or-position' | 'targets';

function produces(effect: Effect, kind: ProducesKind): boolean {
  const cats = new Set(effect.categories);
  switch (kind) {
    case 'tohand':          return cats.has('CATEGORY_TOHAND') || cats.has('CATEGORY_SEARCH');
    case 'summon':          return cats.has('CATEGORY_SPECIAL_SUMMON');
    // CATEGORY_LEAVE_GRAVE = "card leaves GY" (revive/banish-from-GY) — the
    // OPPOSITE of "sends to GY". Only CATEGORY_TOGRAVE matches gy-send.
    case 'tograve':         return cats.has('CATEGORY_TOGRAVE');
    case 'fusion-material': return cats.has('CATEGORY_FUSION_SUMMON');
    case 'destroy':         return cats.has('CATEGORY_DESTROY');
    case 'banish':          return cats.has('CATEGORY_REMOVE');
    // ocgcore has no CATEGORY_LEAVE_FIELD constant; "leaving the field" is
    // the union of every category that physically removes a card from a
    // field zone (destroy, banish, send-to-GY/deck/hand, release).
    case 'leave-field':     return cats.has('CATEGORY_DESTROY') || cats.has('CATEGORY_REMOVE')
                                || cats.has('CATEGORY_TOGRAVE') || cats.has('CATEGORY_TODECK')
                                || cats.has('CATEGORY_TOHAND')  || cats.has('CATEGORY_RELEASE');
    case 'release':         return cats.has('CATEGORY_RELEASE');
    case 'leave-grave':     return cats.has('CATEGORY_LEAVE_GRAVE');
    case 'atk-or-damage':   return cats.has('CATEGORY_ATKCHANGE') || cats.has('CATEGORY_DAMAGE')
                                || cats.has('CATEGORY_DEFCHANGE');
    case 'damage-or-recover': return cats.has('CATEGORY_DAMAGE') || cats.has('CATEGORY_RECOVER');
    case 'equip':           return cats.has('CATEGORY_EQUIP');
    case 'flip-or-position': return cats.has('CATEGORY_POSITION') || cats.has('CATEGORY_FLIP');
    // `targets` is signalled by `EFFECT_FLAG_CARD_TARGET` on properties OR by
    // a non-trivial `target.simpleFilter` (the standard ocgcore target
    // declaration). Both flow through patterns identifying targeted cards.
    case 'targets':         return effect.properties?.includes('EFFECT_FLAG_CARD_TARGET') === true
                                || (effect.target?.simpleFilter !== undefined);
  }
}

function triggersOn(effect: Effect, events: ReadonlySet<string>): boolean {
  return effect.events.some(ev => events.has(ev));
}

// =============================================================================
// Summon-type gate filter (precision audit 2026-04-25)
//
// Some on-summon triggers (EVENT_SPSUMMON_SUCCESS) gate themselves with a
// `condition` that requires a specific summon type — e.g. Branded Albion's e1
// has `function(e) return e:GetHandler():IsFusionSummoned() end`. Pattern 2
// previously emitted an edge whenever the from-effect produced ANY SS, even
// when the from-effect's SS was non-Fusion (regular SS, Ritual SS, etc.) and
// the to-effect's gate would never fire. That generated 43 false-positive
// edges in the branded/yummy/snake-eye/mitsurugi catalog — confirmed by the
// edge-validation-report.md sweep.
//
// Catalog v7 only marks `CATEGORY_FUSION_SUMMON` explicitly. Synchro/Xyz/Link/
// Ritual summons are not category-tagged and are recognised via
// `summonProcedures`, which the catalog stores at the card level rather than
// per-effect. Until the parser is upgraded to expose these as effect-level
// flags, the gate filter only handles `fusionSummoned`. Other summon-type
// gates remain optimistically passed (potential false-positives surfaced by
// `validate-edges-precision.mjs`).
// =============================================================================

/** Token shared with `summonTypeGatesOnToEff` — `fusionSummoned` etc. always
 *  ties to a category check on the from-effect; the synthetic `__SYNCHRO__` /
 *  `__XYZ__` / `__LINK__` / `__RITUAL__` / `__PENDULUM__` tags are sentinels
 *  decoded via from-card procedure inspection. */
const SUMMON_TYPE_TO_CATEGORY: Readonly<Record<string, string>> = {
  fusionSummoned:    'CATEGORY_FUSION_SUMMON',
  synchroSummoned:   '__SYNCHRO__',
  xyzSummoned:       '__XYZ__',
  linkSummoned:      '__LINK__',
  ritualSummoned:    '__RITUAL__',
  pendulumSummoned:  '__PENDULUM__',
};

/** REASON_X conditions on to-effect → equivalent summon-type gate. Branded
 *  Disciple, Albion the Sanctifire, Mirrorjade-recur etc. trigger via
 *  `IsReason(REASON_FUSION)` — semantically identical to `IsFusionSummoned()`
 *  for static edge identification. */
const REASON_TO_GATE: Readonly<Record<string, string>> = {
  REASON_FUSION:   'fusionSummoned',
  REASON_SYNCHRO:  'synchroSummoned',
  REASON_XYZ:      'xyzSummoned',
  REASON_RITUAL:   'ritualSummoned',
};

/** Set of summon-type tokens the to-effect requires for its on-summon trigger
 *  (e.g. {'fusionSummoned'}). Walks `condition.simpleFilter.predicates` AND
 *  one level of OR/NOT awareness:
 *   - Conjuncted `IsXSummoned()` / `IsReason(REASON_X)` — hard gate.
 *   - OR-composite where every disjunct is a summon-type → all tokens added
 *     (the to-effect accepts any of them).
 *   - `not` is ignored: a `not IsFusionSummoned` condition wouldn't constrain
 *     which from-effect could legitimately fire it.
 *   - Nested `not(or(...))` and other rare shapes fall through (permissive). */
function summonTypeGatesOnToEff(toEff: Effect): Set<string> {
  const out = new Set<string>();
  for (const p of toEff.condition?.simpleFilter?.predicates ?? []) {
    if (p.kind in SUMMON_TYPE_TO_CATEGORY) out.add(p.kind);
    else if (p.kind === 'reason' && typeof p.value === 'string') {
      const tok = REASON_TO_GATE[p.value];
      if (tok !== undefined) out.add(tok);
    } else if (p.kind === 'or' && p.predicates) {
      const inner: string[] = [];
      let allGate = true;
      for (const q of p.predicates) {
        if (q.kind in SUMMON_TYPE_TO_CATEGORY) inner.push(q.kind);
        else if (q.kind === 'reason' && typeof q.value === 'string'
              && REASON_TO_GATE[q.value] !== undefined) inner.push(REASON_TO_GATE[q.value]);
        else { allGate = false; break; }
      }
      if (allGate) for (const tok of inner) out.add(tok);
    }
  }
  return out;
}

/** Does the from-effect (in from-card context) satisfy at least one of the
 *  to-effect's summon-type gates? Returns `{ ok: true }` when:
 *   - No gate is present (permissive default).
 *   - At least one gate is provably satisfied via:
 *     - `fusionSummoned` → from-effect carries CATEGORY_FUSION_SUMMON.
 *     - `synchroSummoned/xyzSummoned/linkSummoned/ritualSummoned/pendulumSummoned`:
 *       from-effect Special-Summons its handler (self-SS) AND the from-card's
 *       `summonProcedures` declares the matching kind. The bulk of on-summon
 *       triggers fall here (a Synchro/Xyz/Link monster triggering itself).
 *  Cross-card cases (card A SS's card B as a Synchro from card C's effect)
 *  fall through optimistically because the catalog can't pin SS-type at the
 *  from-effect level. */
function fromEffSatisfiesAnyGate(
  fromEff: Effect,
  fromCard: Catalog,
  gates: ReadonlySet<string>,
): boolean {
  if (gates.size === 0) return true;
  const fromCats = new Set(fromEff.categories);
  for (const gate of gates) {
    const tag = SUMMON_TYPE_TO_CATEGORY[gate];
    if (tag === 'CATEGORY_FUSION_SUMMON') {
      if (fromCats.has('CATEGORY_FUSION_SUMMON')) return true;
      continue;
    }
    const procKind = ({
      __SYNCHRO__: 'Synchro',
      __XYZ__: 'Xyz',
      __LINK__: 'Link',
      __RITUAL__: 'Ritual',
      __PENDULUM__: 'Pendulum',
    } as Record<string, string>)[tag];
    if (procKind === undefined) continue;
    const hasProc = (fromCard.summonProcedures ?? []).some(p => p.kind === procKind);
    if (hasProc && isSelfTargetingSS(fromEff)) return true;
  }
  return false;
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
  // Load properties for every card referenced (carries listedNames for
  // listsCode predicate evaluation).
  const propsByCard = new Map<number, CardProperties>();
  for (const c of catalogs) {
    const p = loadCardProperties(c.cardId, c.listedNames ?? []);
    if (p) propsByCard.set(c.cardId, p);
  }
  const catalogByCard = new Map<number, Catalog>();
  for (const c of catalogs) catalogByCard.set(c.cardId, c);

  const edges: Edge[] = [];

  // Helper: collect intersection of present filters from a from-effect, ANDed.
  // Used by every pattern that filters from-effect → to-card via filter match.
  const intersectFilters = (eff: Effect): SimpleFilter[] => [
    eff.target?.simpleFilter,
    eff.operation?.simpleFilter,
  ].filter((f): f is SimpleFilter => f !== undefined);

  // Helper: emit an edge when filter intersection holds. Used by patterns
  // 1 / 3 / 5 / 6 / 7 — single from-effect → cross-card to-effect with a shared
  // filter discipline. `requireSelfTrigger` enforces EFFECT_TYPE_SINGLE on the
  // to-effect (the trigger is on the card itself); pattern 1 leaves it false
  // because field-spell-style on-add triggers also count.
  const tryEmitFiltered = (
    fromCat: Catalog, fromEff: Effect, toCat: Catalog, toEff: Effect,
    events: ReadonlySet<string>, reason: string,
    opts: { requireSelfTrigger: boolean; baseConfidence?: 'high' | 'medium' | 'low'; notes?: readonly string[] },
  ): void => {
    if (!triggersOn(toEff, events)) return;
    if (opts.requireSelfTrigger && !toEff.types.includes('EFFECT_TYPE_SINGLE')) return;
    const toProps = propsByCard.get(toCat.cardId);
    if (!toProps) return;
    const filters = intersectFilters(fromEff);
    const matched = cardMatchesAllFilters(filters, toProps, fromCat.cardId);
    if (!matched.match) return;
    // When no filters were present, baseConfidence applies (defaults low —
    // the from-effect produces the category but didn't narrow its target).
    const conf = filters.length === 0 ? (opts.baseConfidence ?? 'low') : matched.confidence;
    edges.push({
      from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
      to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
      reason, confidence: conf,
      ...(opts.notes && opts.notes.length > 0 ? { notes: [...opts.notes] } : {}),
    });
  };

  for (const fromCat of catalogs) {
    for (const fromEff of fromCat.effects) {
      // ----- Pattern 1: search-then-trigger ---------------------------------
      // Search → EVENT_TO_HAND. Field-spell on-add triggers (e.g., Belle de
      // Fleur class) don't always carry EFFECT_TYPE_SINGLE, so we accept any
      // trigger type. Filter intersection (Phase 15) prunes false-positives.
      if (produces(fromEff, 'tohand')) {
        for (const toCat of catalogs) {
          if (toCat.cardId === fromCat.cardId) continue;
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, HAND_EVENTS,
              'search-then-trigger (add-to-hand → EVENT_TO_HAND, filter match)',
              { requireSelfTrigger: false, baseConfidence: 'low',
                notes: toEff.condition?.inline?.includes('REASON_DRAW')
                  ? ['target triggers only if NOT drawn — reason passed via add-from-deck qualifies']
                  : undefined,
              });
          }
        }
      }
      // ----- Pattern 2: summon-then-trigger ---------------------------------
      // Phase 15 + 2026-04-25 gate logic. Self-targeting SS only triggers its
      // own on-summon effects (skip cross-card). Summon-type gates on the
      // to-effect (fusionSummoned, synchroSummoned, ...) are required-or-skip.
      if (produces(fromEff, 'summon')) {
        const fromSelfSS = isSelfTargetingSS(fromEff);
        const ssFilters = intersectFilters(fromEff);
        if (ssFilters.length > 0) {
          for (const toCat of catalogs) {
            if (fromSelfSS && toCat.cardId !== fromCat.cardId) continue;
            for (const toEff of toCat.effects) {
              if (!triggersOn(toEff, SUMMON_EVENTS)) continue;
              if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
              const gates = summonTypeGatesOnToEff(toEff);
              if (!fromEffSatisfiesAnyGate(fromEff, fromCat, gates)) continue;
              const toProps = propsByCard.get(toCat.cardId);
              if (!toProps) continue;
              const matched = cardMatchesAllFilters(ssFilters, toProps, fromCat.cardId);
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
      // ----- Pattern 3: gy-send-then-trigger --------------------------------
      // Bug fix 2026-04-25: was checking CATEGORY_TO_GRAVE which doesn't exist
      // in ocgcore (it's CATEGORY_TOGRAVE — see produces()). Fixed → pattern
      // now actually fires.
      if (produces(fromEff, 'tograve')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, GRAVE_EVENTS,
              'gy-send-then-trigger (→ EVENT_TO_GRAVE)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['GY-send target may not be this card — depends on target selection'],
              });
          }
        }
      }
      // ----- Pattern 4: fusion-material-then-trigger ------------------------
      // Fusion summon → EVENT_BE_MATERIAL on materials consumed.
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
      // ----- Pattern 5: destroy-then-trigger --------------------------------
      if (produces(fromEff, 'destroy')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, DESTROYED_EVENTS,
              'destroy-then-trigger (→ EVENT_DESTROYED)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Destroy target may not be this card — depends on target selection'],
              });
          }
        }
      }
      // ----- Pattern 6: banish-then-trigger ---------------------------------
      if (produces(fromEff, 'banish')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, REMOVED_EVENTS,
              'banish-then-trigger (→ EVENT_REMOVE)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Banish target may not be this card — depends on target selection'],
              });
          }
        }
      }
      // ----- Pattern 7: leave-field-then-trigger ----------------------------
      // CATEGORY_LEAVE_FIELD doesn't exist in ocgcore — pattern fires for any
      // category that physically removes a card from a field zone (covered
      // inside produces('leave-field')).
      if (produces(fromEff, 'leave-field')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, LEAVE_FIELD_EVENTS,
              'leave-field-then-trigger (→ EVENT_LEAVE_FIELD)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Target may not be this card'],
              });
          }
        }
      }
      // ----- Pattern 8: battle-then-trigger ---------------------------------
      // Bug fix 2026-04-25: was checking CATEGORY_ATK_CHANGE which doesn't
      // exist (it's CATEGORY_ATKCHANGE). DEFCHANGE included for symmetry.
      if (produces(fromEff, 'atk-or-damage')) {
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
      // ----- Pattern 9: chain-link-then-trigger -----------------------------
      if (triggersOn(fromEff, CHAIN_EVENTS)) {
        for (const toCat of catalogs) {
          if (toCat.cardId === fromCat.cardId) continue;
          for (const toEff of toCat.effects) {
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
      // ----- Pattern 10: release-then-trigger -------------------------------
      // Tribute / release triggers (Mitsurugi Ritual on tribute, Phantom of
      // Chaos, Branded Beast). Release target may match the from-filter when
      // present (e.g. Mitsurugi Ritual targets a Mitsurugi via target.filter).
      if (produces(fromEff, 'release')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, RELEASE_EVENTS,
              'release-then-trigger (→ EVENT_RELEASE)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Release target may not be this card — depends on tribute selection'],
              });
          }
        }
      }
      // ----- Pattern 11: leave-grave-then-trigger ---------------------------
      // Card leaves GY (revive / banish-from-GY / shuffle-back) → EVENT_LEAVE_GRAVE.
      // E.g. Mirrorjade's GY-recur, certain Engage-class persistent monitors.
      // Distinct from leave-field (Pattern 7).
      if (produces(fromEff, 'leave-grave')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, LEAVE_GRAVE_EVENTS,
              'leave-grave-then-trigger (→ EVENT_LEAVE_GRAVE)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Target leaving GY may not be this card'],
              });
          }
        }
      }
      // ----- Pattern 12: chain-resolved-then-trigger ------------------------
      // To-effect triggers on `EVENT_CHAIN_SOLVED` / `EVENT_BREAK_EFFECT` —
      // post-resolution observers (Branded Disciple's "after a Fusion Summon
      // chain resolves" idiom). The to-effect's gate set narrows which from-
      // effects are valid sources. Without a gate, fall back to "produces a
      // chain-reactive category" pruning to keep the edge count tractable.
      // Cross-card only.
      for (const toCat of catalogs) {
        if (toCat.cardId === fromCat.cardId) continue;
        for (const toEff of toCat.effects) {
          if (!triggersOn(toEff, CHAIN_RESOLVED_EVENTS)) continue;
          if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
          const gates = summonTypeGatesOnToEff(toEff);
          if (gates.size > 0) {
            // Hard summon-type gate present → require from-effect to satisfy.
            if (!fromEffSatisfiesAnyGate(fromEff, fromCat, gates)) continue;
          } else {
            // No gate → require from-effect to produce a chain-visible result.
            if (!fromEff.categories.some(c => CHAIN_REACTIVE_CATEGORIES.has(c))) continue;
          }
          edges.push({
            from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
            to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
            reason: 'chain-resolved-then-trigger (→ EVENT_CHAIN_SOLVED, gate match)',
            confidence: gates.size > 0 ? 'medium' : 'low',
          });
        }
      }
      // ----- Pattern 15: be-target-then-trigger -----------------------------
      // From-effect targets cards via `target.simpleFilter`; to-effect triggers
      // on EVENT_BE_TARGET. Filter intersection prunes to-cards the from-effect
      // can't legally target (e.g. setCard / type / location restriction). Cross-
      // card only — a card targeting itself is a self-trigger, not a network edge.
      if (produces(fromEff, 'targets')) {
        for (const toCat of catalogs) {
          if (toCat.cardId === fromCat.cardId) continue;
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, BE_TARGET_EVENTS,
              'be-target-then-trigger (→ EVENT_BE_TARGET, filter match)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Targeting reactive — fires only when this card is among the chosen targets'],
              });
          }
        }
      }
      // ----- Pattern 16: damage-then-trigger --------------------------------
      // CATEGORY_DAMAGE / CATEGORY_RECOVER → EVENT_DAMAGE / EVENT_RECOVER /
      // EVENT_BATTLE_DAMAGE. Burn / heal triggers (e.g., Solemn Strike, Honest's
      // damage payment, Mulcharmy-style draw-trigger). Distinct from Pattern 8
      // which targets EVENT_BATTLED (resolution).
      if (produces(fromEff, 'damage-or-recover')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            if (!triggersOn(toEff, DAMAGE_EVENTS)) continue;
            if (!toEff.types.includes('EFFECT_TYPE_SINGLE')) continue;
            edges.push({
              from: { cardId: fromCat.cardId, name: fromCat.name, effectId: fromEff.id },
              to: { cardId: toCat.cardId, name: toCat.name, effectId: toEff.id },
              reason: 'damage-then-trigger (→ EVENT_DAMAGE / EVENT_RECOVER)',
              confidence: 'low',
              notes: ['Damage delta may not affect this card directly — depends on damage target / amount'],
            });
          }
        }
      }
      // ----- Pattern 17: equip-then-trigger ---------------------------------
      // Equip cards / equip-style effects → EVENT_EQUIP. From-effect carries
      // CATEGORY_EQUIP and typically a target.simpleFilter for the equipee.
      if (produces(fromEff, 'equip')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, EQUIP_EVENTS,
              'equip-then-trigger (→ EVENT_EQUIP, filter match)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Equip target may not be this card — depends on equip selection'],
              });
          }
        }
      }
      // ----- Pattern 18: flip-or-position-then-trigger ----------------------
      // CATEGORY_POSITION / CATEGORY_FLIP on from-effect → EVENT_FLIP /
      // EVENT_CHANGE_POS / EVENT_FLIP_SUMMON_SUCCESS on to-effect. Covers
      // flip-effect monsters (Sangan-class) and reposition responders.
      if (produces(fromEff, 'flip-or-position')) {
        for (const toCat of catalogs) {
          for (const toEff of toCat.effects) {
            tryEmitFiltered(fromCat, fromEff, toCat, toEff, POSITION_EVENTS,
              'flip-or-position-then-trigger (→ EVENT_FLIP / EVENT_CHANGE_POS)',
              { requireSelfTrigger: true, baseConfidence: 'low',
                notes: ['Position-change target may not be this card — depends on selection'],
              });
          }
        }
      }
    }
  }

  // ---------- Pattern 13: material-then-summon (out of fromEff loop) -------
  // For each catalog card C with `summonProcedures.decoded.slots`, emit edges
  // from every catalog card F that statically matches a slot's filter to C's
  // on-summon trigger effects (EVENT_SUMMON_SUCCESS / EVENT_SPSUMMON_SUCCESS,
  // EFFECT_TYPE_SINGLE). This captures the structural relation "F is a viable
  // material for C → summoning C triggers C's on-summon effect".
  //
  // Slot.filter resolution priority:
  //   1. {simpleFilter}      — parser-decoded (post-upgrade)
  //   2. ResolvedHelper      — kind 'filter-wrap' synthesised here
  //   3. {raw: 'CARD_*'}     — resolved via CARD_CODE_CONSTANTS → code predicate
  //   4. {raw: 's.matfilter'} — opaque (parser-side resolution still pending)
  //   5. undefined            — generic slot ("any 2 monsters") — gated only
  //                             by procedure kind (Synchro=tuner+nontuner,
  //                             Xyz=rank R N times, Link=co-linkable monster)
  //
  // Source from-effect is synthesised as `_material` so the edge is clearly
  // a material-relation, not an effect-to-effect transition.
  for (const toCat of catalogs) {
    for (const proc of toCat.summonProcedures ?? []) {
      const slots = proc.decoded?.slots ?? [];
      if (slots.length === 0) continue;
      // Locate the on-summon trigger effects of toCat (the apex's own effects
      // that fire when it lands). Vanilla / non-trigger ED monsters (Mirrorjade,
      // Salamangreat Almiraj) have NO on-summon trigger but the material
      // relation is still structurally meaningful — the solver needs to know
      // "F can be used to summon C". For those we emit edges to a synthetic
      // `_summon` effectId so the relation is preserved at lower granularity.
      const onSummonEffs = toCat.effects.filter(e =>
        triggersOn(e, SUMMON_EVENTS) && e.types.includes('EFFECT_TYPE_SINGLE'));
      const targetEffectIds: string[] = onSummonEffs.length > 0
        ? onSummonEffs.map(e => e.id)
        : ['_summon'];

      // Collect a SimpleFilter per slot we can decode statically.
      const slotFilters: { role: string; filter: SimpleFilter | null; note?: string }[] = [];
      for (const slot of slots) {
        const sf = slotToSimpleFilter(slot);
        slotFilters.push({ role: slot.role, filter: sf });
      }

      for (const fromCat of catalogs) {
        if (fromCat.cardId === toCat.cardId) continue;
        const fromProps = propsByCard.get(fromCat.cardId);
        if (!fromProps) continue;
        // Card matches if ANY slot's filter passes (or any opaque slot, which
        // is treated as low-confidence permissive).
        let bestConf: 'high' | 'medium' | 'low' | null = null;
        let matchedRole: string | null = null;
        for (const s of slotFilters) {
          if (s.filter === null) {
            // Opaque slot — keep low-confidence catch-all match.
            if (bestConf === null) { bestConf = 'low'; matchedRole = s.role; }
            continue;
          }
          const r = cardMatchesFilter(s.filter, fromProps, toCat.cardId);
          if (!r.match) continue;
          if (bestConf === null
              || (bestConf === 'low' && r.confidence !== 'low')
              || (bestConf === 'medium' && r.confidence === 'high')) {
            bestConf = r.confidence;
            matchedRole = s.role;
          }
        }
        if (bestConf === null) continue;
        for (const toEffId of targetEffectIds) {
          edges.push({
            from: { cardId: fromCat.cardId, name: fromCat.name, effectId: '_material' },
            to: { cardId: toCat.cardId, name: toCat.name, effectId: toEffId },
            reason: `material-then-summon (${proc.kind}/${matchedRole}${toEffId === '_summon' ? ' → vanilla summon' : ' → on-summon trigger'})`,
            confidence: bestConf,
            notes: ['from-card is statically a viable material for to-card; actual usage depends on extra-deck choice'],
          });
        }
      }
    }
  }

  // ---------- Pattern 14: alt-SS-proc precondition --------------------------
  // For each catalog card C with an `EFFECT_SPSUMMON_PROC` /
  // `EFFECT_SPSUMMON_PROC_G` effect E (custom Special Summon procedure), the
  // procedure's own target/cost filter declares which cards must exist on
  // field / in GY / in hand to enable the SS. From-cards matching that filter
  // → C's on-summon trigger effects. Captures patterns like:
  //   - Snake-Eyes Doomed Dragon: send a face-up monster to GY → SS self.
  //   - Ext Ryzeal: send an Xyz to GY → SS self from hand.
  //   - Ryzeal core: HAND → field via "send LP-cost monster".
  //
  // Source from-effect is synthesised as `_alt-ss-cost` to flag the relation.
  // Confidence is bounded to 'low' baseline (state-bound by zone availability)
  // and downgrades from filter match if known.
  //
  // The procedure's filter is searched in priority order: target → cost →
  // operation. The first non-empty SimpleFilter wins.
  for (const toCat of catalogs) {
    for (const procEff of toCat.effects) {
      if (!triggersOn(procEff, SS_PROC_EVENTS)) continue;
      // Locate a SimpleFilter on the procedure: the picker for cost/material.
      const procFilter = procEff.target?.simpleFilter
                       ?? procEff.cost?.simpleFilter
                       ?? procEff.operation?.simpleFilter;
      if (!procFilter) continue;
      // Skip filters that only carry "trivially-true" predicates (e.g.,
      // `[ableToGraveAsCost]` alone matches every monster) — the resulting
      // edge set would be unbounded without informational value. The signal
      // for the solver is still present via the procedure existence itself,
      // but we only emit when a meaningful narrowing predicate is present.
      const hasNarrowingPredicate = procFilter.predicates.some(p =>
        p.kind !== 'ableToGraveAsCost' && p.kind !== 'ableToHand'
        && p.kind !== 'ableToDeck' && p.kind !== 'ableToRemove'
        && p.kind !== 'canBeSpecialSummoned' && p.kind !== 'discardable'
        && p.kind !== 'gameState');
      if (!hasNarrowingPredicate) continue;

      // Find C's on-summon trigger effects. Same fallback as Pattern 13:
      // when no on-summon trigger exists (vanilla cards with custom SS proc
      // but no follow-up effect), emit to a synthetic `_summon` effectId so
      // the alt-SS-proc relation is preserved.
      const onSummonEffs = toCat.effects.filter(e =>
        triggersOn(e, SUMMON_EVENTS) && e.types.includes('EFFECT_TYPE_SINGLE'));
      const targetEffectIds: string[] = onSummonEffs.length > 0
        ? onSummonEffs.map(e => e.id)
        : ['_summon'];

      for (const fromCat of catalogs) {
        if (fromCat.cardId === toCat.cardId) continue;
        const fromProps = propsByCard.get(fromCat.cardId);
        if (!fromProps) continue;
        const matched = cardMatchesFilter(procFilter, fromProps, toCat.cardId);
        if (!matched.match) continue;
        // Cap baseline confidence at 'low' — the procedure precondition is
        // a STATE constraint (zone availability, GY contents) layered on top
        // of the filter match. Filter being 'high' just means the type/level/
        // attribute is correct; it doesn't mean the precondition will hold.
        const conf: 'low' | 'medium' = matched.confidence === 'high' ? 'medium' : 'low';
        for (const toEffId of targetEffectIds) {
          edges.push({
            from: { cardId: fromCat.cardId, name: fromCat.name, effectId: '_alt-ss-cost' },
            to: { cardId: toCat.cardId, name: toCat.name, effectId: toEffId },
            reason: `alt-ss-proc-precondition (${procEff.id}${toEffId === '_summon' ? ' → vanilla summon' : ' → on-summon trigger'})`,
            confidence: conf,
            notes: ['from-card is a viable cost/material for to-card\'s alt SS proc; precondition is state-bound (zone availability)'],
          });
        }
      }
    }
  }

  return edges;
}

/** Resolve a summon-procedure slot's filter into a SimpleFilter we can match
 *  cards against. Returns null when the slot's filter is opaque (e.g. raw
 *  references like `s.matfilter` whose body lives outside the catalog) — the
 *  caller treats null as a permissive low-confidence catch-all. */
function slotToSimpleFilter(slot: SlotRequirement): SimpleFilter | null {
  if (!slot.filter) return null;
  // Parser-decoded path (post-upgrade): the slot already carries a SimpleFilter.
  if ('simpleFilter' in slot.filter) return slot.filter.simpleFilter;
  // Resolved aux helper: `aux.FilterBoolFunction(Card.IsX, value)`.
  if ('kind' in slot.filter && slot.filter.kind === 'filter-wrap' && slot.filter.params) {
    const predName = slot.filter.params['predicate'] as string | undefined;
    const predValue = slot.filter.params['value'] as string | undefined;
    const pred = synthesiseSlotPredicate(predName, predValue);
    if (pred) return { predicates: [pred], complete: true };
    return null;
  }
  if ('raw' in slot.filter) {
    const raw = slot.filter.raw;
    // CARD_X token → resolves to a `code` predicate against the literal id.
    if (raw in CARD_CODE_CONSTANTS) {
      return { predicates: [{ kind: 'code', value: CARD_CODE_CONSTANTS[raw] }], complete: true };
    }
    // s.matfilter / s.synfilter / etc. — body lives in the from-card's helper
    // map but the catalog doesn't surface it. Parser upgrade pending.
    return null;
  }
  return null;
}

/** Convert an `aux.FilterBoolFunction(Card.IsX, value)` shape into a single
 *  FilterPredicate. Mirrors the parser's `decodeMethodPredicate` for the few
 *  shapes that appear inside slot filters (level / attribute / race / ListsCode).
 *  Returns undefined for unrecognised method names — caller falls back to
 *  treating the slot as opaque. */
function synthesiseSlotPredicate(method?: string, value?: string): FilterPredicate | undefined {
  if (!method) return undefined;
  const v = (value ?? '').trim();
  switch (method) {
    case 'IsAttribute':         return { kind: 'attribute', value: v };
    case 'IsRace':              return { kind: 'race', value: v };
    case 'IsType':              return { kind: 'type', value: v };
    case 'IsLevel':             return { kind: 'level', value: Number(v) };
    case 'IsLevelAbove':        return { kind: 'levelAbove', value: Number(v) };
    case 'IsLevelBelow':        return { kind: 'levelBelow', value: Number(v) };
    case 'IsCode':
      if (v === 'id') return { kind: 'code', value: 'self' };
      if (/^\d+$/.test(v)) return { kind: 'code', value: Number(v) };
      if (v in CARD_CODE_CONSTANTS) return { kind: 'code', value: CARD_CODE_CONSTANTS[v] };
      return { kind: 'code', value: v };  // unresolved — evalPredicate returns 'unknown'
    case 'IsSetCard':           return { kind: 'setCard', value: v };
    case 'IsLinkMonster':       return { kind: 'linkMonster' };
    case 'IsXyzMonster':        return { kind: 'xyzMonster' };
    case 'IsFusionMonster':     return { kind: 'fusionMonster' };
    case 'IsSynchroMonster':    return { kind: 'synchroMonster' };
    case 'IsRitualMonster':     return { kind: 'ritualMonster' };
    case 'ListsCode':           return { kind: 'listsCode', value: v };
    case 'ListsCodeAsMaterial': return { kind: 'listsCodeAsMaterial', value: v };
    default:                    return undefined;
  }
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
