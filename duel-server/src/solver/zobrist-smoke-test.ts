// =============================================================================
// zobrist-smoke-test.ts — Integration smoke tests for Zobrist + Transposition
// Run: npx tsx src/solver/zobrist-smoke-test.ts
// =============================================================================

import type { ZoneId } from '../ws-protocol.js';
import type { FieldCard, FieldState } from './solver-types.js';
import { ZobristHasher, hashToKey } from './zobrist.js';
import { buildVerificationKey } from './transposition-table.js';

function makeCard(cardId: number, position: FieldCard['position'] = 'faceup-atk', overlayCount = 0): FieldCard {
  return { cardId, cardName: `Card#${cardId}`, position, overlayCount };
}

function emptyZones(): Record<ZoneId, FieldCard[]> {
  const zones = {} as Record<ZoneId, FieldCard[]>;
  const allZones: ZoneId[] = [
    'M1', 'M2', 'M3', 'M4', 'M5',
    'S1', 'S2', 'S3', 'S4', 'S5',
    'FIELD', 'EMZ_L', 'EMZ_R',
    'GY', 'BANISHED', 'EXTRA', 'DECK', 'HAND',
  ];
  for (const z of allZones) zones[z] = [];
  return zones;
}

function makeFieldState(overrides: Partial<Record<ZoneId, FieldCard[]>> = {}): FieldState {
  const zones = emptyZones();
  for (const [z, cards] of Object.entries(overrides)) {
    zones[z as ZoneId] = cards!;
  }
  return { zones, lifePoints: [8000, 8000], turn: 1, phase: 'MAIN1' };
}

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

// =============================================================================
// Test 5.1: XOR round-trip (add/remove card returns original hash)
// =============================================================================

console.log('\n🔬 Test 5.1: XOR round-trip');
{
  const hasher = new ZobristHasher();
  const state = makeFieldState({
    M1: [makeCard(12345, 'faceup-atk')],
    M2: [makeCard(67890, 'faceup-def')],
    HAND: [makeCard(111), makeCard(222), makeCard(333)],
    GY: [makeCard(444)],
  });

  const originalHash = hasher.computeHash(state);
  const m2Card = makeCard(67890, 'faceup-def');

  // Remove M2 card (1 card left in M2 after = 0), then re-add it (0 before)
  let hash = hasher.removeCard(originalHash, m2Card, 'M2', 0);
  hash = hasher.addCard(hash, m2Card, 'M2', 0);

  assert(hash.hi === originalHash.hi && hash.lo === originalHash.lo,
    'XOR round-trip: remove + add returns original hash');
}

// =============================================================================
// Test 5.2: Bag hash order independence (same hand cards, different order)
// =============================================================================

console.log('\n🔬 Test 5.2: Bag hash order independence');
{
  const hasher = new ZobristHasher();

  const state1 = makeFieldState({
    HAND: [makeCard(100), makeCard(200), makeCard(300)],
  });
  const state2 = makeFieldState({
    HAND: [makeCard(300), makeCard(100), makeCard(200)],
  });

  const hash1 = hasher.computeHash(state1);
  const hash2 = hasher.computeHash(state2);

  assert(hash1.hi === hash2.hi && hash1.lo === hash2.lo,
    'Same HAND cards in different order produce identical hashes');
}

// =============================================================================
// Test 5.3: Verification key diverges on overlay count difference
// =============================================================================

console.log('\n🔬 Test 5.3: Verification key overlay divergence');
{
  const state1 = makeFieldState({
    M1: [makeCard(99999, 'faceup-atk', 2)],
  });
  const state2 = makeFieldState({
    M1: [makeCard(99999, 'faceup-atk', 1)],
  });

  const vk1 = buildVerificationKey(state1);
  const vk2 = buildVerificationKey(state2);

  assert(vk1 !== vk2,
    'Different overlayCount produces different verification keys');
}

// =============================================================================
// Test 5.4: Verification key determinism
// =============================================================================

console.log('\n🔬 Test 5.4: Verification key determinism');
{
  const state = makeFieldState({
    M1: [makeCard(111, 'faceup-atk', 1)],
    S3: [makeCard(222, 'facedown')],
    HAND: [makeCard(333), makeCard(444)],
    GY: [makeCard(555)],
  });

  const vk1 = buildVerificationKey(state);
  const vk2 = buildVerificationKey(state);

  assert(vk1 === vk2,
    'Same FieldState produces identical verification keys across calls');
}

// =============================================================================
// Test 5.5: Incremental add to empty zone matches full recompute
// =============================================================================

console.log('\n🔬 Test 5.5: Incremental add to empty zone vs full recompute');
{
  const hasher = new ZobristHasher();
  const card = makeCard(42000, 'faceup-atk');

  // Full recompute with card in M3
  const fullState = makeFieldState({ M3: [card] });
  const fullHash = hasher.computeHash(fullState);

  // Incremental: start from empty state, add card to M3 (zoneCardCountBefore = 0)
  const emptyState = makeFieldState();
  let incHash = hasher.computeHash(emptyState);
  incHash = hasher.addCard(incHash, card, 'M3', 0);

  assert(incHash.hi === fullHash.hi && incHash.lo === fullHash.lo,
    'Incremental add to empty zone matches full recompute (zoneBaseHash toggled)');
}

// =============================================================================
// Test 5.6: hashToKey separator prevents collisions
// =============================================================================

console.log('\n🔬 Test 5.6: hashToKey separator correctness');
{
  const key1 = hashToKey({ hi: 1, lo: 23 });
  const key2 = hashToKey({ hi: 12, lo: 3 });

  assert(key1 !== key2,
    'hashToKey({1,23}) !== hashToKey({12,3}) — separator prevents collision');

  const key3 = hashToKey({ hi: 0, lo: 0 });
  assert(key3 === '0:0', 'hashToKey({0,0}) === "0:0"');
}

// =============================================================================
// Test 5.7: updateDeckCount vs full recompute
// =============================================================================

console.log('\n🔬 Test 5.7: updateDeckCount vs full recompute');
{
  const hasher = new ZobristHasher();

  // Full recompute with 5 deck cards
  const deckCards = Array.from({ length: 5 }, (_, i) => makeCard(9000 + i, 'facedown'));
  const state5 = makeFieldState({ DECK: deckCards });
  const fullHash5 = hasher.computeHash(state5);

  // Incremental: start with empty deck, updateDeckCount(0 → 5)
  const state0 = makeFieldState();
  let incHash = hasher.computeHash(state0);
  incHash = hasher.updateDeckCount(incHash, 0, 5);

  assert(incHash.hi === fullHash5.hi && incHash.lo === fullHash5.lo,
    'updateDeckCount(0→5) matches full recompute (zoneBaseHash toggled)');

  // Incremental: from 5 → 0
  let decHash = hasher.computeHash(state5);
  decHash = hasher.updateDeckCount(decHash, 5, 0);
  const emptyHash = hasher.computeHash(makeFieldState());

  assert(decHash.hi === emptyHash.hi && decHash.lo === emptyHash.lo,
    'updateDeckCount(5→0) matches empty state recompute');
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
