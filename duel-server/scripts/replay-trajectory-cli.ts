// =============================================================================
// replay-trajectory-cli.ts — Path β POC replay engine.
//
// Plan-based replay for use by Path β subagents. Reads a plan JSON file,
// replays it on a fresh OCGCore duel for the named fixture, and outputs
// a JSON report with score, matched cards, and divergence diagnostics.
//
// Plan format (input):
//   {
//     "plan": [
//       { "cardName": "Branded Fusion", "verb": "activate" },
//       { "cardName": "Dracotail Phryxul", "verb": "normal-summon" },
//       ...
//     ],
//     "endTurn": true       // optional, default true — auto-pass to End Phase
//                            // after plan exhausted
//   }
//
// Replay semantics:
//   - At each SELECT_IDLECMD prompt, consume the next plan step and find a
//     matching legal action (case-insensitive cardName match + verb match).
//     Multiple matches → pick first. No match → divergence; stop.
//   - At sub-prompts (SELECT_CARD, SELECT_CHAIN, SELECT_OPTION, SELECT_*),
//     auto-pick the first legal action — these are tactical resolutions
//     the high-level plan doesn't specify.
//   - When the plan is exhausted and `endTurn` is true, repeatedly select
//     the End-Phase action until the player passes the turn (or until a
//     mechanical sub-prompt loop ends naturally).
//   - Stops on: divergence, replay exception, end-of-turn reached, or
//     iteration ceiling (safety).
//
// Output JSON:
//   {
//     "fixtureId": "...",
//     "expectedBoardSize": 8,
//     "matched": 4,
//     "matchedCardIds": [...],
//     "missingCardIds": [...],
//     "score": 70,
//     "scoreBreakdown": {...},
//     "stoppedReason": "completed" | "divergence" | "exception" | "ceiling",
//     "stoppedAtPlanStep": 5 | null,
//     "divergence": null | {
//       "step": 5,
//       "expected": "Branded Fusion (activate)",
//       "legalActionsAtPrompt": [
//         { "responseIndex": 0, "cardId": 12345, "cardName": "...", "verb": "activate" }
//       ],
//       "promptType": "SELECT_IDLECMD"
//     },
//     "replayLog": [
//       { "step": 0, "promptType": "SELECT_IDLECMD", "applied": "Dracotail Phryxul (normal-summon)", "planStepIndex": 0 },
//       { "step": 1, "promptType": "SELECT_CARD",   "applied": "Dracotail Selene (auto-pick first)", "planStepIndex": null },
//       ...
//     ],
//     "finalBoardSelf": [ { "zone": "M1", "cardName": "...", "cardId": ... }, ... ]
//   }
//
// Usage:
//   npx tsx scripts/replay-trajectory-cli.ts \
//     --fixture-id=branded-dracotail-opener \
//     --plan-file=path/to/plan.json \
//     --out=path/to/result.json     # optional, otherwise stdout JSON
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  type HandFixture,
} from './evaluate-structural.js';
import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import {
  buildFeatureContext,
  extractStateFeatures,
  extractActionFeatures,
  computeFeatureSpecHash,
  STATE_DIM,
  ACTION_DIM,
} from '../src/solver/state-feature-extractor.js';
import type { Action, DuelConfig, FieldState, ZoneId } from '../src/solver/solver-types.js';

// =============================================================================
// CLI
// =============================================================================

interface Args {
  fixtureId: string;
  planFile: string;
  outFile?: string;
  maxIterations: number;
  /** Tier 3 corpus dump path (JSONL). When set, every SELECT_CARD prompt
   *  encountered during replay emits one line: state features (58) +
   *  per-candidate action features (58 each) + the picked candidate index.
   *  The picked index reflects whichever the replay chose at that prompt
   *  (target-driven if matched, else legal[0] auto-pick). */
  dumpCorpus?: string;
  /** Continue policy when the plan is exhausted at SELECT_IDLECMD.
   *  - `end-phase` (default): pick end-phase immediately, end the turn.
   *  - `aggressive`: prefer productive actions (summon-procedure, activate,
   *    normal-summon, pendulum-summon, set-st) until none productive remain,
   *    then fall back to end-phase. Used by enumerate-pivot.ts to differentiate
   *    starter candidates by their cascade depth. */
  continueMode: 'end-phase' | 'aggressive';
  /** Max aggressive-mode actions before forcing end-phase. Safety cap. */
  maxAggressiveActions: number;
}

function parseArgs(): Args {
  const pick = (n: string): string | undefined => {
    const a = process.argv.find(x => x.startsWith(`--${n}=`));
    return a?.slice(n.length + 3);
  };
  const fixtureId = pick('fixture-id');
  const planFile = pick('plan-file');
  if (!fixtureId || !planFile) {
    console.error('Usage: --fixture-id=<id> --plan-file=<path> [--out=<path>] [--max-iterations=2000] [--dump-corpus=<path.jsonl>]');
    process.exit(2);
  }
  const continueModeRaw = pick('continue-mode') ?? 'end-phase';
  if (continueModeRaw !== 'end-phase' && continueModeRaw !== 'aggressive') {
    console.error(`[replay] --continue-mode must be 'end-phase' or 'aggressive', got '${continueModeRaw}'`);
    process.exit(2);
  }
  return {
    fixtureId,
    planFile,
    outFile: pick('out'),
    maxIterations: Number(pick('max-iterations') ?? '2000'),
    dumpCorpus: pick('dump-corpus'),
    continueMode: continueModeRaw,
    maxAggressiveActions: Number(pick('max-aggressive-actions') ?? '40'),
  };
}

// Plan-based input (β-1).
//
// Each plan step targets a SELECT_IDLECMD prompt and optionally pre-specifies
// the answers to the immediately-following sub-prompts via `targets[]`.
// Targets are consumed IN ORDER as SELECT_CARD / SELECT_OPTION / SELECT_PLACE
// prompts arise, until the next SELECT_IDLECMD (where the next plan step
// applies). Sub-prompts not covered by targets fall back to the auto-pick
// policy (SELECT_CHAIN→pass, SELECT_EFFECTYN→YES, others→legal[0]).
interface TargetSpec {
  /** Card name to match against legal actions' card names at the next
   *  matching sub-prompt. Case-insensitive. */
  cardName?: string;
  /** Multiple acceptable card names (matches any). */
  cardNames?: string[];
  /** OR force a specific responseIndex (for prompts where card name doesn't
   *  apply, e.g. SELECT_OPTION effect-choice). */
  responseIndex?: number;
  /** Optional human note (no semantic effect). */
  promptHint?: string;
}

interface PlanStep {
  cardName: string;
  verb?: string;
  /** Sub-prompt overrides for the resolution chain triggered by this
   *  IDLECMD step. Consumed in order at SELECT_CARD / SELECT_OPTION /
   *  SELECT_UNSELECT_CARD / SELECT_PLACE prompts encountered before the
   *  next SELECT_IDLECMD. */
  targets?: TargetSpec[];
  /** Chain-trigger overrides. Consumed in order at SELECT_CHAIN prompts
   *  encountered before the next SELECT_IDLECMD. Each entry directs the
   *  CLI to ACTIVATE a specific chain link (matched by cardName or
   *  responseIndex) instead of the default `pass`. Use this for combo
   *  decks where multiple optional triggers are queued together
   *  (e.g. Branded/Dracotail GY-fusion-material set-spell triggers,
   *  on-summon search triggers): without `chainTargets[]`, the auto-pass
   *  policy silently drops every queued trigger.
   *
   *  When `chainTargets` is exhausted, the auto-pass policy resumes
   *  (consistent with goldfish turn 1). To explicitly pass at a specific
   *  chain prompt mid-sequence, use `{responseIndex: -1}`. */
  chainTargets?: TargetSpec[];
}

interface PlanFile {
  plan: PlanStep[];
  endTurn?: boolean;
}

// Raw trajectory input (β-3).
//
// Two accepted shapes:
//   1. Authored canonical lines: { fixtureId, steps: [{ responseIndex, cardId, ... }] }
//   2. Trajectory dumps:        { fixtureId, trajectory: [{ responseIndex, cardId, ... }] }
//
// Each step is applied verbatim against the engine's legal-actions list:
// find the action with matching responseIndex AND cardId, apply it. No
// plan-matching, no auto-pick — the trajectory is fully specified.
// Useful for verifying authored lines and for the β-3 pattern (subagent
// modifies specific steps then replays).
interface RawTrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName?: string;
  actionDescription?: string;
}

interface CanonicalTrajectoryFile {
  fixtureId: string;
  steps: RawTrajectoryStep[];
}

interface DumpTrajectoryFile {
  fixtureId: string;
  trajectory: RawTrajectoryStep[];
}

type InputFile = PlanFile | CanonicalTrajectoryFile | DumpTrajectoryFile;

function isRawTrajectory(f: InputFile): f is CanonicalTrajectoryFile | DumpTrajectoryFile {
  return 'steps' in f || 'trajectory' in f;
}

function getRawSteps(f: CanonicalTrajectoryFile | DumpTrajectoryFile): RawTrajectoryStep[] {
  return 'steps' in f ? f.steps : f.trajectory;
}

// =============================================================================
// Output shapes
// =============================================================================

interface LegalActionSummary {
  responseIndex: number;
  cardId: number;
  cardName: string;
  verb: string | null;
  sourceZone?: string;
}

interface ReplayLogEntry {
  step: number;
  promptType: string;
  applied: string;
  appliedCardId: number;
  appliedResponseIndex: number;
  planStepIndex: number | null;
}

interface DivergenceInfo {
  step: number;
  promptType: string;
  expected: string;
  legalActionsAtPrompt: LegalActionSummary[];
  reason: string;
}

interface FinalBoardEntry {
  zone: ZoneId;
  cardName: string;
  cardId: number;
  position: string;
  overlayMaterials?: number[];
}

interface ReplayResult {
  fixtureId: string;
  expectedBoardSize: number;
  matched: number;
  matchedCardIds: number[];
  missingCardIds: number[];
  score: number;
  scoreBreakdown: unknown;
  stoppedReason: 'completed' | 'divergence' | 'exception' | 'ceiling';
  stoppedAtPlanStep: number | null;
  divergence: DivergenceInfo | null;
  replayLog: ReplayLogEntry[];
  finalBoardSelf: FinalBoardEntry[];
  finalLifePoints: { self: number; opp: number };
  finalTurn: number;
  finalPhase: string;
  errorMessage?: string;
}

// =============================================================================
// Plan matching helpers
// =============================================================================

function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/[‘’‚‛'`]/g, "'")  // smart quotes → '
    .replace(/[“”„‟"]/g, '"')   // smart double quotes
    .replace(/\s+/g, ' ')
    .trim();
}

function actionMatchesPlanStep(action: Action, step: PlanStep, getName: (id: number) => string): boolean {
  const targetName = normalizeName(step.cardName);
  const actionName = normalizeName(action.cardName || getName(action.cardId));
  if (actionName !== targetName) {
    // Allow partial-match fallback (e.g. "Branded Fusion" matches "Branded Fusion (Quick-Play)")
    if (!actionName.includes(targetName) && !targetName.includes(actionName)) return false;
  }
  if (step.verb && step.verb.length > 0) {
    if (action.actionVerb !== step.verb) return false;
  }
  return true;
}

function summarizeAction(a: Action, getName: (id: number) => string): LegalActionSummary {
  return {
    responseIndex: a.responseIndex,
    cardId: a.cardId,
    cardName: a.cardName || getName(a.cardId),
    verb: a.actionVerb ?? null,
    sourceZone: a.sourceZone,
  };
}

// =============================================================================
// Main replay loop
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();
  const inputRaw: InputFile = JSON.parse(readFileSync(resolve(args.planFile), 'utf-8'));
  const rawMode = isRawTrajectory(inputRaw);
  const rawSteps: RawTrajectoryStep[] = rawMode ? getRawSteps(inputRaw) : [];
  const planSteps: PlanStep[] = rawMode ? [] : (inputRaw as PlanFile).plan;
  const endTurn = rawMode ? true : ((inputRaw as PlanFile).endTurn !== false);
  if (!rawMode && !Array.isArray(planSteps)) {
    console.error('[replay] plan-file must contain either a "plan" array (β-1 plan format) or a "steps"/"trajectory" array (β-3 raw format)');
    process.exit(2);
  }

  const fixture = loadFixtureFile();
  const hand: HandFixture | undefined = fixture.hands.find(h => h.id === args.fixtureId);
  if (!hand) {
    console.error(`[replay] fixture ${args.fixtureId} not found`);
    process.exit(2);
  }
  const deck = fixture.decks[hand.deck];
  if (!deck) {
    console.error(`[replay] deck ${hand.deck} not found`);
    process.exit(2);
  }

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  adapter.exposeMultiPickMechanical = true;

  const allCards = [...deck.main, ...deck.extra, ...hand.hand];
  const metadata = buildCardMetadataMap(cardDB, allCards);
  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    metadata,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );

  // Tier 3 corpus extraction — only when --dump-corpus is set.
  const featureCtx = args.dumpCorpus ? buildFeatureContext({
    metadata,
    interruptionTags: allConfigs.interruptionTags,
    interruptionWeights: allConfigs.interruptionWeights,
    mainDeck: deck.main,
    extraDeck: deck.extra,
  }) : null;
  if (args.dumpCorpus) {
    const abs = resolve(args.dumpCorpus);
    mkdirSync(dirname(abs), { recursive: true });
    // Truncate the file at the start of each run so re-runs don't bloat.
    writeFileSync(abs, '', 'utf-8');
  }

  const nameCache = new Map<number, string>();
  const getName = (code: number): string => {
    if (!code) return '(pass)';
    const cached = nameCache.get(code);
    if (cached !== undefined) return cached;
    const row = cardDB.nameStmt.get(code) as { name: string } | undefined;
    const name = row?.name ?? `#${code}`;
    nameCache.set(code, name);
    return name;
  };

  // Setup duel.
  const mainDeck = [...deck.main];
  for (const cid of hand.hand) {
    const idx = mainDeck.indexOf(cid);
    if (idx === -1) throw new Error(`[replay] hand card ${cid} not in main deck`);
    mainDeck.splice(idx, 1);
  }
  const duelConfig: DuelConfig = {
    mainDeck,
    extraDeck: deck.extra,
    hand: hand.hand,
    deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
    opponentDeck: [],
    startingDrawCount: 0,
    drawCountPerTurn: 1,
  };
  const handle = adapter.createDuel(duelConfig);

  const replayLog: ReplayLogEntry[] = [];
  let planIdx = 0;
  let rawIdx = 0;
  /** The plan-step index that most recently committed an IDLECMD action.
   *  Stamped on every corpus row so the enumeration tool can map a sub-prompt
   *  back to the IDLECMD plan step that triggered it. Set on IDLECMD pick;
   *  read by the corpus dump on every prompt. */
  let lastCommittedPlanStepIndex: number | null = null;
  /** Pending sub-prompt overrides for the active plan step, consumed in order
   *  at SELECT_CARD/SELECT_OPTION/SELECT_PLACE/SELECT_UNSELECT_CARD prompts. */
  let pendingTargets: TargetSpec[] = [];
  /** Pending chain-trigger overrides for the active plan step, consumed in
   *  order at SELECT_CHAIN prompts. */
  let pendingChainTargets: TargetSpec[] = [];
  let stoppedReason: ReplayResult['stoppedReason'] = 'completed';
  let divergence: DivergenceInfo | null = null;
  let stoppedAtPlanStep: number | null = null;
  let errorMessage: string | undefined;

  let stepCount = 0;
  let endPhaseAttempts = 0;
  let aggressiveActions = 0;
  const MAX_END_PHASE_ATTEMPTS = 50;
  const SUB_PROMPT_PICKABLE = new Set([
    'SELECT_CARD', 'SELECT_OPTION', 'SELECT_PLACE', 'SELECT_UNSELECT_CARD', 'SELECT_TRIBUTE', 'SELECT_SUM', 'SELECT_POSITION',
  ]);

  function tryConsumeTarget(legal: Action[], promptType: string): Action | null {
    if (pendingTargets.length === 0) return null;
    if (!SUB_PROMPT_PICKABLE.has(promptType)) return null;
    const t = pendingTargets[0];
    let match: Action | null = null;
    if (t.responseIndex !== undefined) {
      match = legal.find(a => a.responseIndex === t.responseIndex) ?? null;
    } else {
      const wanted = (t.cardNames ?? (t.cardName ? [t.cardName] : [])).map(normalizeName);
      if (wanted.length > 0) {
        match = legal.find(a => {
          const n = normalizeName(a.cardName || getName(a.cardId));
          return wanted.some(w => n === w || n.includes(w) || w.includes(n));
        }) ?? null;
      }
    }
    if (match) pendingTargets.shift();
    return match;
  }

  /** Consume the next pending chainTarget at a SELECT_CHAIN prompt. Matches
   *  by cardName (case-insensitive substring) or by responseIndex. Returns
   *  null if no chainTargets are queued or the next entry doesn't match
   *  any legal action — caller falls back to auto-pass. */
  function tryConsumeChainTarget(legal: Action[]): Action | null {
    if (pendingChainTargets.length === 0) return null;
    const t = pendingChainTargets[0];
    let match: Action | null = null;
    if (t.responseIndex !== undefined) {
      match = legal.find(a => a.responseIndex === t.responseIndex) ?? null;
    } else {
      const wanted = (t.cardNames ?? (t.cardName ? [t.cardName] : [])).map(normalizeName);
      if (wanted.length > 0) {
        match = legal.find(a => {
          const n = normalizeName(a.cardName || getName(a.cardId));
          return wanted.some(w => n === w || n.includes(w) || w.includes(n));
        }) ?? null;
      }
    }
    if (match) pendingChainTargets.shift();
    return match;
  }

  try {
    while (stepCount < args.maxIterations) {
      const legal = adapter.getLegalActions(handle);
      if (legal.length === 0) {
        // Engine has no actions — either turn ended or duel concluded.
        break;
      }
      const promptType = legal[0].promptType;

      let chosen: Action | null = null;
      let planStepIndex: number | null = null;
      let pickSource: 'plan' | 'raw' | 'target' | 'auto' | 'auto-end-phase' = 'auto';

      if (rawMode) {
        // ---- Raw trajectory mode (β-3) -------------------------------------
        if (rawIdx < rawSteps.length) {
          const step = rawSteps[rawIdx];
          chosen = legal.find(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId) ?? null;
          if (chosen) {
            planStepIndex = rawIdx;
            rawIdx++;
            pickSource = 'raw';
          } else if (promptType !== 'SELECT_IDLECMD') {
            // Sub-prompt mismatch — likely an extra prompt the recording
            // didn't capture (e.g. SELECT_PLACE that was auto-resolved by
            // an older harness). Auto-resolve and DON'T consume the raw
            // step. The trajectory may drift further but we surface
            // divergence only at strategic prompts.
            if (promptType === 'SELECT_CHAIN') {
              chosen = legal.find(a => a.responseIndex === -1) ?? legal[0];
            } else if (promptType === 'SELECT_EFFECTYN') {
              chosen = legal.find(a => a.responseIndex === 1) ?? legal[0];
            } else {
              chosen = legal[0];
            }
            pickSource = 'auto';
          } else {
            divergence = {
              step: stepCount,
              promptType,
              expected: `${step.cardName ?? getName(step.cardId) ?? '(pass)'} (responseIndex=${step.responseIndex} cardId=${step.cardId})`,
              legalActionsAtPrompt: legal.slice(0, 30).map(a => summarizeAction(a, getName)),
              reason: `Raw trajectory step ${rawIdx} of ${rawSteps.length}: no legal action at SELECT_IDLECMD matches responseIndex=${step.responseIndex} cardId=${step.cardId}. Trajectory has drifted from engine state at a strategic decision.`,
            };
            stoppedAtPlanStep = rawIdx;
            stoppedReason = 'divergence';
            break;
          }
        } else if (endTurn) {
          // Raw exhausted — auto-finish.
          if (promptType === 'SELECT_IDLECMD') {
            chosen = legal.find(a => a.actionVerb === 'end-phase')
              ?? legal[legal.length - 1];
            endPhaseAttempts++;
            if (endPhaseAttempts > MAX_END_PHASE_ATTEMPTS) {
              stoppedReason = 'ceiling';
              errorMessage = 'End-phase loop exceeded ceiling (raw mode)';
              break;
            }
          } else if (promptType === 'SELECT_CHAIN') {
            chosen = legal.find(a => a.responseIndex === -1) ?? legal[0];
          } else if (promptType === 'SELECT_EFFECTYN') {
            chosen = legal.find(a => a.responseIndex === 1) ?? legal[0];
          } else {
            chosen = legal[0];
          }
          pickSource = 'auto-end-phase';
        } else {
          break;
        }
      } else {
        // ---- Plan-based mode (β-1) -----------------------------------------
        if (promptType === 'SELECT_IDLECMD') {
          // SELECT_IDLECMD → consume next plan step.
          if (planIdx < planSteps.length) {
            const step = planSteps[planIdx];
            chosen = legal.find(a => actionMatchesPlanStep(a, step, getName)) ?? null;
            if (!chosen) {
              divergence = {
                step: stepCount,
                promptType,
                expected: `${step.cardName}${step.verb ? ' (' + step.verb + ')' : ''}`,
                legalActionsAtPrompt: legal.slice(0, 30).map(a => summarizeAction(a, getName)),
                reason: `No legal action matches "${step.cardName}"${step.verb ? ' verb=' + step.verb : ''} at this prompt. Plan step ${planIdx} of ${planSteps.length}.`,
              };
              stoppedAtPlanStep = planIdx;
              stoppedReason = 'divergence';
              break;
            }
            planStepIndex = planIdx;
            lastCommittedPlanStepIndex = planIdx;
            // Load the step's targets and chainTargets into pending queues.
            // Any leftovers from the previous step are dropped — they should
            // have been consumed before reaching the next IDLECMD.
            pendingTargets = (step.targets ?? []).slice();
            pendingChainTargets = (step.chainTargets ?? []).slice();
            planIdx++;
            pickSource = 'plan';
          } else if (endTurn) {
            // Plan exhausted at IDLECMD. Two continuation policies:
            //  - end-phase (default): pick end-phase immediately.
            //  - aggressive: prefer productive verbs to keep cascading until
            //    no productive action remains. Used by enumerate-pivot to
            //    measure each starter's cascade depth (differentiates
            //    candidates that auto-finish-end-phase would lump together).
            const PRODUCTIVE_VERBS = ['summon-procedure', 'activate', 'pendulum-summon', 'normal-summon', 'set-st', 'set-monster'];
            const productive = args.continueMode === 'aggressive' && aggressiveActions < args.maxAggressiveActions
              ? legal.find(a => PRODUCTIVE_VERBS.includes(a.actionVerb ?? ''))
              : undefined;
            if (productive) {
              chosen = productive;
              aggressiveActions++;
              pickSource = 'auto-end-phase';  // reuse tag; aggressiveActions disambiguates
            } else {
              chosen = legal.find(a => a.actionVerb === 'end-phase')
                ?? legal[legal.length - 1];
              endPhaseAttempts++;
              if (endPhaseAttempts > MAX_END_PHASE_ATTEMPTS) {
                stoppedReason = 'ceiling';
                errorMessage = 'End-phase loop exceeded ceiling';
                break;
              }
              pickSource = 'auto-end-phase';
            }
          } else {
            break;
          }
        } else {
          // Sub-prompt resolution order (plan mode):
          //   - SELECT_CHAIN: consume next chainTarget if any, else auto-pass
          //   - SELECT_CARD/OPTION/PLACE/etc.: consume next target if any, else legal[0]
          //   - SELECT_EFFECTYN: auto-YES (no override; trivial 2-option prompt)
          if (promptType === 'SELECT_CHAIN') {
            chosen = tryConsumeChainTarget(legal);
            if (chosen) {
              pickSource = 'target';
            } else {
              chosen = legal.find(a => a.responseIndex === -1) ?? legal[0];
              pickSource = 'auto';
            }
          } else if (promptType === 'SELECT_EFFECTYN') {
            chosen = legal.find(a => a.responseIndex === 1) ?? legal[0];
            pickSource = 'auto';
          } else {
            chosen = tryConsumeTarget(legal, promptType);
            if (chosen) {
              pickSource = 'target';
            } else {
              chosen = legal[0];
              pickSource = 'auto';
            }
          }
        }
      }

      if (!chosen) {
        stoppedReason = 'ceiling';
        errorMessage = `No action chosen at step ${stepCount} promptType=${promptType}`;
        break;
      }

      // Tier 3 corpus dump — emit one JSONL row per SELECT_CARD prompt with
      // the full feature space (state[58] + per-candidate action[58]) and
      // the picked candidate's index. Only SELECT_CARD prompts are captured
      // because that is the layer where `preferredSearchTargets` (the leak)
      // currently steers DFS — Tier 3 will replace that heuristic with a
      // learned scorer of (state, candidate) pairs.
      if (featureCtx && promptType === 'SELECT_CARD' && legal.length >= 2) {
        try {
          const fs = adapter.getFieldState(handle);
          const stateVec = extractStateFeatures(fs, featureCtx);
          const candidates = legal.map(a => ({
            cardId: a.cardId,
            cardName: getName(a.cardId),
            responseIndex: a.responseIndex,
            actionFeatures: extractActionFeatures(a, fs, featureCtx),
          }));
          const pickedIndex = legal.findIndex(a => a.responseIndex === chosen!.responseIndex && a.cardId === chosen!.cardId);
          const row = {
            fixtureId: args.fixtureId,
            stepIndex: stepCount,
            planStepIndex,
            /** Index of the most recently committed IDLECMD plan step at the
             *  moment this sub-prompt fired. Lets the enumeration tool map
             *  any SELECT_CARD row back to its parent plan step. */
            ownerPlanStepIndex: lastCommittedPlanStepIndex,
            pickSource,
            promptType,
            promptHint: chosen!.description,
            stateDim: STATE_DIM,
            actionDim: ACTION_DIM,
            featureSpecHash: computeFeatureSpecHash(),
            stateFeatures: stateVec,
            candidates,
            pickedIndex,
            pickedCardId: chosen!.cardId,
            pickedResponseIndex: chosen!.responseIndex,
          };
          appendFileSync(resolve(args.dumpCorpus!), JSON.stringify(row) + '\n', 'utf-8');
        } catch (e) {
          // Don't let corpus extraction break the replay; record but continue.
          console.error(`[corpus-dump] step ${stepCount} failed:`, (e as Error).message);
        }
      }

      const cardName = chosen.cardName || getName(chosen.cardId);
      const verbTag = chosen.actionVerb ? ` (${chosen.actionVerb})` : '';
      replayLog.push({
        step: stepCount,
        promptType,
        applied: `${cardName}${verbTag} [${pickSource}]`,
        appliedCardId: chosen.cardId,
        appliedResponseIndex: chosen.responseIndex,
        planStepIndex,
      });

      adapter.applyAction(handle, chosen);
      stepCount++;

      const exhausted = rawMode ? rawIdx >= rawSteps.length : planIdx >= planSteps.length;
      if (exhausted && endTurn) {
        const fs = adapter.getFieldState(handle);
        if (fs.turn > 1) break;
      }
    }
    if (stepCount >= args.maxIterations) {
      stoppedReason = 'ceiling';
      errorMessage = `Hit max-iterations=${args.maxIterations}`;
    }
  } catch (e) {
    stoppedReason = 'exception';
    errorMessage = String((e as Error).message ?? e);
    stoppedAtPlanStep = rawMode ? rawIdx : planIdx;
  }

  // Final scoring.
  let finalState: FieldState;
  try {
    finalState = adapter.getFieldState(handle);
  } catch (e) {
    // If state not retrievable, build a synthetic empty.
    finalState = {
      turn: 0,
      phase: 'M1',
      activePlayer: 0,
      lifePoints: [8000, 8000],
      zones: { M1: [], M2: [], M3: [], M4: [], M5: [], EMZ_L: [], EMZ_R: [], S1: [], S2: [], S3: [], S4: [], S5: [], FIELD: [], HAND: [], GY: [], BANISHED: [], DECK: [], EXTRA: [] },
    } as unknown as FieldState;
  }

  // Match expectedBoard cardIds against player[0]'s field zones.
  const SCORED_ZONES: ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R', 'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD'];
  const onFieldCardIds = new Set<number>();
  const finalBoardSelf: FinalBoardEntry[] = [];
  for (const z of SCORED_ZONES) {
    for (const c of finalState.zones[z] ?? []) {
      onFieldCardIds.add(c.cardId);
      finalBoardSelf.push({
        zone: z,
        cardName: c.cardName || getName(c.cardId),
        cardId: c.cardId,
        position: c.position,
        overlayMaterials: c.overlayMaterials?.map(o => o.cardId),
      });
    }
  }

  const expectedCardIds = (hand.expectedBoard ?? []).map(e => e.cardId);
  const matchedCardIds = expectedCardIds.filter(id => onFieldCardIds.has(id));
  const missingCardIds = expectedCardIds.filter(id => !onFieldCardIds.has(id));

  const { score, scoreBreakdown } = scorer.score(finalState);

  const result: ReplayResult = {
    fixtureId: args.fixtureId,
    expectedBoardSize: expectedCardIds.length,
    matched: matchedCardIds.length,
    matchedCardIds,
    missingCardIds,
    score,
    scoreBreakdown,
    stoppedReason,
    stoppedAtPlanStep,
    divergence,
    replayLog,
    finalBoardSelf,
    finalLifePoints: { self: finalState.lifePoints[0], opp: finalState.lifePoints[1] },
    finalTurn: finalState.turn,
    finalPhase: finalState.phase,
    errorMessage,
  };

  adapter.destroyAll();

  const out = JSON.stringify(result, null, 2) + '\n';
  if (args.outFile) {
    const abs = resolve(args.outFile);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, out, 'utf-8');
    console.log(`[replay] wrote ${abs}`);
    console.log(`  matched: ${result.matched}/${result.expectedBoardSize}, score: ${result.score}, stopped: ${result.stoppedReason}`);
  } else {
    process.stdout.write(out);
  }
}

main().catch(err => {
  console.error('[replay] fatal:', err);
  process.exit(1);
});
