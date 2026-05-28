// =============================================================================
// pre-process-overlays.ts — β.3 cas #12 (Commit 0bis, 2026-05-26)
// -----------------------------------------------------------------------------
// Capture the `overlayMaterials` of every MZONE slot BEFORE each `duelProcess`
// applies the next batch of OCGCore mutations. The snapshot is the only
// source of truth for the materials attached to an XYZ that just left the
// field: post-process, the source MZONE is already empty and an
// OVERLAY_CARD query returns [] (R8 invariant, validated empirically
// 2026-05-26 — see beta-3-case-12-commit-0bis-AUDIT.md §3.0).
//
// Used by both `runDuelLoop` (live PvP, duel-worker.ts) and
// `runReplayPreComputation` (replay-precompute.ts) — same helper, identical
// behaviour on both sides, mirroring the `ChainSnapshotTracker` pattern.
//
// Cost: 2 `duelQueryLocation` calls per duelProcess (one per player) →
// each returns one entry per existing MZONE slot. Estimated total ~50-200 µs.
// =============================================================================

import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import { OcgQueryFlags } from '@n1xx1/ocgcore-wasm';
import { LOCATION } from './ws-protocol.js';

/** Key for the snapshot map: `${controller}-${sequence}`. The card's
 *  controller (not its owner) — Mind Control / turn-switch can flip
 *  controller at any point. */
export type PreProcessOverlayKey = `${0 | 1}-${number}`;

/** Build the `${controller}-${sequence}` key consumed by `transformMove`. */
export function preProcessOverlayKey(controller: 0 | 1, sequence: number): PreProcessOverlayKey {
  return `${controller}-${sequence}`;
}

/**
 * Lookup the overlayMaterials for the source of a MSG_MOVE. Returns
 * `undefined` when the snapshot is absent, the source is not MZONE, or the
 * captured entry is empty. Pure — extracted so transformMove can be slim
 * and the rule is unit-testable without booting the OCGCore worker.
 */
export function readOverlayMaterialsForMove(
  snapshot: Map<PreProcessOverlayKey, number[]> | undefined,
  fromLocation: number,
  controller: 0 | 1,
  sequence: number,
  mzoneLocation: number,
): number[] | undefined {
  if (!snapshot) return undefined;
  if (fromLocation !== mzoneLocation) return undefined;
  const captured = snapshot.get(preProcessOverlayKey(controller, sequence));
  if (!captured || captured.length === 0) return undefined;
  return captured;
}

/** Logger surface used for the graceful-degradation warn — kept narrow so
 *  the helper does not pull the full `DuelLogger` interface. */
export interface PreProcessOverlayLogger {
  warn(msg: string, data?: Record<string, unknown>): void;
}

/**
 * β.3 cas #12 post-review B3 (2026-05-28) — FIFO queue of pending
 * settling sources, derived from the pre-process snapshot at the
 * START of each `duelProcess` batch.
 *
 * Built once per batch from `capturePreProcessOverlays` output, then
 * consumed at each settling event (GRAVE→GRAVE, reason=0x600) inside
 * `transformMove`. The settling event is tagged with the source
 * MZONE seq pulled from the FIFO so the front-side rule can
 * discriminate between two XYZ that share a material's cardCode.
 *
 * Key = cardCode of the material. Value = ordered list of source
 * MZONE seq that had a card with this code in their overlay. Empty
 * list means all sources for this cardCode have been consumed already.
 *
 * Q1 acknowledged limit : the FIFO assumes OCGCore emits settlings
 * in the same order as the snapshot iteration. If reversed, the
 * sourceMzoneSeq is swapped between settlings of the same cardCode.
 * Visually the material animates from the wrong XYZ source zone —
 * less catastrophic than the original pile→pile flash. If observed,
 * an instance-id extension to the wasm binding closes the gap.
 */
export type SettlingSourceFifo = Map<number, number[]>;

/**
 * Build the per-batch FIFO from the pre-process snapshot. Each
 * `(controller, mzoneSeq) → [cardCode₀, cardCode₁, …]` entry of the
 * snapshot becomes `cardCode → [mzoneSeq, …]` entries in the FIFO,
 * appending in iteration order. The FIFO is mutated by
 * `consumeSettlingSource` as settlings are tagged.
 *
 * Snapshot iteration order is map insertion order (controller 0
 * then 1, MZONE seq ascending) — deterministic given the
 * `capturePreProcessOverlays` for-loop nesting.
 *
 * Mass-destruction bilatérale note : two XYZ on DIFFERENT controllers
 * that share a material cardCode produce 2 entries `[seqA, seqB]` in
 * the FIFO. The settling.player field could in principle disambiguate
 * (P0's material settles to P0's GY, P1's to P1's), but the front-side
 * rule chooses NOT to narrow on `player` — see M2 fix : Mind Control
 * makes settling.player = OWNER ≠ controller. So the FIFO is
 * `cardCode`-keyed alone, and the discriminating key is the source seq
 * alone (sufficient because the snapshot captured per `(controller,
 * seq)` so seqs across controllers never collide on a SINGLE MZONE seq
 * — but DO collide in the FIFO if two different XYZ on different sides
 * occupy the same seq number). That's the Q1 acknowledged limit.
 */
export function buildSettlingSourceFifo(
  snapshot: Map<PreProcessOverlayKey, number[]>,
): SettlingSourceFifo {
  const fifo: SettlingSourceFifo = new Map();
  for (const [key, cardCodes] of snapshot) {
    // Key format `${controller}-${sequence}` — extract the seq for the
    // settling tag.
    const dashIdx = key.indexOf('-');
    if (dashIdx < 0) continue;
    const seq = Number(key.slice(dashIdx + 1));
    if (!Number.isFinite(seq)) continue;
    for (const code of cardCodes) {
      const list = fifo.get(code);
      if (list) list.push(seq);
      else fifo.set(code, [seq]);
    }
  }
  return fifo;
}

/**
 * Consume one source for `cardCode` from the FIFO. Returns the head
 * of the list (first remaining source seq) and removes it. Returns
 * `undefined` when the cardCode is unknown or its list is empty —
 * the settling stays untagged (the rule falls back to cardCode-only
 * match, same as pre-B3 behaviour).
 *
 * Pure-ish : mutates the FIFO in place. The mutation IS the consume
 * semantics ; callers MUST share the same FIFO instance across all
 * settlings of one duelProcess batch.
 */
export function consumeSettlingSource(
  fifo: SettlingSourceFifo,
  cardCode: number,
): number | undefined {
  const list = fifo.get(cardCode);
  if (!list || list.length === 0) return undefined;
  return list.shift();
}

/**
 * Capture overlayMaterials for every MZONE slot of both players, just
 * BEFORE `duelProcess` applies the next batch of mutations. Empty slots
 * (no overlay) are omitted so the Map stays small in the common case.
 *
 * Implementation note (D-Audit-3): uses `duelQueryLocation` (one call per
 * player, returns all MZONE slots at once) instead of N unitary `duelQuery`
 * calls. Two queries total — minimal binding chatter.
 *
 * Binding compatibility (cf. solver/ocg-field-query.ts:268): some wasm
 * bindings expose `overlay_cards` (snake_case), others `overlayCards`
 * (camelCase). Both are read defensively.
 *
 * Error handling (audit Option A): one try/catch wraps the whole capture
 * so a transient binding error returns a partial (possibly empty) Map
 * with a logger warn instead of crashing the worker. The worst-case
 * fallout is one XYZ rendered without its materials' float animation —
 * an acceptable degradation vs a worker crash.
 */
export function capturePreProcessOverlays(
  core: OcgCoreSync,
  duel: OcgDuelHandle,
  logger?: PreProcessOverlayLogger,
): Map<PreProcessOverlayKey, number[]> {
  const snapshot = new Map<PreProcessOverlayKey, number[]>();
  try {
    for (const player of [0, 1] as const) {
      const cards = core.duelQueryLocation(duel, {
        flags: OcgQueryFlags.OVERLAY_CARD as number,
        controller: player,
        location: LOCATION.MZONE as number,
      } as never);
      // H7 post-review (2026-05-28) — defence in depth against a future
      // binding change. The capture assumes `cards` is sparse and indexed
      // by MZONE seq. MR5 = 5 monster + 2 EMZ = 7 slots. A short non-empty
      // array (binding pivoted to dense) would silently skip slots and
      // stale the snapshot for the missing seqs. Bound to 5/7 only —
      // anything else (1..4 or 6 or 8+) triggers the warn so DevHub
      // surfaces it. Length-0 is left silent — empty arrays are a valid
      // "no slot data" signal that callers may legitimately pass
      // (test fixtures, defensive degradation). Empirical check covered
      // by `pre-process-overlays-wasm.spec.ts`.
      if (cards.length !== 0 && cards.length !== 7 && cards.length !== 5) {
        logger?.warn('[pre-process-overlays] unexpected MZONE cards.length', {
          player, length: cards.length, expected: '5 (pre-MR5) or 7 (MR5)',
        });
      }
      for (let seq = 0; seq < cards.length; seq++) {
        const entry = cards[seq] as
          | { overlay_cards?: unknown; overlayCards?: unknown }
          | null;
        if (!entry) continue;
        const raw = entry.overlay_cards ?? entry.overlayCards;
        if (!Array.isArray(raw) || raw.length === 0) continue;
        const codes: number[] = [];
        for (const c of raw) {
          if (typeof c === 'number') codes.push(c);
          else if (typeof c === 'bigint') codes.push(Number(c));
        }
        if (codes.length > 0) {
          snapshot.set(preProcessOverlayKey(player, seq), codes);
        }
      }
    }
  } catch (err) {
    logger?.warn('[pre-process-overlays] capture threw, snapshot partial', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return snapshot;
}
