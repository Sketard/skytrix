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

export const ZONE_KINDS = ['monster', 'spellTrap', 'field', 'extraMonster'] as const;
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
  sourceNotes?: string;
}
