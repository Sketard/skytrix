import type { StreamEvent } from '../types';

/**
 * The flux event union consumed by every {@link BaseProjection}.
 *
 * Alias of {@link StreamEvent} (the palier-0 surface), decoupling
 * future projections from the legacy name as the union grows family
 * by family:
 *
 *   · Palier 0 (shipped) — `GameEvent | ChainNegatedMsg | WinMsg | SelectCardMsg`
 *   · β.1 (shipped) — Boundary family (`ChainStarted/Ended`,
 *     `TurnStarted/Ended`, `PhaseStarted/Ended`) added via `StreamEvent`
 *     itself; consumers discriminate via `kind: 'boundary'`.
 *   · α.3 (sink-only, not in union) — {@link InternalTransportEvent}
 *     family (`runner-started/stopped/etc.`). Reaches an optional
 *     `onInternalEvent` callback on the runner but is not (yet) merged
 *     into `FluxEvent`. β.x will decide whether to absorb it.
 *   · β.2 — Deferred family (`DeferredEffect`, `EffectReady`,
 *     `EffectAbandoned`)
 *
 * Adding a member to the union is a deliberate act: every existing
 * projection's `applyEvent` switch must keep exhaustiveness (TS catches
 * the missing branch at compile time when the projection has a default
 * `never` arm).
 *
 * Cf. `_bmad-output/planning-artifacts/duel-session-chantier.md §3.3`.
 */
export type FluxEvent = StreamEvent;
