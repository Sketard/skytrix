export { BaseProjection } from './base-projection';
export { drainStream, type StreamCursor } from './drain-stream';
export type { FluxEvent } from './flux-event';
export type { ResetTarget } from './reset-target';
export { ScopeResetDispatcher } from './scope-reset-dispatcher';
export {
  SCOPE_HIERARCHY,
  expandInvalidatedScopes,
  type ScopeCategory,
} from './scope';
export { OverlayShowReadyProjection } from './overlay-show-ready.projection';
export { CounterPulseProjection, type CounterPulseProjectionDeps } from './counter-pulse.projection';
export {
  AnimatingZoneProjection,
  type AnimatingZoneData,
  type AnimatingZoneProjectionDeps,
} from './animating-zone.projection';
export { IsAnimatingProjection } from './is-animating.projection';
export {
  SwapGraveDeckProjection,
  type SwapGraveDeckProjectionDeps,
} from './swap-grave-deck.projection';
export {
  AnimatingLpProjection,
  type LpAnimData,
} from './animating-lp.projection';
export {
  TargetedZoneKeysProjection,
  type TargetedZoneKeysProjectionDeps,
} from './targeted-zone-keys.projection';
// F15 (2026-05-31) — `ChainResolutionAnnounceProjection` retired ; the
// state is now a single signal owned by `ChainResolutionManager`
// (read sync by `handleSolving`, reactive by templates + Effect D).
