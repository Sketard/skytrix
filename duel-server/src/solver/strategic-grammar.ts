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
  // Phase 5 (2026-04-24): pre-declared structural limit. When validator
  // would otherwise classify this bridge as tier D (REJECTED), the
  // presence of this field promotes it to tier C (UNVALIDATABLE —
  // known-limit). The bridge is still run through the validator for
  // regression detection but won't affect the final pass-count summary.
  // Human review has previously accepted that the bridge is structurally
  // valid even though current primitives can't reproduce its execution.
  knownStructuralLimit?: KnownStructuralLimit;
}

export interface KnownStructuralLimit {
  // Canonical code — keep in sync with `DiagnosisCode` in validate-bridge.ts.
  reason:
    | 'TRIGGER_ORIGIN_MISMATCH'
    | 'NEEDS_PRIOR_SUMMON_NO_PRECURSOR'
    | 'MATERIAL_NOT_AVAILABLE'
    | 'UNHANDLED_PROMPT'
    | 'COST_MULTI_PICK_COMPLEX'
    | 'PRODUCES_ZONE_MISMATCH'
    | 'OTHER';
  note: string;
  reviewedBy?: string;
  reviewedOn?: string;        // YYYY-MM-DD
  confidence?: 'high' | 'medium' | 'low';
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
  /** Path scoring (Levier 3, 2026-05-02) — cardIds whose effect activations
   *  during the turn count toward `pathPoints` in `explorationScore` (DFS
   *  guidance only, NOT user-facing `interruptionScore`). Authored from the
   *  archetype's β-1 canonical plan: each step's source cardId.
   *  Rewards the activation journey, not the terminal state — addresses
   *  myopia where short terminals beat long combos at constant terminal
   *  cardsOOD (Resource Scoring NULL diagnostic, 2026-05-02). Empty / undefined
   *  = no path scoring for this archetype. Gated by SOLVER_USE_PATH_SCORING=1. */
  pathCards?: readonly number[];
  synergies?: readonly SynergyNote[];
  // Phase B (2026-04-21): bridges authored by this archetype. Convention:
  // host a bridge in its target archetype's file (where it terminates).
  bridges?: readonly BridgeSubroute[];
  sourceNotes?: string;
  /** Phase 5 of prompt-resolver-refactor (2026-05-01): per-card,
   *  per-prompt-type override hints consumed by CardExpertiseOracle.
   *  Key: stringified sourceCardId (e.g. "67322708"). Each value is an
   *  object whose keys are PromptType strings — the value is an
   *  ExpertiseHint with policy + provenance metadata. Forward-compatible:
   *  loader warns (does not reject) when metadata fields are missing,
   *  per refactor design doc Q4. */
  decisionHints?: Readonly<Record<string, Readonly<Record<string, ExpertiseHint>>>>;
}

/** Phase 5 — schema for one (cardId, promptType) override hint. The
 *  `policy` controls how the hint is converted to an OcgResponse. The
 *  `_*` fields are data lineage / provenance: a hint can be authored
 *  manually today, validated by a Path β subagent later, and replaced
 *  by an ML-extracted value — same runtime path, only metadata changes. */
export interface ExpertiseHint {
  /** How to derive the response. See CardExpertiseOracle for the
   *  per-policy mapping. Unknown policies are logged and ignored. */
  policy: 'max' | 'min' | 'first' | 'last' | 'yes' | 'no'
    | 'preferred' | 'all' | 'face-down' | 'face-up-attack' | 'face-up-defense';
  /** Optional disambiguation context (free-text, no semantic effect). */
  context?: string;
  /** Used by `policy: 'preferred'` only — list of cardIds in priority
   *  order. The oracle picks the first matching cardId from the legal
   *  pool. Falls back to `legal[0]` if none match. */
  preferredCardIds?: readonly number[];
  /** Provenance metadata. */
  _source?: 'manual' | 'path-beta-subagent' | 'tier-3-policy' | 'default-mechanical';
  _confidence?: 'observed' | 'inferred' | 'guessed';
  _authored?: string;  // ISO date e.g. '2026-05-15'
  _rationale?: string;
}
