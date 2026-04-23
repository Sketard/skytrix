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

/** Reference to a Lua function. v1 captures name + opaque flag; v2 will attempt inline decoding. */
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
  | { kind: 'code'; value: number | 'self' }      // IsCode(12345) or IsCode(id) → 'self'
  | { kind: 'setCard'; value: string }            // IsSetCard(SET_DRACOTAIL)
  | { kind: 'faceup' }                            // IsFaceup()
  | { kind: 'facedown' }                          // IsFacedown()
  | { kind: 'monster' }                           // IsMonster()
  | { kind: 'spellTrap' }                         // IsSpellTrap()
  | { kind: 'ableToHand' }                        // IsAbleToHand()
  | { kind: 'ableToGrave' }                       // IsAbleToGrave()
  | { kind: 'ableToGraveAsCost' }                 // IsAbleToGraveAsCost()
  | { kind: 'ableToDeck' }                        // IsAbleToDeck()
  | { kind: 'canBeSpecialSummoned' }              // IsCanBeSpecialSummoned(...)
  | { kind: 'canBeEffectTarget' }                 // IsCanBeEffectTarget()
  | { kind: 'discardable' }                       // IsDiscardable()
  | { kind: 'ssetable' }                          // IsSSetable()
  | { kind: 'setable' }                           // IsSetable()
  | { kind: 'relateToEffect' }                    // IsRelateToEffect(e)
  | { kind: 'location'; value: string }           // IsLocation(LOCATION_GRAVE)
  | { kind: 'link'; value: number }               // IsLink(N)
  | { kind: 'linkMonster' }                       // IsLinkMonster()
  | { kind: 'xyzMonster' }                        // IsXyzMonster()
  | { kind: 'fusionMonster' }                     // IsFusionMonster()
  | { kind: 'synchroMonster' }                    // IsSynchroMonster()
  | { kind: 'not'; inner: FilterPredicate }       // `not c:Is...()`
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
  parserVersion: 'v1-80pct';
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

  // Coverage summary. Credit: resolved helper OR simpleFilter.complete => fully decoded.
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
      if (hasFullFilter || hasResolved) fullyDecoded++;
      else if (hasPartialFilter) partiallyDecoded++;
      else opaqueUndecoded++;
    }
  }

  return {
    cardId,
    name: cardName,
    sourceFile: path.split(/[/\\]/).slice(-2).join('/'),
    parserVersion: 'v1-80pct',
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
    // Ignored for v1 (informational only): SetLabel, SetLabelObject, SetOwnerPlayer, SetHintTiming, SetReset, SetAbsoluteRange, SetDescription (already handled).
    default:
      // Flag unknown Set* calls so v2 can prioritize.
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

    if (isFilterSignature(entry.signature)) {
      const simple = tryExtractSimpleFilter(entry.body);
      if (simple) return { name: `s.${fname}`, simpleFilter: simple, opaque: !simple.complete };
      return { name: `s.${fname}`, opaque: true };
    }

    const delegated = extractDelegatedFilter(entry.body, bodies);
    if (delegated) return { name: `s.${fname}`, simpleFilter: delegated, opaque: !delegated.complete };

    return { name: `s.${fname}`, opaque: true };
  }

  const inlineBody = /^function\s*\(([^)]*)\)\s+return\s+([\s\S]*?)\s+end$/s.exec(trimmed);
  if (inlineBody && isFilterSignature(inlineBody[1])) {
    const simple = tryExtractSimpleFilter(`return ${inlineBody[2]}`);
    if (simple) {
      const r: FunctionRef = { inline: trimmed, simpleFilter: simple, opaque: !simple.complete };
      if (resolved) r.resolved = resolved;
      return r;
    }
  }

  const r: FunctionRef = { inline: trimmed, opaque: !resolved };
  if (resolved) r.resolved = resolved;
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

/** Resolve a helper call (pure function reference, no wrapping) into structured semantics.
 *  Returns undefined if no known helper pattern matches. */
function resolveHelper(expr: string): ResolvedHelper | undefined {
  // Cost.*
  if (/^Cost\.DetachFromSelf\s*(\(\s*\d*\s*\))?$/.test(expr)) {
    const m = /\(\s*(\d+)\s*\)/.exec(expr);
    const count = m ? Number(m[1]) : 1;
    return { helper: 'Cost.DetachFromSelf', kind: 'detach-material', params: { from: 'self', count } };
  }
  if (/^Cost\.Discard\s*(\(.*\))?$/.test(expr)) {
    return { helper: 'Cost.Discard', kind: 'discard', params: { from: 'hand', count: 1 } };
  }
  if (/^Cost\.SelfDiscard\s*(\(.*\))?$/.test(expr)) {
    return { helper: 'Cost.SelfDiscard', kind: 'discard', params: { target: 'self' } };
  }
  if (/^Cost\.SelfTribute\s*(\(.*\))?$/.test(expr)) {
    return { helper: 'Cost.SelfTribute', kind: 'tribute', params: { target: 'self' } };
  }
  if (/^Cost\.SelfToGrave\s*(\(.*\))?$/.test(expr)) {
    return { helper: 'Cost.SelfToGrave', kind: 'send-to-grave', params: { target: 'self' } };
  }
  if (/^Cost\.SelfBanish\s*(\(.*\))?$/.test(expr)) {
    return { helper: 'Cost.SelfBanish', kind: 'banish', params: { target: 'self' } };
  }
  if (/^Cost\.SelfToExtra\s*(\(.*\))?$/.test(expr)) {
    return { helper: 'Cost.SelfToExtra', kind: 'return-to-extra', params: { target: 'self' } };
  }
  if (/^Cost\.SelfReveal\s*(\(.*\))?$/.test(expr)) {
    return { helper: 'Cost.SelfReveal', kind: 'reveal', params: { target: 'self' } };
  }
  const payLp = /^Cost\.PayLP\s*\(\s*(\d+|[A-Za-z0-9_]+)\s*\)/.exec(expr);
  if (payLp) {
    return { helper: 'Cost.PayLP', kind: 'pay-lp', params: { amount: payLp[1] } };
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

/** A signature is filter-like when the first param is `c` (possibly with optional extra args). */
function isFilterSignature(sig: string): boolean {
  const first = sig.split(',')[0]?.trim();
  return first === 'c';
}

/** Detect `Duel.IsExistingMatchingCard(s.filterName, ...)` in a target function body and
 *  recursively extract the referenced filter's simpleFilter. */
function extractDelegatedFilter(
  body: string,
  bodies: Map<string, { signature: string; body: string }>,
): SimpleFilter | undefined {
  const m = /(?:Duel\.IsExistingMatchingCard|Duel\.SelectMatchingCard|Duel\.IsExistingTarget|Duel\.SelectTarget)\s*\(\s*(?:tp\s*,\s*)?s\.(\w+)/.exec(body);
  if (!m) return undefined;
  const filterName = m[1];
  const entry = bodies.get(filterName);
  if (!entry || !isFilterSignature(entry.signature)) return undefined;
  return tryExtractSimpleFilter(entry.body);
}

/** v4: AST-based filter extraction via luaparse. Handles multi-statement bodies,
 *  nested and/or, `if chk==0 then return X end` patterns, and inline lambdas.
 *  Falls back to regex-based v1 extractor on parse failure. */
function tryExtractSimpleFilter(body: string): SimpleFilter | undefined {
  const wrapped = `function __extract__() ${body} end`;
  let ast: luaparse.Chunk;
  try {
    ast = luaparse.parse(wrapped, { comments: false, locations: false });
  } catch {
    return tryExtractSimpleFilterRegex(body);
  }
  const fnDecl = ast.body[0];
  if (!fnDecl || fnDecl.type !== 'FunctionDeclaration') return tryExtractSimpleFilterRegex(body);
  return extractFilterFromStatements(fnDecl.body);
}

/** Walk a function body's statements, finding the primary return whose
 *  arguments describe card-shape predicates. Skips `if chk==0 then return ... end`
 *  boilerplate — these are targeting-protocol lines, not filter logic. */
function extractFilterFromStatements(stmts: readonly luaparse.Statement[]): SimpleFilter | undefined {
  // Primary pattern: last return statement, or the non-chk==0 branch of an if.
  for (const stmt of stmts) {
    if (stmt.type === 'ReturnStatement' && stmt.arguments.length === 1) {
      return astExprToFilter(stmt.arguments[0]);
    }
  }
  // Look for `if chk == 0 then return A end; <rest>` — extract from the top-level
  // return within the `if` block OR from a return later in stmts.
  for (const stmt of stmts) {
    if (stmt.type === 'IfStatement') {
      // If the condition is `chk == 0` or similar protocol boilerplate, skip.
      // Otherwise try the inner body's return.
      for (const clause of stmt.clauses) {
        const inner = extractFilterFromStatements(clause.body);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

/** Convert a luaparse expression AST to SimpleFilter by walking and/or chains
 *  and decoding leaf `c:IsX(args)` predicates. */
function astExprToFilter(expr: luaparse.Expression): SimpleFilter | undefined {
  const predicates: FilterPredicate[] = [];
  let complete = true;
  for (const leaf of walkAndChain(expr)) {
    const pred = astPredicateFromExpr(leaf);
    predicates.push(pred);
    if (pred.kind === 'raw') complete = false;
  }
  if (predicates.length === 0) return undefined;
  return { predicates, complete };
}

/** Walk a logical `and` chain, yielding each conjunct as a separate expression. */
function walkAndChain(expr: luaparse.Expression): luaparse.Expression[] {
  if (expr.type === 'LogicalExpression' && expr.operator === 'and') {
    return [...walkAndChain(expr.left), ...walkAndChain(expr.right)];
  }
  return [expr];
}

/** Decode a single expression (typically a c:IsX(arg) call) into a FilterPredicate. */
function astPredicateFromExpr(expr: luaparse.Expression): FilterPredicate {
  // Negation: `not X`
  if (expr.type === 'UnaryExpression' && expr.operator === 'not') {
    const inner = astPredicateFromExpr(expr.argument);
    return { kind: 'not', inner };
  }
  // Method call: `c:IsX(arg)` → CallExpression with base = MemberExpression(indexer=':', identifier=IsX)
  if (expr.type === 'CallExpression' && expr.base.type === 'MemberExpression'
      && expr.base.indexer === ':'
      && expr.base.base.type === 'Identifier' && expr.base.base.name === 'c') {
    const method = expr.base.identifier.name;
    const argRaw = expr.arguments[0] ? exprToString(expr.arguments[0]) : '';
    return decodeClause(`c:${method}(${argRaw})`);
  }
  return { kind: 'raw', source: exprToString(expr) };
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
  // "c:MethodName(args)"
  const m = /^c:(\w+)\(\s*([^)]*)\s*\)$/.exec(clause);
  if (!m) return { kind: 'raw', source: clause };
  const [, method, argRaw] = m;
  const arg = argRaw.trim();
  switch (method) {
    case 'IsAttribute':            return { kind: 'attribute', value: arg };
    case 'IsRace':                 return { kind: 'race', value: arg };
    case 'IsType':                 return { kind: 'type', value: arg };
    case 'IsLevel':                return { kind: 'level', value: Number(arg) };
    case 'IsLevelAbove':           return { kind: 'levelAbove', value: Number(arg) };
    case 'IsLevelBelow':           return { kind: 'levelBelow', value: Number(arg) };
    case 'IsCode':                 return { kind: 'code', value: arg === 'id' ? 'self' : Number(arg) };
    case 'IsSetCard':              return { kind: 'setCard', value: arg };
    case 'IsFaceup':               return { kind: 'faceup' };
    case 'IsFacedown':             return { kind: 'facedown' };
    case 'IsMonster':              return { kind: 'monster' };
    case 'IsSpellTrap':            return { kind: 'spellTrap' };
    case 'IsAbleToHand':           return { kind: 'ableToHand' };
    case 'IsAbleToGrave':          return { kind: 'ableToGrave' };
    case 'IsAbleToGraveAsCost':    return { kind: 'ableToGraveAsCost' };
    case 'IsAbleToDeck':           return { kind: 'ableToDeck' };
    case 'IsCanBeSpecialSummoned': return { kind: 'canBeSpecialSummoned' };
    case 'IsCanBeEffectTarget':    return { kind: 'canBeEffectTarget' };
    case 'IsDiscardable':          return { kind: 'discardable' };
    case 'IsLink':                 return { kind: 'link', value: Number(arg) };
    case 'IsLinkMonster':          return { kind: 'linkMonster' };
    case 'IsXyzMonster':           return { kind: 'xyzMonster' };
    case 'IsFusionMonster':        return { kind: 'fusionMonster' };
    case 'IsSynchroMonster':       return { kind: 'synchroMonster' };
    case 'IsSSetable':             return { kind: 'ssetable' };
    case 'IsSetable':              return { kind: 'setable' };
    case 'IsRelateToEffect':       return { kind: 'relateToEffect' };
    case 'IsLocation':             return { kind: 'location', value: arg };
    default:                       return { kind: 'raw', source: clause };
  }
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
