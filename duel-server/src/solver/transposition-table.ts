// =============================================================================
// transposition-table.ts — Transposition table with verification key
// Per-solve lifecycle: reset() at start of each solve. DFS-only usage.
// =============================================================================

import { ALL_ZONE_IDS } from './solver-types.js';
import type {
  ActivationLog,
  Action,
  FieldCard,
  FieldState,
  ScoreBreakdown,
} from './solver-types.js';
import type { ZobristHash } from './zobrist.js';
import { hashToKey } from './zobrist.js';

// =============================================================================
// Types
// =============================================================================

export interface TranspositionEntry {
  hash: ZobristHash;
  depth: number;
  score: number;
  bestAction: Action;
  verificationKey: string;
  scoreBreakdown: ScoreBreakdown;
}

export interface TranspositionStats {
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
  staleHits: number;
}

// =============================================================================
// TranspositionTable
// =============================================================================

export class TranspositionTable {
  private table: Map<string, TranspositionEntry>;
  private maxEntries: number;

  // Stats counters
  private _hits = 0;
  private _misses = 0;
  private _stores = 0;
  private _evictions = 0;
  private _staleHits = 0;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
    this.table = new Map();
  }

  // ===========================================================================
  // Core API
  // ===========================================================================

  reset(): void {
    // New Map (not .clear()) to avoid stale reference leaks
    this.table = new Map();
    this._hits = 0;
    this._misses = 0;
    this._stores = 0;
    this._evictions = 0;
    this._staleHits = 0;
  }

  lookup(hash: ZobristHash, verificationKey: string, currentDepth: number): TranspositionEntry | null {
    const key = hashToKey(hash);
    const entry = this.table.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    if (entry.verificationKey !== verificationKey) {
      this._misses++;
      return null;
    }

    if (entry.depth < currentDepth) {
      this._misses++;
      return null;
    }

    this._hits++;
    return entry;
  }

  /**
   * Mark a hit as stale (bestAction not in current legal actions).
   * Called by the DFS solver after lookup when stale action is detected.
   */
  recordStaleHit(): void {
    // Undo the hit counted in lookup, count as staleHit instead
    if (this._hits > 0) this._hits--;
    this._staleHits++;
  }

  store(hash: ZobristHash, depth: number, score: number, bestAction: Action, verificationKey: string, scoreBreakdown: ScoreBreakdown): void {
    const key = hashToKey(hash);
    const existing = this.table.get(key);

    if (existing) {
      // Replace only if new depth >= existing
      if (depth >= existing.depth) {
        this.table.set(key, { hash, depth, score, bestAction, verificationKey, scoreBreakdown });
        this._stores++;
      }
      return;
    }

    // New key: skip insert if table is full (O(1) — no linear scan)
    if (this.table.size >= this.maxEntries) {
      this._evictions++;
      return;
    }

    this.table.set(key, { hash, depth, score, bestAction, verificationKey, scoreBreakdown });
    this._stores++;
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  getStats(): TranspositionStats {
    return {
      hits: this._hits,
      misses: this._misses,
      stores: this._stores,
      evictions: this._evictions,
      staleHits: this._staleHits,
    };
  }

  get size(): number {
    return this.table.size;
  }
}

// =============================================================================
// Verification Key Builder
// =============================================================================

/**
 * Build a deterministic verification key fingerprint for a FieldState.
 * Iterates zones in fixed order via ALL_ZONE_IDS (NOT Object.keys()).
 * Per zone: card count + sorted card IDs + per-card overlayCount + per-card position.
 *
 * Story 1.8: when an activation log is supplied, an `opt:` segment is appended
 * encoding `cardId=indices;...` for each tagged card that has consumed at least
 * one effect. Sorted by cardId ascending and indices within each entry sorted
 * ascending for determinism. Two states with identical board layout but
 * different OPT consumption produce different keys, so the transposition table
 * cannot reuse a stale score across OPT-divergent states.
 *
 * The `activationLog` argument is optional for backward compatibility — when
 * omitted (or empty), the `opt:` segment is appended as `opt:` (empty payload).
 * This ensures keys generated by legacy callers remain stable in shape but do
 * not collide with keys generated with an active log.
 */
export function buildVerificationKey(
  fieldState: FieldState,
  activationLog?: ActivationLog,
): string {
  const parts: string[] = [];

  for (const zoneId of ALL_ZONE_IDS) {
    const cards = fieldState.zones[zoneId];
    const count = cards.length;

    if (count === 0) {
      parts.push(`${zoneId}:0`);
      continue;
    }

    // DECK: count-only fingerprint (matches Zobrist count-only hashing strategy)
    if (zoneId === 'DECK') {
      parts.push(`DECK:${count}`);
      continue;
    }

    // Sort cards by cardId for determinism, then by position for ties
    const sorted = [...cards].sort(cardSortComparator);

    const ids = sorted.map(c => c.cardId).join(',');
    const overlays = sorted.map(c => c.overlayCount).join(',');
    const positions = sorted.map(c => c.position).join(',');

    parts.push(`${zoneId}:${count}|${ids}|${overlays}|${positions}`);
  }

  parts.push(buildOptSegment(activationLog));

  return parts.join(';');
}

function buildOptSegment(activationLog?: ActivationLog): string {
  if (!activationLog || activationLog.size === 0) return 'opt:';
  // Filter out cards with empty arrays (defensive — shouldn't happen but the
  // type allows it). Sort cardIds ascending for determinism.
  const entries: { cardId: number; indices: readonly number[] }[] = [];
  for (const [cardId, indices] of activationLog) {
    if (indices.length === 0) continue;
    entries.push({ cardId, indices });
  }
  if (entries.length === 0) return 'opt:';
  entries.sort((a, b) => a.cardId - b.cardId);
  const parts = entries.map(e => {
    const sortedIndices = [...e.indices].sort((a, b) => a - b);
    return `${e.cardId}=${sortedIndices.join(',')}`;
  });
  return `opt:${parts.join(';')}`;
}

function cardSortComparator(a: FieldCard, b: FieldCard): number {
  if (a.cardId !== b.cardId) return a.cardId - b.cardId;
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.overlayCount - b.overlayCount;
}
