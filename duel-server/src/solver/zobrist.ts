// =============================================================================
// zobrist.ts — Zobrist hashing for game state fingerprinting
// Dual 32-bit hash (no BigInt — V8 perf penalty). Per-worker instance.
//
// Determinism (constraint 3.3): hashes are derived via splitmix32 keyed by the
// (cardId, zoneIdx, posIdx) / zone / phase / turn / count tuple — NOT by a
// per-instance randomBytes stream. This guarantees that every worker across
// every run produces the same zobrist table, so transposition-table hits are
// reproducible across solves with the same (deck, hand, deckSeed).
// =============================================================================

import type { ZoneId, Phase } from '../ws-protocol.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import type { FieldCard, FieldState } from './solver-types.js';

// =============================================================================
// Types
// =============================================================================

export interface ZobristHash {
  hi: number;
  lo: number;
}

// =============================================================================
// Constants
// =============================================================================

// Position-dependent zones: each slot is a distinct location
const POSITION_DEPENDENT_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
]);

// Bag zones: order-independent XOR (fixed position index 0)
const BAG_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  'HAND', 'GY', 'BANISHED',
]);

// EXTRA: bag hash WITH position (face-up vs face-down matters for Pendulum)
// DECK: count-only hash (player doesn't know deck order)

const POSITION_MAP: Record<FieldCard['position'], number> = {
  'faceup-atk': 0,
  'faceup-def': 1,
  'facedown-def': 2,
  'facedown': 3,
};

const ALL_PHASES: readonly Phase[] = [
  'DRAW', 'STANDBY', 'MAIN1', 'BATTLE_START', 'BATTLE_STEP',
  'DAMAGE', 'DAMAGE_CALC', 'BATTLE', 'MAIN2', 'END',
];

const MAX_DECK_COUNT = 60;
const TURN_MODULO = 4;

// =============================================================================
// Helpers
// =============================================================================

/** splitmix32 — deterministic, avalanche-quality integer hash. Same input
 *  always yields the same 32-bit output. Used as the underlying PRF for all
 *  zobrist slots so the table is 100% reproducible across workers and runs. */
function splitmix32(x: number): number {
  x = (x + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Domain-separated hash for a tagged tuple. The `domain` byte ensures that
 *  the zone-base / phase / turn / count / card namespaces do not collide. */
function domainHash(domain: number, a: number, b: number): ZobristHash {
  const base = ((domain & 0xff) << 24) ^ Math.imul(a | 0, 0x85ebca6b) ^ (b | 0);
  return { hi: splitmix32(base * 2), lo: splitmix32(base * 2 + 1) };
}

// Domain tags (arbitrary distinct constants).
const DOMAIN_SEED = 0x01;
const DOMAIN_ZONE = 0x02;
const DOMAIN_PHASE = 0x03;
const DOMAIN_TURN = 0x04;
const DOMAIN_DECK_COUNT = 0x05;
const DOMAIN_CARD = 0x06;

function xorHash(a: ZobristHash, b: ZobristHash): ZobristHash {
  return { hi: (a.hi ^ b.hi) >>> 0, lo: (a.lo ^ b.lo) >>> 0 };
}

// Stable integer index for each ZoneId — used as a component in card hashes
// so that domainHash is keyed by a plain number. Frozen at module init.
const ZONE_INDEX: Record<string, number> = {};
{
  let i = 0;
  for (const z of ALL_ZONE_IDS) ZONE_INDEX[z] = i++;
}

// =============================================================================
// ZobristHasher
// =============================================================================

export class ZobristHasher {
  // Lazy card hash table: cardId -> zoneId -> positionIndex -> hash
  private cardTable = new Map<number, Map<string, Map<number, ZobristHash>>>();

  // Pre-generated zone-base hashes (XOR'd when zone is non-empty)
  private zoneBaseHash: Record<string, ZobristHash>;

  // Phase hashes
  private phaseHash: Record<string, ZobristHash>;

  // Turn modulo hashes
  private turnModHash: ZobristHash[];

  // Deck count hashes (index = count)
  private deckCountHash: ZobristHash[];

  // Non-zero seed for hash initialization
  private seed: ZobristHash;

  constructor() {
    this.seed = domainHash(DOMAIN_SEED, 0, 0);

    // Zone base hashes — keyed by ZONE_INDEX
    this.zoneBaseHash = {} as Record<string, ZobristHash>;
    for (const z of ALL_ZONE_IDS) {
      this.zoneBaseHash[z] = domainHash(DOMAIN_ZONE, ZONE_INDEX[z], 0);
    }

    // Phase hashes — keyed by phase ordinal
    this.phaseHash = {} as Record<string, ZobristHash>;
    for (let i = 0; i < ALL_PHASES.length; i++) {
      this.phaseHash[ALL_PHASES[i]] = domainHash(DOMAIN_PHASE, i, 0);
    }

    // Turn modulo hashes
    this.turnModHash = Array.from({ length: TURN_MODULO }, (_, i) => domainHash(DOMAIN_TURN, i, 0));

    // Deck count hashes
    this.deckCountHash = Array.from({ length: MAX_DECK_COUNT + 1 }, (_, i) => domainHash(DOMAIN_DECK_COUNT, i, 0));
  }

  // ===========================================================================
  // Position Mapping
  // ===========================================================================

  private positionToIndex(position: FieldCard['position']): number {
    return POSITION_MAP[position];
  }

  // ===========================================================================
  // Full Hash Computation
  // ===========================================================================

  computeHash(fieldState: FieldState): ZobristHash {
    let hash = { ...this.seed };

    // Phase
    hash = xorHash(hash, this.phaseHash[fieldState.phase]);

    // Turn modulo 4
    hash = xorHash(hash, this.turnModHash[fieldState.turn % TURN_MODULO]);

    for (const zoneId of ALL_ZONE_IDS) {
      const cards = fieldState.zones[zoneId];

      if (zoneId === 'DECK') {
        // Count-only: hash the deck count, not individual cards
        const count = Math.min(cards.length, MAX_DECK_COUNT);
        hash = xorHash(hash, this.deckCountHash[count]);
        if (cards.length > 0) hash = xorHash(hash, this.zoneBaseHash[zoneId]);
        continue;
      }

      if (cards.length === 0) continue;

      // XOR zone base hash for non-empty zones
      hash = xorHash(hash, this.zoneBaseHash[zoneId]);

      if (POSITION_DEPENDENT_ZONES.has(zoneId)) {
        // Position-dependent: hash each card with zone + position
        for (const card of cards) {
          hash = xorHash(hash, this.getCardHash(card.cardId, zoneId, this.positionToIndex(card.position)));
        }
      } else if (BAG_ZONES.has(zoneId)) {
        // Bag: order-independent XOR with fixed position index 0
        for (const card of cards) {
          hash = xorHash(hash, this.getCardHash(card.cardId, zoneId, 0));
        }
      } else {
        // EXTRA: bag hash WITH position (face-up vs face-down matters)
        for (const card of cards) {
          hash = xorHash(hash, this.getCardHash(card.cardId, zoneId, this.positionToIndex(card.position)));
        }
      }
    }

    return hash;
  }

  // ===========================================================================
  // Incremental Hash API — O(1) XOR per operation
  // ===========================================================================

  /**
   * @param zoneCardCountBefore number of cards in the zone BEFORE this add.
   *        When 0 (zone was empty), zoneBaseHash is toggled in.
   *        DECK zone is not supported — use updateDeckCount() instead.
   */
  addCard(hash: ZobristHash, card: FieldCard, zone: ZoneId, zoneCardCountBefore: number): ZobristHash {
    if (zone === 'DECK') throw new Error('addCard does not support DECK — use updateDeckCount()');
    let h = hash;
    if (zoneCardCountBefore === 0) h = xorHash(h, this.zoneBaseHash[zone]);
    const posIdx = (BAG_ZONES.has(zone)) ? 0 : this.positionToIndex(card.position);
    return xorHash(h, this.getCardHash(card.cardId, zone, posIdx));
  }

  /**
   * @param zoneCardCountAfter number of cards in the zone AFTER this removal.
   *        When 0 (zone now empty), zoneBaseHash is toggled out.
   *        DECK zone is not supported — use updateDeckCount() instead.
   */
  removeCard(hash: ZobristHash, card: FieldCard, zone: ZoneId, zoneCardCountAfter: number): ZobristHash {
    if (zone === 'DECK') throw new Error('removeCard does not support DECK — use updateDeckCount()');
    let h = hash;
    // XOR out card hash (self-inverse)
    const posIdx = (BAG_ZONES.has(zone)) ? 0 : this.positionToIndex(card.position);
    h = xorHash(h, this.getCardHash(card.cardId, zone, posIdx));
    if (zoneCardCountAfter === 0) h = xorHash(h, this.zoneBaseHash[zone]);
    return h;
  }

  updateDeckCount(hash: ZobristHash, oldCount: number, newCount: number): ZobristHash {
    const oldIdx = Math.min(oldCount, MAX_DECK_COUNT);
    const newIdx = Math.min(newCount, MAX_DECK_COUNT);
    let h = xorHash(xorHash(hash, this.deckCountHash[oldIdx]), this.deckCountHash[newIdx]);
    // Toggle zoneBaseHash when DECK transitions empty ↔ non-empty
    if (oldCount === 0 && newCount > 0) h = xorHash(h, this.zoneBaseHash['DECK']);
    if (oldCount > 0 && newCount === 0) h = xorHash(h, this.zoneBaseHash['DECK']);
    return h;
  }

  // ===========================================================================
  // Internal: Lazy Card Hash Generation
  // ===========================================================================

  private getCardHash(cardId: number, zoneId: ZoneId, positionIndex: number): ZobristHash {
    let byZone = this.cardTable.get(cardId);
    if (!byZone) {
      byZone = new Map();
      this.cardTable.set(cardId, byZone);
    }

    let byPos = byZone.get(zoneId);
    if (!byPos) {
      byPos = new Map();
      byZone.set(zoneId, byPos);
    }

    let h = byPos.get(positionIndex);
    if (!h) {
      const zoneIdx = ZONE_INDEX[zoneId] ?? 0;
      const packed = ((cardId | 0) * 64) + (zoneIdx * 4) + (positionIndex & 3);
      h = domainHash(DOMAIN_CARD, packed, cardId | 0);
      byPos.set(positionIndex, h);
    }

    return h;
  }
}

// =============================================================================
// Utility: Hash to string key for Map storage
// =============================================================================

export function hashToKey(hash: ZobristHash): string {
  return `${hash.hi}:${hash.lo}`;
}
