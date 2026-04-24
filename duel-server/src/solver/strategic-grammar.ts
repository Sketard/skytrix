// =============================================================================
// strategic-grammar.ts — Strategic Grammar v1
// Role/route/goal ontology consumed by per-archetype ArchetypeExpertise files
// under data/archetype-expertise/. Designed to complement (not replace) the
// atomic interruption-tags.json layer.
// =============================================================================

import type { InterruptionType } from './solver-types.js';

export type ArchetypeId = string;

// -----------------------------------------------------------------------------
// Card role taxonomy — transverse to all archetypes
// -----------------------------------------------------------------------------

export const CARD_ROLES = [
  'starter',      // opens the combo (NS/activation kicks off the line)
  'extender',     // expands an ongoing play (triggers off other summons)
  'tutor',        // deck/GY → hand/field
  'recursion',    // GY/banished → hand/field (resource recycling)
  'material',     // consumed as summon fodder, no independent value
  'finisher',     // terminal summon in a combo line
  'interruption', // endboard disruption piece (on-field interruption)
  'enabler',      // unlocks a specific mechanic (ritual spell, field spell)
  'recycler',     // shuffles/recycles spent resources
  'floodgate',    // continuous permanent lock
] as const;
export type CardRole = typeof CARD_ROLES[number];

// -----------------------------------------------------------------------------
// Locations & selectors
// -----------------------------------------------------------------------------

export const LOCATIONS = ['hand', 'field', 'gy', 'banished', 'deck', 'extra'] as const;
export type Location = typeof LOCATIONS[number];

export type CardSelector =
  | { kind: 'specific'; cardId: number }
  | { kind: 'role'; role: CardRole }
  | { kind: 'anyOf'; cardIds: readonly number[] };

// -----------------------------------------------------------------------------
// Endboard pattern — goals
// -----------------------------------------------------------------------------

export const ZONE_KINDS = [
  'monster', 'spellTrap', 'field', 'extraMonster',
  // Lever 2 (2026-04-21): non-field pile zones for progress-state goals.
  // A ritual spell in `gy` means it was activated; a Mikoto Reptile in `gy`
  // means the tutor chain fired; Albion in `gy` means it was milled. These
  // are legitimate combo-progress signals — same vocabulary a player uses
  // to describe their combo's internal state. `position` is ignored for
  // these zones (piles don't have meaningful positions for scoring).
  'gy', 'hand', 'banished', 'deck',
] as const;
export type ZoneKind = typeof ZONE_KINDS[number];

export type CardPosition = 'faceup-atk' | 'faceup-def' | 'facedown';

export interface CardSlot {
  zone: ZoneKind;
  card: CardSelector;
  position?: CardPosition;
  note?: string;
}

export interface InterruptionCoverage {
  counts: Partial<Record<InterruptionType, number>>;
  attackProtect?: boolean;
}

export interface ComboGoal {
  id: string;
  name: string;
  description: string;
  required: readonly CardSlot[];
  optional?: readonly CardSlot[];
  coverage: InterruptionCoverage;
  baselineScore: number;
  // Phase B (2026-04-21): waypoint-to-apex edges via named bridges.
  // Unset = terminal apex.
  successors?: readonly GoalSuccessor[];
}

// -----------------------------------------------------------------------------
// Combo route — abstract action sequence leading to a goal
// -----------------------------------------------------------------------------

export const ABSTRACT_ACTIONS = [
  'activate',
  'normalSummon',
  'specialSummon',
  'ritualSummon',
  'fusionSummon',
  'xyzSummon',
  'synchroSummon',
  'linkSummon',
  'search',
  'tribute',
  'discard',
  'set',
] as const;
export type AbstractAction = typeof ABSTRACT_ACTIONS[number];

export interface RouteStep {
  action: AbstractAction;
  subject: CardSelector;
  target?: CardSelector;
  note?: string;
}

export interface StartCondition {
  selector: CardSelector;
  location: Location;
  minCount: number;
}

export interface ComboRoute {
  id: string;
  name: string;
  starts: readonly StartCondition[];
  steps: readonly RouteStep[];
  goalId: string;
}

// -----------------------------------------------------------------------------
// Bridge subroute (Phase B 2026-04-21) — named action chain that transitions
// a waypoint goal into an apex goal. Referenced by ComboGoal.successors.
// -----------------------------------------------------------------------------

export interface BridgeSubroute {
  id: string;
  name: string;
  description: string;
  // Card IDs that must be present in the decklist (main + ED) for the bridge
  // to be executable. Static decklist check at load time.
  requiresDeckPieces: readonly number[];
  // What the bridge produces. Combined with the waypoint's `required`, this
  // must cover the apex's `required` for the apex to be reachable.
  produces: readonly CardSlot[];
  steps: readonly RouteStep[];
  // Phase 3 (2026-04-24): optional declarative prior state. Consumed by
  // bridge-validator to place cards directly into non-deck zones before
  // the duel starts. Used for compositional bridges whose preconditions
  // aren't the output of another catalogued bridge (e.g., Flamberge in GY,
  // 2 Lv4 monsters on field). Cards here are NOT drawn from deck — they're
  // synthesized into the target zone. Complementary to `precursors`.
  requiresInitialState?: readonly CardSlot[];
  // Phase 3 (2026-04-24): optional bridge composition. List of bridge IDs
  // to execute first (in order) inside the same duel. The validator runs
  // each precursor's steps before this bridge's, so this bridge starts
  // from the precursors' cumulative output state. Example: cupsy-way
  // depends on snake-eye-ash-1card-ignition's output (Ash + Poplar on
  // field) as its starting state.
  precursors?: readonly string[];
}

export interface GoalSuccessor {
  // Apex goal id — resolved globally across all ArchetypeExpertise files.
  to: string;
  // Bridge subroute id — resolved globally across all ArchetypeExpertise files.
  viaBridge: string;
  note?: string;
}

// -----------------------------------------------------------------------------
// Synergy hint (optional cross-card note)
// -----------------------------------------------------------------------------

export interface SynergyNote {
  cards: readonly number[];
  effect: string;
}

// -----------------------------------------------------------------------------
// Top-level archetype expertise (one file per archetype)
// -----------------------------------------------------------------------------

export interface ArchetypeExpertise {
  archetype: ArchetypeId;
  displayName: string;
  version: number;
  roleMap: Readonly<Record<number, readonly CardRole[]>>;
  goals: readonly ComboGoal[];
  routes: readonly ComboRoute[];
  keyCards: readonly number[];
  synergies?: readonly SynergyNote[];
  // Phase B (2026-04-21): bridges authored by this archetype. Convention:
  // host a bridge in its target archetype's file (where it terminates).
  bridges?: readonly BridgeSubroute[];
  sourceNotes?: string;
}
