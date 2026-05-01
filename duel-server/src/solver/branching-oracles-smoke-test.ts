// =============================================================================
// branching-oracles-smoke-test.ts — Phase 3 unit coverage for
// OpponentBranchingOracle + BranchingOracle.
//
// Uses a stub BranchingDelegate to isolate the dispatch logic from the real
// adapter — the bit-exact baseline gate covers integration. Here we just
// verify the oracle's pass/branches logic is wired correctly.
//
// Run: npx tsx src/solver/branching-oracles-smoke-test.ts
// =============================================================================

import { OcgMessageType } from '@n1xx1/ocgcore-wasm';
import type { Action, DuelConfig, PromptType } from './solver-types.js';
import type { DecisionContext } from './prompt-resolver.js';
import { OpponentBranchingOracle, BranchingOracle, type BranchingDelegate } from './branching-oracles.js';

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

// =============================================================================
// Stub delegate — records calls + returns canned responses
// =============================================================================

interface StubCall {
  fn: string;
  promptType?: PromptType;
}

function makeStubDelegate(opts: {
  enumerateReturns?: Action[];
  selectCardIsExploratory?: boolean;
  selectCardIsPreferredExploratory?: boolean;
  enumeratePreferredReturns?: Action[];
  tryInteractiveReturns?: Action[] | null;
} = {}): BranchingDelegate & { calls: StubCall[] } {
  const calls: StubCall[] = [];
  return {
    calls,
    enumerateActionsWithResponses: (_msg, promptType) => {
      calls.push({ fn: 'enumerate', promptType });
      return opts.enumerateReturns ?? [];
    },
    selectCardIsExploratory: () => {
      calls.push({ fn: 'selectCardIsExploratory' });
      return opts.selectCardIsExploratory ?? false;
    },
    selectCardIsPreferredExploratory: () => {
      calls.push({ fn: 'selectCardIsPreferredExploratory' });
      return opts.selectCardIsPreferredExploratory ?? false;
    },
    enumeratePreferredSelectCard: (_msg) => {
      calls.push({ fn: 'enumeratePreferred' });
      return opts.enumeratePreferredReturns ?? [];
    },
    tryInteractiveMechanical: (_msg, promptType) => {
      calls.push({ fn: 'tryInteractive', promptType });
      return opts.tryInteractiveReturns ?? null;
    },
  };
}

function makeCtx(overrides: Partial<DecisionContext>): DecisionContext {
  return {
    promptType: 'SELECT_IDLECMD',
    msg: { type: OcgMessageType.SELECT_IDLECMD, player: 0 },
    caller: 'dfs',
    player: 0,
    config: {
      mainDeck: [],
      extraDeck: [],
      hand: [],
      deckSeed: [42n, 137n],
    } as DuelConfig,
    ...overrides,
  };
}

function fakeAction(cardId: number): Action {
  return {
    cardId,
    cardName: `Card#${cardId}`,
    promptType: 'SELECT_IDLECMD',
    responseIndex: 0,
    isExploratory: true,
  };
}

// =============================================================================
// OpponentBranchingOracle
// =============================================================================

console.log('\n📋 OpponentBranchingOracle\n');

// Player prompt → pass
{
  const delegate = makeStubDelegate();
  const oracle = new OpponentBranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ player: 0 }));
  assert(r.kind === 'pass' && delegate.calls.length === 0, 'player=0 → pass (no delegate call)');
}

// Opponent prompt + no handtraps → pass
{
  const delegate = makeStubDelegate();
  const oracle = new OpponentBranchingOracle(delegate);
  const ctx = makeCtx({ player: 1, promptType: 'SELECT_CHAIN' });
  const r = oracle.decide(ctx);
  assert(r.kind === 'pass' && delegate.calls.length === 0, 'opponent + no handtraps → pass');
}

// Opponent prompt + handtraps + non-CHAIN prompt → pass
{
  const delegate = makeStubDelegate();
  const oracle = new OpponentBranchingOracle(delegate);
  const config: DuelConfig = {
    mainDeck: [],
    extraDeck: [],
    hand: [],
    deckSeed: [42n, 137n],
    handtraps: [{ cardId: 14558127, cardName: 'Ash' }],
  };
  const ctx = makeCtx({ player: 1, promptType: 'SELECT_IDLECMD', config });
  const r = oracle.decide(ctx);
  assert(r.kind === 'pass' && delegate.calls.length === 0, 'opponent + handtraps + non-CHAIN → pass');
}

// Opponent SELECT_CHAIN + handtraps → branches with team:1 tagging
{
  const delegate = makeStubDelegate({ enumerateReturns: [fakeAction(101), fakeAction(202)] });
  const oracle = new OpponentBranchingOracle(delegate);
  const config: DuelConfig = {
    mainDeck: [],
    extraDeck: [],
    hand: [],
    deckSeed: [42n, 137n],
    handtraps: [{ cardId: 14558127, cardName: 'Ash' }],
  };
  const ctx = makeCtx({ player: 1, promptType: 'SELECT_CHAIN', config });
  const r = oracle.decide(ctx);
  const ok = r.kind === 'branches'
    && r.actions.length === 2
    && r.actions.every(a => a.team === 1);
  assert(ok, 'opponent SELECT_CHAIN + handtraps → branches all tagged team:1', JSON.stringify(r));
}

// =============================================================================
// BranchingOracle
// =============================================================================

console.log('\n📋 BranchingOracle\n');

// Opponent player → pass (BranchingOracle is player-only)
{
  const delegate = makeStubDelegate();
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ player: 1 }));
  assert(r.kind === 'pass' && delegate.calls.length === 0, 'player=1 → pass');
}

// Player exploratory prompt → branches via enumerateActionsWithResponses
{
  const delegate = makeStubDelegate({ enumerateReturns: [fakeAction(1), fakeAction(2)] });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_IDLECMD' }));
  assert(
    r.kind === 'branches' && r.actions.length === 2 && delegate.calls[0].fn === 'enumerate',
    'player SELECT_IDLECMD (exploratory) → enumerate + branches',
    JSON.stringify(delegate.calls),
  );
}

// Player BATTLECMD (exploratory) → enumerate + branches
{
  const delegate = makeStubDelegate({ enumerateReturns: [fakeAction(3)] });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_BATTLECMD' }));
  assert(
    r.kind === 'branches' && r.actions.length === 1,
    'player SELECT_BATTLECMD → enumerate + branches',
  );
}

// Player CHAIN (exploratory) → enumerate + branches (player chain)
{
  const delegate = makeStubDelegate({ enumerateReturns: [] });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_CHAIN' }));
  assert(r.kind === 'branches', 'player SELECT_CHAIN → enumerate + branches');
}

// Player mechanical SELECT_POSITION → pass (falls through to MechanicalDefault)
{
  const delegate = makeStubDelegate();
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_POSITION' }));
  assert(
    r.kind === 'pass' && delegate.calls.length === 0,
    'player SELECT_POSITION (mechanical, no flags) → pass',
  );
}

// Player SELECT_CARD small-pool exploratory → branches
{
  const delegate = makeStubDelegate({
    selectCardIsExploratory: true,
    enumerateReturns: [fakeAction(100), fakeAction(200)],
  });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_CARD' }));
  assert(
    r.kind === 'branches' && r.actions.length === 2,
    'player SELECT_CARD small-pool → branches',
  );
}

// Player SELECT_CARD preferred large-pool → enumeratePreferred
{
  const delegate = makeStubDelegate({
    selectCardIsExploratory: false,
    selectCardIsPreferredExploratory: true,
    enumeratePreferredReturns: [fakeAction(300)],
  });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_CARD' }));
  const callsFns = delegate.calls.map(c => c.fn);
  assert(
    r.kind === 'branches'
      && r.actions.length === 1
      && callsFns.includes('enumeratePreferred'),
    'player SELECT_CARD large-pool preferred → enumeratePreferred + branches',
    JSON.stringify(callsFns),
  );
}

// Player SELECT_CARD neither exploratory nor preferred → pass to mechanical
{
  const delegate = makeStubDelegate({
    selectCardIsExploratory: false,
    selectCardIsPreferredExploratory: false,
  });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_CARD' }));
  assert(r.kind === 'pass', 'player SELECT_CARD neither gate → pass');
}

// Player SELECT_TRIBUTE + exposeMultiPickMechanical=true + delegate returns interactive
{
  const delegate = makeStubDelegate({
    tryInteractiveReturns: [fakeAction(500)],
  });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_TRIBUTE', exposeMultiPickMechanical: true }));
  assert(
    r.kind === 'branches' && r.actions.length === 1 && delegate.calls[0].fn === 'tryInteractive',
    'SELECT_TRIBUTE + exposeMultiPick → tryInteractive + branches',
  );
}

// Player SELECT_TRIBUTE + exposeMultiPickMechanical=false → no tryInteractive call, pass
{
  const delegate = makeStubDelegate({
    tryInteractiveReturns: [fakeAction(500)],  // would return data but should not be called
  });
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ promptType: 'SELECT_TRIBUTE', exposeMultiPickMechanical: false }));
  assert(
    r.kind === 'pass' && !delegate.calls.some(c => c.fn === 'tryInteractive'),
    'SELECT_TRIBUTE + exposeMultiPick=false → no tryInteractive call, pass',
  );
}

// Missing config → pass (defensive — should never happen in practice)
{
  const delegate = makeStubDelegate();
  const oracle = new BranchingOracle(delegate);
  const r = oracle.decide(makeCtx({ config: undefined }));
  assert(r.kind === 'pass' && delegate.calls.length === 0, 'no config → pass');
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`❌ ${failed} test(s) failed`);
  process.exit(1);
}
console.log('✅ All branching oracles smoke tests passed');
