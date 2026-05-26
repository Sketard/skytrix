/**
 * β.1 — boundary events emitted by `BoundaryProcessor` (cf.
 * `_bmad-output/planning-artifacts/duel-session-chantier.md §3.8`).
 *
 * Boundaries are explicit markers in the stream that delimit a causal
 * group: a chain resolution, a turn, a phase. Projections that read the
 * stream use them to know "where I am in the duel's causality" without
 * having to infer it from individual MSG_* events.
 *
 * Three pairs, all `flat` per the OCGCore structural guarantee — chains
 * never nest, turns never overlap, phases are strictly sequential:
 *
 *   - `ChainStarted(id)` / `ChainEnded(id)` — encadrent les events
 *     d'une même chain YGO. Detected from `MSG_CHAINING` (open) +
 *     `MSG_CHAIN_END` (close).
 *   - `TurnStarted(turnNumber, playerIndex)` / `TurnEnded(turnNumber)`
 *     — detected from BOARD_STATE `turnCount` / `turnPlayer` delta.
 *   - `PhaseStarted(phase)` / `PhaseEnded(phase)` — detected from
 *     BOARD_STATE `phase` delta.
 *
 * Discriminator: every boundary carries `kind: 'boundary'` so the
 * widened `StreamEvent` union can route them past `MSG_*` consumers.
 * `type` then identifies the specific boundary.
 */

import type { Phase, Player } from '../duel-ws.types';

export interface ChainStartedEvent {
  kind: 'boundary';
  type: 'ChainStarted';
  chainId: number;
}

export interface ChainEndedEvent {
  kind: 'boundary';
  type: 'ChainEnded';
  chainId: number;
}

export interface TurnStartedEvent {
  kind: 'boundary';
  type: 'TurnStarted';
  turnNumber: number;
  player: Player;
}

export interface TurnEndedEvent {
  kind: 'boundary';
  type: 'TurnEnded';
  turnNumber: number;
}

export interface PhaseStartedEvent {
  kind: 'boundary';
  type: 'PhaseStarted';
  phase: Phase;
}

export interface PhaseEndedEvent {
  kind: 'boundary';
  type: 'PhaseEnded';
  phase: Phase;
}

export type BoundaryEvent =
  | ChainStartedEvent
  | ChainEndedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | PhaseStartedEvent
  | PhaseEndedEvent;

/** Guard: discriminate a `BoundaryEvent` from any `StreamEvent` member.
 *  Accepts `unknown` because most `StreamEvent` members (the MSG_*
 *  family) do not declare a `kind` property at the type level — TS
 *  would otherwise refuse the call on a union that doesn't share the
 *  guard's parameter shape. */
export function isBoundaryEvent(e: unknown): e is BoundaryEvent {
  return typeof e === 'object' && e !== null
    && (e as { kind?: unknown }).kind === 'boundary';
}
