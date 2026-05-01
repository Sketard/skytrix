// =============================================================================
// card-metadata.ts — pre-computed card typology lookup for the structural
// value function (step 1).
//
// The scorer has historically had zero CardDB access — it only consumed
// `interruption-tags.json`. Step 1 structural features need type inference
// (isRitualMonster, isRitualSpell, level, attribute, race) to be
// deck-agnostic. Rather than passing CardDB into the hot scoring path, we
// pre-compute a flat map once at solver construction and inject it.
//
// Cost: ~40-70 cards per duel (main + extra + hand), 1 SQLite query each
// via the existing `cardDB.stmt` prepared statement. Measured < 5ms total
// on warm cache (first query may include cold-read overhead, irrelevant).
//
// Runtime lookup: O(1) map access.
// =============================================================================

import type { CardDB } from '../types.js';

// YGOPro type/race/attribute constants mirrored from ygopro-core.
// Single source of truth: duel-server/data/scripts_full/constant.lua
// Reference doc: _bmad-output/solver-data/cards-cdb-hex-reference.md
export const TYPE_MONSTER = 0x1;
export const TYPE_SPELL = 0x2;
export const TYPE_TRAP = 0x4;
export const TYPE_NORMAL = 0x10;
export const TYPE_EFFECT = 0x20;
export const TYPE_FUSION = 0x40;
export const TYPE_RITUAL = 0x80;
export const TYPE_TRAPMONSTER = 0x100;
export const TYPE_SPIRIT = 0x200;
export const TYPE_UNION = 0x400;
export const TYPE_DUAL = 0x800;   // aka TYPE_GEMINI
export const TYPE_TUNER = 0x1000;
export const TYPE_SYNCHRO = 0x2000;
export const TYPE_TOKEN = 0x4000;
export const TYPE_QUICKPLAY = 0x10000;
export const TYPE_CONTINUOUS = 0x20000;
export const TYPE_EQUIP = 0x40000;
export const TYPE_FIELD = 0x80000;
export const TYPE_COUNTER = 0x100000;
export const TYPE_FLIP = 0x200000;
export const TYPE_TOON = 0x400000;
export const TYPE_XYZ = 0x800000;
export const TYPE_PENDULUM = 0x1000000;
export const TYPE_SPSUMMON = 0x2000000;
export const TYPE_LINK = 0x4000000;

// Attributes (single value — a monster has exactly one).
export const ATTRIBUTE_EARTH = 0x1;
export const ATTRIBUTE_WATER = 0x2;
export const ATTRIBUTE_FIRE = 0x4;
export const ATTRIBUTE_WIND = 0x8;
export const ATTRIBUTE_LIGHT = 0x10;
export const ATTRIBUTE_DARK = 0x20;
export const ATTRIBUTE_DIVINE = 0x40;

// Races (officially called "Type" in card text — single value).
export const RACE_WARRIOR = 0x1;
export const RACE_SPELLCASTER = 0x2;
export const RACE_FAIRY = 0x4;
export const RACE_FIEND = 0x8;
export const RACE_ZOMBIE = 0x10;
export const RACE_MACHINE = 0x20;
export const RACE_AQUA = 0x40;
export const RACE_PYRO = 0x80;
export const RACE_ROCK = 0x100;
export const RACE_WINGEDBEAST = 0x200;
export const RACE_PLANT = 0x400;
export const RACE_INSECT = 0x800;
export const RACE_THUNDER = 0x1000;
export const RACE_DRAGON = 0x2000;
export const RACE_BEAST = 0x4000;
export const RACE_BEASTWARRIOR = 0x8000;
export const RACE_DINOSAUR = 0x10000;
export const RACE_FISH = 0x20000;
export const RACE_SEASERPENT = 0x40000;
export const RACE_REPTILE = 0x80000;
export const RACE_PSYCHIC = 0x100000;
export const RACE_DIVINE = 0x200000;
export const RACE_CREATORGOD = 0x400000;
export const RACE_WYRM = 0x800000;
export const RACE_CYBERSE = 0x1000000;
export const RACE_ILLUSION = 0x2000000;

const ATTRIBUTE_NAMES: Readonly<Record<number, string>> = {
  [ATTRIBUTE_EARTH]: 'EARTH',
  [ATTRIBUTE_WATER]: 'WATER',
  [ATTRIBUTE_FIRE]: 'FIRE',
  [ATTRIBUTE_WIND]: 'WIND',
  [ATTRIBUTE_LIGHT]: 'LIGHT',
  [ATTRIBUTE_DARK]: 'DARK',
  [ATTRIBUTE_DIVINE]: 'DIVINE',
};

const RACE_NAMES: Readonly<Record<number, string>> = {
  [RACE_WARRIOR]: 'WARRIOR',
  [RACE_SPELLCASTER]: 'SPELLCASTER',
  [RACE_FAIRY]: 'FAIRY',
  [RACE_FIEND]: 'FIEND',
  [RACE_ZOMBIE]: 'ZOMBIE',
  [RACE_MACHINE]: 'MACHINE',
  [RACE_AQUA]: 'AQUA',
  [RACE_PYRO]: 'PYRO',
  [RACE_ROCK]: 'ROCK',
  [RACE_WINGEDBEAST]: 'WINGED BEAST',
  [RACE_PLANT]: 'PLANT',
  [RACE_INSECT]: 'INSECT',
  [RACE_THUNDER]: 'THUNDER',
  [RACE_DRAGON]: 'DRAGON',
  [RACE_BEAST]: 'BEAST',
  [RACE_BEASTWARRIOR]: 'BEAST-WARRIOR',
  [RACE_DINOSAUR]: 'DINOSAUR',
  [RACE_FISH]: 'FISH',
  [RACE_SEASERPENT]: 'SEA SERPENT',
  [RACE_REPTILE]: 'REPTILE',
  [RACE_PSYCHIC]: 'PSYCHIC',
  [RACE_DIVINE]: 'DIVINE',
  [RACE_CREATORGOD]: 'CREATOR GOD',
  [RACE_WYRM]: 'WYRM',
  [RACE_CYBERSE]: 'CYBERSE',
  [RACE_ILLUSION]: 'ILLUSION',
};

const TYPE_BIT_NAMES: readonly [number, string][] = [
  [TYPE_MONSTER, 'Monster'],
  [TYPE_SPELL, 'Spell'],
  [TYPE_TRAP, 'Trap'],
  [TYPE_NORMAL, 'Normal'],
  [TYPE_EFFECT, 'Effect'],
  [TYPE_FUSION, 'Fusion'],
  [TYPE_RITUAL, 'Ritual'],
  [TYPE_TRAPMONSTER, 'TrapMonster'],
  [TYPE_SPIRIT, 'Spirit'],
  [TYPE_UNION, 'Union'],
  [TYPE_DUAL, 'Dual'],
  [TYPE_TUNER, 'Tuner'],
  [TYPE_SYNCHRO, 'Synchro'],
  [TYPE_TOKEN, 'Token'],
  [TYPE_QUICKPLAY, 'QuickPlay'],
  [TYPE_CONTINUOUS, 'Continuous'],
  [TYPE_EQUIP, 'Equip'],
  [TYPE_FIELD, 'Field'],
  [TYPE_COUNTER, 'Counter'],
  [TYPE_FLIP, 'Flip'],
  [TYPE_TOON, 'Toon'],
  [TYPE_XYZ, 'Xyz'],
  [TYPE_PENDULUM, 'Pendulum'],
  [TYPE_SPSUMMON, 'SpecialSummon'],
  [TYPE_LINK, 'Link'],
];

/** Decode a `datas.type` bitmask into human-readable "|"-joined bit names.
 *  Example: 0x1021 → "Monster|Effect|Tuner". Preserves bit-order for stability. */
export function decodeType(type: number): string {
  const bits: string[] = [];
  for (const [flag, name] of TYPE_BIT_NAMES) if ((type & flag) !== 0) bits.push(name);
  return bits.join('|') || '(none)';
}

/** Decode a `datas.race` value into its human-readable name. Returns `UNKNOWN(0xNN)` for non-canonical values. */
export function decodeRace(race: number): string {
  if (race === 0) return '(none)';
  return RACE_NAMES[race] ?? `UNKNOWN(0x${race.toString(16)})`;
}

/** Decode a `datas.attribute` value. Returns `(none)` for 0 (Spells/Traps). */
export function decodeAttribute(attr: number): string {
  if (attr === 0) return '(none)';
  return ATTRIBUTE_NAMES[attr] ?? `UNKNOWN(0x${attr.toString(16)})`;
}

/** Extra-deck monster summon category. `undefined` for non-extra-deck cards.
 *  Phase D latent interruption computer gates target compatibility via this. */
export type SummonCategory = 'LINK' | 'FUSION' | 'XYZ' | 'SYNCHRO';

export interface CardMetadata {
  cardId: number;
  type: number;
  level: number;
  attribute: number;
  race: number;

  // Derived flags — cached so features don't re-mask.
  isMonster: boolean;
  isSpell: boolean;
  isTrap: boolean;
  isRitualMonster: boolean;
  isRitualSpell: boolean;
  isExtraDeckMonster: boolean;  // Fusion / Synchro / Xyz / Link
  /** Phase D (2026-04-17): specific extra-deck category (undefined for
   *  main-deck cards). Used by the latent interruption computer to match
   *  enablers (e.g. Masquerena → LINK only) with valid targets. */
  summonCategory?: SummonCategory;
  /** Phase D: the card's summon rating — link rating for Link monsters,
   *  rank for Xyz, level for Fusion/Synchro. Matches Masquerena-style
   *  enabler `ratingRange` checks. Zero for non-extra-deck cards.
   *  OCGCore convention: Link rating is stored in the `level` field for
   *  Link monsters (they have no traditional Level); Xyz rank uses the
   *  level field too. */
  rating: number;
}

export type CardMetadataMap = ReadonlyMap<number, CardMetadata>;

interface DatasRow {
  id: number;
  type: number;
  level: number;
  attribute: number;
  race: number;
}

function deriveMetadata(row: DatasRow): CardMetadata {
  const type = row.type >>> 0;
  const isMonster = (type & TYPE_MONSTER) !== 0;
  const isSpell = (type & TYPE_SPELL) !== 0;
  const isTrap = (type & TYPE_TRAP) !== 0;
  const isRitual = (type & TYPE_RITUAL) !== 0;
  const isLink = (type & TYPE_LINK) !== 0;
  const isXyz = (type & TYPE_XYZ) !== 0;
  const isFusion = (type & TYPE_FUSION) !== 0;
  const isSynchro = (type & TYPE_SYNCHRO) !== 0;
  const isExtraDeckMonster = isMonster && (isFusion || isSynchro || isXyz || isLink);
  let summonCategory: SummonCategory | undefined;
  if (isLink) summonCategory = 'LINK';
  else if (isXyz) summonCategory = 'XYZ';
  else if (isFusion) summonCategory = 'FUSION';
  else if (isSynchro) summonCategory = 'SYNCHRO';
  return {
    cardId: row.id,
    type,
    level: row.level ?? 0,
    attribute: row.attribute ?? 0,
    race: row.race ?? 0,
    isMonster,
    isSpell,
    isTrap,
    isRitualMonster: isMonster && isRitual,
    isRitualSpell: isSpell && isRitual,
    isExtraDeckMonster,
    summonCategory,
    rating: isExtraDeckMonster ? (row.level ?? 0) : 0,
  };
}

/**
 * Build a CardMetadataMap for the cards relevant to a duel.
 *
 * @param cardDB - prepared-statement database wrapper
 * @param cardIds - deduplicated cardIds to query (main + extra + hand)
 * @returns Map<cardId, CardMetadata>; unknown cardIds are silently skipped
 */
export function buildCardMetadataMap(cardDB: CardDB, cardIds: Iterable<number>): CardMetadataMap {
  const map = new Map<number, CardMetadata>();
  const seen = new Set<number>();
  for (const cid of cardIds) {
    if (cid === 0 || seen.has(cid)) continue;
    seen.add(cid);
    const row = cardDB.stmt.get(cid) as DatasRow | undefined;
    if (!row) continue;
    map.set(cid, deriveMetadata(row));
  }
  return map;
}

/**
 * Convenience: build metadata from a DuelConfig-shaped input.
 */
export function buildCardMetadataForDuel(
  cardDB: CardDB,
  deck: { mainDeck: number[]; extraDeck: number[]; hand: number[] },
): CardMetadataMap {
  const all: number[] = [];
  all.push(...deck.mainDeck, ...deck.extraDeck, ...deck.hand);
  return buildCardMetadataMap(cardDB, all);
}
