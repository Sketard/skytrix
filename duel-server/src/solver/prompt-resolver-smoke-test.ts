// =============================================================================
// prompt-resolver-smoke-test.ts — Phase 2 unit coverage for PromptResolver +
// MechanicalDefaultOracle.
//
// Covers every existing autoRespondMechanical case + every autoRespondOpponent
// case from ocgcore-adapter.ts (Phase 0 inventory Track A §"Mechanical default
// layer" + §"Opponent layer"). Bit-exact target — Phase 3 gate diffs against
// _bmad-output/solver-data/phase-1-baselines/ so any drift here surfaces
// immediately.
//
// Run: npx tsx src/solver/prompt-resolver-smoke-test.ts
// =============================================================================

import { OcgLocation, OcgMessageType, OcgPosition } from '@n1xx1/ocgcore-wasm';
import { PromptResolver } from './prompt-resolver.js';
import type { DecisionContext } from './prompt-resolver.js';
import { MechanicalDefaultOracle } from './mechanical-default-oracle.js';
import type { DuelConfig, PromptType } from './solver-types.js';

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

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function makeCtx(
  promptType: PromptType,
  msg: Record<string, unknown>,
  player: 0 | 1 = 0,
  config?: DuelConfig,
): DecisionContext {
  return {
    promptType,
    msg: { ...msg },
    caller: 'dfs',
    player,
    config,
  };
}

const oracle = new MechanicalDefaultOracle();
const resolver = new PromptResolver([oracle]);

// =============================================================================
// autoRespondMechanical cases (player=0 path)
// =============================================================================

console.log('\n📋 MechanicalDefaultOracle — autoRespondMechanical cases\n');

// SELECT_POSITION → faceup-attack
{
  const r = resolver.resolve(makeCtx('SELECT_POSITION', { type: OcgMessageType.SELECT_POSITION, code: 12345, positions: 7 }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 11, position: OcgPosition.FACEUP_ATTACK }),
    'SELECT_POSITION → {type:11, position:FACEUP_ATTACK}',
    JSON.stringify(r),
  );
}

// SELECT_PLACE → decoded field_mask, count
{
  // field_mask=0x60 (= 96) means 2 main monster zones; count=2.
  // The exact decoded places depend on decodeFieldMask which we trust verbatim
  // — what we check is that the response shape matches and is non-empty.
  const r = resolver.resolve(makeCtx('SELECT_PLACE', { type: OcgMessageType.SELECT_PLACE, field_mask: 0x60, count: 2 }));
  assert(
    r.kind === 'response'
      && (r.response as { type: number; places: unknown[] }).type === 10
      && Array.isArray((r.response as { places: unknown[] }).places),
    'SELECT_PLACE → {type:10, places: [...]}',
    JSON.stringify(r),
  );
}

// SELECT_DISFIELD → decoded field_mask
{
  const r = resolver.resolve(makeCtx('SELECT_PLACE', { type: OcgMessageType.SELECT_DISFIELD, field_mask: 0x60, count: 1 }));
  assert(
    r.kind === 'response'
      && (r.response as { type: number; places: unknown[] }).type === 9
      && Array.isArray((r.response as { places: unknown[] }).places),
    'SELECT_DISFIELD → {type:9, places: [...]}',
    JSON.stringify(r),
  );
}

// SELECT_TRIBUTE min=2 → indices [0, 1]
{
  const r = resolver.resolve(makeCtx('SELECT_TRIBUTE', { type: OcgMessageType.SELECT_TRIBUTE, min: 2 }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 12, indicies: [0, 1] }),
    'SELECT_TRIBUTE min=2 → {type:12, indicies:[0,1]}',
    JSON.stringify(r),
  );
}

// SELECT_TRIBUTE missing min → defaults to 1, indices [0]
{
  const r = resolver.resolve(makeCtx('SELECT_TRIBUTE', { type: OcgMessageType.SELECT_TRIBUTE }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 12, indicies: [0] }),
    'SELECT_TRIBUTE no min → defaults to min=1, indicies:[0]',
    JSON.stringify(r),
  );
}

// SELECT_SUM min=3 → indices [0, 1, 2]
{
  const r = resolver.resolve(makeCtx('SELECT_SUM', { type: OcgMessageType.SELECT_SUM, min: 3 }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 14, indicies: [0, 1, 2] }),
    'SELECT_SUM min=3 → {type:14, indicies:[0,1,2]}',
    JSON.stringify(r),
  );
}

// SELECT_COUNTER → all-zero counters array sized to cards.length
{
  const r = resolver.resolve(makeCtx('SELECT_COUNTER', { type: OcgMessageType.SELECT_COUNTER, cards: [{}, {}, {}] }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 13, counters: [0, 0, 0] }),
    'SELECT_COUNTER cards=[3] → {type:13, counters:[0,0,0]}',
    JSON.stringify(r),
  );
}

// SELECT_COUNTER missing cards → empty counters
{
  const r = resolver.resolve(makeCtx('SELECT_COUNTER', { type: OcgMessageType.SELECT_COUNTER }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 13, counters: [] }),
    'SELECT_COUNTER no cards → {type:13, counters:[]}',
    JSON.stringify(r),
  );
}

// SELECT_CARD without preferred — first min indices
{
  const msg = {
    type: OcgMessageType.SELECT_CARD,
    min: 2,
    selects: [
      { code: 100, location: OcgLocation.DECK },
      { code: 200, location: OcgLocation.DECK },
      { code: 300, location: OcgLocation.DECK },
    ],
  };
  const r = resolver.resolve(makeCtx('SELECT_CARD', msg));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 5, indicies: [0, 1] }),
    'SELECT_CARD no preferred → {type:5, indicies:[0,1]}',
    JSON.stringify(r),
  );
}

// SELECT_CARD with preferred + DECK gate satisfied → preferred order
{
  const msg = {
    type: OcgMessageType.SELECT_CARD,
    min: 1,
    selects: [
      { code: 100, location: OcgLocation.DECK },
      { code: 200, location: OcgLocation.DECK },  // prefer this one
      { code: 300, location: OcgLocation.DECK },
    ],
  };
  const config: DuelConfig = {
    mainDeck: [],
    extraDeck: [],
    hand: [],
    deckSeed: [42n, 137n],
    preferredSearchTargets: [200],
  };
  const r = resolver.resolve(makeCtx('SELECT_CARD', msg, 0, config));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 5, indicies: [1] }),
    'SELECT_CARD preferred=[200] all-DECK → picks index 1 (200)',
    JSON.stringify(r),
  );
}

// SELECT_CARD preferred + DECK gate satisfied + multiple preferred
{
  const msg = {
    type: OcgMessageType.SELECT_CARD,
    min: 2,
    selects: [
      { code: 100, location: OcgLocation.DECK },
      { code: 200, location: OcgLocation.DECK },
      { code: 300, location: OcgLocation.DECK },
    ],
  };
  const config: DuelConfig = {
    mainDeck: [],
    extraDeck: [],
    hand: [],
    deckSeed: [42n, 137n],
    preferredSearchTargets: [300, 100],  // priority order: 300 first then 100
  };
  const r = resolver.resolve(makeCtx('SELECT_CARD', msg, 0, config));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 5, indicies: [2, 0] }),
    'SELECT_CARD preferred=[300,100] all-DECK → picks indices [2,0] in that order',
    JSON.stringify(r),
  );
}

// SELECT_CARD preferred but DECK gate fails (one card in HAND) → fallback to OCG order
{
  const msg = {
    type: OcgMessageType.SELECT_CARD,
    min: 1,
    selects: [
      { code: 100, location: OcgLocation.DECK },
      { code: 200, location: OcgLocation.HAND },
      { code: 300, location: OcgLocation.DECK },
    ],
  };
  const config: DuelConfig = {
    mainDeck: [],
    extraDeck: [],
    hand: [],
    deckSeed: [42n, 137n],
    preferredSearchTargets: [300],
  };
  const r = resolver.resolve(makeCtx('SELECT_CARD', msg, 0, config));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 5, indicies: [0] }),
    'SELECT_CARD preferred but mixed locations → fallback to OCG-index [0]',
    JSON.stringify(r),
  );
}

// SELECT_CARD preferred not in pool → top up with OCG-order
{
  const msg = {
    type: OcgMessageType.SELECT_CARD,
    min: 2,
    selects: [
      { code: 100, location: OcgLocation.DECK },
      { code: 200, location: OcgLocation.DECK },
    ],
  };
  const config: DuelConfig = {
    mainDeck: [],
    extraDeck: [],
    hand: [],
    deckSeed: [42n, 137n],
    preferredSearchTargets: [999, 200],  // 999 not in pool; only 200 matches
  };
  const r = resolver.resolve(makeCtx('SELECT_CARD', msg, 0, config));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 5, indicies: [1, 0] }),
    'SELECT_CARD preferred=[999,200] → matches 200 (idx 1) then tops up with OCG idx 0',
    JSON.stringify(r),
  );
}

// SELECT_CARD missing min → defaults to 1
{
  const msg = {
    type: OcgMessageType.SELECT_CARD,
    selects: [{ code: 100, location: OcgLocation.DECK }],
  };
  const r = resolver.resolve(makeCtx('SELECT_CARD', msg));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 5, indicies: [0] }),
    'SELECT_CARD no min → defaults to min=1',
    JSON.stringify(r),
  );
}

// SELECT_UNSELECT_CARD with can_finish=true → null index (commit)
{
  const r = resolver.resolve(makeCtx('SELECT_UNSELECT_CARD', { type: OcgMessageType.SELECT_UNSELECT_CARD, can_finish: true }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 7, index: null }),
    'SELECT_UNSELECT_CARD can_finish=true → {type:7, index:null}',
    JSON.stringify(r),
  );
}

// SELECT_UNSELECT_CARD with can_finish=false → index 0 (auto-pick first)
{
  const r = resolver.resolve(makeCtx('SELECT_UNSELECT_CARD', { type: OcgMessageType.SELECT_UNSELECT_CARD, can_finish: false }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 7, index: 0 }),
    'SELECT_UNSELECT_CARD can_finish=false → {type:7, index:0}',
    JSON.stringify(r),
  );
}

// SELECT_UNSELECT_CARD missing can_finish → falsy → index 0
{
  const r = resolver.resolve(makeCtx('SELECT_UNSELECT_CARD', { type: OcgMessageType.SELECT_UNSELECT_CARD }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 7, index: 0 }),
    'SELECT_UNSELECT_CARD no can_finish → {type:7, index:0}',
    JSON.stringify(r),
  );
}

// ANNOUNCE_NUMBER → max-index (last option)
{
  const r = resolver.resolve(makeCtx('SELECT_OPTION', { type: OcgMessageType.ANNOUNCE_NUMBER, options: [1n, 2n, 3n, 4n] }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 19, value: 3 }),
    'ANNOUNCE_NUMBER opts=[1,2,3,4] → {type:19, value:3} (last index)',
    JSON.stringify(r),
  );
}

// ANNOUNCE_NUMBER with options as numbers (not bigint)
{
  const r = resolver.resolve(makeCtx('SELECT_OPTION', { type: OcgMessageType.ANNOUNCE_NUMBER, options: [10, 20] }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 19, value: 1 }),
    'ANNOUNCE_NUMBER opts=[10,20] → {type:19, value:1}',
    JSON.stringify(r),
  );
}

// ANNOUNCE_NUMBER empty options → value=0
{
  const r = resolver.resolve(makeCtx('SELECT_OPTION', { type: OcgMessageType.ANNOUNCE_NUMBER, options: [] }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 19, value: 0 }),
    'ANNOUNCE_NUMBER opts=[] → {type:19, value:0}',
    JSON.stringify(r),
  );
}

// ANNOUNCE_NUMBER missing options → value=0 (defensive default)
{
  const r = resolver.resolve(makeCtx('SELECT_OPTION', { type: OcgMessageType.ANNOUNCE_NUMBER }));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 19, value: 0 }),
    'ANNOUNCE_NUMBER no options → {type:19, value:0}',
    JSON.stringify(r),
  );
}

// =============================================================================
// autoRespondOpponent cases (player=1 path)
// =============================================================================

console.log('\n📋 MechanicalDefaultOracle — autoRespondOpponent cases\n');

// Opponent SELECT_IDLECMD with to_ep=true → end-phase action 7
{
  const r = resolver.resolve(makeCtx('SELECT_IDLECMD', { type: OcgMessageType.SELECT_IDLECMD, to_ep: true }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 1, action: 7 }),
    'opponent SELECT_IDLECMD to_ep=true → {type:1, action:7}',
    JSON.stringify(r),
  );
}

// Opponent SELECT_IDLECMD with to_ep=false → battle-phase action 6
{
  const r = resolver.resolve(makeCtx('SELECT_IDLECMD', { type: OcgMessageType.SELECT_IDLECMD, to_ep: false }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 1, action: 6 }),
    'opponent SELECT_IDLECMD to_ep=false → {type:1, action:6}',
    JSON.stringify(r),
  );
}

// Opponent SELECT_BATTLECMD with to_ep=true → action 3
{
  const r = resolver.resolve(makeCtx('SELECT_BATTLECMD', { type: OcgMessageType.SELECT_BATTLECMD, to_ep: true }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 0, action: 3 }),
    'opponent SELECT_BATTLECMD to_ep=true → {type:0, action:3}',
    JSON.stringify(r),
  );
}

// Opponent SELECT_BATTLECMD with to_ep=false → action 2
{
  const r = resolver.resolve(makeCtx('SELECT_BATTLECMD', { type: OcgMessageType.SELECT_BATTLECMD, to_ep: false }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 0, action: 2 }),
    'opponent SELECT_BATTLECMD to_ep=false → {type:0, action:2}',
    JSON.stringify(r),
  );
}

// Opponent SELECT_CHAIN → null index (decline)
{
  const r = resolver.resolve(makeCtx('SELECT_CHAIN', { type: OcgMessageType.SELECT_CHAIN }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 8, index: null }),
    'opponent SELECT_CHAIN → {type:8, index:null}',
    JSON.stringify(r),
  );
}

// Opponent SELECT_EFFECTYN → yes
{
  const r = resolver.resolve(makeCtx('SELECT_EFFECTYN', { type: OcgMessageType.SELECT_EFFECTYN }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 2, yes: true }),
    'opponent SELECT_EFFECTYN → {type:2, yes:true}',
    JSON.stringify(r),
  );
}

// Opponent SELECT_YESNO → no
{
  const r = resolver.resolve(makeCtx('SELECT_YESNO', { type: OcgMessageType.SELECT_YESNO }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 3, yes: false }),
    'opponent SELECT_YESNO → {type:3, yes:false}',
    JSON.stringify(r),
  );
}

// Opponent SELECT_POSITION → falls through to mechanical
{
  const r = resolver.resolve(makeCtx('SELECT_POSITION', { type: OcgMessageType.SELECT_POSITION }, 1));
  assert(
    r.kind === 'response' && deepEqual(r.response, { type: 11, position: OcgPosition.FACEUP_ATTACK }),
    'opponent SELECT_POSITION → falls through to mechanical default',
    JSON.stringify(r),
  );
}

// Opponent SELECT_PLACE → falls through to mechanical
{
  const r = resolver.resolve(makeCtx('SELECT_PLACE', { type: OcgMessageType.SELECT_PLACE, field_mask: 0x10, count: 1 }, 1));
  assert(
    r.kind === 'response'
      && (r.response as { type: number }).type === 10
      && Array.isArray((r.response as { places: unknown[] }).places),
    'opponent SELECT_PLACE → falls through to mechanical default {type:10}',
    JSON.stringify(r),
  );
}

// =============================================================================
// PromptResolver chain semantics
// =============================================================================

console.log('\n📋 PromptResolver — chain semantics\n');

// Chain composition: resolver returns the source oracle name on response
{
  const r = resolver.resolve(makeCtx('SELECT_POSITION', { type: OcgMessageType.SELECT_POSITION }));
  assert(
    r.kind === 'response' && r.source === 'MechanicalDefaultOracle',
    'ResolveResult.source = MechanicalDefaultOracle',
    JSON.stringify(r),
  );
}

// Empty chain → constructor throws
{
  let threw = false;
  try {
    new PromptResolver([]);
  } catch (e) {
    threw = true;
  }
  assert(threw, 'PromptResolver([]) constructor throws (empty chain)');
}

// Pass-through oracle in front: chain walks past it to MechanicalDefaultOracle
{
  const passThroughOracle = {
    name: 'PassThrough',
    decide(): { kind: 'pass' } {
      return { kind: 'pass' };
    },
  };
  const r2 = new PromptResolver([passThroughOracle, oracle])
    .resolve(makeCtx('SELECT_POSITION', { type: OcgMessageType.SELECT_POSITION }));
  assert(
    r2.kind === 'response'
      && r2.source === 'MechanicalDefaultOracle'
      && deepEqual(r2.response, { type: 11, position: OcgPosition.FACEUP_ATTACK }),
    'pass-through oracle → chain walks to terminal',
    JSON.stringify(r2),
  );
}

// First oracle producing branches short-circuits
{
  const branchingOracle = {
    name: 'BranchingFake',
    decide(): { kind: 'branches'; actions: [] } {
      return { kind: 'branches', actions: [] };
    },
  };
  const r3 = new PromptResolver([branchingOracle, oracle])
    .resolve(makeCtx('SELECT_IDLECMD', { type: OcgMessageType.SELECT_IDLECMD }));
  assert(
    r3.kind === 'branches' && r3.source === 'BranchingFake',
    'branching oracle short-circuits chain',
    JSON.stringify(r3),
  );
}

// Divergence short-circuits chain
{
  const divergingOracle = {
    name: 'DivergingFake',
    decide(): { kind: 'divergence'; info: { step: 0; promptType: 'SELECT_IDLECMD'; expected: ''; legalActionsAtPrompt: []; reason: 'test' } } {
      return {
        kind: 'divergence',
        info: { step: 0, promptType: 'SELECT_IDLECMD', expected: '', legalActionsAtPrompt: [], reason: 'test' },
      };
    },
  };
  const r4 = new PromptResolver([divergingOracle, oracle])
    .resolve(makeCtx('SELECT_IDLECMD', { type: OcgMessageType.SELECT_IDLECMD }));
  assert(
    r4.kind === 'divergence' && r4.source === 'DivergingFake' && r4.info.reason === 'test',
    'divergence oracle short-circuits chain',
    JSON.stringify(r4),
  );
}

// =============================================================================
// Bit-exact parity vs legacy adapter (sanity sample)
// =============================================================================

// We can't import the private autoRespondMechanical — but the verbatim
// migration in mechanical-default-oracle.ts is bit-exact by construction.
// Phase 3 baseline diff is the real gate. Here we just sanity-check that the
// most-used responses don't drift via copy-paste error.

console.log('\n📋 Sanity: response shape contract\n');

{
  const r = resolver.resolve(makeCtx('SELECT_TRIBUTE', { type: OcgMessageType.SELECT_TRIBUTE, min: 1 }));
  assert(
    r.kind === 'response'
      && (r.response as { type: number; indicies: number[] }).type === 12
      && Array.isArray((r.response as { indicies: number[] }).indicies)
      && (r.response as { indicies: number[] }).indicies.length === 1,
    'SELECT_TRIBUTE response is {type:12, indicies:number[]}',
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
console.log('✅ All MechanicalDefaultOracle + PromptResolver smoke tests passed');
