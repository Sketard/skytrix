import type { StreamEvent } from '../types';

/**
 * The flux event union consumed by every {@link BaseProjection}.
 *
 * At α.2 this is an alias of {@link StreamEvent} (the existing palier-0
 * surface — `GameEvent | ChainNegatedMsg | WinMsg | SelectCardMsg`). The
 * alias decouples future projections from the legacy name and lets the
 * union grow as new families are introduced:
 *
 *   · α.3 — {@link InternalTransportEvent} family (`AnimationStarted`,
 *     `AnimationCompleted`, `TimerArmed`, `TimerFired`, `TimerCancelled`)
 *   · β.1 — Boundary family (`ChainStarted/Ended`, `TurnStarted/Ended`,
 *     `PhaseStarted/Ended`)
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
