// =============================================================================
// validate-bridge.ts — execute a BridgeSubroute against ocgcore and match produces
//
// Phase 2 scope (2026-04-23):
//   - Covers normalSummon, activate, search, specialSummon (triggered),
//     {xyz,synchro,link,fusion,ritual}Summon (proc activation via 'ss'),
//     tribute/discard (auto-advance annotation steps).
//   - CardSelector: 'specific', 'anyOf', 'role' (resolved via roleMap).
//   - Synthesis: bridges needing a Monster from deck to be on-field for step 0
//     get a "needs prior state" warning but are still attempted — the natural
//     FAIL result signals whether the schema needs a requiresInitialState field.
//   - Batch mode: --archetype=<id> (or --all) iterates all bridges, per-row report.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/validate-bridge.ts --bridge=<id>
//   npx tsx scripts/validate-bridge.ts --archetype=snake-eye
//   npx tsx scripts/validate-bridge.ts --all
//   VALIDATE_BRIDGE_VERBOSE=1 ...
//
// Exit 0 on all PASS. Exit 1 on any FAIL. Exit 2 on setup error.
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DATA_DIR } from './evaluate-structural.js';
import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadInterruptionTags } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { FILLER_CARD } from '../src/solver/ocg-constants.js';
import type {
  DuelConfig, Action, FieldState, FieldCard,
  InitialPlacement, InitialPlacementZone, InitialPlacementPosition,
} from '../src/solver/solver-types.js';
import type {
  BridgeSubroute,
  RouteStep,
  CardSelector,
  CardSlot,
  ArchetypeExpertise,
  CardRole,
} from '../src/solver/strategic-grammar.js';

const ARCHETYPE_FILES = ['branded.json', 'mitsurugi.json', 'ryzeal.json', 'snake-eye.json'];
const DECK_SIZE = 40;
const PROMPT_CEILING = 300;

const ED_ACTIONS = new Set(['xyzSummon', 'synchroSummon', 'linkSummon', 'fusionSummon', 'ritualSummon']);
const ANNOTATION_ACTIONS = new Set(['tribute', 'discard']);

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

interface LoadedExpertise {
  archetype: string;
  roleMap: Readonly<Record<number, readonly CardRole[]>>;
  bridges: readonly BridgeSubroute[];
}

function loadAllExpertise(): LoadedExpertise[] {
  return ARCHETYPE_FILES.map(file => {
    const p = join(DATA_DIR, 'archetype-expertise', file);
    const content = JSON.parse(readFileSync(p, 'utf-8')) as ArchetypeExpertise;
    return {
      archetype: content.archetype,
      roleMap: content.roleMap ?? {},
      bridges: content.bridges ?? [],
    };
  });
}

function findBridge(all: LoadedExpertise[], bridgeId: string):
  { bridge: BridgeSubroute; expertise: LoadedExpertise } | null {
  for (const exp of all) {
    const match = exp.bridges.find(b => b.id === bridgeId);
    if (match) return { bridge: match, expertise: exp };
  }
  return null;
}

// =============================================================================
// --candidates mode — translate mechanical edges into synthetic bridges
// =============================================================================

interface CandidateCardProps {
  cardId: number;
  name: string;
  type: number;
  level: number;
  attribute: number;
  race: number;
  setcodes: readonly number[];
}

interface CandidateEdge {
  from: { cardId: number; name: string; effectId: string };
  to: { cardId: number; name: string; effectId: string };
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: readonly string[];
}

interface CandidatesFile {
  generatedAt: string;
  cardCount: number;
  cardProperties: Readonly<Record<string, CandidateCardProps>>;
  edges: readonly CandidateEdge[];
}

// Bitmask decode — keep in sync with ocg-constants / cards.cdb `type` column.
const TYPE_MONSTER = 0x1;
const TYPE_SPELL = 0x2;
const TYPE_TRAP = 0x4;
const TYPE_FUSION = 0x40;
const TYPE_RITUAL = 0x80;
const TYPE_SYNCHRO = 0x2000;
const TYPE_XYZ = 0x800000;
const TYPE_LINK = 0x4000000;
const ED_TYPE_MASK = TYPE_FUSION | TYPE_RITUAL | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK;

function isMainDeckMonster(type: number): boolean {
  return (type & TYPE_MONSTER) !== 0 && (type & ED_TYPE_MASK) === 0;
}
function isSpell(type: number): boolean { return (type & TYPE_SPELL) !== 0; }
function isTrap(type: number): boolean { return (type & TYPE_TRAP) !== 0; }

interface CandidateEffect {
  id: string;
  categories: readonly string[];
  events: readonly string[];
  types: readonly string[];
}

/** Load a minimal slice of the card's effect catalog. Returns the effect
 *  with the given id, or null if the catalog is missing / effect not found. */
function loadCatalogEffect(cardId: number, effectId: string): CandidateEffect | null {
  const p = join(DATA_DIR, '..', '..', '_bmad-output', 'solver-data', 'card-effects-catalog', `${cardId}.json`);
  try {
    const content = JSON.parse(readFileSync(p, 'utf-8')) as { effects: readonly CandidateEffect[] };
    return content.effects.find(e => e.id === effectId) ?? null;
  } catch {
    return null;
  }
}

/** Translate a mechanical edge into a synthetic BridgeSubroute for validation.
 *  Returns null if the edge shape isn't supported (e.g., Trap initiator —
 *  which requires setting on a prior turn then activating, which the current
 *  autopilot can't reproduce). */
function candidateToBridge(
  edge: CandidateEdge,
  cardProps: Readonly<Record<string, CandidateCardProps>>,
): BridgeSubroute | null {
  const fromProps = cardProps[String(edge.from.cardId)];
  const toProps = cardProps[String(edge.to.cardId)];
  if (!fromProps || !toProps) return null;

  const fromType = fromProps.type;
  const toType = toProps.type;

  // Edge reason prefix determines translator.
  if (edge.reason.startsWith('search-then-trigger')) {
    return translateSearchThenTrigger(edge, fromType, toType);
  }
  if (edge.reason.startsWith('summon-then-trigger')) {
    return translateSummonThenTrigger(edge, fromType, toType);
  }
  // All other edge classes (gy-send / destroy / banish / fusion-material /
  // leave-field / battle) are ambiguous at synthesis (target not resolvable
  // from edge data alone). Skip with null → recorded as SKIPPED in report.
  return null;
}

/** Pick the right ZoneKind for a summoned monster. Link monsters naturally
 *  occupy the Extra Monster Zone (EMZ_L/R) in MR5 — the validator's
 *  `zoneKindMatches` distinguishes 'monster' (M1-M5) from 'extraMonster'
 *  (EMZ), so producing the wrong kind would cause a false tier-D rejection. */
function fieldZoneKindForType(type: number): 'monster' | 'extraMonster' {
  return (type & TYPE_LINK) !== 0 ? 'extraMonster' : 'monster';
}

function translateSearchThenTrigger(
  edge: CandidateEdge,
  fromType: number,
  toType: number,
): BridgeSubroute | null {
  const steps: RouteStep[] = [];

  // Step 1: bring fromCard into play so its effect can activate.
  if (isSpell(fromType)) {
    steps.push({
      action: 'activate',
      subject: { kind: 'specific', cardId: edge.from.cardId },
      note: `[synthetic] activate ${edge.from.name}`,
    });
  } else if (isMainDeckMonster(fromType)) {
    steps.push({
      action: 'normalSummon',
      subject: { kind: 'specific', cardId: edge.from.cardId },
      note: `[synthetic] NS ${edge.from.name} to trigger ${edge.from.effectId}`,
    });
  } else if (isTrap(fromType)) {
    return null; // Trap initiator — unsupported (needs prior-turn set + activate).
  } else {
    return null;
  }

  // Step 2: search — pick to.cardId as target.
  steps.push({
    action: 'search',
    subject: { kind: 'specific', cardId: edge.from.cardId },
    target: { kind: 'specific', cardId: edge.to.cardId },
    note: `[synthetic] ${edge.from.effectId} searches ${edge.to.name}`,
  });

  // Step 3: if to's trigger SS's from hand, model that.
  const toEffect = loadCatalogEffect(edge.to.cardId, edge.to.effectId);
  const toCategorySS = toEffect?.categories.includes('CATEGORY_SPECIAL_SUMMON') ?? false;
  if (toCategorySS) {
    steps.push({
      action: 'specialSummon',
      subject: { kind: 'specific', cardId: edge.to.cardId },
      note: `[synthetic] ${edge.to.effectId} triggers on-to-hand, SS self`,
    });
  }

  const produces: CardSlot[] = toCategorySS
    ? [{
        zone: fieldZoneKindForType(toType),
        card: { kind: 'specific', cardId: edge.to.cardId },
        position: 'faceup-atk',
        note: `${edge.to.name} SS'd via ${edge.to.effectId} on-to-hand trigger`,
      }]
    : [{
        zone: 'hand',
        card: { kind: 'specific', cardId: edge.to.cardId },
        note: `${edge.to.name} in hand after ${edge.from.effectId} search`,
      }];

  return {
    id: `edge-search-trigger-${edge.from.cardId}-${edge.from.effectId}-to-${edge.to.cardId}-${edge.to.effectId}`,
    name: `[candidate] ${edge.from.name}.${edge.from.effectId} → ${edge.to.name}.${edge.to.effectId}`,
    description: `${edge.reason} (confidence=${edge.confidence})`,
    requiresDeckPieces: [edge.from.cardId, edge.to.cardId],
    produces,
    steps,
  };
}

function translateSummonThenTrigger(
  edge: CandidateEdge,
  fromType: number,
  toType: number,
): BridgeSubroute | null {
  // Special case: self-trigger (same card). fromCard is summoned and triggers
  // its OWN on-summon effect. Model as: NS fromCard → activate trigger effect.
  // Very common in on-NS archetype openers (Snake-Eye Ash, Mitsurugi Mikoto…).
  const isSelfTrigger = edge.from.cardId === edge.to.cardId;
  if (isSelfTrigger) {
    if (!isMainDeckMonster(fromType)) return null;
    // For search-on-own-NS → model as normalSummon + search (if to effect is search-producing)
    // Generic "just NS and let trigger fire" — produces field presence of the card.
    return {
      id: `edge-self-summon-trigger-${edge.from.cardId}-${edge.from.effectId}-via-${edge.to.effectId}`,
      name: `[candidate] ${edge.from.name}.${edge.from.effectId} self-triggers ${edge.to.effectId} on-summon`,
      description: `${edge.reason} (confidence=${edge.confidence}, self-trigger)`,
      requiresDeckPieces: [edge.from.cardId],
      produces: [{
        zone: fieldZoneKindForType(fromType),
        card: { kind: 'specific', cardId: edge.from.cardId },
        position: 'faceup-atk',
        note: `${edge.from.name} on field post-NS`,
      }],
      steps: [
        { action: 'normalSummon', subject: { kind: 'specific', cardId: edge.from.cardId } },
      ],
    };
  }

  // Non-self case: "from" effect SS's "to" card (or a matching one).
  const steps: RouteStep[] = [];
  if (isSpell(fromType)) {
    steps.push({
      action: 'activate',
      subject: { kind: 'specific', cardId: edge.from.cardId },
    });
  } else if (isMainDeckMonster(fromType)) {
    steps.push({
      action: 'normalSummon',
      subject: { kind: 'specific', cardId: edge.from.cardId },
    });
  } else {
    return null;
  }

  steps.push({
    action: 'specialSummon',
    subject: { kind: 'specific', cardId: edge.to.cardId },
    note: `[synthetic] ${edge.from.effectId} SS's ${edge.to.name}`,
  });

  return {
    id: `edge-summon-trigger-${edge.from.cardId}-${edge.from.effectId}-to-${edge.to.cardId}-${edge.to.effectId}`,
    name: `[candidate] ${edge.from.name}.${edge.from.effectId} → ${edge.to.name}.${edge.to.effectId}`,
    description: `${edge.reason} (confidence=${edge.confidence})`,
    requiresDeckPieces: [edge.from.cardId, edge.to.cardId],
    produces: [{
      zone: fieldZoneKindForType(toType),
      card: { kind: 'specific', cardId: edge.to.cardId },
      position: 'faceup-atk',
      note: `${edge.to.name} SS'd via ${edge.from.name}.${edge.from.effectId}`,
    }],
    steps,
  };
}

// Resolve a CardSelector to a concrete cardId list. For 'role' selectors, we
// consult the roleMap of the owning archetype. A target selector with kind
// 'role' and role='extender' expands to every cardId tagged 'extender' in
// roleMap.
function expandSelector(selector: CardSelector, roleMap: Readonly<Record<number, readonly CardRole[]>>):
  readonly number[] {
  if (selector.kind === 'specific') return [selector.cardId];
  if (selector.kind === 'anyOf') return selector.cardIds;
  if (selector.kind === 'role') {
    const ids: number[] = [];
    for (const [cidStr, roles] of Object.entries(roleMap)) {
      if ((roles as readonly CardRole[]).includes(selector.role)) ids.push(Number(cidStr));
    }
    return ids;
  }
  return [];
}

// =============================================================================
// CardSlot → InitialPlacement conversion
// =============================================================================

const ZONE_KIND_TO_PLACEMENT_ZONE: Record<string, InitialPlacementZone> = {
  monster: 'MZONE',
  extraMonster: 'MZONE',
  spellTrap: 'SZONE',
  field: 'FZONE',
  gy: 'GRAVE',
  hand: 'HAND',
  banished: 'REMOVED',
  deck: 'DECK',
};

const POSITION_TO_PLACEMENT_POSITION: Record<string, InitialPlacementPosition> = {
  'faceup-atk': 'FACEUP_ATTACK',
  'faceup-def': 'FACEUP_DEFENSE',
  'facedown': 'FACEDOWN_DEFENSE',
};

function cardSlotToPlacement(
  slot: CardSlot,
  roleMap: Readonly<Record<number, readonly CardRole[]>>,
): InitialPlacement | null {
  const cids = expandSelector(slot.card, roleMap);
  if (cids.length === 0) return null;
  const zone = ZONE_KIND_TO_PLACEMENT_ZONE[slot.zone];
  if (!zone) return null;
  const position = slot.position ? POSITION_TO_PLACEMENT_POSITION[slot.position] : undefined;
  return { cardId: cids[0], zone, position, controller: 0 };
}

// =============================================================================
// Bridge composition — flatten precursors into a single effective bridge
// =============================================================================

interface EffectiveBridge {
  bridge: BridgeSubroute;
  precursorStepCount: number;
  chain: readonly string[];
}

function buildEffectiveBridge(
  bridge: BridgeSubroute,
  all: LoadedExpertise[],
): EffectiveBridge {
  const precursorIds = bridge.precursors ?? [];
  if (precursorIds.length === 0) {
    return { bridge, precursorStepCount: 0, chain: [] };
  }

  const precursorSteps: RouteStep[] = [];
  const deckPieces = new Set<number>(bridge.requiresDeckPieces);
  const initialState: CardSlot[] = [...(bridge.requiresInitialState ?? [])];
  const chain: string[] = [];

  for (const pid of precursorIds) {
    const match = findBridge(all, pid);
    if (!match) {
      throw new Error(`precursor '${pid}' not found (referenced by '${bridge.id}')`);
    }
    // Recursive composition: allow precursors to themselves have precursors.
    // Flattened via the same helper.
    const recursive = buildEffectiveBridge(match.bridge, all);
    precursorSteps.push(...recursive.bridge.steps);
    for (const cid of recursive.bridge.requiresDeckPieces) deckPieces.add(cid);
    if (recursive.bridge.requiresInitialState) initialState.push(...recursive.bridge.requiresInitialState);
    chain.push(...recursive.chain, pid);
  }

  const effective: BridgeSubroute = {
    ...bridge,
    steps: [...precursorSteps, ...bridge.steps],
    requiresDeckPieces: [...deckPieces],
    requiresInitialState: initialState.length > 0 ? initialState : undefined,
  };
  return { bridge: effective, precursorStepCount: precursorSteps.length, chain };
}

// =============================================================================
// State synthesis
// =============================================================================

interface SynthesizedState {
  hand: number[];
  mainDeck: number[];
  extraDeck: number[];
  initialPlacements: InitialPlacement[];
  notes: string[];
  priorStateWarning: string | null;
}

function synthesizeState(
  bridge: BridgeSubroute,
  roleMap: Readonly<Record<number, readonly CardRole[]>>,
): SynthesizedState {
  const notes: string[] = [];
  const hand: number[] = [];
  const mainDeckNeeded = new Set<number>();
  const extraDeckNeeded = new Set<number>();
  let priorStateWarning: string | null = null;

  // Heuristic seed: if step 0's subject is a `specific` card and the action
  // is one we can perform from hand (normalSummon, activate of a spell/trap),
  // seed it to hand. Otherwise fall back to deck and flag prior-state.
  const firstStep = bridge.steps[0];
  if (firstStep) {
    const subjectIds = expandSelector(firstStep.subject, roleMap);
    const cid = subjectIds[0];
    if (cid !== undefined) {
      if (firstStep.action === 'normalSummon' || firstStep.action === 'activate') {
        hand.push(cid);
      } else if (ED_ACTIONS.has(firstStep.action)) {
        extraDeckNeeded.add(cid);
        priorStateWarning = `first step is ${firstStep.action} of cardId=${cid} — assumes material on field`;
      } else {
        // specialSummon / ritualSummon as step 0 — often triggered by prior
        // state (card in GY, field). Best-effort: put in hand so the bridge
        // at least has the subject accessible.
        hand.push(cid);
        priorStateWarning = `first step is ${firstStep.action} — may need prior state not modelled in synthesis`;
      }
    } else {
      priorStateWarning = `first step subject selector resolved to no cardId (kind=${firstStep.subject.kind})`;
    }
  }

  // requiresDeckPieces → mainDeck (minus those in hand).
  for (const cid of bridge.requiresDeckPieces) {
    if (!hand.includes(cid)) mainDeckNeeded.add(cid);
  }

  // Every step: ED summon subject → extraDeck; other targets → mainDeck.
  for (const step of bridge.steps) {
    const subjectIds = expandSelector(step.subject, roleMap);
    if (ED_ACTIONS.has(step.action)) {
      for (const cid of subjectIds) extraDeckNeeded.add(cid);
    }
    if (step.target) {
      const targetIds = expandSelector(step.target, roleMap);
      for (const cid of targetIds) {
        if (!hand.includes(cid) && !extraDeckNeeded.has(cid)) mainDeckNeeded.add(cid);
      }
    }
  }

  // Build initialPlacements from requiresInitialState. Cards placed directly
  // into MZONE/GY/etc. must NOT also appear in mainDeck (duplicate) — exclude
  // from deck synthesis.
  const initialPlacements: InitialPlacement[] = [];
  const placedCardIds = new Set<number>();
  for (const slot of bridge.requiresInitialState ?? []) {
    const placement = cardSlotToPlacement(slot, roleMap);
    if (placement) {
      initialPlacements.push(placement);
      placedCardIds.add(placement.cardId);
    } else {
      notes.push(`requiresInitialState entry with selector ${JSON.stringify(slot.card)} / zone=${slot.zone} — skipped`);
    }
  }
  for (const cid of placedCardIds) {
    mainDeckNeeded.delete(cid);
    extraDeckNeeded.delete(cid);
  }

  // Intersection safety: a card can't be in both mainDeck and extraDeck.
  // ED wins for ED cards by design.
  for (const cid of extraDeckNeeded) mainDeckNeeded.delete(cid);

  // Duel cannot start with 0 cards in hand — seed a filler so createDuel
  // succeeds. The bridge will naturally FAIL produces match because no real
  // play is possible from a filler-only hand; the failure signals to the
  // caller that the bridge needs prior state (handled in phase 3).
  if (hand.length === 0) {
    hand.push(FILLER_CARD);
    priorStateWarning = `${priorStateWarning ?? 'no hand seed derivable'}; filler placeholder inserted`;
  }

  const mainDeck = [...mainDeckNeeded];
  const extraDeck = [...extraDeckNeeded];
  const fillerCount = DECK_SIZE - hand.length - mainDeck.length;
  if (fillerCount < 0) {
    notes.push(`deck overflow: ${hand.length + mainDeck.length} forced cards > ${DECK_SIZE}`);
  }
  mainDeck.push(...Array(Math.max(fillerCount, 0)).fill(FILLER_CARD));

  return { hand, mainDeck, extraDeck, initialPlacements, notes, priorStateWarning };
}

// =============================================================================
// Autopilot
// =============================================================================

const STALL_CEILING = 30; // Prompts without step advance before aborting.

class BridgeAutopilot {
  private stepIdx = 0;
  private promptCount = 0;
  private lastProgressAt = 0;
  private stalled = false;
  private readonly log: string[] = [];

  constructor(
    private readonly bridge: BridgeSubroute,
    private readonly roleMap: Readonly<Record<number, readonly CardRole[]>>,
    private readonly verbose: boolean,
  ) {}

  get currentStep(): RouteStep | undefined { return this.bridge.steps[this.stepIdx]; }
  get isDone(): boolean { return this.stepIdx >= this.bridge.steps.length; }
  get hasStalled(): boolean { return this.stalled; }
  get stepsConsumed(): number { return this.stepIdx; }
  get trace(): readonly string[] { return this.log; }

  private advance(): void {
    this.stepIdx++;
    this.lastProgressAt = this.promptCount;
  }

  pickAction(legal: readonly Action[]): Action | null {
    this.promptCount++;
    if (this.promptCount > PROMPT_CEILING) {
      this.stalled = true;
      return null;
    }
    // No-progress abort: if the step cursor hasn't advanced in N prompts,
    // the bridge can't be completed from this state. Return null to halt
    // the outer loop cleanly instead of looping end-phase → next-turn forever.
    if (this.promptCount - this.lastProgressAt > STALL_CEILING) {
      this.stalled = true;
      return null;
    }

    // Annotation steps: advance immediately, not tied to a prompt. tribute/
    // discard in bridge steps describe a cost that OCGcore resolves via its
    // own mechanical SELECT_TRIBUTE/SELECT_CARD prompt — that is handled
    // by fallback auto-pick. Just move the cursor forward.
    while (this.currentStep && ANNOTATION_ACTIONS.has(this.currentStep.action)) {
      this.log.push(`step ${this.stepIdx} ${this.currentStep.action} (annotation; auto-advance)`);
      this.advance();
    }

    const promptType = legal[0].promptType;
    const step = this.currentStep;

    if (this.verbose) {
      console.log(`[autopilot] prompt=${promptType} legal=${legal.length} step=${this.stepIdx}${step ? ` (${step.action})` : ' (terminal)'}`);
    }

    if (step) {
      const match = this.pickForStep(step, promptType, legal);
      if (match) return match.action;
    }

    return this.pickFallback(promptType, legal);
  }

  private pickForStep(step: RouteStep, promptType: string, legal: readonly Action[]):
    { action: Action } | null {
    const subjectIds = new Set(expandSelector(step.subject, this.roleMap));
    const targetIds = step.target ? new Set(expandSelector(step.target, this.roleMap)) : null;

    switch (step.action) {
      case 'normalSummon':
        return this.tryMatch(legal, 'SELECT_IDLECMD', a => subjectIds.has(a.cardId) && a.actionTag === 'summon', step, promptType, true);

      case 'activate':
        return this.tryMatch(legal, 'SELECT_IDLECMD', a => subjectIds.has(a.cardId) && a.actionTag === 'activate', step, promptType, true);

      case 'set':
        return this.tryMatch(legal, 'SELECT_IDLECMD', a => subjectIds.has(a.cardId) && (a.actionTag === 'mset' || a.actionTag === 'sset'), step, promptType, true);

      case 'specialSummon':
      case 'xyzSummon':
      case 'synchroSummon':
      case 'linkSummon':
      case 'fusionSummon':
      case 'ritualSummon': {
        // Two paths:
        //  (a) at SELECT_IDLECMD with actionTag 'ss' (proc-driven ED summon)
        //  (b) at SELECT_CHAIN / SELECT_EFFECTYN when the subject is the card
        //      that owns a triggered SS effect (e.g., Poplar on-add-to-hand)
        if (promptType === 'SELECT_IDLECMD') {
          return this.tryMatch(legal, 'SELECT_IDLECMD', a => subjectIds.has(a.cardId) && a.actionTag === 'ss', step, promptType, true);
        }
        if (promptType === 'SELECT_CHAIN' || promptType === 'SELECT_EFFECTYN') {
          return this.tryActivateTrigger(legal, subjectIds, promptType, step, true);
        }
        return null;
      }

      case 'search': {
        // Sub-phase 1: activate the trigger (SELECT_CHAIN/SELECT_EFFECTYN) —
        // don't advance step pointer.
        if (promptType === 'SELECT_CHAIN' || promptType === 'SELECT_EFFECTYN') {
          return this.tryActivateTrigger(legal, subjectIds, promptType, step, false);
        }
        // Sub-phase 2: pick target — advance step pointer.
        if (promptType === 'SELECT_CARD' || promptType === 'SELECT_UNSELECT_CARD') {
          if (!targetIds) return null;
          const match = legal.find(a => targetIds.has(a.cardId));
          if (match) {
            this.log.push(`step ${this.stepIdx} search/pickTarget ${match.cardId} → rIdx=${match.responseIndex}`);
            this.advance();
            return { action: match };
          }
          return null;
        }
        return null;
      }

      default:
        return null;
    }
  }

  private tryMatch(
    legal: readonly Action[],
    expectPrompt: string,
    pred: (a: Action) => boolean,
    step: RouteStep,
    promptType: string,
    advance: boolean,
  ): { action: Action } | null {
    if (promptType !== expectPrompt) return null;
    const match = legal.find(pred);
    if (match) {
      this.log.push(`step ${this.stepIdx} ${step.action} cardId=${match.cardId} → rIdx=${match.responseIndex}`);
      if (advance) this.advance();
      return { action: match };
    }
    return null;
  }

  private tryActivateTrigger(
    legal: readonly Action[],
    subjectIds: Set<number>,
    promptType: string,
    step: RouteStep,
    advance: boolean,
  ): { action: Action } | null {
    const match = legal.find(a =>
      subjectIds.has(a.cardId)
      && ((promptType === 'SELECT_CHAIN' && a.responseIndex !== -1)
        || (promptType === 'SELECT_EFFECTYN' && a.responseIndex === 1)),
    );
    if (match) {
      this.log.push(`step ${this.stepIdx} ${step.action}/activate cardId=${match.cardId} → rIdx=${match.responseIndex}`);
      if (advance) this.advance();
      return { action: match };
    }
    return null;
  }

  private pickFallback(promptType: string, legal: readonly Action[]): Action | null {
    // Multi-pick prompts (SELECT_CARD min>1, SELECT_TRIBUTE, SELECT_SUM) surface
    // via actionTag tokens when exposeMultiPickMechanical=true. Autopilot must:
    //   1. commit as soon as constraints are satisfied (skips further picks)
    //   2. otherwise add — preferring an add whose cardId matches the current
    //      step's target (for cost-specific bridges); else any add
    //   3. never undo — undoing reverts progress and guarantees an infinite loop
    const hasMultiPickActions = legal.some(a =>
      a.actionTag === 'multi-pick-add' || a.actionTag === 'multi-pick-commit');
    if (hasMultiPickActions) {
      const commit = legal.find(a => a.actionTag === 'multi-pick-commit');
      if (commit) return commit;
      const step = this.currentStep;
      if (step?.target) {
        const targetIds = new Set(expandSelector(step.target, this.roleMap));
        const targetedAdd = legal.find(a => a.actionTag === 'multi-pick-add' && targetIds.has(a.cardId));
        if (targetedAdd) return targetedAdd;
      }
      const anyAdd = legal.find(a => a.actionTag === 'multi-pick-add');
      if (anyAdd) return anyAdd;
      // Only undo left — we're wedged. Return null to let outer loop surface
      // the stall via STALL_CEILING rather than regress.
      return null;
    }

    if (promptType === 'SELECT_CHAIN') {
      const pass = legal.find(a => a.responseIndex === -1);
      if (pass) return pass;
    }
    if (promptType === 'SELECT_EFFECTYN' || promptType === 'SELECT_YESNO') {
      const no = legal.find(a => a.responseIndex === 0);
      if (no) return no;
    }
    if (promptType === 'SELECT_IDLECMD' && this.isDone) {
      const toEp = legal.find(a => a.actionTag === 'to_ep');
      const toBp = legal.find(a => a.actionTag === 'to_bp');
      return toEp ?? toBp ?? null;
    }
    return legal[0] ?? null;
  }
}

// =============================================================================
// Produces matching
// =============================================================================

function zoneKindMatches(kind: string, actualZone: string): boolean {
  switch (kind) {
    case 'monster': return ['M1', 'M2', 'M3', 'M4', 'M5'].includes(actualZone);
    case 'extraMonster': return ['EMZ_L', 'EMZ_R'].includes(actualZone);
    case 'spellTrap': return ['S1', 'S2', 'S3', 'S4', 'S5'].includes(actualZone);
    case 'field': return actualZone === 'FIELD_S';
    case 'gy': return actualZone === 'GY';
    case 'hand': return actualZone === 'HAND';
    case 'banished': return actualZone === 'BANISHED';
    case 'deck': return actualZone === 'DECK';
    default: return false;
  }
}

function positionMatches(expected: string | undefined, actual: string): boolean {
  if (!expected) return true;
  return expected === actual;
}

function matchesProduces(
  fs: FieldState,
  produces: readonly CardSlot[],
  roleMap: Readonly<Record<number, readonly CardRole[]>>,
): { ok: boolean; missing: string[]; matched: string[] } {
  const missing: string[] = [];
  const matched: string[] = [];
  for (const slot of produces) {
    const cardIds = new Set(expandSelector(slot.card, roleMap));
    if (cardIds.size === 0) {
      missing.push(`selector ${JSON.stringify(slot.card)} resolved to no cardId`);
      continue;
    }
    let found: { zone: string; card: FieldCard } | null = null;
    let foundElsewhere: { zone: string; card: FieldCard } | null = null;
    for (const [zone, cards] of Object.entries(fs.zones)) {
      for (const c of cards as FieldCard[]) {
        if (!cardIds.has(c.cardId)) continue;
        if (!foundElsewhere) foundElsewhere = { zone, card: c };
        if (!zoneKindMatches(slot.zone, zone)) continue;
        if (!positionMatches(slot.position, c.position)) continue;
        found = { zone, card: c };
        break;
      }
      if (found) break;
    }
    const label = `${slot.zone}${slot.position ? `/${slot.position}` : ''} [${[...cardIds].slice(0, 3).join(',')}${cardIds.size > 3 ? ',…' : ''}]`;
    if (found) matched.push(`${label} → ${found.zone}/${found.card.position} (${found.card.cardName})`);
    else if (foundElsewhere) missing.push(`${label} — found at ${foundElsewhere.zone}/${foundElsewhere.card.position} instead`);
    else missing.push(`${label} — NOT ON FIELD`);
  }
  return { ok: missing.length === 0, missing, matched };
}

// =============================================================================
// Tier + diagnosis classification
// =============================================================================

type Tier =
  | 'A_VERIFIED'          // steps all consumed + produces matched. Trust high.
  | 'B_PARTIAL'           // progress made, not complete. Likely recoverable.
  | 'C_UNVALIDATABLE'     // structural limit recognized. Human review queue.
  | 'D_REJECTED';         // validator executed cleanly but produces mismatch.

type DiagnosisCode =
  | 'NONE'                           // tier A
  | 'TRIGGER_ORIGIN_MISMATCH'        // e.g., flamberge-gy, trigger wants 'from field' but state placement won't emit event
  | 'NEEDS_PRIOR_SUMMON_NO_PRECURSOR' // activate of Monster without precursor/placement to get it on field
  | 'MATERIAL_NOT_AVAILABLE'         // ED summon with no matching materials in legal pool
  | 'UNHANDLED_PROMPT'               // autopilot encountered SELECT_SUM / SELECT_COUNTER / etc. not yet supported
  | 'COST_MULTI_PICK_COMPLEX'        // multi-pick with non-trivial constraints we can't satisfy
  | 'PRODUCES_ZONE_MISMATCH'         // end state reached but slot in wrong zone (likely bridge authoring bug)
  | 'PRE_DECLARED_LIMIT'             // bridge carries knownStructuralLimit — promoted to C regardless
  | 'SYNTHESIS_EMPTY_HAND'           // couldn't seed hand from bridge spec
  | 'PARTIAL_STALL'                  // stepsConsumed > 0 but autopilot stalled before completion
  | 'UNKNOWN';                        // fallback

function classify(
  bridge: BridgeSubroute,
  result: Omit<ValidationResult, 'tier' | 'diagnosis'>,
): { tier: Tier; diagnosis: DiagnosisCode } {
  // 1. Pre-declared structural limit overrides anything — always tier C.
  if (bridge.knownStructuralLimit) {
    return { tier: 'C_UNVALIDATABLE', diagnosis: 'PRE_DECLARED_LIMIT' };
  }

  // 2. Full success → tier A.
  if (result.ok) return { tier: 'A_VERIFIED', diagnosis: 'NONE' };

  const reason = result.reason ?? '';
  const firstStep = bridge.steps[0];

  // 3. Synthesis failure.
  if (reason.includes('synthesis failed')) {
    return { tier: 'C_UNVALIDATABLE', diagnosis: 'SYNTHESIS_EMPTY_HAND' };
  }

  // 4. Engine-level createDuel rejection.
  if (reason.startsWith('createDuel failed')) {
    return { tier: 'D_REJECTED', diagnosis: 'UNKNOWN' };
  }

  // 5. Zero steps consumed — initial conditions wrong.
  if (result.stepsConsumed === 0) {
    if (firstStep && ED_ACTIONS.has(firstStep.action) && !bridge.precursors?.length
      && !bridge.requiresInitialState?.length) {
      return { tier: 'C_UNVALIDATABLE', diagnosis: 'MATERIAL_NOT_AVAILABLE' };
    }
    if (firstStep?.action === 'activate' && !bridge.precursors?.length
      && !bridge.requiresInitialState?.length) {
      // activate of a Monster usually needs prior NS; without precursor/state → structural
      return { tier: 'C_UNVALIDATABLE', diagnosis: 'NEEDS_PRIOR_SUMMON_NO_PRECURSOR' };
    }
    if (firstStep?.action === 'specialSummon' && !bridge.precursors?.length
      && !bridge.requiresInitialState?.length) {
      // triggered SS (flamberge pattern) — probably needs trigger origin that state placement can't emit
      return { tier: 'C_UNVALIDATABLE', diagnosis: 'TRIGGER_ORIGIN_MISMATCH' };
    }
    // Multi-pick or unhandled prompt.
    if (reason.includes('SELECT_SUM') || reason.includes('SELECT_COUNTER')) {
      return { tier: 'C_UNVALIDATABLE', diagnosis: 'UNHANDLED_PROMPT' };
    }
    if (reason.includes('multi-pick')) {
      return { tier: 'C_UNVALIDATABLE', diagnosis: 'COST_MULTI_PICK_COMPLEX' };
    }
    return { tier: 'C_UNVALIDATABLE', diagnosis: 'UNKNOWN' };
  }

  // 6. Partial progress — some steps ran but not all.
  if (result.stepsConsumed < result.stepsTotal) {
    return { tier: 'B_PARTIAL', diagnosis: 'PARTIAL_STALL' };
  }

  // 7. All steps consumed but produces mismatch — genuine bridge error.
  //    Differentiate "card on field but wrong zone" vs "card not on field at all"
  //    to steer human review.
  const hasZoneMismatch = result.missing.some(m => m.includes('found at '));
  if (hasZoneMismatch) {
    return { tier: 'D_REJECTED', diagnosis: 'PRODUCES_ZONE_MISMATCH' };
  }
  return { tier: 'D_REJECTED', diagnosis: 'UNKNOWN' };
}

// =============================================================================
// Single-bridge validator
// =============================================================================

interface ValidationResult {
  bridgeId: string;
  archetype: string;
  ok: boolean;
  stepsTotal: number;
  stepsConsumed: number;
  matchedProduces: number;
  totalProduces: number;
  priorStateWarning: string | null;
  reason?: string;
  trace: readonly string[];
  fieldStateSummary: string;
  missing: readonly string[];
  tier: Tier;
  diagnosis: DiagnosisCode;
}

function formatZones(fs: FieldState): string {
  const lines: string[] = [];
  for (const [zone, cards] of Object.entries(fs.zones)) {
    const list = cards as FieldCard[];
    if (list.length === 0) continue;
    if (zone === 'DECK' || zone === 'EXTRA') {
      lines.push(`  ${zone}: ${list.length} cards`);
      continue;
    }
    lines.push(`  ${zone}: ${list.map(c => `${c.cardName}(${c.cardId})[${c.position}]`).join(', ')}`);
  }
  lines.push(`  LP: [${fs.lifePoints[0]}, ${fs.lifePoints[1]}]  turn=${fs.turn}  phase=${fs.phase}`);
  return lines.join('\n');
}

async function validateBridge(
  bridge: BridgeSubroute,
  expertise: LoadedExpertise,
  allExpertise: LoadedExpertise[],
  adapter: OCGCoreAdapter,
  verbose: boolean,
): Promise<ValidationResult> {
  // Flatten precursors into a single effective bridge with all steps,
  // merged requiresDeckPieces, and merged requiresInitialState. produces
  // stays the MAIN bridge's produces (what we're actually validating).
  let effective: EffectiveBridge;
  try {
    effective = buildEffectiveBridge(bridge, allExpertise);
  } catch (err) {
    const base = {
      bridgeId: bridge.id, archetype: expertise.archetype, ok: false,
      stepsTotal: bridge.steps.length, stepsConsumed: 0,
      matchedProduces: 0, totalProduces: bridge.produces.length,
      priorStateWarning: null, reason: (err as Error).message,
      trace: [] as string[], fieldStateSummary: '', missing: [] as string[],
    };
    const { tier, diagnosis } = classify(bridge, base);
    return { ...base, tier, diagnosis };
  }

  const result: ValidationResult = {
    bridgeId: bridge.id,
    archetype: expertise.archetype,
    ok: false,
    stepsTotal: effective.bridge.steps.length,
    stepsConsumed: 0,
    matchedProduces: 0,
    totalProduces: bridge.produces.length,
    priorStateWarning: null,
    trace: [],
    fieldStateSummary: '',
    missing: [],
    tier: 'D_REJECTED',   // overwritten at end via classify()
    diagnosis: 'UNKNOWN',
  };

  const state = synthesizeState(effective.bridge, expertise.roleMap);
  result.priorStateWarning = state.priorStateWarning;
  if (effective.chain.length > 0) {
    const chainNote = `composed via precursors [${effective.chain.join(' → ')}] (${effective.precursorStepCount} prefix steps)`;
    result.priorStateWarning = result.priorStateWarning ? `${result.priorStateWarning}; ${chainNote}` : chainNote;
  }

  if (state.hand.length === 0) {
    result.reason = 'synthesis failed: empty hand';
    const { tier, diagnosis } = classify(bridge, result);
    result.tier = tier; result.diagnosis = diagnosis;
    return result;
  }

  const config: DuelConfig = {
    mainDeck: state.mainDeck,
    extraDeck: state.extraDeck,
    hand: state.hand,
    deckSeed: [42n, 123n, 456n, 789n],
    opponentDeck: [],
    startingDrawCount: 0,
    drawCountPerTurn: 0,
    initialPlacements: state.initialPlacements.length > 0 ? state.initialPlacements : undefined,
  };

  let handle;
  try {
    handle = adapter.createDuel(config);
  } catch (err) {
    result.reason = `createDuel failed: ${(err as Error).message}`;
    const { tier, diagnosis } = classify(bridge, result);
    result.tier = tier; result.diagnosis = diagnosis;
    return result;
  }

  try {
    const autopilot = new BridgeAutopilot(effective.bridge, expertise.roleMap, verbose);
    while (true) {
      const legal = adapter.getLegalActions(handle);
      if (legal.length === 0) break;
      if (autopilot.isDone && legal[0].promptType === 'SELECT_IDLECMD') break;
      const pick = autopilot.pickAction(legal);
      if (!pick) {
        if (autopilot.hasStalled) {
          result.reason = `no progress — autopilot stalled at prompt=${legal[0].promptType} step=${autopilot.currentStep?.action ?? 'done'}`;
        } else {
          result.reason = `autopilot stuck at prompt=${legal[0].promptType} step=${autopilot.currentStep?.action ?? 'done'}`;
        }
        break;
      }
      adapter.applyAction(handle, pick);
    }

    const fieldState = adapter.getFieldState(handle);
    result.fieldStateSummary = formatZones(fieldState);
    result.trace = autopilot.trace;
    result.stepsConsumed = autopilot.stepsConsumed;

    const match = matchesProduces(fieldState, bridge.produces, expertise.roleMap);
    result.matchedProduces = match.matched.length;
    result.missing = match.missing;
    result.ok = match.ok && autopilot.isDone;
    if (!result.ok && !result.reason) {
      if (!autopilot.isDone) result.reason = 'not all steps consumed';
      else result.reason = `${match.missing.length} produces unmatched`;
    }
  } finally {
    adapter.destroyDuel(handle);
  }

  const { tier, diagnosis } = classify(bridge, result);
  result.tier = tier;
  result.diagnosis = diagnosis;
  return result;
}

// =============================================================================
// Main
// =============================================================================

const TIER_GLYPH: Record<Tier, string> = {
  A_VERIFIED: '🟢 A',
  B_PARTIAL: '🟡 B',
  C_UNVALIDATABLE: '🔵 C',
  D_REJECTED: '🔴 D',
};

function tierLabel(r: ValidationResult): string {
  return TIER_GLYPH[r.tier];
}

// Exit code policy: success (0) if no tier D failures. Tier C (unvalidatable)
// is not a failure — these bridges are structurally valid, just outside our
// primitives. Only tier D signals a bad bridge.
function effectiveFailureCount(results: readonly ValidationResult[]): number {
  return results.filter(r => r.tier === 'D_REJECTED').length;
}

// =============================================================================
// Human-verdicts override (phase 5) — persists human adjudication of tier C
// bridges. A verdict of 'accepted' leaves the bridge in tier C but marks it
// as human-confirmed-valid; 'rejected' forces tier D regardless of classify().
// =============================================================================

interface HumanVerdict {
  verdict: 'accepted' | 'rejected';
  reason: string;
  reviewedOn: string;
}

type HumanVerdictMap = Readonly<Record<string, HumanVerdict>>;

const HUMAN_VERDICTS_PATH = join(DATA_DIR, 'bridge-validation-verdicts.json');

function loadHumanVerdicts(): HumanVerdictMap {
  try {
    const content = readFileSync(HUMAN_VERDICTS_PATH, 'utf-8');
    return JSON.parse(content) as HumanVerdictMap;
  } catch {
    return {};
  }
}

function applyHumanVerdict(r: ValidationResult, verdicts: HumanVerdictMap): ValidationResult {
  const v = verdicts[r.bridgeId];
  if (!v) return r;
  if (v.verdict === 'rejected') return { ...r, tier: 'D_REJECTED' };
  // 'accepted' → stay in whatever tier (usually C); the summary marks it.
  return r;
}

function printResult(r: ValidationResult, verbose: boolean, verdict?: HumanVerdict): void {
  console.log(`\n━━━ ${r.bridgeId} (${r.archetype})`);
  const verdictTag = verdict
    ? verdict.verdict === 'accepted' ? ' [human:accepted]' : ' [human:rejected]'
    : '';
  console.log(`  ${tierLabel(r)}  ${r.diagnosis}  steps ${r.stepsConsumed}/${r.stepsTotal}  produces ${r.matchedProduces}/${r.totalProduces}${verdictTag}`);
  if (r.priorStateWarning) console.log(`  ⚠ ${r.priorStateWarning}`);
  if (r.reason) console.log(`  reason: ${r.reason}`);
  if (verdict) console.log(`  human-verdict: ${verdict.verdict} (${verdict.reviewedOn}) — ${verdict.reason}`);
  if (verbose || r.tier === 'D_REJECTED' || r.tier === 'B_PARTIAL') {
    if (r.trace.length > 0) {
      console.log(`  trace:`);
      for (const t of r.trace) console.log(`    ${t}`);
    }
    if (r.fieldStateSummary) {
      console.log(`  field:`);
      for (const line of r.fieldStateSummary.split('\n')) console.log(`  ${line}`);
    }
    if (r.missing.length > 0) {
      console.log(`  missing:`);
      for (const m of r.missing) console.log(`    ${m}`);
    }
  }
}

async function main(): Promise<void> {
  const bridgeId = parseStringArg('bridge');
  const archetype = parseStringArg('archetype');
  const candidatesPath = parseStringArg('candidates');
  const candidatesLimit = Number(parseStringArg('limit') ?? 0) || undefined;
  const candidatesConfidence = parseStringArg('confidence')?.split(',');
  const runAll = process.argv.includes('--all');
  const verbose = process.env['VALIDATE_BRIDGE_VERBOSE'] === '1';

  if (!bridgeId && !archetype && !runAll && !candidatesPath) {
    console.error('[validate-bridge] specify --bridge=<id> | --archetype=<id> | --all | --candidates=<path>');
    process.exit(2);
  }

  const all = loadAllExpertise();

  const targets: { bridge: BridgeSubroute; expertise: LoadedExpertise }[] = [];
  const candidatesHost: LoadedExpertise = { archetype: 'candidates', roleMap: {}, bridges: [] };
  const skippedEdges: { edge: CandidateEdge; reason: string }[] = [];

  if (candidatesPath) {
    const raw = readFileSync(candidatesPath, 'utf-8');
    const cf = JSON.parse(raw) as CandidatesFile;
    console.log(`[validate-bridge] loaded ${cf.edges.length} candidate edges from ${candidatesPath}`);
    let edges = cf.edges;
    if (candidatesConfidence) {
      edges = edges.filter(e => candidatesConfidence.includes(e.confidence));
      console.log(`[validate-bridge] filter confidence=[${candidatesConfidence.join(',')}] → ${edges.length} edges`);
    }
    if (candidatesLimit) {
      edges = edges.slice(0, candidatesLimit);
      console.log(`[validate-bridge] limit=${candidatesLimit} → ${edges.length} edges`);
    }
    let translated = 0;
    const skipReasonHist: Record<string, number> = {};
    let debugPrinted = 0;
    for (const edge of edges) {
      const bridge = candidateToBridge(edge, cf.cardProperties);
      if (!bridge) {
        const reasonPrefix = edge.reason.split(' ')[0];
        skipReasonHist[reasonPrefix] = (skipReasonHist[reasonPrefix] ?? 0) + 1;
        skippedEdges.push({ edge, reason: `unsupported: ${edge.reason}` });
        if (debugPrinted < 3 && verbose) {
          const fp = cf.cardProperties[String(edge.from.cardId)];
          const tp = cf.cardProperties[String(edge.to.cardId)];
          console.log(`[debug skip] ${edge.reason}`);
          console.log(`  from: ${edge.from.name}(${edge.from.cardId}) type=0x${fp?.type.toString(16)} propsFound=${!!fp}`);
          console.log(`  to  : ${edge.to.name}(${edge.to.cardId}) type=0x${tp?.type.toString(16)} propsFound=${!!tp}`);
          debugPrinted++;
        }
        continue;
      }
      targets.push({ bridge, expertise: candidatesHost });
      translated++;
    }
    console.log(`[validate-bridge] translated ${translated} edges → bridges; skipped ${skippedEdges.length}`);
    if (skippedEdges.length > 0) {
      console.log(`[validate-bridge] skip reasons:`);
      for (const [r, n] of Object.entries(skipReasonHist).sort(([, a], [, b]) => b - a)) {
        console.log(`  ${String(n).padStart(5)}  ${r}`);
      }
    }
  } else if (bridgeId) {
    const match = findBridge(all, bridgeId);
    if (!match) {
      console.error(`[validate-bridge] bridge '${bridgeId}' not found`);
      process.exit(2);
    }
    targets.push(match);
  } else {
    for (const exp of all) {
      if (archetype && exp.archetype !== archetype) continue;
      for (const bridge of exp.bridges) targets.push({ bridge, expertise: exp });
    }
  }

  if (targets.length === 0) {
    console.error('[validate-bridge] no bridges matched');
    process.exit(2);
  }

  console.log(`[validate-bridge] loading ocgcore…`);
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  // Light-weight load path: only interruption-tags are needed by the adapter.
  // We skip `loadAllSolverConfigs` here because it runs `validateGrammarGraph`
  // which `process.exit(1)`s on any successor-coverage inconsistency — those
  // are orthogonal to bridge validation and shouldn't block this tool.
  const interruptionTags = loadInterruptionTags(DATA_DIR);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, interruptionTags);
  adapter.exposeMultiPickMechanical = true;

  const verdicts = loadHumanVerdicts();

  const results: ValidationResult[] = [];
  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const r0 = await validateBridge(t.bridge, t.expertise, all, adapter, verbose);
      const r = applyHumanVerdict(r0, verdicts);
      results.push(r);
      // Suppress per-bridge printing in large --candidates runs (spammy).
      // Still print a compact progress line every 25 targets.
      if (candidatesPath && targets.length > 50) {
        if ((i + 1) % 25 === 0 || i === targets.length - 1) {
          const pass = results.filter(x => x.tier === 'A_VERIFIED').length;
          console.log(`[validate-bridge] ${i + 1}/${targets.length} done — A=${pass} so far`);
        }
      } else {
        printResult(r, verbose, verdicts[r.bridgeId]);
      }
    }
  } finally {
    adapter.destroyAll();
  }

  // Summary: tier breakdown + per-bridge row.
  console.log(`\n═══ SUMMARY ═══`);
  const byTier: Record<Tier, number> = { A_VERIFIED: 0, B_PARTIAL: 0, C_UNVALIDATABLE: 0, D_REJECTED: 0 };
  for (const r of results) byTier[r.tier]++;
  console.log(`🟢 A (verified)       : ${byTier.A_VERIFIED}/${results.length}`);
  console.log(`🟡 B (partial)        : ${byTier.B_PARTIAL}/${results.length}`);
  console.log(`🔵 C (unvalidatable)  : ${byTier.C_UNVALIDATABLE}/${results.length}   ← needs human review (unless verdicted)`);
  console.log(`🔴 D (rejected)       : ${byTier.D_REJECTED}/${results.length}   ← genuine errors`);

  if (!candidatesPath) {
    console.log(`\nPer-bridge:`);
    for (const r of results) {
      const v = verdicts[r.bridgeId];
      const vTag = v ? ` [${v.verdict}]` : '';
      console.log(`  ${tierLabel(r)}  ${r.diagnosis.padEnd(34)}  ${r.bridgeId}${vTag}`);
    }
  } else {
    // --candidates mode: write tier-bucketed output files + diagnosis histogram.
    const outDir = join(DATA_DIR, '..', '..', '_bmad-output', 'solver-data');
    const stamp = new Date().toISOString().slice(0, 10);
    const outA = join(outDir, `candidate-bridges-tier-a-${stamp}.json`);
    const outC = join(outDir, `candidate-bridges-tier-c-${stamp}.json`);
    const outD = join(outDir, `candidate-bridges-tier-d-${stamp}.json`);

    const slim = (r: ValidationResult) => ({
      bridgeId: r.bridgeId, tier: r.tier, diagnosis: r.diagnosis,
      stepsTotal: r.stepsTotal, stepsConsumed: r.stepsConsumed,
      matchedProduces: r.matchedProduces, totalProduces: r.totalProduces,
      reason: r.reason, priorStateWarning: r.priorStateWarning,
      missing: r.missing,
    });

    writeFileSync(outA, JSON.stringify({
      stamp, tier: 'A_VERIFIED', count: byTier.A_VERIFIED,
      results: results.filter(r => r.tier === 'A_VERIFIED').map(slim),
    }, null, 2));
    writeFileSync(outC, JSON.stringify({
      stamp, tier: 'C_UNVALIDATABLE', count: byTier.C_UNVALIDATABLE,
      skippedEdges: skippedEdges.map(s => ({ edge: s.edge, reason: s.reason })),
      results: results.filter(r => r.tier === 'C_UNVALIDATABLE').map(slim),
    }, null, 2));
    writeFileSync(outD, JSON.stringify({
      stamp, tier: 'D_REJECTED', count: byTier.D_REJECTED,
      results: results.filter(r => r.tier === 'D_REJECTED').map(slim),
    }, null, 2));

    // Diagnosis histogram — what's preventing acceptance?
    const byDiag: Record<string, number> = {};
    for (const r of results) byDiag[r.diagnosis] = (byDiag[r.diagnosis] ?? 0) + 1;
    console.log(`\nDiagnosis histogram:`);
    for (const [diag, n] of Object.entries(byDiag).sort(([, a], [, b]) => b - a)) {
      console.log(`  ${String(n).padStart(5)}  ${diag}`);
    }
    if (skippedEdges.length > 0) {
      console.log(`\nSkipped (unsupported edge class, not translated): ${skippedEdges.length}`);
    }
    console.log(`\nTier-bucketed output:`);
    console.log(`  🟢 ${outA}`);
    console.log(`  🔵 ${outC}`);
    console.log(`  🔴 ${outD}`);
  }

  // Exit 0 if no tier D. Tier C is NOT a failure (human-review bucket).
  const dCount = effectiveFailureCount(results);
  if (dCount > 0) {
    console.log(`\n✗ ${dCount} tier-D rejection(s) — genuine bridge errors`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('[validate-bridge] FATAL:', err);
  process.exit(2);
});
