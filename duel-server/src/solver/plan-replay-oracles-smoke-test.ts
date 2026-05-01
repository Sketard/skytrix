// =============================================================================
// plan-replay-oracles-smoke-test.ts — Phase 4 unit coverage for the 4 plan/raw
// oracles. Uses fake Action[] / PlanStep[] / RawTrajectoryStep[] inputs so we
// don't pay OCGCore boot cost. The bit-exact baseline gate vs phase-1-baselines/
// covers integration; here we just verify the dispatch logic.
//
// Run: npx tsx src/solver/plan-replay-oracles-smoke-test.ts
// =============================================================================

import type { Action, PromptType } from './solver-types.js';
import type { DecisionContext } from './prompt-resolver.js';
import type { PlanStep, RawTrajectoryStep, TargetSpec } from './plan-replay-types.js';
import {
  PlanStepOracle,
  PlanTargetOracle,
  RawTrajectoryOracle,
  EndPhasePolicyOracle,
  normalizeName,
  actionMatchesPlanStep,
} from './plan-replay-oracles.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

const fakeGetName = (id: number) => `Card#${id}`;

function makeAction(opts: {
  cardId: number;
  cardName?: string;
  responseIndex?: number;
  promptType?: PromptType;
  actionVerb?: string;
  response?: unknown;
}): Action {
  const a: Action = {
    cardId: opts.cardId,
    promptType: opts.promptType ?? 'SELECT_IDLECMD',
    responseIndex: opts.responseIndex ?? 0,
    isExploratory: true,
  };
  if (opts.cardName) (a as Action & { cardName: string }).cardName = opts.cardName;
  if (opts.actionVerb) (a as Action & { actionVerb: string }).actionVerb = opts.actionVerb;
  // _response cache must be set — oracles assert on it.
  (a as Action & { _response: unknown })._response = opts.response ?? { type: 1, action: opts.responseIndex ?? 0 };
  return a;
}

function baseCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    promptType: 'SELECT_IDLECMD',
    msg: {},
    caller: 'plan-β1',
    player: 0,
    legal: [],
    getName: fakeGetName,
    pendingTargets: [],
    pendingChainTargets: [],
    endTurn: true,
    continueMode: 'end-phase',
    maxAggressiveActions: 40,
    endPhaseAttempts: { value: 0 },
    aggressiveActions: { value: 0 },
    stepCount: 0,
    lastPickSource: { value: 'auto' },
    lastCommittedPlanStepIndex: { value: null },
    lastConsumedStepIndex: { value: null },
    ...overrides,
  };
}

// =============================================================================
// normalizeName / actionMatchesPlanStep utility coverage
// =============================================================================

console.log('\n📋 normalizeName + actionMatchesPlanStep\n');

assert(normalizeName('  HELLO  ') === 'hello', 'normalizeName lowercase + trim');
assert(normalizeName("It's") === "it's", 'normalizeName smart quote');
assert(normalizeName('a   b') === 'a b', 'normalizeName collapse whitespace');

{
  const action = makeAction({ cardId: 100, cardName: 'Branded Fusion' });
  const step: PlanStep = { cardName: 'Branded Fusion' };
  assert(actionMatchesPlanStep(action, step, fakeGetName), 'exact name match');
}

{
  const action = makeAction({ cardId: 100, cardName: 'Branded Fusion (Quick-Play)' });
  const step: PlanStep = { cardName: 'Branded Fusion' };
  assert(
    actionMatchesPlanStep(action, step, fakeGetName),
    'bidirectional substring match (action contains step)',
  );
}

{
  const action = makeAction({ cardId: 100, cardName: 'Branded' });
  const step: PlanStep = { cardName: 'Branded Fusion' };
  assert(
    actionMatchesPlanStep(action, step, fakeGetName),
    'bidirectional substring match (step contains action)',
  );
}

{
  const action = makeAction({ cardId: 100, cardName: 'Branded Fusion', actionVerb: 'activate' });
  const step: PlanStep = { cardName: 'Branded Fusion', verb: 'activate' };
  assert(actionMatchesPlanStep(action, step, fakeGetName), 'verb match');
}

{
  const action = makeAction({ cardId: 100, cardName: 'Branded Fusion', actionVerb: 'set-st' });
  const step: PlanStep = { cardName: 'Branded Fusion', verb: 'activate' };
  assert(!actionMatchesPlanStep(action, step, fakeGetName), 'verb mismatch → no match');
}

// =============================================================================
// PlanStepOracle
// =============================================================================

console.log('\n📋 PlanStepOracle\n');

{
  // β-3 caller → pass
  const oracle = new PlanStepOracle();
  const r = oracle.decide(baseCtx({ caller: 'plan-β3' }));
  assert(r.kind === 'pass', 'β-3 caller → pass');
}

{
  // Non-IDLECMD prompt → pass
  const oracle = new PlanStepOracle();
  const r = oracle.decide(baseCtx({ promptType: 'SELECT_CARD' }));
  assert(r.kind === 'pass', 'non-IDLECMD → pass');
}

{
  // Plan exhausted → pass
  const oracle = new PlanStepOracle();
  const r = oracle.decide(baseCtx({
    planSteps: [{ cardName: 'X' }],
    planIdx: { value: 1 },  // already past end
    legal: [makeAction({ cardId: 100, cardName: 'Y' })],
  }));
  assert(r.kind === 'pass', 'plan exhausted → pass (EndPhasePolicy takes over)');
}

{
  // Match: load targets/chainTargets, advance planIdx, pickSource=plan
  const oracle = new PlanStepOracle();
  const planIdx = { value: 0 };
  const lastCommitted = { value: null as number | null };
  const lastConsumed = { value: null as number | null };
  const lastPickSource = { value: 'auto' as 'auto' | 'plan' | 'raw' | 'target' | 'auto-end-phase' };
  const pendingTargets: TargetSpec[] = [];
  const pendingChainTargets: TargetSpec[] = [];
  const planSteps: PlanStep[] = [
    {
      cardName: 'Branded Fusion',
      targets: [{ cardName: 'Mirrorjade' }],
      chainTargets: [{ cardName: 'Albaz' }],
    },
  ];
  const legal = [makeAction({ cardId: 100, cardName: 'Branded Fusion', responseIndex: 5, response: { type: 1, action: 5 } })];
  const r = oracle.decide(baseCtx({
    planSteps,
    planIdx,
    legal,
    pendingTargets,
    pendingChainTargets,
    lastCommittedPlanStepIndex: lastCommitted,
    lastConsumedStepIndex: lastConsumed,
    lastPickSource,
  }));
  const ok = r.kind === 'response'
    && JSON.stringify(r.response) === JSON.stringify({ type: 1, action: 5 })
    && r.chosenAction?.cardId === 100
    && planIdx.value === 1
    && lastCommitted.value === 0
    && lastConsumed.value === 0
    && lastPickSource.value === 'plan'
    && pendingTargets.length === 1 && pendingTargets[0].cardName === 'Mirrorjade'
    && pendingChainTargets.length === 1 && pendingChainTargets[0].cardName === 'Albaz';
  assert(ok, 'plan match → response + advance + load targets/chainTargets', JSON.stringify({
    kind: r.kind, planIdx: planIdx.value, pendingTargets, pendingChainTargets,
  }));
}

{
  // No match → divergence
  const oracle = new PlanStepOracle();
  const r = oracle.decide(baseCtx({
    planSteps: [{ cardName: 'Branded Fusion' }],
    planIdx: { value: 0 },
    legal: [makeAction({ cardId: 100, cardName: 'Snake-Eye Ash' })],
    stepCount: 7,
  }));
  const ok = r.kind === 'divergence' && r.info.step === 7 && r.info.expected === 'Branded Fusion';
  assert(ok, 'plan no-match → divergence with step + expected', JSON.stringify(r));
}

// =============================================================================
// PlanTargetOracle
// =============================================================================

console.log('\n📋 PlanTargetOracle\n');

{
  // SELECT_IDLECMD → pass (handled by PlanStepOracle)
  const oracle = new PlanTargetOracle();
  const r = oracle.decide(baseCtx({ promptType: 'SELECT_IDLECMD' }));
  assert(r.kind === 'pass', 'SELECT_IDLECMD → pass');
}

{
  // SELECT_CHAIN with chainTarget → consume + response
  const oracle = new PlanTargetOracle();
  const pendingChainTargets: TargetSpec[] = [{ cardName: 'Albaz' }];
  const lastPickSource = { value: 'auto' as 'auto' | 'plan' | 'raw' | 'target' | 'auto-end-phase' };
  const r = oracle.decide(baseCtx({
    promptType: 'SELECT_CHAIN',
    legal: [makeAction({ cardId: 999, cardName: 'Albaz', responseIndex: 0, response: { type: 8, index: 0 } })],
    pendingChainTargets,
    lastPickSource,
  }));
  const ok = r.kind === 'response'
    && pendingChainTargets.length === 0
    && lastPickSource.value === 'target'
    && r.chosenAction?.cardId === 999;
  assert(ok, 'SELECT_CHAIN + chainTarget match → consume + response', JSON.stringify(r));
}

{
  // SELECT_CHAIN no chainTarget → auto-pass (responseIndex -1)
  const oracle = new PlanTargetOracle();
  const lastPickSource = { value: 'auto' as 'auto' | 'plan' | 'raw' | 'target' | 'auto-end-phase' };
  const r = oracle.decide(baseCtx({
    promptType: 'SELECT_CHAIN',
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 0, responseIndex: -1, response: { type: 8, index: null } }),
    ],
    lastPickSource,
  }));
  const ok = r.kind === 'response' && lastPickSource.value === 'auto' && r.chosenAction?.responseIndex === -1;
  assert(ok, 'SELECT_CHAIN no chainTarget → auto-pass (responseIndex=-1)', JSON.stringify(r));
}

{
  // SELECT_EFFECTYN no target → auto-YES (responseIndex 1)
  const oracle = new PlanTargetOracle();
  const r = oracle.decide(baseCtx({
    promptType: 'SELECT_EFFECTYN',
    legal: [
      makeAction({ cardId: 100, responseIndex: 0, response: { type: 2, yes: false } }),
      makeAction({ cardId: 100, responseIndex: 1, response: { type: 2, yes: true } }),
    ],
  }));
  const ok = r.kind === 'response' && r.chosenAction?.responseIndex === 1;
  assert(ok, 'SELECT_EFFECTYN no target → auto-YES', JSON.stringify(r));
}

{
  // SELECT_YESNO no target → legal[0] (default-NO)
  const oracle = new PlanTargetOracle();
  const r = oracle.decide(baseCtx({
    promptType: 'SELECT_YESNO',
    legal: [
      makeAction({ cardId: 100, responseIndex: 0, response: { type: 3, yes: false } }),
      makeAction({ cardId: 100, responseIndex: 1, response: { type: 3, yes: true } }),
    ],
  }));
  const ok = r.kind === 'response' && r.chosenAction?.responseIndex === 0;
  assert(ok, 'SELECT_YESNO no target → legal[0] (default-NO)', JSON.stringify(r));
}

{
  // SELECT_CARD with responseIndex target
  const oracle = new PlanTargetOracle();
  const pendingTargets: TargetSpec[] = [{ responseIndex: 2 }];
  const r = oracle.decide(baseCtx({
    promptType: 'SELECT_CARD',
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
      makeAction({ cardId: 300, responseIndex: 2 }),
    ],
    pendingTargets,
  }));
  const ok = r.kind === 'response' && r.chosenAction?.cardId === 300 && pendingTargets.length === 0;
  assert(ok, 'SELECT_CARD responseIndex match → consume + response', JSON.stringify(r));
}

// =============================================================================
// RawTrajectoryOracle
// =============================================================================

console.log('\n📋 RawTrajectoryOracle\n');

{
  // β-1 caller → pass
  const oracle = new RawTrajectoryOracle();
  const r = oracle.decide(baseCtx({ caller: 'plan-β1' }));
  assert(r.kind === 'pass', 'β-1 caller → pass');
}

{
  // Raw exhausted → pass
  const oracle = new RawTrajectoryOracle();
  const r = oracle.decide(baseCtx({
    caller: 'plan-β3',
    rawSteps: [{ responseIndex: 0, cardId: 100 }],
    rawIdx: { value: 1 },
    legal: [makeAction({ cardId: 100, responseIndex: 0 })],
  }));
  assert(r.kind === 'pass', 'raw exhausted → pass');
}

{
  // Raw exact match → consume + response
  const oracle = new RawTrajectoryOracle();
  const rawIdx = { value: 0 };
  const r = oracle.decide(baseCtx({
    caller: 'plan-β3',
    rawSteps: [{ responseIndex: 1, cardId: 200 }],
    rawIdx,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1, response: { type: 1, action: 1 } }),
    ],
  }));
  const ok = r.kind === 'response' && rawIdx.value === 1 && r.chosenAction?.cardId === 200;
  assert(ok, 'raw exact match → consume + response', JSON.stringify(r));
}

{
  // Raw mismatch at SELECT_IDLECMD → divergence
  const oracle = new RawTrajectoryOracle();
  const r = oracle.decide(baseCtx({
    caller: 'plan-β3',
    promptType: 'SELECT_IDLECMD',
    rawSteps: [{ responseIndex: 1, cardId: 999 }],
    rawIdx: { value: 0 },
    legal: [makeAction({ cardId: 100, responseIndex: 0 })],
    stepCount: 12,
  }));
  const ok = r.kind === 'divergence' && r.info.step === 12;
  assert(ok, 'raw IDLECMD mismatch → divergence', JSON.stringify(r));
}

{
  // Raw mismatch at SELECT_CHAIN → auto-resolve, do NOT consume
  const oracle = new RawTrajectoryOracle();
  const rawIdx = { value: 0 };
  const r = oracle.decide(baseCtx({
    caller: 'plan-β3',
    promptType: 'SELECT_CHAIN',
    rawSteps: [{ responseIndex: 1, cardId: 999 }],
    rawIdx,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 0, responseIndex: -1, response: { type: 8, index: null } }),
    ],
  }));
  const ok = r.kind === 'response' && rawIdx.value === 0 && r.chosenAction?.responseIndex === -1;
  assert(ok, 'raw SELECT_CHAIN mismatch → auto-pass + DO NOT consume', JSON.stringify(r));
}

// =============================================================================
// EndPhasePolicyOracle
// =============================================================================

console.log('\n📋 EndPhasePolicyOracle\n');

{
  // DFS caller → pass
  const oracle = new EndPhasePolicyOracle();
  const r = oracle.decide(baseCtx({ caller: 'dfs' }));
  assert(r.kind === 'pass', 'DFS caller → pass');
}

{
  // endTurn=false → pass
  const oracle = new EndPhasePolicyOracle();
  const r = oracle.decide(baseCtx({ endTurn: false }));
  assert(r.kind === 'pass', 'endTurn=false → pass');
}

{
  // Plan not exhausted → pass
  const oracle = new EndPhasePolicyOracle();
  const r = oracle.decide(baseCtx({
    planSteps: [{ cardName: 'X' }],
    planIdx: { value: 0 },  // not exhausted
    legal: [makeAction({ cardId: 100 })],
  }));
  assert(r.kind === 'pass', 'plan not exhausted → pass');
}

{
  // Plan exhausted + IDLECMD + end-phase mode → pick end-phase
  const oracle = new EndPhasePolicyOracle();
  const endPhaseAttempts = { value: 0 };
  const r = oracle.decide(baseCtx({
    planSteps: [],
    planIdx: { value: 0 },
    promptType: 'SELECT_IDLECMD',
    legal: [
      makeAction({ cardId: 100, actionVerb: 'activate' }),
      makeAction({ cardId: 200, actionVerb: 'end-phase', responseIndex: 7, response: { type: 1, action: 7 } }),
    ],
    endPhaseAttempts,
  }));
  const ok = r.kind === 'response' && r.chosenAction?.cardId === 200 && endPhaseAttempts.value === 1;
  assert(ok, 'plan exhausted + IDLECMD → pick end-phase + increment counter', JSON.stringify(r));
}

{
  // Plan exhausted + IDLECMD + aggressive mode + productive available → pick productive
  const oracle = new EndPhasePolicyOracle();
  const aggressiveActions = { value: 0 };
  const r = oracle.decide(baseCtx({
    planSteps: [],
    planIdx: { value: 0 },
    promptType: 'SELECT_IDLECMD',
    continueMode: 'aggressive',
    maxAggressiveActions: 40,
    aggressiveActions,
    legal: [
      makeAction({ cardId: 100, actionVerb: 'activate', response: { type: 1, action: 0 } }),
      makeAction({ cardId: 200, actionVerb: 'end-phase' }),
    ],
  }));
  const ok = r.kind === 'response' && r.chosenAction?.cardId === 100 && aggressiveActions.value === 1;
  assert(ok, 'aggressive cascade → pick productive verb', JSON.stringify(r));
}

{
  // Aggressive cascade exhausted (count >= cap) → fall to end-phase
  const oracle = new EndPhasePolicyOracle();
  const r = oracle.decide(baseCtx({
    planSteps: [],
    planIdx: { value: 0 },
    promptType: 'SELECT_IDLECMD',
    continueMode: 'aggressive',
    maxAggressiveActions: 40,
    aggressiveActions: { value: 40 },  // at cap
    legal: [
      makeAction({ cardId: 100, actionVerb: 'activate' }),
      makeAction({ cardId: 200, actionVerb: 'end-phase', response: { type: 1, action: 7 } }),
    ],
  }));
  const ok = r.kind === 'response' && r.chosenAction?.cardId === 200;
  assert(ok, 'aggressive cap reached → fall to end-phase', JSON.stringify(r));
}

{
  // β-3 + aggressive (should NOT activate aggressive — β-1 only)
  const oracle = new EndPhasePolicyOracle();
  const aggressiveActions = { value: 0 };
  const r = oracle.decide(baseCtx({
    caller: 'plan-β3',
    rawSteps: [],
    rawIdx: { value: 0 },
    promptType: 'SELECT_IDLECMD',
    continueMode: 'aggressive',
    aggressiveActions,
    legal: [
      makeAction({ cardId: 100, actionVerb: 'activate' }),
      makeAction({ cardId: 200, actionVerb: 'end-phase', response: { type: 1, action: 7 } }),
    ],
  }));
  const ok = r.kind === 'response' && r.chosenAction?.cardId === 200 && aggressiveActions.value === 0;
  assert(ok, 'β-3 ignores aggressive → end-phase', JSON.stringify(r));
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`❌ ${failed} test(s) failed`);
  process.exit(1);
}
console.log('✅ All plan-replay oracles smoke tests passed');
