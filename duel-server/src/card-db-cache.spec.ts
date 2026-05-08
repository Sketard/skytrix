import { describe, it, expect, vi } from 'vitest';
import { CardDbCache } from './card-db-cache.js';
import type { CardDB } from './types.js';

const TYPE_XYZ = 0x800000;
const TYPE_LINK = 0x4000000;
const TYPE_NORMAL = 0x1;

/**
 * Build a minimal CardDB stub whose `stmt.get(code)` returns the supplied
 * row table. Other CardDB fields are irrelevant — the cache only touches
 * `cardDb.stmt.get`.
 */
function makeCardDb(rows: Record<number, Record<string, number | bigint> | undefined>): CardDB {
  const stmt = {
    get: vi.fn((code: number) => rows[code]),
  };
  return {
    db: {} as CardDB['db'],
    stmt: stmt as unknown as CardDB['stmt'],
    nameStmt: {} as CardDB['nameStmt'],
    descStmt: {} as CardDB['descStmt'],
  };
}

describe('CardDbCache', () => {
  describe('get — cache miss', () => {
    it('queries cardDb.stmt.get on first lookup and returns the parsed row', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        12345: { level: 7, type: TYPE_NORMAL, attribute: 4, race: 8 },
      });
      const row = cache.get(cardDb, 12345);
      expect(row).not.toBeNull();
      expect(row!.baseLevel).toBe(7);
      expect(row!.baseAttribute).toBe(4);
      expect(row!.baseRace).toBe(8);
      expect(row!.baseType).toBe(TYPE_NORMAL);
      expect(row!.isXyz).toBe(false);
      expect(row!.isLink).toBe(false);
    });

    it('memoizes "not found" (returns null) and does not re-query', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({});
      expect(cache.get(cardDb, 9999)).toBeNull();
      expect(cache.get(cardDb, 9999)).toBeNull();
      expect(cardDb.stmt.get).toHaveBeenCalledTimes(1);
    });

    it('returns null without querying when cardDb is null', () => {
      const cache = new CardDbCache();
      expect(cache.get(null, 12345)).toBeNull();
    });

    it('returns null without querying when code is 0 (sentinel for "no card")', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({});
      expect(cache.get(cardDb, 0)).toBeNull();
      expect(cardDb.stmt.get).not.toHaveBeenCalled();
    });
  });

  describe('get — cache hit', () => {
    it('does not re-query SQLite on a second lookup', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        100: { level: 4, type: TYPE_NORMAL, attribute: 1, race: 2 },
      });
      cache.get(cardDb, 100);
      cache.get(cardDb, 100);
      cache.get(cardDb, 100);
      expect(cardDb.stmt.get).toHaveBeenCalledTimes(1);
    });

    it('returns the same parsed object on subsequent hits (referential equality)', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        100: { level: 4, type: TYPE_NORMAL, attribute: 1, race: 2 },
      });
      const a = cache.get(cardDb, 100);
      const b = cache.get(cardDb, 100);
      expect(a).toBe(b);
    });
  });

  describe('Xyz handling', () => {
    it('extracts baseRank (not baseLevel) for Xyz monsters', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        200: { level: 4, type: TYPE_XYZ, attribute: 1, race: 2 },
      });
      const row = cache.get(cardDb, 200)!;
      expect(row.isXyz).toBe(true);
      expect(row.baseRank).toBe(4);
      expect(row.baseLevel).toBe(0);
    });
  });

  describe('Link handling', () => {
    it('forces baseLevel and baseRank to 0 for Link monsters', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        300: { level: 3, type: TYPE_LINK, attribute: 1, race: 2 },
      });
      const row = cache.get(cardDb, 300)!;
      expect(row.isLink).toBe(true);
      expect(row.baseLevel).toBe(0);
      expect(row.baseRank).toBe(0);
    });
  });

  describe('Pendulum scale extraction', () => {
    it('reads left scale from bits 16-23 and right scale from bits 24-31', () => {
      const cache = new CardDbCache();
      // level field = rawLevel(0xFF) | (lscale << 16) | (rscale << 24)
      // here: lscale=5, rscale=8, level=4
      const packedLevel = (8 << 24) | (5 << 16) | 4;
      const cardDb = makeCardDb({
        400: { level: packedLevel, type: TYPE_NORMAL, attribute: 1, race: 2 },
      });
      const row = cache.get(cardDb, 400)!;
      expect(row.baseLevel).toBe(4);
      expect(row.baseLScale).toBe(5);
      expect(row.baseRScale).toBe(8);
    });
  });

  describe('BigInt conversion', () => {
    it('converts BigInt fields to Number transparently', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        500: { level: BigInt(6), type: BigInt(TYPE_NORMAL), attribute: BigInt(7), race: BigInt(11) },
      });
      const row = cache.get(cardDb, 500)!;
      expect(row.baseLevel).toBe(6);
      expect(row.baseAttribute).toBe(7);
      expect(row.baseRace).toBe(11);
      expect(typeof row.baseLevel).toBe('number');
      expect(typeof row.baseType).toBe('number');
    });
  });

  describe('clear', () => {
    it('drops all entries and forces re-query on next lookup', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        100: { level: 4, type: TYPE_NORMAL, attribute: 1, race: 2 },
      });
      cache.get(cardDb, 100);
      cache.clear();
      expect(cache.size()).toBe(0);
      cache.get(cardDb, 100);
      expect(cardDb.stmt.get).toHaveBeenCalledTimes(2);
    });

    it('drops memoized null entries too', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({});
      cache.get(cardDb, 9999); // memoize null
      expect(cache.size()).toBe(1);
      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe('size', () => {
    it('reports current entry count (including null entries)', () => {
      const cache = new CardDbCache();
      const cardDb = makeCardDb({
        1: { level: 1, type: TYPE_NORMAL, attribute: 1, race: 1 },
        2: { level: 2, type: TYPE_NORMAL, attribute: 2, race: 2 },
      });
      expect(cache.size()).toBe(0);
      cache.get(cardDb, 1);
      expect(cache.size()).toBe(1);
      cache.get(cardDb, 2);
      expect(cache.size()).toBe(2);
      cache.get(cardDb, 9999); // miss → memoized null
      expect(cache.size()).toBe(3);
    });
  });
});
