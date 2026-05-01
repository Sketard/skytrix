// =============================================================================
// card-expertise-oracle-smoke-test.ts — Phase 5 unit coverage for
// CardExpertiseOracle. Bit-exact baseline gate covers integration; here we
// verify dispatch logic + pass-through + policy mappings.
//
// Run: npx tsx src/solver/card-expertise-oracle-smoke-test.ts
// =============================================================================

import { OcgPosition } from '@n1xx1/ocgcore-wasm';
import type { Action } from './solver-types.js';
import type { ArchetypeExpertise, ExpertiseHint } from './strategic-grammar.js';
import type { DecisionContext } from './prompt-resolver.js';
import { CardExpertiseOracle } from './card-expertise-oracle.js';

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
  responseIndex?: number;
  response?: unknown;
  cardName?: string;
}): Action {
  const a: Action = {
    cardId: opts.cardId,
    promptType: 'SELECT_OPTION',
    responseIndex: opts.responseIndex ?? 0,
    isExploratory: false,
  };
  (a as Action & { _response: unknown })._response = opts.response ?? { type: 4, index: opts.responseIndex ?? 0 };
  if (opts.cardName) (a as Action & { cardName: string }).cardName = opts.cardName;
  return a;
}

function makeExpertise(hints: Record<string, Record<string, ExpertiseHint>>): ArchetypeExpertise {
  return {
    archetype: 'test' as ArchetypeExpertise['archetype'],
    displayName: 'test',
    version: 1,
    roleMap: {},
    goals: [],
    routes: [],
    keyCards: [],
    decisionHints: hints,
  };
}

function ctx(overrides: Partial<DecisionContext>): DecisionContext {
  return {
    promptType: 'SELECT_OPTION',
    msg: {},
    caller: 'plan-β1',
    player: 0,
    legal: [],
    getName: fakeGetName,
    pendingTargets: [],
    pendingChainTargets: [],
    expertise: undefined,
    sourceCardId: undefined,
    ...overrides,
  };
}

const oracle = new CardExpertiseOracle();

// =============================================================================
// Pass-through tests
// =============================================================================

console.log('\n📋 CardExpertiseOracle — pass-through cases\n');

// No expertise → pass
{
  const r = oracle.decide(ctx({ expertise: undefined, sourceCardId: 100 }));
  assert(r.kind === 'pass', 'no expertise → pass');
}

// Empty expertise array → pass
{
  const r = oracle.decide(ctx({ expertise: [], sourceCardId: 100 }));
  assert(r.kind === 'pass', 'empty expertise → pass');
}

// No sourceCardId → pass
{
  const r = oracle.decide(ctx({
    expertise: [makeExpertise({ '100': { SELECT_OPTION: { policy: 'first' } } })],
    sourceCardId: undefined,
  }));
  assert(r.kind === 'pass', 'no sourceCardId → pass');
}

// sourceCardId=0 → pass
{
  const r = oracle.decide(ctx({
    expertise: [makeExpertise({ '0': { SELECT_OPTION: { policy: 'first' } } })],
    sourceCardId: 0,
  }));
  assert(r.kind === 'pass', 'sourceCardId=0 → pass');
}

// No matching hint for the cardId → pass
{
  const r = oracle.decide(ctx({
    expertise: [makeExpertise({ '999': { SELECT_OPTION: { policy: 'first' } } })],
    sourceCardId: 100,
  }));
  assert(r.kind === 'pass', 'sourceCardId not in hints → pass');
}

// Hint exists but for a different promptType → pass
{
  const r = oracle.decide(ctx({
    expertise: [makeExpertise({ '100': { SELECT_YESNO: { policy: 'yes' } } })],
    sourceCardId: 100,
    promptType: 'SELECT_OPTION',
  }));
  assert(r.kind === 'pass', 'wrong promptType → pass');
}

// DFS exploratory prompt → pass (must yield branches, not response)
{
  const r = oracle.decide(ctx({
    caller: 'dfs',
    promptType: 'SELECT_IDLECMD',
    expertise: [makeExpertise({ '100': { SELECT_IDLECMD: { policy: 'first' } } })],
    sourceCardId: 100,
  }));
  assert(r.kind === 'pass', 'DFS exploratory prompt → pass (preserve branching)');
}

// β-1 SELECT_IDLECMD → pass (PlanStepOracle should win)
{
  const r = oracle.decide(ctx({
    caller: 'plan-β1',
    promptType: 'SELECT_IDLECMD',
    expertise: [makeExpertise({ '100': { SELECT_IDLECMD: { policy: 'first' } } })],
    sourceCardId: 100,
  }));
  assert(r.kind === 'pass', 'β-1 IDLECMD → pass (PlanStep wins)');
}

// β-3 SELECT_IDLECMD → pass (RawTrajectoryOracle should win)
{
  const r = oracle.decide(ctx({
    caller: 'plan-β3',
    promptType: 'SELECT_IDLECMD',
    expertise: [makeExpertise({ '100': { SELECT_IDLECMD: { policy: 'first' } } })],
    sourceCardId: 100,
  }));
  assert(r.kind === 'pass', 'β-3 IDLECMD → pass (RawTrajectory wins)');
}

// Plan target would match → pass (PlanTargetOracle should win)
{
  const r = oracle.decide(ctx({
    caller: 'plan-β1',
    promptType: 'SELECT_OPTION',
    expertise: [makeExpertise({ '100': { SELECT_OPTION: { policy: 'first' } } })],
    sourceCardId: 100,
    pendingTargets: [{ responseIndex: 1 }],
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
    ],
  }));
  assert(r.kind === 'pass', 'plan target would match → pass (PlanTarget wins)');
}

// Plan target queued but doesn't match anything → fall through to oracle
{
  const r = oracle.decide(ctx({
    caller: 'plan-β1',
    promptType: 'SELECT_OPTION',
    expertise: [makeExpertise({ '100': { SELECT_OPTION: { policy: 'last' } } })],
    sourceCardId: 100,
    pendingTargets: [{ responseIndex: 999 }],  // not in legal
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
    ],
  }));
  assert(
    r.kind === 'response' && r.chosenAction?.responseIndex === 1,
    'plan target wouldn\'t match → oracle takes over (last)',
    JSON.stringify(r),
  );
}

// =============================================================================
// Policy dispatch
// =============================================================================

console.log('\n📋 CardExpertiseOracle — policy dispatch\n');

// policy: 'last' → legal[N-1]
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_OPTION',
    expertise: [makeExpertise({ '100': { SELECT_OPTION: { policy: 'last' } } })],
    sourceCardId: 100,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
      makeAction({ cardId: 300, responseIndex: 2 }),
    ],
  }));
  assert(
    r.kind === 'response' && r.chosenAction?.cardId === 300,
    'policy=last → legal[N-1]',
    JSON.stringify(r),
  );
}

// policy: 'first' → legal[0]
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_OPTION',
    expertise: [makeExpertise({ '100': { SELECT_OPTION: { policy: 'first' } } })],
    sourceCardId: 100,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
    ],
  }));
  assert(
    r.kind === 'response' && r.chosenAction?.cardId === 100,
    'policy=first → legal[0]',
    JSON.stringify(r),
  );
}

// policy: 'yes' → responseIndex 1
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_YESNO',
    expertise: [makeExpertise({ '100': { SELECT_YESNO: { policy: 'yes' } } })],
    sourceCardId: 100,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0, response: { type: 3, yes: false } }),
      makeAction({ cardId: 100, responseIndex: 1, response: { type: 3, yes: true } }),
    ],
  }));
  assert(
    r.kind === 'response' && r.chosenAction?.responseIndex === 1,
    'policy=yes → responseIndex 1',
    JSON.stringify(r),
  );
}

// policy: 'no' → responseIndex 0
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_YESNO',
    expertise: [makeExpertise({ '100': { SELECT_YESNO: { policy: 'no' } } })],
    sourceCardId: 100,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0, response: { type: 3, yes: false } }),
      makeAction({ cardId: 100, responseIndex: 1, response: { type: 3, yes: true } }),
    ],
  }));
  assert(
    r.kind === 'response' && r.chosenAction?.responseIndex === 0,
    'policy=no → responseIndex 0',
    JSON.stringify(r),
  );
}

// policy: 'preferred' → first matching cardId
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_CARD',
    expertise: [makeExpertise({ '100': { SELECT_CARD: { policy: 'preferred', preferredCardIds: [300, 200] } } })],
    sourceCardId: 100,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
      makeAction({ cardId: 300, responseIndex: 2 }),
    ],
  }));
  assert(
    r.kind === 'response' && r.chosenAction?.cardId === 300,
    'policy=preferred [300,200] → cardId 300',
    JSON.stringify(r),
  );
}

// policy: 'preferred' fallback when none match → pass
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_CARD',
    expertise: [makeExpertise({ '100': { SELECT_CARD: { policy: 'preferred', preferredCardIds: [999] } } })],
    sourceCardId: 100,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
    ],
  }));
  assert(r.kind === 'pass', 'policy=preferred no match → pass (mechanical decides)');
}

// policy: 'face-down' → OcgPosition.FACEDOWN_DEFENSE
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_POSITION',
    expertise: [makeExpertise({ '100': { SELECT_POSITION: { policy: 'face-down' } } })],
    sourceCardId: 100,
  }));
  const ok = r.kind === 'response'
    && JSON.stringify(r.response) === JSON.stringify({ type: 11, position: OcgPosition.FACEDOWN_DEFENSE });
  assert(ok, 'policy=face-down → FACEDOWN_DEFENSE', JSON.stringify(r));
}

// policy: 'face-up-defense' → OcgPosition.FACEUP_DEFENSE
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_POSITION',
    expertise: [makeExpertise({ '100': { SELECT_POSITION: { policy: 'face-up-defense' } } })],
    sourceCardId: 100,
  }));
  const ok = r.kind === 'response'
    && JSON.stringify(r.response) === JSON.stringify({ type: 11, position: OcgPosition.FACEUP_DEFENSE });
  assert(ok, 'policy=face-up-defense → FACEUP_DEFENSE', JSON.stringify(r));
}

// policy: 'all' → pass (mechanical handles places)
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_PLACE',
    expertise: [makeExpertise({ '100': { SELECT_PLACE: { policy: 'all' } } })],
    sourceCardId: 100,
  }));
  assert(r.kind === 'pass', 'policy=all → pass');
}

// Unknown policy → pass + warn
{
  const r = oracle.decide(ctx({
    promptType: 'SELECT_OPTION',
    expertise: [makeExpertise({ '100': { SELECT_OPTION: { policy: 'mystery' as ExpertiseHint['policy'] } } })],
    sourceCardId: 100,
    legal: [makeAction({ cardId: 100 })],
  }));
  assert(r.kind === 'pass', 'unknown policy → pass + warn');
}

// =============================================================================
// Multi-file expertise priority
// =============================================================================

console.log('\n📋 CardExpertiseOracle — multi-file expertise\n');

// First expertise file with the hint wins
{
  const e1 = makeExpertise({ '100': { SELECT_OPTION: { policy: 'first' } } });
  const e2 = makeExpertise({ '100': { SELECT_OPTION: { policy: 'last' } } });
  const r = oracle.decide(ctx({
    expertise: [e1, e2],
    sourceCardId: 100,
    legal: [
      makeAction({ cardId: 100, responseIndex: 0 }),
      makeAction({ cardId: 200, responseIndex: 1 }),
    ],
  }));
  assert(
    r.kind === 'response' && r.chosenAction?.responseIndex === 0,
    'multi-file: first matching expertise wins',
    JSON.stringify(r),
  );
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`❌ ${failed} test(s) failed`);
  process.exit(1);
}
console.log('✅ All CardExpertiseOracle smoke tests passed');
