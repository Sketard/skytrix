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

// YGOPro type bitmask constants (subset needed for structural features).
// Source: github.com/Fluorohydride/ygopro-core/blob/master/common.h
export const TYPE_MONSTER = 0x1;
export const TYPE_SPELL = 0x2;
export const TYPE_TRAP = 0x4;
export const TYPE_NORMAL = 0x10;
export const TYPE_EFFECT = 0x20;
export const TYPE_FUSION = 0x40;
export const TYPE_RITUAL = 0x80;
export const TYPE_SPIRIT = 0x200;
export const TYPE_UNION = 0x400;
export const TYPE_DUAL = 0x800;
export const TYPE_TUNER = 0x1000;
export const TYPE_SYNCHRO = 0x2000;
export const TYPE_QUICKPLAY = 0x10000;
export const TYPE_CONTINUOUS = 0x20000;
export const TYPE_EQUIP = 0x40000;
export const TYPE_FIELD = 0x80000;
export const TYPE_COUNTER = 0x100000;
export const TYPE_FLIP = 0x200000;
export const TYPE_TOON = 0x400000;
export const TYPE_XYZ = 0x800000;
export const TYPE_PENDULUM = 0x1000000;
export const TYPE_LINK = 0x4000000;

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
