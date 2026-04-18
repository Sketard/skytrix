// =============================================================================
// solver-config-loader.ts — Boot-time config loading & validation
// Fail-fast: invalid config -> ERROR log + process.exit(1)
// =============================================================================

import { readFileSync } from 'node:fs';
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
import type { OppTurnEnablerMap, LinkArrowsMap } from './latent-interruption-computer.js';
import {
  loadOppTurnEnablers as _loadOppTurnEnablers,
  loadLinkArrows as _loadLinkArrows,
} from './latent-interruption-computer.js';

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
  oppTurnEnablers: OppTurnEnablerMap;
  linkArrows: LinkArrowsMap;
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
  latentDiscount:         { min: 0, max: 1 },
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

export function loadAllSolverConfigs(dataDir: string, cardDB: CardDB): AllSolverConfigs {
  const solverConfig = loadSolverConfig(dataDir);
  const interruptionWeights = loadInterruptionWeights(dataDir);
  const interruptionTags = loadInterruptionTags(dataDir);
  const handtraps = loadHandtraps(dataDir);
  const structuralWeights = loadStructuralWeights(dataDir);
  const structuralTutorCards = loadStructuralTutorCards(dataDir);
  const oppTurnEnablers = _loadOppTurnEnablers(dataDir);
  const linkArrows = _loadLinkArrows(dataDir);

  validateInterruptionTagsAgainstCardPool(interruptionTags, cardDB);

  return { solverConfig, interruptionWeights, interruptionTags, handtraps, structuralWeights, structuralTutorCards, oppTurnEnablers, linkArrows };
}
