import type { CardDB } from './types.js';

const TYPE_XYZ = 0x800000;
const TYPE_LINK = 0x4000000;

/**
 * Pre-computed base values from a single cards.cdb row. All fields are
 * immutable for a given cardCode — none ever change in response to in-game
 * events (current* alteration fields are queried separately via WASM
 * `duelQuery`). Safe to memoize for the lifetime of the active card database.
 */
export interface CachedDbRow {
  rawLevel: number;
  cardType: number;
  isXyz: boolean;
  isLink: boolean;
  baseLevel: number;
  baseRank: number;
  baseAttribute: number;
  baseRace: number;
  baseLScale: number;
  baseRScale: number;
  baseType: number;
}

/**
 * Per-cardCode memoization of cards.cdb row lookups + the bitwise
 * post-processing (type masking, level/rank disambiguation, scale extraction).
 *
 * `buildBoardState` calls this for every face-up field card on every
 * BOARD_STATE — and during chain-resolving replay (see `boardStateAfter`
 * snapshot rule), once per BOARD_CHANGING event. Without memoization a
 * 6-monster board × 8 chain links = 48 redundant SQLite + 48×6 BigInt
 * conversions per chain. The values themselves never change for a given
 * cardCode, so a Map<number, CachedDbRow | null> sized by the active card
 * pool is bounded and cheap.
 *
 * `null` is also memoized — repeated lookups for unknown cardCodes (logged
 * via `dlog.warn`) hit the cache instead of re-querying SQLite.
 *
 * Caller MUST invoke `clear()` when the underlying CardDB is reloaded or
 * closed (`cleanup()` in duel-worker), otherwise stale entries from a prior
 * cards.cdb version could leak across worker pool reuse.
 */
export class CardDbCache {
  private readonly cache = new Map<number, CachedDbRow | null>();

  /**
   * Look up + memoize the base values for `code` against the supplied CardDB.
   * Returns `null` when the row is absent (also memoized).
   *
   * `cardDb` is passed in (not stored) so the cache stays decoupled from
   * the worker's mutable `cardDb` field — callers control reload semantics
   * via `clear()`.
   */
  get(cardDb: CardDB | null, code: number): CachedDbRow | null {
    if (!cardDb || !code) return null;

    const cached = this.cache.get(code);
    if (cached !== undefined) return cached;

    const dbRow = cardDb.stmt.get(code) as Record<string, number | bigint> | undefined;
    if (!dbRow) {
      this.cache.set(code, null);
      return null;
    }

    const rawLevel = Number(dbRow['level']);
    const cardType = Number(dbRow['type']);
    const isXyz = (cardType & TYPE_XYZ) !== 0;
    const isLink = (cardType & TYPE_LINK) !== 0;
    const entry: CachedDbRow = {
      rawLevel,
      cardType,
      isXyz,
      isLink,
      baseLevel: (isXyz || isLink) ? 0 : (rawLevel & 0xFF),
      baseRank: isXyz ? (rawLevel & 0xFF) : 0,
      baseAttribute: Number(dbRow['attribute']),
      baseRace: Number(dbRow['race']),
      baseLScale: (rawLevel >> 16) & 0xFF,
      baseRScale: (rawLevel >> 24) & 0xFF,
      baseType: cardType,
    };
    this.cache.set(code, entry);
    return entry;
  }

  /** Drop all entries. Invoke after CardDB swap / close. */
  clear(): void {
    this.cache.clear();
  }

  /** Test helper — current entry count. */
  size(): number {
    return this.cache.size;
  }
}
