// =============================================================================
// overlay-show-ready.projection.ts — β.3 Lot 1b (2026-05-26)
// -----------------------------------------------------------------------------
// First production `BaseProjection<T>` consumer of the DEP flux. Tracks the
// set of `chainId`s for which the chain overlay is allowed to appear —
// gated on `EffectReady('overlay-show:chain-<N>')` (or
// `EffectAbandoned(...)` as graceful-degradation fallback). The
// `pvp-chain-overlay.component` consults this projection in its
// `onNewChainLink` handler to decide whether to set `overlayVisible=true`
// immediately or defer the set until the projection notifies readiness.
//
// **What this fixes** (the cost-before-overlay test of victory):
// pre-β.3, `onNewChainLink` set `overlayVisible=true` synchronously on
// every MSG_CHAINING with link ≥ 2 — the overlay popped the SAME frame
// the WS message arrived, while the cost MSG_MOVE was still mid-travel.
// β.3 routes that visibility through this projection: the overlay only
// pops AFTER the DEP emits `EffectReady('overlay-show:chain-<N>')`,
// which by the rule definition only fires once the cost MSG_MOVE's
// `AnimationCompleted` lands on the stream (wall-clock end of travel).
//
// **Lifecycle**:
//   · `EffectReady('overlay-show:chain-<N>')` → add N to the set.
//   · `EffectAbandoned('overlay-show:chain-<N>')` → also add N to the
//     set (graceful degradation: a timeout / checkpoint means "stop
//     waiting, just show it"; better than a never-showing overlay).
//   · `ChainEnded(chainId)` (boundary) → remove chainId from the set
//     (the overlay's `onChainEnd` handler will hide it anyway, but
//     clearing here keeps the set bounded across long sessions).
//   · `applyReset({CONNECTION_LIFETIME})` (STATE_SYNC / RematchStarted)
//     → clear the set (every pending overlay is discarded with its DEP).
//
// **Scope**: `PERSPECTIVE_LIFETIME`. The overlay is a UI surface and
// resets on perspective switch (SOLO PvP) — the new perspective starts
// from a clean slate; any in-flight overlay-show deferred is already
// reset by the chain-overlay component's own reset path.
// =============================================================================

import { signal, type Signal } from '@angular/core';

import type { FluxEvent } from './flux-event';
import { BaseProjection } from './base-projection';
import type { CheckpointPayload } from './checkpoint-payload';
import type { ScopeCategory } from './scope';

/** Prefix matched on `name` for the overlay-show family of deferreds.
 *  Matches the rule's `deriveName` output in `deferred-effect-rules.ts`
 *  (`overlay-show:chain-<chainIndex>`). Kept private — consumers read
 *  the projection's `value` signal, not the parse logic. */
const OVERLAY_SHOW_NAME_PREFIX = 'overlay-show:chain-';

/** Parse a deferred event's `name` field; returns the chainId if the
 *  name matches the overlay-show family, `null` otherwise. */
function parseOverlayShowChainId(name: string): number | null {
  if (!name.startsWith(OVERLAY_SHOW_NAME_PREFIX)) return null;
  const idStr = name.slice(OVERLAY_SHOW_NAME_PREFIX.length);
  const id = Number(idStr);
  return Number.isFinite(id) ? id : null;
}

export class OverlayShowReadyProjection extends BaseProjection<ReadonlySet<number>> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _ready = signal<ReadonlySet<number>>(new Set());
  override readonly value: Signal<ReadonlySet<number>> = this._ready.asReadonly();

  override applyEvent(event: FluxEvent): void {
    // Narrow on `kind` — boundary events (kind: 'boundary') feed the
    // ChainEnded removal path; deferred events (kind: 'deferred') feed
    // the ready / abandon add paths. MSG_* events are ignored — the
    // projection is fully derived from the DEP + BP families.
    const candidate = event as { kind?: string; type?: string; name?: string; chainId?: number };
    if (candidate.kind === 'deferred') {
      if (candidate.type !== 'EffectReady' && candidate.type !== 'EffectAbandoned') return;
      if (!candidate.name) return;
      const chainId = parseOverlayShowChainId(candidate.name);
      if (chainId === null) return;
      this._ready.update(set => {
        if (set.has(chainId)) return set;
        const next = new Set(set);
        next.add(chainId);
        return next;
      });
      return;
    }
    if (candidate.kind === 'boundary' && candidate.type === 'ChainEnded') {
      const chainId = candidate.chainId;
      if (chainId === undefined) return;
      this._ready.update(set => {
        if (!set.has(chainId)) return set;
        const next = new Set(set);
        next.delete(chainId);
        return next;
      });
    }
  }

  override applyReset(
    _invalidatedScopes: ReadonlySet<ScopeCategory>,
    _checkpointPayload?: CheckpointPayload,
  ): void {
    // The dispatcher already filters by scope before calling — we don't
    // need to re-check `invalidatedScopes.has('PERSPECTIVE_LIFETIME')`.
    // Always reset to the empty set, regardless of reset source.
    this._ready.set(new Set());
  }

  /** Test-only: convenience to assert "chainId N is ready". Templates
   *  read `value().has(N)` directly. */
  isReady(chainId: number): boolean {
    return this._ready().has(chainId);
  }
}
