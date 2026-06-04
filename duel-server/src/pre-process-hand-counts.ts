import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import { OcgQueryFlags } from '@n1xx1/ocgcore-wasm';
import { LOCATION } from './ws-protocol.js';
import type { DuelLogger } from './logger.js';

/**
 * Per-player snapshot of hand-card-code counts, captured BEFORE `duelProcess`
 * applies the next batch of mutations. Mirrors `capturePreProcessOverlays`:
 * needed because a single `duelProcess` call can emit `MSG_CHAINING` AND the
 * cost-discard `MSG_MOVE` in the same batch — by the time the transform
 * pipeline reaches `MSG_CHAINING`, querying the live OCGCore would already
 * report the post-discard hand (one copy fewer).
 *
 * Consumer: `transformMessage(MSG_CHAINING)` reads
 * `counts[player.controller].get(cardCode)` to populate
 * `ChainingMsg.handCopiesAtChaining`. The client uses that count in
 * `chain-badge.utils.ts:findCurrentIndex` to refuse misrouting the badge to
 * a second copy when the activated card is no longer in hand.
 *
 * Returned shape: `[player0Counts, player1Counts]` where each entry is a
 * `Map<cardCode, count>` of every card-code currently in that player's HAND.
 * Empty / missing cards skipped (we only count valid `code` entries).
 *
 * F9-bis hand-discard fix (2026-06-04). Pre-fix, the front-side resolver
 * `findCurrentIndex` matched chain links to hand positions by cardCode +
 * sequence proximity, with no way to detect that the activated card had
 * been discarded — so the badge migrated to the second copy. With this
 * counter, the resolver can tell "expected 2 copies, see 1 → one is gone,
 * refuse the badge" without needing to scan the MSG_MOVE history.
 */
export type HandCountSnapshot = ReadonlyArray<ReadonlyMap<number, number>>;

export interface HandCountsLogger {
  warn(msg: string, data?: Record<string, unknown>): void;
}

export function capturePreProcessHandCounts(
  core: OcgCoreSync,
  duel: OcgDuelHandle,
  logger?: HandCountsLogger | DuelLogger,
): HandCountSnapshot {
  const FLAG_CODE = OcgQueryFlags.CODE as number;
  const snapshot: Map<number, number>[] = [new Map(), new Map()];
  try {
    for (const player of [0, 1] as const) {
      const cards = core.duelQueryLocation(duel, {
        flags: FLAG_CODE,
        controller: player,
        location: LOCATION.HAND as number,
      } as never);
      for (const card of cards) {
        // Defensive: the binding may return null/undefined entries for empty
        // slots — skip them. We also skip entries without a `code` since
        // anything we can't identify can't drive the handCopies counter.
        if (!card) continue;
        const code = (card as { code?: number }).code;
        if (typeof code !== 'number' || code <= 0) continue;
        snapshot[player].set(code, (snapshot[player].get(code) ?? 0) + 1);
      }
    }
  } catch (err) {
    // Mirror capturePreProcessOverlays' degradation strategy: log + return
    // a partial / empty snapshot instead of crashing the worker. Worst-case
    // fallout is one MSG_CHAINING shipped without handCopiesAtChaining —
    // the front falls back to its pre-fix behavior (potentially misroutes
    // a single badge), strictly bounded.
    logger?.warn('[pre-process-hand-counts] capture failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return snapshot;
}
