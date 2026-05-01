// =============================================================================
// record-activation-integration-test.ts — Story 1.8 C1 fix verification
// Run: npx tsx src/solver/record-activation-integration-test.ts
//
// Boots a real OCGCoreAdapter with a SYNTHETIC tag map (Alexandrite Dragon
// flagged as if it were a tagged interruption monster) and drives a vanilla
// duel through SELECT_IDLECMD. Verifies that the C1 fix correctly EXCLUDES
// normal summons from the activation log: even though the summoned card is
// "tagged" via the synthetic map, the summon must NOT pollute getActivationLog().
//
// Why a synthetic tag rather than a real card: it lets us reuse the existing
// vanilla-deck test fixture (Alexandrite Dragon ×40) without bringing in a
// real combo deck. The fix is generic — if it works for synthetic tags, it
// works for real ones.
// =============================================================================

import { join } from 'node:path';
import type { Action, InterruptionTag } from './solver-types.js';
import { OCGCoreAdapter } from './ocgcore-adapter.js';
import { loadDatabase, loadScripts } from '../ocg-scripts.js';

const ALEXANDRITE_DRAGON = 43096270;

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

console.log('🔧 Booting OCGCore WASM with synthetic tags...');

const dataDir = join(import.meta.dirname, '..', '..', 'data');
const cardDB = loadDatabase(join(dataDir, 'cards.cdb'));
const scripts = loadScripts(join(dataDir, 'scripts_full'));

// Inject a synthetic tag on Alexandrite Dragon so recordActivation considers
// it a candidate. With the C1 fix, the normal summon should NOT log; without
// it, the summon would falsely populate activationLog[43096270].
const syntheticTags: Record<string, InterruptionTag> = {
  [String(ALEXANDRITE_DRAGON)]: {
    cardName: 'Alexandrite Dragon (test fixture)',
    effects: [
      { type: 'omniNegate', usesPerTurn: 1, trigger: 'main' },
    ],
  },
};

const adapter = await OCGCoreAdapter.create(cardDB, scripts, syntheticTags);

const handle = adapter.createDuel({
  mainDeck: Array(35).fill(ALEXANDRITE_DRAGON),
  extraDeck: [],
  hand: [ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON],
  deckSeed: [42n, 123n, 456n, 789n],
  opponentDeck: [],
});

// =============================================================================
// Test I1: Fresh handle has empty activation log
// =============================================================================

console.log('\n🔬 Test I1: fresh duel handle has empty activation log');
{
  const log = adapter.getActivationLog(handle);
  assert(log.size === 0, `fresh log size = ${log.size} (expected 0)`);
}

// =============================================================================
// Test I2: Normal summon of a tagged card does NOT pollute the log
// =============================================================================

console.log('\n🔬 Test I2: SELECT_IDLECMD normal-summon of a tagged card does not log');
{
  const actions = adapter.getLegalActions(handle);
  assert(actions.length > 0, `getLegalActions returned ${actions.length} actions`);

  // Find the normal-summon action for Alexandrite Dragon. The OCGCore response
  // for IDLECMD action 0 = "summons" (normal summon).
  const summonAction = actions.find((a: Action) => {
    if (a.promptType !== 'SELECT_IDLECMD') return false;
    if (a.cardId !== ALEXANDRITE_DRAGON) return false;
    const r = a._response as { type?: number; action?: number } | undefined;
    return r?.type === 1 && r?.action === 0;
  });

  assert(summonAction !== undefined, 'normal-summon action offered for tagged Alexandrite Dragon');

  if (summonAction) {
    // Critical assertion: the enumerator must NOT flag the summon as an
    // effect activation (this is the C1 fix). Without the fix, the flag
    // would be undefined which is also "not true" — but the bug pre-fix
    // was that recordActivation didn't check the flag at all and used
    // promptType-only filtering.
    assert(
      summonAction._isEffectActivation !== true,
      `summon._isEffectActivation = ${summonAction._isEffectActivation} (expected falsy — summon is not an effect activation)`,
    );

    adapter.applyAction(handle, summonAction);

    const logAfterSummon = adapter.getActivationLog(handle);
    assert(
      logAfterSummon.size === 0,
      `activation log after normal summon: size=${logAfterSummon.size} entries=${JSON.stringify([...logAfterSummon])} (expected empty)`,
    );
    assert(
      logAfterSummon.get(ALEXANDRITE_DRAGON) === undefined,
      `log[ALEXANDRITE_DRAGON] === undefined after summon (got ${JSON.stringify(logAfterSummon.get(ALEXANDRITE_DRAGON))})`,
    );
  }
}

// =============================================================================
// Test I3: to_ep also leaves the log empty (cardId=0 fast path)
// =============================================================================

console.log('\n🔬 Test I3: SELECT_IDLECMD to_ep does not pollute the log');
{
  const actions = adapter.getLegalActions(handle);
  const toEpAction = actions.find((a: Action) => {
    if (a.promptType !== 'SELECT_IDLECMD') return false;
    const r = a._response as { type?: number; action?: number } | undefined;
    return r?.type === 1 && r?.action === 7;
  });

  if (toEpAction) {
    adapter.applyAction(handle, toEpAction);
    const log = adapter.getActivationLog(handle);
    assert(log.size === 0, `log size after to_ep = ${log.size} (expected 0)`);
  } else {
    console.log('  ℹ️  to_ep not offered at this prompt — skipping');
  }
}

// =============================================================================
// Test I4: forkViaReplay clones the (still empty) log without leakage
// =============================================================================

console.log('\n🔬 Test I4: fork clones the activation log into an isolated map');
{
  const fresh = adapter.createDuel({
    mainDeck: Array(35).fill(ALEXANDRITE_DRAGON),
    extraDeck: [],
    hand: [ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON, ALEXANDRITE_DRAGON],
    deckSeed: [99n, 88n, 77n, 66n],
    opponentDeck: [],
  });

  // Pump a few actions through the parent
  const parentActions = adapter.getLegalActions(fresh);
  const parentSummon = parentActions.find((a: Action) => {
    if (a.promptType !== 'SELECT_IDLECMD') return false;
    if (a.cardId !== ALEXANDRITE_DRAGON) return false;
    const r = a._response as { type?: number; action?: number } | undefined;
    return r?.type === 1 && r?.action === 0;
  });

  if (parentSummon) {
    adapter.applyAction(fresh, parentSummon);
  }

  const child = adapter.fork(fresh);
  const parentLog = adapter.getActivationLog(fresh);
  const childLog = adapter.getActivationLog(child);

  assert(parentLog.size === 0, `parent log empty after summon (size=${parentLog.size})`);
  assert(childLog.size === 0, `child log empty after fork (size=${childLog.size})`);
  // Identity check — fork must produce a NEW Map, not share the parent's reference
  assert(parentLog !== childLog, `parent and child logs are different Map instances`);

  adapter.destroyDuel(child);
  adapter.destroyDuel(fresh);
}

adapter.destroyDuel(handle);
adapter.destroyAll();

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
