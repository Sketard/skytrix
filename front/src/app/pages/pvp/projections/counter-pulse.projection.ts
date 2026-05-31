// =============================================================================
// counter-pulse.projection.ts — β.3 Lot 2.3 (2026-05-26)
// -----------------------------------------------------------------------------
// Tracks the zone key whose counter badge is currently pulsing
// (`.counter-indicator--pulse` CSS class). Triggered by `MSG_ADD_COUNTER`
// or `MSG_REMOVE_COUNTER`, cleared by the matching `AnimationCompleted`
// (or by `applyReset` on §3.6 checkpoint cascades).
//
// **Scope**: `PERSPECTIVE_LIFETIME`. The pulse is a UI surface that
// resets on perspective switch (SOLO PvP).
//
// **Double-set null→key trick**: when two consecutive counter events fire
// on the SAME zone, Angular signals dedupe by `Object.is`. The projection
// must transiently pass through `null` to force the signal to re-emit so
// the CSS animation restarts. Mirrors the legacy pattern at
// `animation-orchestrator.handleCounter` (the lines that read
// `this.counterPulseKey.set(null); this.counterPulseKey.set(key)`).
// Synchronous within `applyEvent`, so no UI ever observes the transient
// `null` — only the re-emit signal.
//
// **`reducedMotion` short-circuit**: when the user enables reduced motion
// (Preferences toggle OR OS `prefers-reduced-motion`), the orchestrator's
// `handleCounter` returns 0 (no animation, no AnimationCompleted with a
// useful duration). The projection mirrors this by ignoring the event
// entirely under reduced motion — the source is the same `ReducedMotionService`
// via the injected `reducedMotion` callback. This keeps the projection
// pure-from-flux + reduced-motion-aware without re-reading DOM state.
// =============================================================================

import { signal, type Signal } from '@angular/core';

import type { AddCounterMsg, RemoveCounterMsg } from '../duel-ws.types';
import { locationToZoneKey } from '../pvp-zone.utils';

import { BaseProjection } from './base-projection';
import type { FluxEvent } from './flux-event';
import type { ScopeCategory } from './scope';

const COUNTER_MSG_TYPES = new Set(['MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER']);

export interface CounterPulseProjectionDeps {
  /** Maps absolute player index (0|1) → relative (0=viewer, 1=opponent).
   *  Closure over `DuelContext.relativePlayer` so the projection stays
   *  free of @Injectable dependencies and is plain-constructable. */
  relativePlayer: (absolute: number) => 0 | 1;
  /** Reduced-motion gate. Closure over `DuelContext.reducedMotion()`
   *  (which itself reads `ReducedMotionService.enabled`). When `true`,
   *  the projection ignores MSG_ADD/REMOVE_COUNTER events entirely. */
  reducedMotion: () => boolean;
}

export class CounterPulseProjection extends BaseProjection<string | null> {
  override readonly scope: ScopeCategory = 'PERSPECTIVE_LIFETIME';

  private readonly _key = signal<string | null>(null);
  override readonly value: Signal<string | null> = this._key.asReadonly();

  constructor(private readonly deps: CounterPulseProjectionDeps) {
    super();
  }

  override applyEvent(event: FluxEvent): void {
    const candidate = event as { kind?: string; type?: string; msgType?: string };

    // AnimationCompleted on a counter MSG → clear.
    if (candidate.kind === 'animation' && candidate.type === 'AnimationCompleted'
        && candidate.msgType && COUNTER_MSG_TYPES.has(candidate.msgType)) {
      this._key.set(null);
      return;
    }

    // MSG_ADD_COUNTER / MSG_REMOVE_COUNTER → compute key + double-set.
    if (candidate.type === 'MSG_ADD_COUNTER' || candidate.type === 'MSG_REMOVE_COUNTER') {
      if (this.deps.reducedMotion()) return;
      const msg = event as AddCounterMsg | RemoveCounterMsg;
      const rel = this.deps.relativePlayer(msg.player);
      const key = locationToZoneKey(msg.location, msg.sequence, rel);
      // Force re-emit even when the same zone fires twice in a row
      // (Object.is dedup would otherwise swallow the second set).
      this._key.set(null);
      this._key.set(key);
    }
  }

  override applyReset(_invalidatedScopes: ReadonlySet<ScopeCategory>): void {
    this._key.set(null);
  }
}
