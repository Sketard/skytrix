// Extract structured effect descriptions from ocgcore Lua card scripts.
//
// v1 coverage target: ~80% of common patterns via regex + line-scan.
// v2 (planned): AST parser + helper library resolution + filter lambda decoding → 95%.
//
// Anything not parsed is FLAGGED (never silently dropped). Downstream tools
// consume the `opaque` markers as "needs hand-review" signals.
//
// Usage:
//   npx tsx scripts/extract-card-effects.ts <cardId>                    # single card to stdout
//   npx tsx scripts/extract-card-effects.ts --write <cardId>            # write to catalog dir
//   npx tsx scripts/extract-card-effects.ts --batch <id1> <id2> ...     # multiple cards to catalog dir

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import luaparse from 'luaparse';

// Bump this whenever parser semantics change. Propagated to every catalog JSON's
// `parserVersion` field and typed through `CardEffectCatalog` via `typeof`.
const PARSER_VERSION = 'v7-gate-strip' as const;

// =============================================================================
// Schema (v1 — extensible for v2 95% upgrade via optional `ast` / `resolved` fields)
// =============================================================================

/** One effect registered by a card's initial_effect function. */
interface Effect {
  id: string;                                  // "e1", "e2", ...
  descriptionStringId?: string;                // aux.Stringid(id, N) → "N"
  categories: readonly string[];               // ["CATEGORY_TOHAND", "CATEGORY_SEARCH"]
  types: readonly string[];                    // ["EFFECT_TYPE_SINGLE", "EFFECT_TYPE_TRIGGER_O"]
  properties: readonly string[];               // ["EFFECT_FLAG_DELAY"]
  /** Trigger/event code. Multi-event effects (via Clone) list each event here. */
  events: readonly string[];                   // ["EVENT_SUMMON_SUCCESS"] OR ["EVENT_SUMMON_SUCCESS", "EVENT_SPSUMMON_SUCCESS"]
  range?: string;                              // "LOCATION_MZONE" | "LOCATION_EXTRA" | ...
  targetRange?: { self: string; opponent: string };  // for EFFECT_TYPE_FIELD effects
  countLimit?: { count: number; key: string };
  /** Condition function — v1 opaque ref, v2 will decode simple lambdas. */
  condition?: FunctionRef;
  cost?: FunctionRef;
  target?: FunctionRef;
  operation?: FunctionRef;
  /** For EFFECT_TYPE_FIELD effects with SetValue. */
  value?: FunctionRef | { literal: string };
  /** Clone source — if this effect was created via `e1:Clone()`. */
  clonedFrom?: string;
  clonedTo?: readonly string[];
}

/** Reference to a Lua function. v1 captures name + opaque flag; v5 adds AST-derived actions + side-effects. */
interface FunctionRef {
  name?: string;                               // "s.thfilter" if named, else undefined for inline
  inline?: string;                             // raw Lua source if inline lambda
  /** v1 attempt at decoding simple AND-chain filters. */
  simpleFilter?: SimpleFilter;
  /** True when content is not fully captured by simpleFilter (or when simpleFilter is absent). */
  opaque: boolean;
  /** Reserved for v2. AST of the function body + resolved helper calls. */
  ast?: unknown;
  /** Reserved for v2. Normalized predicate description. */
  resolved?: unknown;
  /** v5: visible Duel.* actions found in the body (send-to-deck, special-summon, etc.). */
  actions?: readonly OperationAction[];
  /** v5: Effect.CreateEffect registrations observed inside the body. */
  sideEffects?: readonly SideEffect[];
}

/** A visible game action triggered by an operation body (`Duel.XXX`). */
interface OperationAction {
  kind: string;                                // "send-to-deck" | "special-summon" | "banish" | ...
  method: string;                              // raw Duel method name
  /** First argument descriptor (often the target card/group expression). */
  target?: string;
  /** Additional relevant args (reason, position, location) raw-stringified. */
  argHints?: readonly string[];
}

/** An Effect.CreateEffect registration discovered inside an operation body. */
interface SideEffect {
  /** Code set via :SetCode(...) — the effect's event/flag code. */
  code?: string;
  /** Value set via :SetValue(...) — often a location/type mask. */
  value?: string;
  /** Types from :SetType(...). */
  types?: readonly string[];
  /** Properties from :SetProperty(...). */
  properties?: readonly string[];
  /** Category from :SetCategory(...). */
  categories?: readonly string[];
  /** Reset mask from :SetReset(...). */
  reset?: string;
  /** Target-range self/opponent from :SetTargetRange(...). */
  targetRange?: { self: string; opponent: string };
  /** The card variable on which :RegisterEffect was called (e.g. "c", "tc", "e:GetHandler()"). */
  registeredOn?: string;
}

/** Simple AND-chain filter extracted from pure `c:IsX(...)` compositions. */
interface SimpleFilter {
  /** Each predicate extracted from the AND-chain. Unknown predicates keep raw form. */
  predicates: readonly FilterPredicate[];
  /** True when every clause was decoded; false = partially decoded. */
  complete: boolean;
}

type FilterPredicate =
  | { kind: 'attribute'; value: string }          // IsAttribute(ATTRIBUTE_FIRE)
  | { kind: 'race'; value: string }               // IsRace(RACE_DRAGON)
  | { kind: 'type'; value: string }               // IsType(TYPE_FUSION)
  | { kind: 'level'; value: number }              // IsLevel(4)
  | { kind: 'levelAbove'; value: number }         // IsLevelAbove(4)
  | { kind: 'levelBelow'; value: number }         // IsLevelBelow(4)
  | { kind: 'rank'; value: number }               // IsRank(N)
  | { kind: 'rankAbove'; value: number }          // IsRankAbove(N)
  | { kind: 'rankBelow'; value: number }          // IsRankBelow(N)
  | { kind: 'atk'; value: number }                // IsAttack(N)
  | { kind: 'atkAbove'; value: number }           // IsAttackAbove(N)
  | { kind: 'atkBelow'; value: number }           // IsAttackBelow(N)
  | { kind: 'def'; value: number }                // IsDefense(N)
  | { kind: 'code'; value: number | 'self' }      // IsCode(12345) or IsCode(id) → 'self'
  | { kind: 'setCard'; value: string }            // IsSetCard(SET_DRACOTAIL)
  | { kind: 'faceup' }                            // IsFaceup()
  | { kind: 'facedown' }                          // IsFacedown()
  | { kind: 'monster' }                           // IsMonster()
  | { kind: 'spellTrap' }                         // IsSpellTrap()
  | { kind: 'spell' }                             // IsSpell()
  | { kind: 'trap' }                              // IsTrap()
  | { kind: 'ableToHand' }                        // IsAbleToHand()
  | { kind: 'ableToGrave' }                       // IsAbleToGrave()
  | { kind: 'ableToGraveAsCost' }                 // IsAbleToGraveAsCost()
  | { kind: 'ableToDeck' }                        // IsAbleToDeck()
  | { kind: 'ableToRemove' }                      // IsAbleToRemove()
  | { kind: 'ableToExtra' }                       // IsAbleToExtra()
  | { kind: 'canBeSpecialSummoned' }              // IsCanBeSpecialSummoned(...)
  | { kind: 'canBeEffectTarget' }                 // IsCanBeEffectTarget()
  | { kind: 'canBeSynchroMaterial' }              // IsCanBeSynchroMaterial(...)
  | { kind: 'canBeFusionMaterial' }               // IsCanBeFusionMaterial()
  | { kind: 'canBeXyzMaterial' }                  // IsCanBeXyzMaterial(...)
  | { kind: 'canBeLinkMaterial' }                 // IsCanBeLinkMaterial(...)
  | { kind: 'canBeRitualMaterial' }               // IsCanBeRitualMaterial()
  | { kind: 'canBeDisabledByEffect' }             // IsCanBeDisabledByEffect(e)
  | { kind: 'canBeBattleTarget' }                 // IsCanBeBattleTarget()
  | { kind: 'canBeTributed' }                     // IsAbleToTribute / IsReleasable
  | { kind: 'discardable' }                       // IsDiscardable()
  | { kind: 'ssetable' }                          // IsSSetable()
  | { kind: 'setable' }                           // IsSetable()
  | { kind: 'relateToEffect' }                    // IsRelateToEffect(e)
  | { kind: 'location'; value: string }           // IsLocation(LOCATION_GRAVE)
  | { kind: 'onField' }                           // IsOnField()
  | { kind: 'link'; value: number }               // IsLink(N)
  | { kind: 'linkAbove'; value: number }          // IsLinkAbove(N)
  | { kind: 'linkBelow'; value: number }          // IsLinkBelow(N)
  | { kind: 'linkMonster' }                       // IsLinkMonster()
  | { kind: 'xyzMonster' }                        // IsXyzMonster()
  | { kind: 'fusionMonster' }                     // IsFusionMonster()
  | { kind: 'synchroMonster' }                    // IsSynchroMonster()
  | { kind: 'ritualMonster' }                     // IsRitualMonster()
  | { kind: 'effectMonster' }                     // IsEffectMonster()
  | { kind: 'negatable' }                         // IsNegatableMonster() / IsNegatableEffect()
  | { kind: 'forbidden' }                         // IsForbidden()
  | { kind: 'controler'; value: string }          // IsControler(tp) / IsControler(1-tp)
  | { kind: 'previousControler'; value: string }  // IsPreviousControler(...)
  | { kind: 'player'; value: string }             // IsPlayer(tp)
  | { kind: 'position'; value: string }           // IsPosition(POS_FACEUP_ATTACK)
  | { kind: 'reason'; value: string }             // IsReason(REASON_EFFECT)
  | { kind: 'uniqueOnField' }                     // CheckUniqueOnField(...)
  | { kind: 'immuneToEffect' }                    // IsImmuneToEffect(e)
  | { kind: 'hasFlag'; value: string }            // HasFlagEffect(id)
  | { kind: 'publicCard' }                        // IsPublic()
  | { kind: 'summonable' }                        // IsSummonable(nil)
  | { kind: 'specialSummonable' }                 // IsSpecialSummonable()
  | { kind: 'fieldSpell' }                        // IsFieldSpell()
  | { kind: 'continuousSpell' }                   // IsContinuousSpell()
  | { kind: 'continuousTrap' }                    // IsContinuousTrap()
  | { kind: 'continuousSpellTrap' }               // IsContinuousSpellTrap()
  | { kind: 'ritualSpell' }                       // IsRitualSpell()
  | { kind: 'normalSpell' }                       // IsNormalSpell()
  | { kind: 'normalTrap' }                        // IsNormalTrap()
  | { kind: 'normalSpellTrap' }                   // IsNormalSpellTrap()
  | { kind: 'trapMonster' }                       // IsTrapMonster()
  | { kind: 'negatableSpellTrap' }                // IsNegatableSpellTrap()
  | { kind: 'disabled' }                          // IsDisabled()
  | { kind: 'releasableByEffect' }                // IsReleasableByEffect(e)
  | { kind: 'attackPos' }                         // IsAttackPos()
  | { kind: 'defensePos' }                        // IsDefensePos()
  | { kind: 'sequence'; value: string }           // IsSequence(N)
  | { kind: 'inExtraMZone' }                      // IsInExtraMZone()
  | { kind: 'originalType'; value: string }       // IsOriginalType(TYPE_MONSTER)
  | { kind: 'monsterCard' }                       // IsMonsterCard()
  | { kind: 'linkSummoned' }                      // IsLinkSummoned()
  | { kind: 'fusionSummoned' }                    // IsFusionSummoned()
  | { kind: 'synchroSummoned' }                   // IsSynchroSummoned()
  | { kind: 'xyzSummoned' }                       // IsXyzSummoned()
  | { kind: 'ritualSummoned' }                    // IsRitualSummoned()
  | { kind: 'pendulumSummoned' }                  // IsPendulumSummoned()
  | { kind: 'listsCode'; value: string }          // ListsCode(id)
  | { kind: 'listsCodeAsMaterial'; value: string }// ListsCodeAsMaterial(id)
  // Numeric comparisons: `c:GetX() OP N`. `op` is '==' | '~=' | '<' | '<=' | '>' | '>='.
  | { kind: 'attrCompare'; attr: 'level' | 'atk' | 'def' | 'rank' | 'link' | 'overlayCount';
      op: string; value: number }
  // Non-card game-state checks: Duel.IsPhase, Duel.IsMainPhase, etc. Scoped to condition bodies
  // where they gate effect activation rather than filter a card.
  | { kind: 'gameState'; method: string; args?: readonly string[];
      op?: string; value?: string }
  | { kind: 'not'; inner: FilterPredicate }       // `not c:Is...()`
  | { kind: 'or'; predicates: readonly FilterPredicate[] }  // `A or B or C`
  | { kind: 'raw'; source: string };              // unrecognized clause

/** Summon procedure (Synchro/Fusion/Xyz/Link). v3: decodes arg roles into structured slots. */
interface SummonProcedure {
  kind: 'Synchro' | 'Fusion' | 'Xyz' | 'Link' | 'Pendulum' | 'Ritual';
  rawCall: string;                                // "Synchro.AddProcedure(c, ...)"
  opaque: boolean;
  /** v3: decomposed material slots + bounds + special clauses. */
  decoded?: DecodedProcedure;
}

interface DecodedProcedure {
  /** Material slot descriptions. Each slot names its role + filter + cardinality. */
  slots: readonly SlotRequirement[];
  /** Extra clauses (Xyz.InfiniteMats, Fusion overrides, etc.) */
  extras?: readonly string[];
  /** Procedure-level notes (e.g., "must be either Fusion Summoned or special condition"). */
  notes?: readonly string[];
}

interface SlotRequirement {
  role: 'tuner' | 'non-tuner' | 'material' | 'fallen-of-albaz' | 'extra';
  /** min/max cardinality. */
  min?: number;
  max?: number;
  /** Filter description — resolved helper, raw string, or undefined for "any". */
  filter?: ResolvedHelper | { raw: string };
}

export interface CardEffectCatalog {
  cardId: number;
  name: string;
  sourceFile: string;
  parserVersion: typeof PARSER_VERSION;
  parsedAt: string;
  /** `s.listed_names = {...}`. Card codes this card is considered to be (treat-as). */
  listedNames: readonly number[];
  /** `s.listed_series = {...}`. Setcodes this card belongs to. */
  listedSeries: readonly string[];
  summonProcedures: readonly SummonProcedure[];
  /** Effects registered in initial_effect. */
  effects: readonly Effect[];
  /** Parser coverage report. Counts are per-function-ref (condition/cost/target/operation/value). */
  coverage: {
    totalEffects: number;
    totalFunctionRefs: number;
    fullyDecoded: number;       // simpleFilter with complete=true
    partiallyDecoded: number;   // simpleFilter with complete=false
    opaqueUndecoded: number;    // no simpleFilter at all
  };
  /** Warnings from the parser. Empty = clean parse. */
  warnings: readonly string[];
}

// =============================================================================
// Parser v1
// =============================================================================

const EFFECT_CREATE_RE = /^\s*local\s+(e\w+)\s*=\s*Effect\.CreateEffect\(c\)/;
const EFFECT_CLONE_RE = /^\s*local\s+(e\w+)\s*=\s*(e\w+):Clone\(\)/;
const EFFECT_METHOD_RE = /^\s*(e\w+):(\w+)\(([\s\S]*)\)\s*$/;
const EFFECT_REGISTER_RE = /^\s*c:RegisterEffect\((e\w+)\)/;
const LISTED_NAMES_RE = /^\s*s\.listed_names\s*=\s*\{([^}]*)\}/;
const LISTED_SERIES_RE = /^\s*s\.listed_series\s*=\s*\{([^}]*)\}/;
const FUNCTION_DEF_RE = /^\s*function\s+s\.(\w+)\s*\(([^)]*)\)\s*$/;
const SUMMON_PROC_RE = /^\s*(Synchro|Fusion|Xyz|Link|Pendulum|Ritual)\.(AddProcedure|AddProcMix)\s*\(/;
/** Ritual procedure is instantiated via `local e<N> = Ritual.CreateProc(c, ...)` rather
 *  than a top-level `AddProcedure`. The returned effect is configured separately. */
const RITUAL_CREATE_PROC_RE = /^\s*local\s+(e\w+)\s*=\s*Ritual\.CreateProc\s*\(/;

function parseLuaScript(path: string, cardId: number, cardName: string): CardEffectCatalog {
  const source = readFileSync(path, 'utf-8');
  const lines = source.split(/\r?\n/);
  const warnings: string[] = [];

  // Track effect declarations + method calls in document order.
  const effectsByVar = new Map<string, {
    id: string;
    categories: string[];
    types: string[];
    properties: string[];
    events: string[];
    range?: string;
    targetRange?: { self: string; opponent: string };
    countLimit?: { count: number; key: string };
    descriptionStringId?: string;
    conditionRaw?: string;
    costRaw?: string;
    targetRaw?: string;
    operationRaw?: string;
    valueRaw?: string;
    clonedFrom?: string;
    clonedTo: string[];
  }>();
  const effectOrder: string[] = [];

  const listedNames: number[] = [];
  const listedSeries: string[] = [];
  const summonProcedures: SummonProcedure[] = [];

  // Collect function bodies + signatures for later filter extraction.
  const functionBodies = new Map<string, { signature: string; body: string }>();

  // Function body tracking. `initial_effect` is special — its body contains
  // the Effect.CreateEffect calls we want to parse (not buffer as opaque).
  // Helper functions (s.thfilter, s.thop, etc.) are buffered for later
  // filter extraction.
  let inHelper: { name: string; signature: string; bodyLines: string[] } | null = null;
  let insideInitialEffect = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track helper function body (NOT initial_effect).
    if (inHelper) {
      if (/^end\s*$/.test(line)) {
        functionBodies.set(inHelper.name, {
          signature: inHelper.signature,
          body: inHelper.bodyLines.join('\n'),
        });
        inHelper = null;
      } else {
        inHelper.bodyLines.push(line);
      }
      continue;
    }

    const fnMatch = FUNCTION_DEF_RE.exec(line);
    if (fnMatch) {
      if (fnMatch[1] === 'initial_effect') {
        insideInitialEffect = true;
      } else {
        inHelper = { name: fnMatch[1], signature: fnMatch[2], bodyLines: [] };
      }
      continue;
    }

    // Exit initial_effect on `end`.
    if (insideInitialEffect && /^end\s*$/.test(line)) {
      insideInitialEffect = false;
      continue;
    }

    const createMatch = EFFECT_CREATE_RE.exec(line);
    if (createMatch) {
      const varName = createMatch[1];
      effectsByVar.set(varName, {
        id: varName,
        categories: [],
        types: [],
        properties: [],
        events: [],
        clonedTo: [],
      });
      effectOrder.push(varName);
      continue;
    }

    // Ritual procedure: `local eN = Ritual.CreateProc(c, ...)`. We capture it as both
    // a summonProcedure entry AND an Effect entry so subsequent :Set* overrides on eN
    // are tracked correctly by the Effect pipeline.
    const ritualProcMatch = RITUAL_CREATE_PROC_RE.exec(line);
    if (ritualProcMatch) {
      const varName = ritualProcMatch[1];
      effectsByVar.set(varName, {
        id: varName,
        categories: [],
        types: [],
        properties: [],
        events: [],
        clonedTo: [],
      });
      effectOrder.push(varName);
      summonProcedures.push({
        kind: 'Ritual',
        rawCall: line.trim(),
        opaque: false,
        decoded: { slots: [], notes: ['Ritual.CreateProc (sacrifice-based ritual summon)'] },
      });
      continue;
    }

    const cloneMatch = EFFECT_CLONE_RE.exec(line);
    if (cloneMatch) {
      const [, newVar, srcVar] = cloneMatch;
      const src = effectsByVar.get(srcVar);
      if (!src) {
        warnings.push(`Clone of unknown effect var "${srcVar}" on line ${i + 1}`);
        continue;
      }
      // Clone inherits all fields; overrides will be applied via subsequent :Set* calls.
      effectsByVar.set(newVar, {
        ...src,
        id: newVar,
        categories: [...src.categories],
        types: [...src.types],
        properties: [...src.properties],
        events: [...src.events],
        clonedFrom: srcVar,
        clonedTo: [],
      });
      src.clonedTo.push(newVar);
      effectOrder.push(newVar);
      continue;
    }

    const methodMatch = EFFECT_METHOD_RE.exec(line);
    if (methodMatch) {
      const [, varName, method, args] = methodMatch;
      const eff = effectsByVar.get(varName);
      if (!eff) continue;       // call on unrelated variable
      applyMethod(eff, method, args.trim(), warnings, i + 1);
      continue;
    }

    if (EFFECT_REGISTER_RE.exec(line)) continue;  // finalization marker; no-op for parser

    const lnMatch = LISTED_NAMES_RE.exec(line);
    if (lnMatch) {
      for (const tok of lnMatch[1].split(',')) {
        const t = tok.trim();
        if (t === 'id') listedNames.push(cardId);
        else if (/^\d+$/.test(t)) listedNames.push(Number(t));
      }
      continue;
    }

    const lsMatch = LISTED_SERIES_RE.exec(line);
    if (lsMatch) {
      for (const tok of lsMatch[1].split(',')) {
        const t = tok.trim();
        if (t) listedSeries.push(t);
      }
      continue;
    }

    const spMatch = SUMMON_PROC_RE.exec(line);
    if (spMatch) {
      const raw = line.trim();
      const kind = spMatch[1] as SummonProcedure['kind'];
      const decoded = decodeSummonProc(kind, raw);
      summonProcedures.push({
        kind,
        rawCall: raw,
        opaque: decoded === undefined,
        ...(decoded ? { decoded } : {}),
      });
      continue;
    }
  }

  // Finalize effects.
  const effects: Effect[] = effectOrder.map(varName => {
    const raw = effectsByVar.get(varName)!;
    const out: Effect = {
      id: raw.id,
      categories: raw.categories,
      types: raw.types,
      properties: raw.properties,
      events: raw.events,
    };
    if (raw.descriptionStringId) out.descriptionStringId = raw.descriptionStringId;
    if (raw.range) out.range = raw.range;
    if (raw.targetRange) out.targetRange = raw.targetRange;
    if (raw.countLimit) out.countLimit = raw.countLimit;
    if (raw.conditionRaw) out.condition = buildFunctionRef(raw.conditionRaw, functionBodies);
    if (raw.costRaw) out.cost = buildFunctionRef(raw.costRaw, functionBodies);
    if (raw.targetRaw) out.target = buildFunctionRef(raw.targetRaw, functionBodies);
    if (raw.operationRaw) out.operation = buildFunctionRef(raw.operationRaw, functionBodies);
    if (raw.valueRaw) {
      const asFunc = buildFunctionRef(raw.valueRaw, functionBodies);
      out.value = asFunc.opaque && !asFunc.name && !asFunc.inline
        ? { literal: raw.valueRaw }
        : asFunc;
    }
    if (raw.clonedFrom) out.clonedFrom = raw.clonedFrom;
    if (raw.clonedTo.length > 0) out.clonedTo = raw.clonedTo;
    return out;
  });

  // Coverage summary. A ref is fully decoded when we've extracted at least one
  // concrete signal: complete filter, resolved helper, visible Duel actions, or
  // a registered side-effect. Partial filter with no other signal is partial.
  let fullyDecoded = 0;
  let partiallyDecoded = 0;
  let opaqueUndecoded = 0;
  let totalFunctionRefs = 0;
  for (const e of effects) {
    for (const ref of [e.condition, e.cost, e.target, e.operation]) {
      if (!ref) continue;
      totalFunctionRefs++;
      const hasFullFilter = ref.simpleFilter?.complete === true;
      const hasPartialFilter = ref.simpleFilter !== undefined && !ref.simpleFilter.complete;
      const hasResolved = ref.resolved !== undefined;
      const hasActions = (ref.actions?.length ?? 0) > 0;
      const hasSideEffects = (ref.sideEffects?.length ?? 0) > 0;
      if (hasFullFilter || hasResolved || hasActions || hasSideEffects) fullyDecoded++;
      else if (hasPartialFilter) partiallyDecoded++;
      else opaqueUndecoded++;
    }
  }

  return {
    cardId,
    name: cardName,
    sourceFile: path.split(/[/\\]/).slice(-2).join('/'),
    parserVersion: PARSER_VERSION,
    parsedAt: new Date().toISOString().slice(0, 10),
    listedNames,
    listedSeries,
    summonProcedures,
    effects,
    coverage: {
      totalEffects: effects.length,
      totalFunctionRefs,
      fullyDecoded,
      partiallyDecoded,
      opaqueUndecoded,
    },
    warnings,
  };
}

function applyMethod(
  eff: ReturnType<() => ReturnType<typeof Object.create> & {
    categories: string[]; types: string[]; properties: string[]; events: string[];
    countLimit?: { count: number; key: string };
    range?: string; targetRange?: { self: string; opponent: string };
    descriptionStringId?: string;
    conditionRaw?: string; costRaw?: string; targetRaw?: string; operationRaw?: string; valueRaw?: string;
  }>,
  method: string,
  args: string,
  warnings: string[],
  line: number,
): void {
  switch (method) {
    case 'SetCategory':
      eff.categories = parseOrExpression(args);
      break;
    case 'SetType':
      eff.types = parseOrExpression(args);
      break;
    case 'SetProperty':
      eff.properties = parseOrExpression(args);
      break;
    case 'SetCode':
      // SetCode sets a single event/effect code. Clones with different SetCode accumulate via events[].
      eff.events.push(args.trim());
      break;
    case 'SetRange':
      eff.range = args.trim();
      break;
    case 'SetTargetRange': {
      const parts = splitTopLevelArgs(args);
      if (parts.length === 2) eff.targetRange = { self: parts[0].trim(), opponent: parts[1].trim() };
      else warnings.push(`SetTargetRange with unexpected arity ${parts.length} on line ${line}`);
      break;
    }
    case 'SetCountLimit': {
      const parts = splitTopLevelArgs(args);
      const count = Number(parts[0]?.trim());
      const key = parts[1]?.trim() ?? 'id';
      if (Number.isFinite(count)) eff.countLimit = { count, key };
      break;
    }
    case 'SetDescription': {
      // aux.Stringid(id, N) → capture N
      const m = /aux\.Stringid\s*\(\s*id\s*,\s*(\d+)\s*\)/.exec(args);
      if (m) eff.descriptionStringId = m[1];
      break;
    }
    case 'SetCondition':  eff.conditionRaw = args; break;
    case 'SetCost':       eff.costRaw = args; break;
    case 'SetTarget':     eff.targetRaw = args; break;
    case 'SetOperation':  eff.operationRaw = args; break;
    case 'SetValue':      eff.valueRaw = args; break;
    // Explicitly ignored — informational / timing metadata that doesn't change what the effect does.
    case 'SetLabel':
    case 'SetLabelObject':
    case 'SetOwnerPlayer':
    case 'SetHintTiming':
    case 'SetReset':
    case 'SetAbsoluteRange':
    case 'SetHint':
      break;
    default:
      // Flag unknown Set* calls so future versions can prioritize.
      if (method.startsWith('Set')) warnings.push(`Unhandled method ${method}(${args}) on line ${line}`);
  }
}

/** Parse "A + B + C" or "A | B | C" into tokens. OR-expressions in SetCategory/SetType use `+`. */
function parseOrExpression(args: string): string[] {
  return args.split(/\s*\+\s*|\s*\|\s*/).map(s => s.trim()).filter(s => s.length > 0);
}

/** Split arguments at top-level commas (ignoring nested parens). */
function splitTopLevelArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of args) {
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Build a FunctionRef from a raw argument string + function body lookup.
 *  For filter-signature functions `(c)` or `(c, ...)` with return c:Is*, decode AND-chain.
 *  For target/cost/op functions with complex bodies, detect `IsExistingMatchingCard(s.filter, ...)`
 *  delegation and recursively decode the referenced filter. Otherwise attempt helper resolution
 *  (v2) or fall back to opaque. */
function buildFunctionRef(raw: string, bodies: Map<string, { signature: string; body: string }>): FunctionRef {
  const trimmed = raw.trim();

  // v2: try helper resolver first — covers Cost.*, Fusion.*, aux.*, etc.
  const resolved = resolveHelper(trimmed);

  const nameMatch = /^s\.(\w+)$/.exec(trimmed);
  if (nameMatch) {
    const fname = nameMatch[1];
    const entry = bodies.get(fname);
    if (!entry) return { name: `s.${fname}`, opaque: true };

    const cardName = getCardParamName(entry.signature);
    if (cardName !== undefined) {
      const simple = tryExtractSimpleFilter(entry.body, cardName);
      if (simple) return { name: `s.${fname}`, simpleFilter: simple, opaque: !simple.complete };
      return { name: `s.${fname}`, opaque: true };
    }

    // Non-filter signature: walk the body for delegated filters + actions + side-effects.
    return buildNonFilterRef(`s.${fname}`, entry.body, bodies);
  }

  // Higher-order call: `s.wrapper(arg1, arg2)`. When `s.wrapper` is a closure factory
  // whose body is `return function(...) <body> end`, we textually substitute the
  // wrapper's parameters with the call args and analyze the substituted body.
  // Pattern from Code Igniter: `s.thtg(s.thfilter1)` — `thtg` returns a target fn
  // that references `filter` which is actually `s.thfilter1`.
  const hoMatch = /^s\.(\w+)\((.*)\)$/s.exec(trimmed);
  if (hoMatch) {
    const resolvedHo = resolveHigherOrderCall(hoMatch[1], hoMatch[2], bodies);
    if (resolvedHo) return { ...resolvedHo, inline: trimmed };
  }

  const inlineBody = /^function\s*\(([^)]*)\)\s+return\s+([\s\S]*?)\s+end$/s.exec(trimmed);
  if (inlineBody) {
    const cardName = getCardParamName(inlineBody[1]);
    if (cardName !== undefined) {
      const simple = tryExtractSimpleFilter(`return ${inlineBody[2]}`, cardName);
      if (simple) {
        const r: FunctionRef = { inline: trimmed, simpleFilter: simple, opaque: !simple.complete };
        if (resolved) r.resolved = resolved;
        return r;
      }
    }
  }

  // Inline non-filter lambda: `function(e,tp,...) <body> end` — AST-walk body.
  const inlineFull = /^function\s*\(([^)]*)\)\s+([\s\S]*)\s+end$/.exec(trimmed);
  if (inlineFull && !isFilterSignature(inlineFull[1])) {
    const inlineR = buildNonFilterRef(undefined, inlineFull[2], bodies);
    if (!inlineR.opaque || inlineR.actions || inlineR.sideEffects || inlineR.simpleFilter) {
      const r: FunctionRef = { inline: trimmed, opaque: inlineR.opaque };
      if (inlineR.simpleFilter)  r.simpleFilter  = inlineR.simpleFilter;
      if (inlineR.actions)       r.actions       = inlineR.actions;
      if (inlineR.sideEffects)   r.sideEffects   = inlineR.sideEffects;
      if (resolved)              r.resolved      = resolved;
      return r;
    }
  }

  const r: FunctionRef = { inline: trimmed, opaque: !resolved };
  if (resolved) r.resolved = resolved;
  return r;
}

/** Resolve a higher-order call like `s.thtg(s.thfilter1)`. Returns a FunctionRef
 *  describing the closure returned by the wrapper, with the wrapper's parameters
 *  textually substituted by the call args before analysis. Returns undefined when
 *  the wrapper's body isn't the recognizable `return function(...) <body> end` shape. */
function resolveHigherOrderCall(
  wrapperName: string,
  argString: string,
  bodies: Map<string, { signature: string; body: string }>,
): FunctionRef | undefined {
  const entry = bodies.get(wrapperName);
  if (!entry) return undefined;
  const paramNames = entry.signature.split(',').map(s => s.trim()).filter(s => s.length > 0);
  const callArgs = splitTopLevelArgs(argString).map(a => a.trim());
  if (paramNames.length !== callArgs.length) return undefined;

  // Wrapper body must be exactly `return function(<sig>) <body> end`.
  const closure = /^\s*return\s+function\s*\(([^)]*)\)\s+([\s\S]*?)\s+end\s*$/s.exec(entry.body);
  if (!closure) return undefined;
  const closureSig = closure[1];

  // Substitute wrapper params in closure body (word-boundary replace).
  let body = closure[2];
  for (let i = 0; i < paramNames.length; i++) {
    const name = paramNames[i];
    if (!/^\w+$/.test(name)) continue; // skip weird params
    body = body.replace(new RegExp(`\\b${name}\\b`, 'g'), callArgs[i]);
  }

  // If the closure is itself a filter, decode directly. Otherwise run the non-filter
  // analyzer so delegated filters and actions inside the closure are captured.
  const cardName = getCardParamName(closureSig);
  if (cardName !== undefined) {
    const simple = tryExtractSimpleFilter(body, cardName);
    if (simple) return { opaque: !simple.complete, simpleFilter: simple };
    return undefined;
  }
  return buildNonFilterRef(undefined, body, bodies);
}

/** Build a FunctionRef for a non-filter function body (target/cost/op/condition).
 *  `name` is `s.funcName` when looked up from the script's top-level functions, or
 *  undefined for inline lambdas. */
function buildNonFilterRef(
  name: string | undefined,
  body: string,
  bodies: Map<string, { signature: string; body: string }>,
): FunctionRef {
  const analysis = analyzeNonFilterBody(body, bodies);
  const r: FunctionRef = {
    ...(name !== undefined ? { name } : {}),
    opaque: true,
  };
  if (!analysis) return r;
  if (analysis.simpleFilter) {
    r.simpleFilter = analysis.simpleFilter;
    if (analysis.simpleFilter.complete) r.opaque = false;
  }
  if (analysis.actions)      { r.actions      = analysis.actions;      r.opaque = false; }
  if (analysis.sideEffects)  { r.sideEffects  = analysis.sideEffects;  r.opaque = false; }
  return r;
}

// =============================================================================
// v2 Helper resolver — hand-coded semantic mapping for the top ~15 helpers
// observed in the skytrix card pool. Covers Cost.*, Fusion.*, Synchro.*, aux.*.
// =============================================================================

interface ResolvedHelper {
  helper: string;
  kind: string;
  params?: Readonly<Record<string, unknown>>;
}

/** Known Cost.* helper names mapped to their semantic kind. Arg shapes vary
 *  (e.g. `DetachFromSelf(1)`, `DetachFromSelf(1,1,nil)`) — the resolver keeps
 *  the raw args as `params.args` rather than enumerating every form. */
const COST_HELPER_KINDS: Readonly<Record<string, string>> = {
  DetachFromSelf: 'detach-material',
  Discard: 'discard',
  SelfDiscard: 'discard',
  SelfTribute: 'tribute',
  SelfRelease: 'tribute',
  SelfToGrave: 'send-to-grave',
  SelfBanish: 'banish',
  SelfToExtra: 'return-to-extra',
  SelfReveal: 'reveal',
  PayLP: 'pay-lp',
  HalfLP: 'pay-lp',
};

/** Resolve a helper call (pure function reference, no wrapping) into structured semantics.
 *  Returns undefined if no known helper pattern matches. */
function resolveHelper(expr: string): ResolvedHelper | undefined {
  // Cost.* — match `Cost.Name` with any trailing call shape. Multi-arg forms like
  // `Cost.DetachFromSelf(1,1,nil)` or `Cost.Discard(1,s.filter)` are common and
  // must all resolve even if we don't parse every argument.
  const costMatch = /^Cost\.(\w+)\s*(?:\((.*)\))?\s*$/.exec(expr);
  if (costMatch) {
    const helperName = costMatch[1];
    const argStr = costMatch[2] ?? '';
    const costKind = COST_HELPER_KINDS[helperName];
    if (costKind) {
      const params: Record<string, unknown> = {};
      if (argStr.trim().length > 0) params.args = splitTopLevelArgs(argStr).map(s => s.trim());
      return { helper: `Cost.${helperName}`, kind: costKind, params };
    }
  }

  // Fusion.* — delegating wrappers. Semantics: Fusion Summon from ED using declared materials.
  if (/^Fusion\.SummonEffTG(\b|\()/.test(expr)) {
    return { helper: 'Fusion.SummonEffTG', kind: 'fusion-summon-target', params: { note: 'Fusion summon target; material requirements declared by AddProcMix on the same card' } };
  }
  if (/^Fusion\.SummonEffOP(\b|\()/.test(expr)) {
    return { helper: 'Fusion.SummonEffOP', kind: 'fusion-summon-operation' };
  }

  // aux.FilterBoolFunction(Card.IsX, value) / aux.FilterBoolFunctionEx(...) — synthesizes a filter
  // predicate matching cards where Card.IsX(value) is true.
  const filterBool = /^aux\.FilterBoolFunction(?:Ex)?\s*\(\s*Card\.(Is\w+)\s*,\s*([^)]+?)\s*\)$/.exec(expr);
  if (filterBool) {
    return {
      helper: `aux.FilterBoolFunction${expr.includes('Ex') ? 'Ex' : ''}`,
      kind: 'filter-wrap',
      params: { predicate: filterBool[1], value: filterBool[2].trim() },
    };
  }

  // aux.NOT(predicate) — negate
  const notHelper = /^aux\.NOT\s*\(\s*(.+)\s*\)$/.exec(expr);
  if (notHelper) {
    return { helper: 'aux.NOT', kind: 'negate', params: { inner: notHelper[1].trim() } };
  }

  // aux.tgoval / aux.TargetBoolFunction / aux.FaceupFilter — less common, flag by name only
  if (/^aux\.(tgoval|TargetBoolFunction|FaceupFilter)\b/.test(expr)) {
    const m = /^aux\.(\w+)/.exec(expr);
    return { helper: `aux.${m![1]}`, kind: 'aux-helper' };
  }

  // Synchro.NonTuner(filter) — filter synthesized for non-Tuner material slot
  const synchroNonTuner = /^Synchro\.NonTuner\s*\(\s*(.+)\s*\)$/.exec(expr);
  if (synchroNonTuner) {
    return { helper: 'Synchro.NonTuner', kind: 'synchro-non-tuner-filter', params: { innerFilter: synchroNonTuner[1].trim() } };
  }

  return undefined;
}

/** A signature is filter-like when one of its parameters is the card being filtered.
 *  Canonical shapes:
 *    - `(c)` / `(c,...)` — classic filter, first param is the card
 *    - `(e,c)` / `(e,c,...)` — effect context + card (material filter, target-validity filter)
 *    - `(_,c)` — ignored first param + card
 *    - Underscore variants `(_c)` / `(e,_c)` are accepted too (Promethean Princess idiom). */
function isFilterSignature(sig: string): boolean {
  return getCardParamName(sig) !== undefined;
}

/** Return the identifier used for the filtered card, or undefined if this isn't a filter. */
function getCardParamName(sig: string): string | undefined {
  const params = sig.split(',').map(s => s.trim()).filter(s => s.length > 0);
  if (params.length === 0) return undefined;
  const looksLikeCard = (p: string) => p === 'c' || p === '_c';
  if (looksLikeCard(params[0])) return params[0];
  // Shapes (e,c) / (_,c) / (e,c,og) / (e,c,...) — second param is the card.
  if (params.length >= 2 && (params[0] === 'e' || params[0] === '_' || params[0] === '_e')
      && looksLikeCard(params[1])) return params[1];
  return undefined;
}

/** v4: AST-based filter extraction via luaparse. Handles multi-statement bodies,
 *  nested and/or, `if chk==0 then return X end` patterns, and inline lambdas.
 *  Falls back to regex-based v1 extractor on parse failure. */
function tryExtractSimpleFilter(body: string, cardName: string = 'c'): SimpleFilter | undefined {
  const wrapped = `function __extract__() ${body} end`;
  let ast: luaparse.Chunk;
  try {
    ast = luaparse.parse(wrapped, { comments: false, locations: false, luaVersion: '5.3' });
  } catch {
    return tryExtractSimpleFilterRegex(body);
  }
  const fnDecl = ast.body[0];
  if (!fnDecl || fnDecl.type !== 'FunctionDeclaration') return tryExtractSimpleFilterRegex(body);
  return extractFilterFromStatements(fnDecl.body, cardName);
}

/** Walk a function body's statements, finding the primary return whose
 *  arguments describe card-shape predicates. Skips `if chk==0 then return ... end`
 *  boilerplate — these are targeting-protocol lines, not filter logic. */
function extractFilterFromStatements(
  stmts: readonly luaparse.Statement[],
  cardName: string = 'c',
): SimpleFilter | undefined {
  // Primary pattern: last return statement, or the non-chk==0 branch of an if.
  for (const stmt of stmts) {
    if (stmt.type === 'ReturnStatement' && stmt.arguments.length === 1) {
      return astExprToFilter(stmt.arguments[0], cardName);
    }
  }
  // Look for `if chk == 0 then return A end; <rest>` — extract from the top-level
  // return within the `if` block OR from a return later in stmts.
  for (const stmt of stmts) {
    if (stmt.type === 'IfStatement') {
      // If the condition is `chk == 0` or similar protocol boilerplate, skip.
      // Otherwise try the inner body's return.
      for (const clause of stmt.clauses) {
        const inner = extractFilterFromStatements(clause.body, cardName);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

/** Convert a luaparse expression AST to SimpleFilter by walking and/or chains
 *  and decoding leaf `c:IsX(args)` predicates. `cardName` is the parameter that
 *  refers to the filtered card (usually `c`; sometimes `_c`, or synthesized from
 *  `e:GetHandler()` for condition bodies). */
function astExprToFilter(expr: luaparse.Expression, cardName: string = 'c'): SimpleFilter | undefined {
  const raw = walkAndChain(expr).map(l => astPredicateFromExpr(l, cardName));
  // Drop gate-local-var leaves that just guard the chain (e.g. `ft>0 and c:IsX()`
  // or `szone_chk and c:IsContinuousSpellTrap()`). They don't describe the card
  // being filtered, so stripping them does not misrepresent the filter and lets
  // the remaining card predicates express completeness.
  const predicates = raw.filter(p => !isGateLeaf(p));
  if (predicates.length === 0) return undefined;
  return { predicates, complete: predicates.every(isPredComplete) };
}

/** A `raw` leaf that references no card-shaped primitive (c:, e:, Duel., Card., s.).
 *  These are local-var gates sprinkled into filter bodies as preconditions.
 *  v7 additions: also strip gates that describe the EVENT/REASON context
 *  rather than card identity — event-group existence checks, reason-effect
 *  checks, Duel-scope existence queries. Stripping them lets the remaining
 *  card predicates express completeness. */
function isGateLeaf(pred: FilterPredicate): boolean {
  if (pred.kind !== 'raw') return false;
  const src = pred.source;
  // Non-card-identity gates (v7): eg:/re: event-group + reason-effect context
  // probes, and specific Duel.* existence/state checks that don't involve the
  // filtered card. NOT included: Duel.GetAttacker (can appear in comparisons
  // like `Duel.GetAttacker()==c` which DO filter on identity).
  if (/^(?:eg|re):\w+\b/.test(src)) return true;
  if (/^Duel[.:](?:IsExistingMatchingCard|CheckReleaseGroupCost|IsPlayerCanSpecialSummon\w*|GetMatchingGroup(?:Count)?|GetFlagEffect|GetLocationCount|IsMainPhase|IsChainDisablable)\b/.test(src)) return true;
  if (/\b(?:c|e|_c|_e|Duel|Card|s|aux|re|rc|tc|rp|ep|tp)[.:]/.test(src)) return false;
  if (/^\w+$/.test(src)) return true;
  if (/^\w+\s*(?:==|~=|<=|>=|<|>)\s*\w+$/.test(src)) return true;
  return false;
}

function isPredComplete(p: FilterPredicate): boolean {
  if (p.kind === 'raw') return false;
  if (p.kind === 'not') return isPredComplete(p.inner);
  if (p.kind === 'or') return p.predicates.every(isPredComplete);
  return true;
}

/** Walk a logical `and` chain, yielding each conjunct as a separate expression. */
function walkAndChain(expr: luaparse.Expression): luaparse.Expression[] {
  if (expr.type === 'LogicalExpression' && expr.operator === 'and') {
    return [...walkAndChain(expr.left), ...walkAndChain(expr.right)];
  }
  return [expr];
}

/** Walk a logical `or` chain, yielding each disjunct as a separate expression. */
function walkOrChain(expr: luaparse.Expression): luaparse.Expression[] {
  if (expr.type === 'LogicalExpression' && expr.operator === 'or') {
    return [...walkOrChain(expr.left), ...walkOrChain(expr.right)];
  }
  return [expr];
}

/** Decode a single expression (typically a c:IsX(arg) call) into a FilterPredicate.
 *  `cardName` names the Lua identifier that refers to the filtered card — usually
 *  `c`, sometimes `_c`. `e:GetHandler()` is also recognized as a card receiver
 *  so condition bodies like `function(e) return e:GetHandler():IsX() end` decode
 *  identically to their `function(c) return c:IsX() end` filter equivalents. */
function astPredicateFromExpr(expr: luaparse.Expression, cardName: string = 'c'): FilterPredicate {
  // Disjunction: `A or B` → `or` composite. Nested `or`s are flattened.
  if (expr.type === 'LogicalExpression' && expr.operator === 'or') {
    const leaves = walkOrChain(expr);
    return { kind: 'or', predicates: leaves.map(l => astPredicateFromExpr(l, cardName)) };
  }
  // Negation: `not X`
  if (expr.type === 'UnaryExpression' && expr.operator === 'not') {
    const inner = astPredicateFromExpr(expr.argument, cardName);
    return { kind: 'not', inner };
  }
  // Method call on card receiver: `c:IsX(arg)` or `e:GetHandler():IsX(arg)`.
  if (expr.type === 'CallExpression' && expr.base.type === 'MemberExpression'
      && expr.base.indexer === ':' && isCardReceiver(expr.base.base, cardName)) {
    const method = expr.base.identifier.name;
    const argRaw = expr.arguments[0] ? exprToString(expr.arguments[0]) : '';
    return decodeMethodPredicate(method, argRaw, `c:${method}(${argRaw})`);
  }
  // Comparison: `c:GetLevel() == N` / `c:GetAttack() > N` / `c:GetOverlayCount() > 0`.
  if (expr.type === 'BinaryExpression' && isComparisonOp(expr.operator)) {
    const cmp = decodeAttrCompare(expr, cardName);
    if (cmp) return cmp;
    // Game-state comparison: `Duel.GetFlagEffect(tp,id) > 0` etc.
    const gs = decodeGameStateCompare(expr);
    if (gs) return gs;
  }
  // Bare game-state call: `Duel.IsMainPhase()` / `Duel.IsPhase(X)` / `Duel.IsChainDisablable(ev)`.
  if (expr.type === 'CallExpression' && isDuelCall(expr)) {
    const method = (expr.base as luaparse.MemberExpression).identifier.name;
    if (DUEL_STATE_CHECKS.has(method)) {
      const args = expr.arguments.map(exprToString);
      return args.length > 0 ? { kind: 'gameState', method, args } : { kind: 'gameState', method };
    }
  }
  return { kind: 'raw', source: exprToString(expr) };
}

/** True when `base` is a reference to the filtered card — either the bound identifier
 *  or the idiomatic `e:GetHandler()` call used in condition bodies. */
function isCardReceiver(base: luaparse.Expression, cardName: string): boolean {
  if (base.type === 'Identifier' && (base.name === cardName || base.name === 'c')) return true;
  // `e:GetHandler()` → CallExpression on Identifier:GetHandler
  if (base.type === 'CallExpression'
      && base.base.type === 'MemberExpression'
      && base.base.indexer === ':'
      && base.base.identifier.name === 'GetHandler'
      && base.base.base.type === 'Identifier'
      && (base.base.base.name === 'e' || base.base.base.name === '_e')) {
    return true;
  }
  return false;
}

function isComparisonOp(op: string): boolean {
  return op === '==' || op === '~=' || op === '<' || op === '<=' || op === '>' || op === '>=';
}

/** Card attribute accessors paired with their FilterPredicate "attr" kind. */
const CARD_ATTR_GETTERS: Readonly<Record<string, 'level' | 'atk' | 'def' | 'rank' | 'link' | 'overlayCount'>> = {
  GetLevel: 'level',
  GetAttack: 'atk',
  GetBaseAttack: 'atk',
  GetDefense: 'def',
  GetBaseDefense: 'def',
  GetRank: 'rank',
  GetLink: 'link',
  GetOverlayCount: 'overlayCount',
};

/** Decode `c:GetX() OP N` as a typed numeric comparison. */
function decodeAttrCompare(
  expr: luaparse.BinaryExpression,
  cardName: string,
): FilterPredicate | undefined {
  // Either side may hold the getter — normalize so `getter` is the call.
  let getter: luaparse.CallExpression | undefined;
  let other: luaparse.Expression | undefined;
  let op: string = expr.operator;
  if (expr.left.type === 'CallExpression') { getter = expr.left; other = expr.right; }
  else if (expr.right.type === 'CallExpression') {
    getter = expr.right; other = expr.left;
    // Swap the comparison so semantics read "c:GetX() OP N" left-to-right.
    op = ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as Record<string,string>)[op] ?? op;
  }
  if (!getter || !other) return undefined;
  if (!(getter.base.type === 'MemberExpression'
      && getter.base.indexer === ':'
      && isCardReceiver(getter.base.base, cardName))) return undefined;
  const attr = CARD_ATTR_GETTERS[getter.base.identifier.name];
  if (!attr) return undefined;
  const raw = exprToString(other);
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return { kind: 'attrCompare', attr, op, value: n };
}

/** Duel.* methods that return a boolean the condition body cares about. */
const DUEL_STATE_CHECKS = new Set([
  'IsMainPhase', 'IsBattlePhase', 'IsEndPhase', 'IsDamageStep', 'IsPhase',
  'IsTurnPlayer', 'IsChainDisablable', 'IsPlayerCanDiscardDeck',
  'IsPlayerCanDraw', 'IsPlayerCanSpecialSummon', 'IsPlayerAffectedByEffect',
]);

/** Duel.* methods that return a count; decoded as a comparison. */
const DUEL_COUNT_CHECKS = new Set([
  'GetLocationCount', 'GetMZoneCount', 'GetFieldGroupCount', 'GetFlagEffect',
  'GetCustomActivityCount', 'GetMatchingGroupCount', 'GetTurnCount',
]);

/** Decode `Duel.GetFlagEffect(tp,id) > 0` / `Duel.GetLocationCount(tp,LOCATION_MZONE) > 0`. */
function decodeGameStateCompare(expr: luaparse.BinaryExpression): FilterPredicate | undefined {
  let call: luaparse.CallExpression | undefined;
  let other: luaparse.Expression | undefined;
  let op: string = expr.operator;
  if (expr.left.type === 'CallExpression') { call = expr.left; other = expr.right; }
  else if (expr.right.type === 'CallExpression') {
    call = expr.right; other = expr.left;
    op = ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as Record<string,string>)[op] ?? op;
  }
  if (!call || !other || !isDuelCall(call)) return undefined;
  const method = (call.base as luaparse.MemberExpression).identifier.name;
  if (!DUEL_COUNT_CHECKS.has(method)) return undefined;
  const args = call.arguments.map(exprToString);
  const value = exprToString(other);
  return { kind: 'gameState', method, args, op, value };
}

/** Convert a luaparse expression back to a readable string for fallback / opaque cases. */
function exprToString(expr: luaparse.Expression): string {
  switch (expr.type) {
    case 'Identifier':       return expr.name;
    case 'NumericLiteral':   return String(expr.value);
    case 'StringLiteral':    return expr.raw ?? '';
    case 'BooleanLiteral':   return String(expr.value);
    case 'NilLiteral':       return 'nil';
    case 'MemberExpression':
      return `${exprToString(expr.base)}${expr.indexer}${expr.identifier.name}`;
    case 'CallExpression':
      return `${exprToString(expr.base)}(${expr.arguments.map(exprToString).join(',')})`;
    case 'BinaryExpression':
      return `${exprToString(expr.left)}${expr.operator}${exprToString(expr.right)}`;
    case 'LogicalExpression':
      return `${exprToString(expr.left)} ${expr.operator} ${exprToString(expr.right)}`;
    case 'UnaryExpression':
      return `${expr.operator} ${exprToString(expr.argument)}`;
    default:
      return `<${expr.type}>`;
  }
}

/** v1 fallback — kept for resilience when AST parsing fails (malformed Lua, unusual syntax). */
function tryExtractSimpleFilterRegex(body: string): SimpleFilter | undefined {
  const trimmed = body.trim();
  const m = /^return\s+([\s\S]+?)\s*$/.exec(trimmed);
  if (!m) return undefined;
  const expr = m[1].trim();
  if (/\b(if|elseif|else|local|do|while|for|repeat|then|function)\b/.test(expr)) return undefined;
  const clauses = splitAndChain(expr);
  if (clauses.length === 0) return undefined;
  const predicates: FilterPredicate[] = [];
  let complete = true;
  for (const clause of clauses) {
    const pred = decodeClause(clause.trim());
    predicates.push(pred);
    if (pred.kind === 'raw') complete = false;
  }
  return { predicates, complete };
}

function splitAndChain(expr: string): string[] {
  // Split on " and " at top-level paren depth.
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && expr.substr(i, 5) === ' and ') {
      out.push(expr.slice(start, i));
      start = i + 5;
      i += 4;
    }
  }
  out.push(expr.slice(start));
  return out;
}

function decodeClause(clause: string): FilterPredicate {
  // "not c:IsX(...)" → negated
  const notMatch = /^not\s+(.*)$/.exec(clause);
  if (notMatch) {
    const inner = decodeClause(notMatch[1].trim());
    return { kind: 'not', inner };
  }
  // "c:MethodName(args)" — arg can be empty, or a balanced expression. Use simple paren-balanced match.
  const m = /^c:(\w+)\((.*)\)$/.exec(clause);
  if (!m) return { kind: 'raw', source: clause };
  const method = m[1];
  const arg = m[2].trim();
  return decodeMethodPredicate(method, arg, clause);
}

function decodeMethodPredicate(method: string, arg: string, clause: string): FilterPredicate {
  switch (method) {
    case 'IsAttribute':            return { kind: 'attribute', value: arg };
    case 'IsRace':                 return { kind: 'race', value: arg };
    case 'IsType':                 return { kind: 'type', value: arg };
    case 'IsLevel':                return { kind: 'level', value: Number(arg) };
    case 'IsLevelAbove':           return { kind: 'levelAbove', value: Number(arg) };
    case 'IsLevelBelow':           return { kind: 'levelBelow', value: Number(arg) };
    case 'IsRank':                 return { kind: 'rank', value: Number(arg) };
    case 'IsRankAbove':            return { kind: 'rankAbove', value: Number(arg) };
    case 'IsRankBelow':            return { kind: 'rankBelow', value: Number(arg) };
    case 'IsAttack':               return { kind: 'atk', value: Number(arg) };
    case 'IsAttackAbove':          return { kind: 'atkAbove', value: Number(arg) };
    case 'IsAttackBelow':          return { kind: 'atkBelow', value: Number(arg) };
    case 'IsDefense':              return { kind: 'def', value: Number(arg) };
    case 'IsCode':                 return { kind: 'code', value: arg === 'id' ? 'self' : Number(arg) };
    case 'IsSetCard':              return { kind: 'setCard', value: arg };
    case 'IsFaceup':               return { kind: 'faceup' };
    case 'IsFacedown':             return { kind: 'facedown' };
    case 'IsMonster':              return { kind: 'monster' };
    case 'IsSpellTrap':            return { kind: 'spellTrap' };
    case 'IsSpell':                return { kind: 'spell' };
    case 'IsTrap':                 return { kind: 'trap' };
    case 'IsAbleToHand':           return { kind: 'ableToHand' };
    case 'IsAbleToGrave':          return { kind: 'ableToGrave' };
    case 'IsAbleToGraveAsCost':    return { kind: 'ableToGraveAsCost' };
    case 'IsAbleToDeck':           return { kind: 'ableToDeck' };
    case 'IsAbleToRemove':         return { kind: 'ableToRemove' };
    case 'IsAbleToExtra':          return { kind: 'ableToExtra' };
    case 'IsAbleToTribute':
    case 'IsReleasable':           return { kind: 'canBeTributed' };
    case 'IsCanBeSpecialSummoned': return { kind: 'canBeSpecialSummoned' };
    case 'IsCanBeEffectTarget':    return { kind: 'canBeEffectTarget' };
    case 'IsCanBeSynchroMaterial': return { kind: 'canBeSynchroMaterial' };
    case 'IsCanBeFusionMaterial':  return { kind: 'canBeFusionMaterial' };
    case 'IsCanBeXyzMaterial':     return { kind: 'canBeXyzMaterial' };
    case 'IsCanBeLinkMaterial':    return { kind: 'canBeLinkMaterial' };
    case 'IsCanBeRitualMaterial':  return { kind: 'canBeRitualMaterial' };
    case 'IsCanBeDisabledByEffect':return { kind: 'canBeDisabledByEffect' };
    case 'IsCanBeBattleTarget':    return { kind: 'canBeBattleTarget' };
    case 'IsDiscardable':          return { kind: 'discardable' };
    case 'IsLink':                 return { kind: 'link', value: Number(arg) };
    case 'IsLinkAbove':            return { kind: 'linkAbove', value: Number(arg) };
    case 'IsLinkBelow':            return { kind: 'linkBelow', value: Number(arg) };
    case 'IsLinkMonster':          return { kind: 'linkMonster' };
    case 'IsXyzMonster':           return { kind: 'xyzMonster' };
    case 'IsFusionMonster':        return { kind: 'fusionMonster' };
    case 'IsSynchroMonster':       return { kind: 'synchroMonster' };
    case 'IsRitualMonster':        return { kind: 'ritualMonster' };
    case 'IsEffectMonster':        return { kind: 'effectMonster' };
    case 'IsNegatableMonster':
    case 'IsNegatableEffect':      return { kind: 'negatable' };
    case 'IsForbidden':            return { kind: 'forbidden' };
    case 'IsSSetable':             return { kind: 'ssetable' };
    case 'IsSetable':              return { kind: 'setable' };
    case 'IsRelateToEffect':       return { kind: 'relateToEffect' };
    case 'IsLocation':             return { kind: 'location', value: arg };
    case 'IsOnField':              return { kind: 'onField' };
    case 'IsControler':            return { kind: 'controler', value: arg };
    case 'IsPreviousControler':    return { kind: 'previousControler', value: arg };
    case 'IsPlayer':               return { kind: 'player', value: arg };
    case 'IsPosition':             return { kind: 'position', value: arg };
    case 'IsReason':               return { kind: 'reason', value: arg };
    case 'CheckUniqueOnField':     return { kind: 'uniqueOnField' };
    case 'IsImmuneToEffect':       return { kind: 'immuneToEffect' };
    case 'HasFlagEffect':          return { kind: 'hasFlag', value: arg };
    case 'IsPublic':               return { kind: 'publicCard' };
    case 'IsSummonable':           return { kind: 'summonable' };
    case 'IsSpecialSummonable':    return { kind: 'specialSummonable' };
    case 'IsFieldSpell':           return { kind: 'fieldSpell' };
    case 'IsContinuousSpell':      return { kind: 'continuousSpell' };
    case 'IsContinuousTrap':       return { kind: 'continuousTrap' };
    case 'IsContinuousSpellTrap':  return { kind: 'continuousSpellTrap' };
    case 'IsRitualSpell':          return { kind: 'ritualSpell' };
    case 'IsNormalSpell':          return { kind: 'normalSpell' };
    case 'IsNormalTrap':           return { kind: 'normalTrap' };
    case 'IsNormalSpellTrap':      return { kind: 'normalSpellTrap' };
    case 'IsTrapMonster':          return { kind: 'trapMonster' };
    case 'IsNegatableSpellTrap':   return { kind: 'negatableSpellTrap' };
    case 'IsDisabled':             return { kind: 'disabled' };
    case 'IsReleasableByEffect':   return { kind: 'releasableByEffect' };
    case 'IsAttackPos':            return { kind: 'attackPos' };
    case 'IsDefensePos':           return { kind: 'defensePos' };
    case 'IsSequence':             return { kind: 'sequence', value: arg };
    case 'IsInExtraMZone':         return { kind: 'inExtraMZone' };
    case 'IsOriginalType':         return { kind: 'originalType', value: arg };
    case 'IsMonsterCard':          return { kind: 'monsterCard' };
    case 'IsLinkSummoned':         return { kind: 'linkSummoned' };
    case 'IsFusionSummoned':       return { kind: 'fusionSummoned' };
    case 'IsSynchroSummoned':      return { kind: 'synchroSummoned' };
    case 'IsXyzSummoned':          return { kind: 'xyzSummoned' };
    case 'IsRitualSummoned':       return { kind: 'ritualSummoned' };
    case 'IsPendulumSummoned':     return { kind: 'pendulumSummoned' };
    case 'ListsCode':              return { kind: 'listsCode', value: arg };
    case 'ListsCodeAsMaterial':    return { kind: 'listsCodeAsMaterial', value: arg };
    default:                       return { kind: 'raw', source: clause };
  }
}

// =============================================================================
// v5 Non-filter body AST analyzer — walks target/cost/op/condition bodies for
// (a) delegated filter references via Duel.IsExistingMatchingCard & friends,
// (b) visible Duel.* actions (send-to-deck, special-summon, etc.),
// (c) Effect.CreateEffect side-effect registrations.
// =============================================================================

interface NonFilterAnalysis {
  simpleFilter?: SimpleFilter;
  actions?: OperationAction[];
  sideEffects?: SideEffect[];
}

/** Lua methods on `Duel` whose first card-ish argument carries a filter. The filter
 *  is typically `s.X` or `Card.IsY` — both of which we know how to decode. */
const DUEL_FILTER_METHODS = new Set([
  'IsExistingMatchingCard', 'SelectMatchingCard',
  'IsExistingTarget', 'SelectTarget',
  'GetMatchingGroup', 'GetMatchingGroupCount',
  'GetFirstMatchingCard', 'GetFieldGroup',
]);

/** Lua methods on `Duel` that perform a visible game action. Mapped to a normalized
 *  action kind that downstream consumers can switch on. */
const DUEL_ACTION_MAP: Readonly<Record<string, string>> = {
  SendtoDeck: 'send-to-deck',
  SendtoHand: 'send-to-hand',
  SendtoGrave: 'send-to-grave',
  SendtoExtraP: 'send-to-extra-p',
  Destroy: 'destroy',
  Remove: 'banish',
  SpecialSummon: 'special-summon',
  SpecialSummonStep: 'special-summon-step',
  SpecialSummonComplete: 'special-summon-complete',
  Summon: 'normal-summon',
  MSet: 'monster-set',
  SSet: 'spell-trap-set',
  Draw: 'draw',
  MoveToField: 'move-to-field',
  NegateEffect: 'negate-effect',
  NegateActivation: 'negate-activation',
  NegateRelatedChain: 'negate-related-chain',
  Damage: 'damage',
  Recover: 'recover',
  DiscardHand: 'discard-hand',
  DiscardDeck: 'mill',
  ConfirmCards: 'confirm',
  ConfirmDecktop: 'confirm-decktop',
  Equip: 'equip',
  ChangePosition: 'change-position',
  Overlay: 'attach-xyz-material',
  BreakEffect: 'break-effect',
  ShuffleDeck: 'shuffle-deck',
  ShuffleHand: 'shuffle-hand',
  ShuffleExtra: 'shuffle-extra',
  Release: 'tribute',
};

function analyzeNonFilterBody(
  body: string,
  bodies: Map<string, { signature: string; body: string }>,
): NonFilterAnalysis | undefined {
  const wrapped = `function __extract__() ${body} end`;
  let ast: luaparse.Chunk;
  try {
    ast = luaparse.parse(wrapped, { comments: false, locations: false, luaVersion: '5.3' });
  } catch {
    return undefined;
  }
  const fnDecl = ast.body[0];
  if (!fnDecl || fnDecl.type !== 'FunctionDeclaration') return undefined;

  // Collect all statements in document order, descending into nested blocks.
  const flatStmts: luaparse.Statement[] = [];
  walkStmts(fnDecl.body, s => flatStmts.push(s));

  // Prefer a delegated filter when present (most informative). Try in order:
  //   1. delegated Duel.* filter calls (most informative — explicit filter ref)
  //   2. curried Fusion.SummonEff(TG|OP)(params)(...) — extracts fusfilter
  //   3. body's direct return expression — covers condition bodies like
  //      `function(e) return e:GetHandler():IsX() and Duel.IsMainPhase() end`
  // Curried Fusion is positioned BEFORE return-extraction because the raw
  // return falls back to opaque `raw` predicates that would shortcircuit the
  // chain (Faimena's s.fustg returns `Fusion.SummonEffTG(...)` directly).
  let simpleFilter = extractDelegatedFilterFromStmts(flatStmts, bodies);
  if (!simpleFilter) simpleFilter = extractCurriedFusionFilter(body);
  if (!simpleFilter) simpleFilter = extractReturnPredicateFromStmts(fnDecl.body);

  const actions = extractOperationActions(flatStmts);
  const sideEffects = extractSideEffects(flatStmts);

  const anyFound = simpleFilter !== undefined || actions.length > 0 || sideEffects.length > 0;
  if (!anyFound) return undefined;

  const out: NonFilterAnalysis = {};
  if (simpleFilter) out.simpleFilter = simpleFilter;
  if (actions.length > 0) out.actions = actions;
  if (sideEffects.length > 0) out.sideEffects = sideEffects;
  return out;
}

/** Extract a condition-style SimpleFilter from a non-filter body's return expression.
 *  `cardName` defaults to 'c', but astPredicateFromExpr separately recognizes
 *  `e:GetHandler():IsX()` as a handler predicate so condition bodies decode too.
 *  v7: when descending into `if <Identifier> then return X end`, pass the
 *  identifier name as cardName so target-callback validators like
 *  `if chkc then return chkc:IsLocation(...) end` decode `chkc:IsX(...)` as a
 *  card receiver instead of emitting them as raw. */
function extractReturnPredicateFromStmts(
  stmts: readonly luaparse.Statement[],
  cardName: string = 'c',
): SimpleFilter | undefined {
  for (const stmt of stmts) {
    if (stmt.type === 'ReturnStatement' && stmt.arguments.length === 1) {
      return astExprToFilter(stmt.arguments[0], cardName);
    }
    // Descend into `if` clauses whose bodies return — handles `if chkc then return X end`.
    if (stmt.type === 'IfStatement') {
      for (const c of stmt.clauses) {
        let nested = cardName;
        if (c.type === 'IfClause' && c.condition.type === 'Identifier') {
          // `if chkc then ...` → chkc is the card receiver inside the body.
          nested = c.condition.name;
        }
        const inner = extractReturnPredicateFromStmts(c.body, nested);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

/** Recursively visit every statement, descending into if/while/for/do bodies. */
function walkStmts(
  stmts: readonly luaparse.Statement[],
  visit: (s: luaparse.Statement) => void,
): void {
  for (const s of stmts) {
    visit(s);
    switch (s.type) {
      case 'IfStatement':
        for (const c of s.clauses) walkStmts(c.body, visit);
        break;
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'ForNumericStatement':
      case 'ForGenericStatement':
      case 'DoStatement':
        walkStmts(s.body, visit);
        break;
      // Nested FunctionDeclarations are closures (e.g. callbacks) — skip to avoid
      // picking up actions from unrelated scopes.
    }
  }
}

/** Visit every CallExpression nested inside an expression tree. */
function walkCallsInExpr(
  expr: luaparse.Expression,
  visit: (call: luaparse.CallExpression) => void,
): void {
  if (!expr) return;
  if (expr.type === 'CallExpression') {
    visit(expr);
    for (const arg of expr.arguments) walkCallsInExpr(arg, visit);
    walkCallsInExpr(expr.base, visit);
    return;
  }
  switch (expr.type) {
    case 'BinaryExpression':
    case 'LogicalExpression':
      walkCallsInExpr(expr.left, visit);
      walkCallsInExpr(expr.right, visit);
      break;
    case 'UnaryExpression':
      walkCallsInExpr(expr.argument, visit);
      break;
    case 'MemberExpression':
      walkCallsInExpr(expr.base, visit);
      break;
    case 'IndexExpression':
      walkCallsInExpr(expr.base, visit);
      walkCallsInExpr(expr.index, visit);
      break;
    case 'TableCallExpression':
    case 'StringCallExpression':
      walkCallsInExpr(expr.base, visit);
      break;
    case 'TableConstructorExpression':
      for (const f of expr.fields) {
        if ('value' in f) walkCallsInExpr(f.value, visit);
        if (f.type === 'TableKey') walkCallsInExpr(f.key, visit);
      }
      break;
    // Literals / Identifier: leaf, nothing to recurse.
  }
}

/** Walk every CallExpression inside any part of a statement. */
function walkCallsInStmt(
  stmt: luaparse.Statement,
  visit: (call: luaparse.CallExpression) => void,
): void {
  switch (stmt.type) {
    case 'CallStatement':
      walkCallsInExpr(stmt.expression as luaparse.Expression, visit);
      break;
    case 'LocalStatement':
    case 'AssignmentStatement':
      for (const e of stmt.init) walkCallsInExpr(e, visit);
      break;
    case 'ReturnStatement':
      for (const e of stmt.arguments) walkCallsInExpr(e, visit);
      break;
    case 'IfStatement':
      for (const c of stmt.clauses) {
        if ('condition' in c) walkCallsInExpr(c.condition, visit);
      }
      break;
    case 'WhileStatement':
    case 'RepeatStatement':
      walkCallsInExpr(stmt.condition, visit);
      break;
    case 'ForNumericStatement':
      walkCallsInExpr(stmt.start, visit);
      walkCallsInExpr(stmt.end, visit);
      if (stmt.step) walkCallsInExpr(stmt.step, visit);
      break;
    case 'ForGenericStatement':
      for (const e of stmt.iterators) walkCallsInExpr(e, visit);
      break;
    // LabelStatement, BreakStatement, GotoStatement, FunctionDeclaration, DoStatement: no interesting calls.
  }
}

/** Phase 14b: decode curried `Fusion.SummonEff(TG|OP)(params)(e,tp,...)` calls.
 *  The `params` is either a literal table `{...}` or an Identifier referencing
 *  a local table declared earlier in the body. We extract `params.fusfilter`
 *  (typically `aux.FilterBoolFunction(Card.IsX, value)`) and decode it via
 *  the existing predicate machinery. Returns undefined if no curried Fusion
 *  call is present, or if `fusfilter` can't be resolved to a single predicate. */
function extractCurriedFusionFilter(body: string): SimpleFilter | undefined {
  // Find Fusion.SummonEff(TG|OP)(<expr>)(...) — the trailing `(` distinguishes
  // curried form from a normal call.
  const curried = /Fusion\.SummonEff(?:TG|OP)\s*\(\s*([\s\S]*?)\s*\)\s*\(/.exec(body);
  if (!curried) return undefined;
  const paramExpr = curried[1].trim();

  // Resolve the param expression to a table-body string. Two cases:
  //  (a) `{ key=val, ... }` — literal table, use directly.
  //  (b) `<identifier>` — find `local <identifier> = { ... }` declaration.
  let tableBody: string | undefined;
  if (paramExpr.startsWith('{') && paramExpr.endsWith('}')) {
    tableBody = paramExpr.slice(1, -1);
  } else if (/^[a-zA-Z_]\w*$/.test(paramExpr)) {
    // Match `local params = { ... }` (allow newlines, single nesting OK).
    const localRe = new RegExp(`local\\s+${paramExpr}\\s*=\\s*\\{([\\s\\S]*?)\\}`, 'm');
    const localMatch = localRe.exec(body);
    if (localMatch) tableBody = localMatch[1];
  }
  if (!tableBody) return undefined;

  // Find `fusfilter = aux.FilterBoolFunction(Card.IsX, <value>)` — the SS-target
  // constraint. The value may contain `|` for OR-masks (handled by enumerator).
  const fusfilter = /fusfilter\s*=\s*aux\.FilterBoolFunction(?:Ex)?\s*\(\s*Card\.(Is\w+)\s*,\s*([^)]+?)\s*\)/.exec(tableBody);
  if (!fusfilter) return undefined;

  const method = fusfilter[1];
  const arg = fusfilter[2].trim();
  const pred = decodeMethodPredicate(method, arg, `c:${method}(${arg})`);
  if (pred.kind === 'raw') return undefined;
  return { predicates: [pred], complete: true };
}

/** Find the first Duel.* filter-method call whose filter argument resolves to a known
 *  `s.filter` function (recursively decoded) or a `Card.IsX` direct predicate. */
function extractDelegatedFilterFromStmts(
  stmts: readonly luaparse.Statement[],
  bodies: Map<string, { signature: string; body: string }>,
): SimpleFilter | undefined {
  let found: SimpleFilter | undefined;
  for (const stmt of stmts) {
    if (found) break;
    walkCallsInStmt(stmt, call => {
      if (found) return;
      if (!isDuelCall(call)) return;
      const method = (call.base as luaparse.MemberExpression).identifier.name;
      if (!DUEL_FILTER_METHODS.has(method)) return;
      for (const arg of call.arguments) {
        const resolved = resolveFilterArg(arg, bodies);
        if (resolved) { found = resolved; return; }
      }
    });
  }
  return found;
}

/** Resolve one argument of a Duel.* filter method to a SimpleFilter. */
function resolveFilterArg(
  arg: luaparse.Expression,
  bodies: Map<string, { signature: string; body: string }>,
): SimpleFilter | undefined {
  // `s.filterName` — look up in helper body map and recursively decode.
  if (arg.type === 'MemberExpression' && arg.indexer === '.'
      && arg.base.type === 'Identifier' && arg.base.name === 's') {
    const entry = bodies.get(arg.identifier.name);
    if (entry && isFilterSignature(entry.signature)) {
      return tryExtractSimpleFilter(entry.body);
    }
    return undefined;
  }
  // `Card.IsX` — single direct predicate (filter delegates entirely to this method).
  if (arg.type === 'MemberExpression' && arg.indexer === '.'
      && arg.base.type === 'Identifier' && arg.base.name === 'Card') {
    const pred = decodeMethodPredicate(arg.identifier.name, '', `c:${arg.identifier.name}()`);
    if (pred.kind !== 'raw') return { predicates: [pred], complete: true };
    return undefined;
  }
  // `aux.FilterBoolFunction(Card.IsX, val)` — synthesized predicate.
  if (arg.type === 'CallExpression'
      && arg.base.type === 'MemberExpression'
      && arg.base.indexer === '.'
      && arg.base.base.type === 'Identifier' && arg.base.base.name === 'aux'
      && /^FilterBoolFunction(Ex)?$/.test(arg.base.identifier.name)) {
    const predArg = arg.arguments[0];
    const valArg = arg.arguments[1];
    if (predArg && predArg.type === 'MemberExpression'
        && predArg.base.type === 'Identifier' && predArg.base.name === 'Card') {
      const valRaw = valArg ? exprToString(valArg) : '';
      const pred = decodeMethodPredicate(predArg.identifier.name, valRaw, `c:${predArg.identifier.name}(${valRaw})`);
      if (pred.kind !== 'raw') return { predicates: [pred], complete: true };
    }
  }
  return undefined;
}

/** Check a CallExpression is `Duel.X(...)`. */
function isDuelCall(call: luaparse.CallExpression): boolean {
  return call.base.type === 'MemberExpression'
      && call.base.indexer === '.'
      && call.base.base.type === 'Identifier' && call.base.base.name === 'Duel';
}

/** Collect all Duel.* visible actions encountered across every statement. */
function extractOperationActions(stmts: readonly luaparse.Statement[]): OperationAction[] {
  const actions: OperationAction[] = [];
  for (const stmt of stmts) {
    walkCallsInStmt(stmt, call => {
      if (!isDuelCall(call)) return;
      const method = (call.base as luaparse.MemberExpression).identifier.name;
      const kind = DUEL_ACTION_MAP[method];
      if (!kind) return;
      const target = call.arguments[0] ? exprToString(call.arguments[0]) : undefined;
      const argHints = call.arguments.slice(1).map(exprToString);
      const entry: OperationAction = { kind, method };
      if (target !== undefined) entry.target = target;
      if (argHints.length > 0) entry.argHints = argHints;
      actions.push(entry);
    });
  }
  return actions;
}

/** Detect `local e1 = Effect.CreateEffect(X)` + following `e1:SetCode(...)` /
 *  `e1:SetValue(...)` / ... / `Y:RegisterEffect(e1)` — emit a SideEffect per
 *  registered effect. Tracks multiple concurrent effect variables. */
function extractSideEffects(stmts: readonly luaparse.Statement[]): SideEffect[] {
  interface Pending {
    handler?: string;       // Effect.CreateEffect argument
    code?: string;
    value?: string;
    types: string[];
    properties: string[];
    categories: string[];
    reset?: string;
    targetRange?: { self: string; opponent: string };
  }
  const pending = new Map<string, Pending>();
  const emitted: SideEffect[] = [];

  for (const stmt of stmts) {
    // local eN = Effect.CreateEffect(handlerExpr)
    if (stmt.type === 'LocalStatement'
        && stmt.variables.length === 1
        && stmt.init.length === 1) {
      const init = stmt.init[0];
      if (init.type === 'CallExpression'
          && init.base.type === 'MemberExpression'
          && init.base.indexer === '.'
          && init.base.base.type === 'Identifier' && init.base.base.name === 'Effect'
          && init.base.identifier.name === 'CreateEffect') {
        const varName = stmt.variables[0].name;
        const handlerArg = init.arguments[0] ? exprToString(init.arguments[0]) : undefined;
        pending.set(varName, { handler: handlerArg, types: [], properties: [], categories: [] });
        continue;
      }
    }
    // eN:SetX(arg) | Y:RegisterEffect(eN)
    if (stmt.type === 'CallStatement' && stmt.expression.type === 'CallExpression') {
      const call = stmt.expression;
      if (call.base.type === 'MemberExpression'
          && call.base.indexer === ':'
          && call.base.base.type === 'Identifier') {
        const receiver = call.base.base.name;
        const method = call.base.identifier.name;
        const p = pending.get(receiver);
        if (p) {
          const argRaw = call.arguments[0] ? exprToString(call.arguments[0]) : '';
          switch (method) {
            case 'SetCode':        p.code = argRaw; break;
            case 'SetValue':       p.value = argRaw; break;
            case 'SetType':        if (argRaw) p.types.push(argRaw); break;
            case 'SetProperty':    if (argRaw) p.properties.push(argRaw); break;
            case 'SetCategory':    if (argRaw) p.categories.push(argRaw); break;
            case 'SetReset':       p.reset = argRaw; break;
            case 'SetTargetRange': {
              const self = call.arguments[0] ? exprToString(call.arguments[0]) : '';
              const opp  = call.arguments[1] ? exprToString(call.arguments[1]) : '';
              p.targetRange = { self, opponent: opp };
              break;
            }
          }
        }
        // Any receiver :RegisterEffect(eN) finalizes the SideEffect for eN.
        if (method === 'RegisterEffect' && call.arguments[0]) {
          const a = call.arguments[0];
          if (a.type === 'Identifier' && pending.has(a.name)) {
            const p = pending.get(a.name)!;
            const se: SideEffect = { registeredOn: receiver };
            if (p.code !== undefined)     se.code = p.code;
            if (p.value !== undefined)    se.value = p.value;
            if (p.types.length > 0)       se.types = p.types;
            if (p.properties.length > 0)  se.properties = p.properties;
            if (p.categories.length > 0)  se.categories = p.categories;
            if (p.reset !== undefined)    se.reset = p.reset;
            if (p.targetRange)            se.targetRange = p.targetRange;
            // Only emit if it carries any identifying info (avoid empty records).
            if (se.code || se.value || se.types || se.properties) emitted.push(se);
            pending.delete(a.name);
          }
        }
      }
    }
  }
  return emitted;
}

// =============================================================================
// v3 Summon procedure decomposition — parses AddProcedure/AddProcMix args into
// structured slot requirements. Covers Synchro / Fusion / Link / Xyz.
// =============================================================================

function decodeSummonProc(kind: SummonProcedure['kind'], raw: string): DecodedProcedure | undefined {
  const openIdx = raw.indexOf('(');
  if (openIdx < 0) return undefined;
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < raw.length; i++) {
    if (raw[i] === '(') depth++;
    else if (raw[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break; } }
  }
  if (closeIdx < 0) return undefined;
  const argStr = raw.slice(openIdx + 1, closeIdx);
  const args = splitTopLevelArgs(argStr).map(a => a.trim());
  if (args[0] !== 'c') return undefined;
  const rest = args.slice(1);
  switch (kind) {
    case 'Synchro':   return decodeSynchroProc(rest);
    case 'Fusion':    return decodeFusionProc(rest, raw);
    case 'Link':      return decodeLinkProc(rest);
    case 'Xyz':       return decodeXyzProc(rest);
    default:          return undefined;
  }
}

function decodeSynchroProc(args: readonly string[]): DecodedProcedure | undefined {
  if (args.length < 6) return undefined;
  const slots: SlotRequirement[] = [];
  const extras: string[] = [];
  const customMainFilter = args[0];
  const minT = parseIntOrUndefined(args[1]);
  const maxT = parseIntOrUndefined(args[2]);
  const nonTunerFilter = args[3];
  const minNT = parseIntOrUndefined(args[4]);
  const maxNT = parseIntOrUndefined(args[5]);
  slots.push({
    role: 'tuner',
    ...(minT !== undefined ? { min: minT } : {}),
    ...(maxT !== undefined ? { max: maxT } : {}),
    ...(customMainFilter !== 'nil' ? { filter: filterFromArg(customMainFilter) } : {}),
  });
  slots.push({
    role: 'non-tuner',
    ...(minNT !== undefined ? { min: minNT } : {}),
    ...(maxNT !== undefined ? { max: maxNT } : {}),
    ...(nonTunerFilter !== 'nil' ? { filter: filterFromArg(nonTunerFilter) } : {}),
  });
  for (let i = 6; i < args.length; i++) {
    if (args[i] && args[i] !== 'nil') extras.push(args[i]);
  }
  return { slots, ...(extras.length > 0 ? { extras } : {}) };
}

function decodeFusionProc(args: readonly string[], raw: string): DecodedProcedure | undefined {
  if (args.length < 3) return undefined;
  const slots: SlotRequirement[] = [];
  const extras: string[] = [];
  const matArgs = args.slice(2);
  for (const matArg of matArgs) {
    if (matArg === 'nil') continue;
    const filter = filterFromArg(matArg);
    const role = matArg === 'CARD_ALBAZ' ? 'fallen-of-albaz' : 'material';
    slots.push({ role, min: 1, max: 1, filter });
  }
  if (raw.includes('ProcMix2')) extras.push('ProcMix2 (strict-mix 2)');
  return { slots, ...(extras.length > 0 ? { extras } : {}) };
}

function decodeLinkProc(args: readonly string[]): DecodedProcedure | undefined {
  if (args.length < 2) return undefined;
  const slots: SlotRequirement[] = [];
  const extras: string[] = [];
  const matFilter = args[0];
  const minLinks = parseIntOrUndefined(args[1]);
  const maxLinks = args.length >= 3 ? parseIntOrUndefined(args[2]) : undefined;
  slots.push({
    role: 'material',
    ...(minLinks !== undefined ? { min: minLinks } : {}),
    ...(maxLinks !== undefined ? { max: maxLinks } : {}),
    ...(matFilter !== 'nil' ? { filter: filterFromArg(matFilter) } : {}),
  });
  for (let i = 3; i < args.length; i++) {
    if (args[i] && args[i] !== 'nil') extras.push(args[i]);
  }
  return { slots, ...(extras.length > 0 ? { extras } : {}) };
}

function decodeXyzProc(args: readonly string[]): DecodedProcedure | undefined {
  if (args.length < 3) return undefined;
  const slots: SlotRequirement[] = [];
  const extras: string[] = [];
  const matFilter = args[0];
  const rank = parseIntOrUndefined(args[1]);
  const count = parseIntOrUndefined(args[2]);
  slots.push({
    role: 'material',
    ...(count !== undefined ? { min: count, max: count } : {}),
    ...(matFilter !== 'nil' ? { filter: filterFromArg(matFilter) } : {}),
  });
  const notes: string[] = [];
  if (rank !== undefined) notes.push(`Rank ${rank}`);
  for (let i = 3; i < args.length; i++) {
    if (args[i] && args[i] !== 'nil') extras.push(args[i]);
  }
  return {
    slots,
    ...(extras.length > 0 ? { extras } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function parseIntOrUndefined(s: string): number | undefined {
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function filterFromArg(arg: string): ResolvedHelper | { raw: string } {
  const resolved = resolveHelper(arg);
  if (resolved) return resolved;
  return { raw: arg };
}

// =============================================================================
// CLI
// =============================================================================

const nameDb = new Database(join('data', 'cards.cdb'), { readonly: true });
const nameStmt = nameDb.prepare('SELECT name FROM texts WHERE id = ?');

function lookupCardName(cardId: number): string {
  const row = nameStmt.get(cardId) as { name: string } | undefined;
  return row?.name ?? `UNKNOWN_${cardId}`;
}

function findLuaPath(cardId: number): string {
  const base = join('data', 'scripts_full');
  for (const sub of ['official', 'unofficial', '']) {
    const p = join(base, sub, `c${cardId}.lua`);
    if (existsSync(p)) return p;
  }
  throw new Error(`No Lua script found for cardId ${cardId}`);
}

const args = process.argv.slice(2);
let mode: 'stdout' | 'write' | 'batch' = 'stdout';
let cardIds: number[] = [];
for (const a of args) {
  if (a === '--write') mode = 'write';
  else if (a === '--batch') mode = 'batch';
  else if (/^\d+$/.test(a)) cardIds.push(Number(a));
}
if (cardIds.length === 0) {
  console.error('Usage: extract-card-effects.ts [--write|--batch] <cardId1> [cardId2 ...]');
  process.exit(2);
}

const outDir = join('..', '_bmad-output', 'solver-data', 'card-effects-catalog');
if (mode !== 'stdout' && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

for (const cardId of cardIds) {
  let catalog: CardEffectCatalog;
  try {
    const luaPath = findLuaPath(cardId);
    const name = lookupCardName(cardId);
    catalog = parseLuaScript(luaPath, cardId, name);
  } catch (e) {
    console.error(`[${cardId}] parse failed: ${String(e)}`);
    continue;
  }
  const json = JSON.stringify(catalog, null, 2);
  if (mode === 'stdout') {
    console.log(json);
    console.log();
  } else {
    const outPath = join(outDir, `${cardId}.json`);
    writeFileSync(outPath, json, 'utf-8');
    const c = catalog.coverage;
    const decodedPct = (c.fullyDecoded + c.partiallyDecoded) / Math.max(1, c.totalFunctionRefs) * 100;
    console.log(`[${cardId}] ${catalog.name} — ${c.totalEffects} effects, ${c.fullyDecoded}/${c.totalFunctionRefs} fully + ${c.partiallyDecoded} partial (${decodedPct.toFixed(0)}% any decode), ${catalog.warnings.length} warn → ${outPath}`);
  }
}
