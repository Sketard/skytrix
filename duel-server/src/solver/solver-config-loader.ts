// =============================================================================
// solver-config-loader.ts — Boot-time config loading & validation
// Fail-fast: invalid config -> ERROR log + process.exit(1)
// =============================================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CardDB } from '../types.js';
import type { ZoneId } from '../ws-protocol.js';
import type {
  SolverConfigFile,
  InterruptionTag,
  InterruptionType,
  HandtrapConfig,
} from './solver-types.js';
import { INTERRUPTION_TYPES, ALL_ZONE_IDS } from './solver-types.js';
import type { StructuralWeights, StructuralTutorCards } from './structural-value-computer.js';
import type {
  ArchetypeExpertise,
  BridgeSubroute,
  CardSelector,
  CardSlot,
  ComboGoal,
} from './strategic-grammar.js';
import { CARD_ROLES } from './strategic-grammar.js';

// =============================================================================
// Range Validation Helpers
// =============================================================================

interface RangeRule {
  min: number;
  max: number;
}

function validateRange(value: unknown, field: string, rule: RangeRule): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < rule.min || num > rule.max) {
    console.error(`[Solver] Invalid config: ${field} = ${String(value)} (expected ${rule.min}-${rule.max})`);
    process.exit(1);
  }
  return num;
}

function validateEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) {
    console.error(`[Solver] Invalid config: ${field} = ${String(value)} (expected ${allowed.join('|')})`);
    process.exit(1);
  }
  return value as T;
}

// =============================================================================
// Solver Config
// =============================================================================

const SOLVER_CONFIG_RANGES: Record<string, RangeRule> = {
  poolSize:                { min: 1,    max: 32 },
  maxDepth:                { min: 10,   max: 100 },
  timeBudgetFastMs:        { min: 1000, max: 30000 },
  timeBudgetOptimalMs:     { min: 5000, max: 300000 },
  progressThrottleMs:      { min: 50,   max: 2000 },
  treePruningTopX:         { min: 1,    max: 50 },
  maxResultNodes:          { min: 50,   max: 5000 },
  transpositionMaxEntries: { min: 1000, max: 100000 },
  memoryBudgetMb:          { min: 128,  max: 4096 },
  bfComplexityThreshold:   { min: 5,    max: 100 },
  rateLimitIntervalMs:     { min: 500,  max: 10000 },
  maxHandtraps:            { min: 1,    max: 10 },
  ucb1C:                   { min: 0.5,  max: 3.0 },
  rolloutEpsilon:          { min: 0.0,  max: 1.0 },
  verificationBudgetRatio: { min: 0.05, max: 0.30 },
  stalledWarningMs:        { min: 500,  max: 30000 },
  maxSolverConnections:    { min: 1,    max: 1000 },
};

export function loadSolverConfig(dataDir: string): SolverConfigFile {
  const filePath = join(dataDir, 'solver-config.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

  const config: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(SOLVER_CONFIG_RANGES)) {
    config[field] = validateRange(raw[field], field, rule);
  }
  config['backpropPolicy'] = validateEnum(raw['backpropPolicy'], 'backpropPolicy', ['max', 'mean'] as const);

  console.log('[Solver] solver-config.json loaded and validated');
  return config as unknown as SolverConfigFile;
}

// =============================================================================
// Interruption Weights
// =============================================================================

export function loadInterruptionWeights(dataDir: string): Record<InterruptionType, number> {
  const filePath = join(dataDir, 'interruption-weights.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

  const weights: Record<string, number> = {};
  for (const type of INTERRUPTION_TYPES) {
    if (!(type in raw)) {
      console.error(`[Solver] Invalid interruption-weights.json: missing type "${type}"`);
      process.exit(1);
    }
    weights[type] = validateRange(raw[type], `interruption-weights.${type}`, { min: 0, max: 100 });
  }

  console.log('[Solver] interruption-weights.json loaded and validated (15 types)');
  return weights as Record<InterruptionType, number>;
}

// =============================================================================
// Interruption Tags
// =============================================================================

const VALID_TYPES_SET: ReadonlySet<string> = new Set(INTERRUPTION_TYPES);
const VALID_TRIGGERS_SET: ReadonlySet<string> = new Set([
  'chain', 'main', 'quick', 'trigger', 'continuous',
]);
const VALID_ZONE_IDS_SET: ReadonlySet<string> = new Set(ALL_ZONE_IDS);

export function loadInterruptionTags(dataDir: string): Record<string, InterruptionTag> {
  const filePath = join(dataDir, 'interruption-tags.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

  const tags: Record<string, InterruptionTag> = {};
  for (const [cardId, entry] of Object.entries(raw)) {
    const id = Number(cardId);
    if (!Number.isFinite(id) || id <= 0) {
      console.error(`[Solver] Invalid interruption-tags.json: invalid cardId "${cardId}"`);
      process.exit(1);
    }

    const e = entry as { cardName?: string; effects?: unknown[] };
    if (!Array.isArray(e.effects) || e.effects.length === 0) {
      console.error(`[Solver] Invalid interruption-tags.json: cardId ${cardId} has no effects`);
      process.exit(1);
    }

    const effects = e.effects.map((eff: unknown, i: number) => {
      const f = eff as {
        type?: string;
        usesPerTurn?: number;
        trigger?: string;
        activeZones?: unknown;
        description?: string;
      };
      if (!VALID_TYPES_SET.has(f.type ?? '')) {
        console.error(`[Solver] Invalid interruption-tags.json: cardId ${cardId} effect[${i}] has invalid type "${f.type}"`);
        process.exit(1);
      }
      const usesPerTurn = validateRange(f.usesPerTurn, `interruption-tags.${cardId}.effects[${i}].usesPerTurn`, { min: 1, max: 10 });
      // trigger is optional. When present, must be one of the known values.
      // Unknown values are coerced to undefined with a warning (forward-compat
      // for future trigger types).
      let trigger: InterruptionTag['effects'][number]['trigger'];
      if (f.trigger !== undefined) {
        if (VALID_TRIGGERS_SET.has(f.trigger)) {
          trigger = f.trigger as InterruptionTag['effects'][number]['trigger'];
        } else {
          console.warn(`[Solver] interruption-tags.json: cardId ${cardId} effect[${i}] has unknown trigger "${f.trigger}" — ignored`);
        }
      }
      // activeZones (Voie B, 2026-04-17): optional explicit zone gate for
      // the effect. When present, must be a non-empty ZoneId[]. Unknown
      // zone strings fail loudly — a typo here silently changes scoring.
      let activeZones: readonly ZoneId[] | undefined;
      if (f.activeZones !== undefined) {
        if (!Array.isArray(f.activeZones) || f.activeZones.length === 0) {
          console.error(`[Solver] Invalid interruption-tags.json: cardId ${cardId} effect[${i}].activeZones must be a non-empty array`);
          process.exit(1);
        }
        for (const z of f.activeZones) {
          if (typeof z !== 'string' || !VALID_ZONE_IDS_SET.has(z)) {
            console.error(`[Solver] Invalid interruption-tags.json: cardId ${cardId} effect[${i}].activeZones contains invalid zone "${z}"`);
            process.exit(1);
          }
        }
        activeZones = f.activeZones as readonly ZoneId[];
      }
      const effect: InterruptionTag['effects'][number] = { type: f.type as InterruptionType, usesPerTurn };
      if (trigger !== undefined) effect.trigger = trigger;
      if (activeZones !== undefined) effect.activeZones = activeZones;
      if (typeof f.description === 'string') effect.description = f.description;
      return effect;
    });

    if (!e.cardName || e.cardName.trim() === '') {
      console.error(`[Solver] Invalid interruption-tags.json: cardId ${cardId} has empty cardName`);
      process.exit(1);
    }

    // Extract optional new fields (sharedOpt, totalUsesPerTurn, audit metadata).
    // These are forward-compat — old entries without them still load correctly.
    const eFull = entry as {
      cardName: string;
      sharedOpt?: boolean;
      totalUsesPerTurn?: number;
      _generatedBy?: string;
      _oracleVersion?: string;
      _validated?: boolean;
    };
    const tag: InterruptionTag = { cardName: e.cardName, effects };
    if (typeof eFull.sharedOpt === 'boolean') tag.sharedOpt = eFull.sharedOpt;
    if (typeof eFull.totalUsesPerTurn === 'number') {
      tag.totalUsesPerTurn = validateRange(
        eFull.totalUsesPerTurn,
        `interruption-tags.${cardId}.totalUsesPerTurn`,
        { min: 1, max: 20 },
      );
      // totalUsesPerTurn is only meaningful when sharedOpt is true. The
      // scorer ignores it otherwise — warn so the data file isn't silently
      // misconfigured.
      if (tag.sharedOpt !== true) {
        console.warn(`[Solver] interruption-tags.json: cardId ${cardId} has totalUsesPerTurn=${tag.totalUsesPerTurn} without sharedOpt:true — value will be ignored by the scorer`);
      }
    }
    if (typeof eFull._generatedBy === 'string') tag._generatedBy = eFull._generatedBy;
    if (typeof eFull._oracleVersion === 'string') tag._oracleVersion = eFull._oracleVersion;
    if (typeof eFull._validated === 'boolean') tag._validated = eFull._validated;
    tags[cardId] = tag;
  }

  console.log(`[Solver] interruption-tags.json loaded and validated (${Object.keys(tags).length} cards)`);
  return tags;
}

// =============================================================================
// Handtraps
// =============================================================================

export function loadHandtraps(dataDir: string): HandtrapConfig[] {
  const filePath = join(dataDir, 'handtraps.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown[];

  if (!Array.isArray(raw) || raw.length !== 5) {
    console.error(`[Solver] Invalid handtraps.json: expected exactly 5 entries, got ${Array.isArray(raw) ? raw.length : 'non-array'}`);
    process.exit(1);
  }

  const handtraps: HandtrapConfig[] = raw.map((entry: unknown, i: number) => {
    const e = entry as { cardId?: number; cardName?: string };
    if (!Number.isFinite(e.cardId) || (e.cardId ?? 0) <= 0) {
      console.error(`[Solver] Invalid handtraps.json: entry[${i}] has invalid cardId "${e.cardId}"`);
      process.exit(1);
    }
    if (!e.cardName || e.cardName.trim() === '') {
      console.error(`[Solver] Invalid handtraps.json: entry[${i}] has empty cardName`);
      process.exit(1);
    }
    return { cardId: e.cardId!, cardName: e.cardName };
  });

  console.log('[Solver] handtraps.json loaded and validated (5 entries)');
  return handtraps;
}

// =============================================================================
// Card Pool Validation
// =============================================================================

export function validateInterruptionTagsAgainstCardPool(
  tags: Record<string, InterruptionTag>,
  cardDB: CardDB,
): void {
  const stale: string[] = [];
  for (const cardId of Object.keys(tags)) {
    const row = cardDB.stmt.get(Number(cardId));
    if (!row) {
      stale.push(`${cardId} (${tags[cardId].cardName})`);
    }
  }
  if (stale.length > 0) {
    console.warn(`[Solver] WARNING: ${stale.length} stale cardIds in interruption-tags.json not found in card pool:\n  ${stale.join('\n  ')}`);
  } else {
    console.log('[Solver] All interruption-tags cardIds verified against card pool');
  }
}

// =============================================================================
// Aggregate Loader
// =============================================================================

export interface AllSolverConfigs {
  solverConfig: SolverConfigFile;
  interruptionWeights: Record<InterruptionType, number>;
  interruptionTags: Record<string, InterruptionTag>;
  handtraps: HandtrapConfig[];
  structuralWeights: StructuralWeights;
  structuralTutorCards: StructuralTutorCards;
  archetypeExpertise: readonly ArchetypeExpertise[];
}

const STRUCTURAL_WEIGHT_RANGES: Record<string, RangeRule> = {
  F1_W:                   { min: 0, max: 20 },
  F1_CAP:                 { min: 0, max: 10 },
  F1_tributeFodderBonus:  { min: 0, max: 5 },
  F2_W:                   { min: 0, max: 20 },
  F2_CAP:                 { min: 0, max: 20 },
  F3_W:                   { min: 0, max: 20 },
  F3_CAP:                 { min: 0, max: 10 },
  F4_W:                   { min: 0, max: 5 },
  F4_CAP:                 { min: 0, max: 20 },
  globalCap:              { min: 0, max: 50 },
};

export function loadStructuralWeights(dataDir: string): StructuralWeights {
  const filePath = join(dataDir, 'structural-weights.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

  const weights: Record<string, number | boolean | string | undefined> = {};
  for (const [field, rule] of Object.entries(STRUCTURAL_WEIGHT_RANGES)) {
    weights[field] = validateRange(raw[field], field, rule);
  }
  if (raw._validated !== undefined) weights._validated = Boolean(raw._validated);
  if (raw._notes !== undefined) weights._notes = String(raw._notes);

  console.log('[Solver] structural-weights.json loaded and validated');
  return weights as unknown as StructuralWeights;
}

const TUTOR_ROLES = ['combo-starter', 'engine-glue', 'utility'] as const;

export function loadStructuralTutorCards(dataDir: string): StructuralTutorCards {
  const filePath = join(dataDir, 'structural-tutor-cards.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as { cards?: Record<string, unknown> };
  const cardsRaw = raw.cards;
  if (!cardsRaw || typeof cardsRaw !== 'object') {
    console.error(`[Solver] Invalid structural-tutor-cards.json: missing 'cards' object`);
    process.exit(1);
  }

  const cards: Record<string, { name: string; weight: number; archetype: string; role: 'combo-starter' | 'engine-glue' | 'utility' }> = {};
  for (const [cidStr, rawEntry] of Object.entries(cardsRaw)) {
    if (!/^\d+$/.test(cidStr)) {
      console.error(`[Solver] Invalid tutor cardId '${cidStr}' — must be a decimal number string`);
      process.exit(1);
    }
    const entry = rawEntry as Record<string, unknown>;
    const weight = validateRange(entry.weight, `tutor.${cidStr}.weight`, { min: 0, max: 10 });
    const role = validateEnum(entry.role, `tutor.${cidStr}.role`, TUTOR_ROLES);
    const name = typeof entry.name === 'string' ? entry.name : `#${cidStr}`;
    const archetype = typeof entry.archetype === 'string' ? entry.archetype : 'unknown';
    cards[cidStr] = { name, weight, archetype, role };
  }

  console.log(`[Solver] structural-tutor-cards.json loaded (${Object.keys(cards).length} entries)`);
  return { cards };
}

// =============================================================================
// Override helpers — used by `scripts/evaluate-structural.ts --weights-override`
// (C3) and `scripts/tune-weights.ts` (C4) to apply partial weight overrides
// at runtime without touching the on-disk JSON files. Each overridden field
// is validated against the same range rule as the loader; unknown fields
// throw to prevent silent typos.
// =============================================================================

export function applyStructuralWeightsOverride(
  base: StructuralWeights,
  override: Record<string, unknown>,
): StructuralWeights {
  const merged: Record<string, number | boolean | string | undefined> = { ...(base as unknown as Record<string, number | boolean | string | undefined>) };
  for (const [field, value] of Object.entries(override)) {
    if (field === '_validated' || field === '_notes') {
      merged[field] = value as never;
      continue;
    }
    const rule = STRUCTURAL_WEIGHT_RANGES[field];
    if (!rule) {
      throw new Error(`[Solver] Invalid weights override: unknown structural field '${field}'`);
    }
    merged[field] = validateRange(value, `override.structural.${field}`, rule);
  }
  return merged as unknown as StructuralWeights;
}

export function applyInterruptionWeightsOverride(
  base: Record<InterruptionType, number>,
  override: Record<string, unknown>,
): Record<InterruptionType, number> {
  const merged: Record<string, number> = { ...base };
  for (const [type, value] of Object.entries(override)) {
    if (!INTERRUPTION_TYPES.includes(type as InterruptionType)) {
      throw new Error(`[Solver] Invalid weights override: unknown interruption type '${type}'`);
    }
    merged[type] = validateRange(value, `override.interruption.${type}`, { min: 0, max: 100 });
  }
  return merged as Record<InterruptionType, number>;
}

// =============================================================================
// Archetype Expertise (Strategic Grammar v1, 2026-04-21)
// =============================================================================

/** Archetype keyCards overlap threshold. An expertise file matches a deck
 *  when ≥ this many of its keyCards are present in the mainDeck. Tunable —
 *  3 is conservative: avoids false positives on generic staples, allows
 *  hybrid decks (Ryzeal-Mitsurugi) to activate multiple expertises. */
export const ARCHETYPE_KEYCARDS_MATCH_THRESHOLD = 3;

/** Load every `*.json` under `<dataDir>/archetype-expertise/` and parse as
 *  `ArchetypeExpertise`. Fail-fast: malformed file → exit(1). Silently
 *  tolerates an absent directory (returns []). Does NOT filter by deck —
 *  caller filters per-fixture via `filterExpertiseByDeck()`. */
export function loadArchetypeExpertise(dataDir: string): ArchetypeExpertise[] {
  const dir = join(dataDir, 'archetype-expertise');
  if (!existsSync(dir)) {
    console.log('[Solver] No archetype-expertise/ directory — goal-match scoring disabled');
    return [];
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const out: ArchetypeExpertise[] = [];
  for (const f of files) {
    const filePath = join(dir, f);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.error(`[Solver] Failed to parse archetype-expertise/${f}: ${String(e)}`);
      process.exit(1);
    }
    out.push(validateArchetypeExpertise(raw, f));
  }
  console.log(`[Solver] archetype-expertise loaded (${out.length} file${out.length === 1 ? '' : 's'})`);
  return out;
}

function validateArchetypeExpertise(raw: unknown, filename: string): ArchetypeExpertise {
  if (!raw || typeof raw !== 'object') {
    console.error(`[Solver] archetype-expertise/${filename}: not an object`);
    process.exit(1);
  }
  const r = raw as Record<string, unknown>;
  const requireString = (k: string): string => {
    if (typeof r[k] !== 'string') {
      console.error(`[Solver] archetype-expertise/${filename}: field '${k}' must be a string`);
      process.exit(1);
    }
    return r[k] as string;
  };
  const requireArray = <T>(k: string): T[] => {
    if (!Array.isArray(r[k])) {
      console.error(`[Solver] archetype-expertise/${filename}: field '${k}' must be an array`);
      process.exit(1);
    }
    return r[k] as T[];
  };

  const archetype = requireString('archetype');
  const displayName = requireString('displayName');
  if (typeof r.version !== 'number') {
    console.error(`[Solver] archetype-expertise/${filename}: field 'version' must be a number`);
    process.exit(1);
  }
  const keyCards = requireArray<number>('keyCards');
  for (const k of keyCards) {
    if (!Number.isInteger(k) || k < 0) {
      console.error(`[Solver] archetype-expertise/${filename}: keyCards must be positive integers, got ${String(k)}`);
      process.exit(1);
    }
  }

  const roleMapRaw = r.roleMap;
  if (!roleMapRaw || typeof roleMapRaw !== 'object') {
    console.error(`[Solver] archetype-expertise/${filename}: field 'roleMap' must be an object`);
    process.exit(1);
  }
  for (const [cidStr, roles] of Object.entries(roleMapRaw as Record<string, unknown>)) {
    if (!/^\d+$/.test(cidStr)) {
      console.error(`[Solver] archetype-expertise/${filename}: roleMap key '${cidStr}' must be decimal cardId`);
      process.exit(1);
    }
    if (!Array.isArray(roles)) {
      console.error(`[Solver] archetype-expertise/${filename}: roleMap['${cidStr}'] must be array`);
      process.exit(1);
    }
    for (const role of roles) {
      if (!CARD_ROLES.includes(role as typeof CARD_ROLES[number])) {
        console.error(`[Solver] archetype-expertise/${filename}: invalid role '${String(role)}' in roleMap['${cidStr}'] (allowed: ${CARD_ROLES.join('|')})`);
        process.exit(1);
      }
    }
  }

  // goals + routes: shape-validated at the TS level via `as` cast. Detailed
  // per-field validation deferred — malformed goals surface as zero match
  // (safe default) and bad routes surface as zero alignment. Keep loader
  // under 100 LOC; enforce stricter schemas when adoption warrants it.
  requireArray<unknown>('goals');
  requireArray<unknown>('routes');

  return raw as ArchetypeExpertise;
}

// =============================================================================
// Grammar graph validation (Phase B 2026-04-21) — verify ComboGoal.successors
// and BridgeSubroute references resolve globally, and structural coverage:
// apex.required slots must all be covered by waypoint.required ∪ bridge.produces.
// Fail-loud on any broken reference or missing coverage — an unauthored graph
// edge is a hard error since the scorer trusts resolution at runtime.
// =============================================================================

interface GoalRef { goal: ComboGoal; host: ArchetypeExpertise; }
interface BridgeRef { bridge: BridgeSubroute; host: ArchetypeExpertise; }

export function validateGrammarGraph(expertise: readonly ArchetypeExpertise[]): void {
  const goalMap = new Map<string, GoalRef>();
  const bridgeMap = new Map<string, BridgeRef>();

  for (const e of expertise) {
    for (const g of e.goals) {
      if (goalMap.has(g.id)) {
        console.error(`[Solver] Grammar graph: duplicate goalId '${g.id}' (hosts: ${goalMap.get(g.id)!.host.archetype}, ${e.archetype})`);
        process.exit(1);
      }
      goalMap.set(g.id, { goal: g, host: e });
    }
    for (const b of e.bridges ?? []) {
      if (bridgeMap.has(b.id)) {
        console.error(`[Solver] Grammar graph: duplicate bridgeId '${b.id}' (hosts: ${bridgeMap.get(b.id)!.host.archetype}, ${e.archetype})`);
        process.exit(1);
      }
      bridgeMap.set(b.id, { bridge: b, host: e });
    }
  }

  let successorCount = 0;
  for (const { goal: waypoint, host } of goalMap.values()) {
    for (const s of waypoint.successors ?? []) {
      successorCount++;
      const apexRef = goalMap.get(s.to);
      if (!apexRef) {
        console.error(`[Solver] Grammar graph: '${host.archetype}.${waypoint.id}' → unknown successor goal '${s.to}'`);
        process.exit(1);
      }
      const brRef = bridgeMap.get(s.viaBridge);
      if (!brRef) {
        console.error(`[Solver] Grammar graph: '${host.archetype}.${waypoint.id}' → '${s.to}' uses unknown bridge '${s.viaBridge}'`);
        process.exit(1);
      }
      const supply: readonly CardSlot[] = [...waypoint.required, ...brRef.bridge.produces];
      for (const apexSlot of apexRef.goal.required) {
        if (!supply.some(candidate => slotCovers(candidate, apexSlot))) {
          console.error(`[Solver] Grammar graph: '${waypoint.id}' → '${s.to}' via '${s.viaBridge}': apex slot ${describeSlot(apexSlot)} NOT covered by waypoint.required ∪ bridge.produces`);
          process.exit(1);
        }
      }
    }
  }

  if (successorCount > 0 || bridgeMap.size > 0) {
    console.log(`[Solver] grammar graph validated (${successorCount} successor${successorCount === 1 ? '' : 's'}, ${bridgeMap.size} bridge${bridgeMap.size === 1 ? '' : 's'})`);
  }
}

/** True when satisfying `a` guarantees satisfying `b`. Used for static
 *  structural coverage: waypoint.required ∪ bridge.produces must guarantee
 *  apex.required. Role-based selectors are deliberately conservative
 *  (role covers only identical role) — downgrading to a false negative
 *  (requiring tighter authoring) rather than a silent false positive. */
function slotCovers(a: CardSlot, b: CardSlot): boolean {
  if (a.zone !== b.zone) return false;
  if (b.position !== undefined && a.position !== b.position) return false;
  return selectorCovers(a.card, b.card);
}

function selectorCovers(a: CardSelector, b: CardSelector): boolean {
  if (a.kind === 'specific') {
    if (b.kind === 'specific') return a.cardId === b.cardId;
    if (b.kind === 'anyOf') return b.cardIds.includes(a.cardId);
    return false;
  }
  if (a.kind === 'anyOf') {
    if (b.kind === 'anyOf') return a.cardIds.every(id => b.cardIds.includes(id));
    if (b.kind === 'specific') return a.cardIds.length === 1 && a.cardIds[0] === b.cardId;
    return false;
  }
  return a.kind === 'role' && b.kind === 'role' && a.role === b.role;
}

function describeSlot(s: CardSlot): string {
  const sel = s.card.kind === 'specific' ? `card=${s.card.cardId}` :
              s.card.kind === 'anyOf' ? `anyOf=[${s.card.cardIds.join(',')}]` :
              `role=${s.card.role}`;
  return `{zone=${s.zone}${s.position ? `@${s.position}` : ''} ${sel}}`;
}

/** Filter expertise list to those whose keyCards overlap with `mainDeck` by
 *  ≥ ARCHETYPE_KEYCARDS_MATCH_THRESHOLD cards. Pure + deterministic — called
 *  per-fixture by the harness before passing to scorer + ranker. */
export function filterExpertiseByDeck(
  all: readonly ArchetypeExpertise[],
  mainDeck: readonly number[],
): ArchetypeExpertise[] {
  const deckSet = new Set(mainDeck);
  const out: ArchetypeExpertise[] = [];
  for (const e of all) {
    let overlap = 0;
    for (const k of e.keyCards) {
      if (deckSet.has(k)) overlap++;
    }
    if (overlap >= ARCHETYPE_KEYCARDS_MATCH_THRESHOLD) out.push(e);
  }
  return out;
}

export function loadAllSolverConfigs(dataDir: string, cardDB: CardDB): AllSolverConfigs {
  const solverConfig = loadSolverConfig(dataDir);
  const interruptionWeights = loadInterruptionWeights(dataDir);
  const interruptionTags = loadInterruptionTags(dataDir);
  const handtraps = loadHandtraps(dataDir);
  const structuralWeights = loadStructuralWeights(dataDir);
  const structuralTutorCards = loadStructuralTutorCards(dataDir);
  const archetypeExpertise = loadArchetypeExpertise(dataDir);
  validateGrammarGraph(archetypeExpertise);

  validateInterruptionTagsAgainstCardPool(interruptionTags, cardDB);

  return {
    solverConfig, interruptionWeights, interruptionTags, handtraps,
    structuralWeights, structuralTutorCards, archetypeExpertise,
  };
}
