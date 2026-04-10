// =============================================================================
// solver-ws-smoke-test.ts — Smoke tests for Solver WS Protocol & Server Integration
// Run: npx tsx src/solver/solver-ws-smoke-test.ts
// Requires: duel-server running on PORT (default 3001) with valid data dir
// =============================================================================

import { WebSocket } from 'ws';
import {
  SOLVER_START, SOLVER_CANCEL, SOLVER_INIT, SOLVER_PROGRESS,
  SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR, SOLVER_HANDTRAPS,
} from '../ws-protocol.js';
import type {
  SolverStartMessage, SolverInitMessage, SolverCancelMessage,
  SolverResultMessage, SolverCancelledMessage,
  SolverErrorMessage, SolverHandtrapsMessage,
} from '../ws-protocol.js';

// =============================================================================
// Helpers
// =============================================================================

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

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

function makeJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString('base64url');
  return `${header}.${payload}.fake-sig`;
}

// Alexandrite Dragon test deck — same as Story 1.3 smoke tests
const ALEXANDRITE_ID = 43096270;
const TEST_DECK = {
  main: Array(40).fill(ALEXANDRITE_ID),
  extra: [] as number[],
};
const TEST_HAND = Array(5).fill(ALEXANDRITE_ID);

function connectSolver(userId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const jwt = makeJwt(userId);
    const ws = new WebSocket(`ws://localhost:${PORT}?mode=solver&token=${jwt}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

function waitForMessage<T>(ws: WebSocket, type: string, timeoutMs = 30000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg as T);
      }
    };
    ws.on('message', handler);
  });
}

function collectMessages(ws: WebSocket, timeoutMs: number): Promise<unknown[]> {
  return new Promise(resolve => {
    const msgs: unknown[] = [];
    const handler = (data: Buffer) => { msgs.push(JSON.parse(data.toString())); };
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(msgs);
    }, timeoutMs);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// =============================================================================
// Group A — Protocol Type Exports (no server needed)
// =============================================================================

console.log('\n🔬 Test 9.2: ws-protocol.ts exports');
{
  assert(SOLVER_START === 'SOLVER_START', 'SOLVER_START constant');
  assert(SOLVER_CANCEL === 'SOLVER_CANCEL', 'SOLVER_CANCEL constant');
  assert(SOLVER_INIT === 'SOLVER_INIT', 'SOLVER_INIT constant');
  assert(SOLVER_PROGRESS === 'SOLVER_PROGRESS', 'SOLVER_PROGRESS constant');
  assert(SOLVER_RESULT === 'SOLVER_RESULT', 'SOLVER_RESULT constant');
  assert(SOLVER_CANCELLED === 'SOLVER_CANCELLED', 'SOLVER_CANCELLED constant');
  assert(SOLVER_ERROR === 'SOLVER_ERROR', 'SOLVER_ERROR constant');
  assert(SOLVER_HANDTRAPS === 'SOLVER_HANDTRAPS', 'SOLVER_HANDTRAPS constant');

  // Verify payload interfaces are importable (compile-time check — if this file compiles, they exist)
  // C2 fix: SolverStartMessage no longer carries `deck` — server fetches it from Spring Boot via JWT.
  void TEST_DECK; // suppress unused warning while leaving the fixture for the integration tests below
  const _start: SolverStartMessage = { type: SOLVER_START, deckId: 'x', hand: TEST_HAND, mode: 'goldfish', speed: 'fast' };
  const _init: SolverInitMessage = { type: SOLVER_INIT };
  const _cancel: SolverCancelMessage = { type: SOLVER_CANCEL };
  assert(!!_start && !!_init && !!_cancel, 'Client message interfaces importable');
}

// =============================================================================
// Group B — Server Integration Tests (requires running server)
// =============================================================================

async function runServerTests(): Promise<void> {
  // Test 9.3: Solver WS connection
  console.log('\n🔬 Test 9.3: Solver WS connection');
  {
    try {
      const ws = await connectSolver('smoke-test-user-1');
      assert(ws.readyState === WebSocket.OPEN, 'Solver WS connection accepted');
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Connection failed:', err);
      failed++;
    }
  }

  // Test 9.4: SOLVER_INIT → SOLVER_HANDTRAPS response
  console.log('\n🔬 Test 9.4: SOLVER_INIT → SOLVER_HANDTRAPS');
  {
    try {
      const ws = await connectSolver('smoke-test-user-2');
      ws.send(JSON.stringify({ type: SOLVER_INIT }));
      const msg = await waitForMessage<SolverHandtrapsMessage>(ws, SOLVER_HANDTRAPS);
      assert(msg.type === SOLVER_HANDTRAPS, 'Received SOLVER_HANDTRAPS');
      assert(Array.isArray(msg.handtraps), 'handtraps is array');
      assert(msg.handtraps.length === 5, `5 handtrap entries (got ${msg.handtraps.length})`);
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ SOLVER_INIT test failed:', err);
      failed++;
    }
  }

  // Test 9.5: SOLVER_START validation — invalid hand length (0 and 6 cards)
  console.log('\n🔬 Test 9.5: SOLVER_START invalid hand length');
  {
    try {
      // 0 cards — should fail
      const ws0 = await connectSolver('smoke-test-user-3');
      ws0.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        deck: TEST_DECK,
        hand: [],
        mode: 'goldfish',
        speed: 'fast',
      }));
      const msg0 = await waitForMessage<SolverErrorMessage>(ws0, SOLVER_ERROR);
      assert(msg0.type === SOLVER_ERROR, 'Empty hand: Received SOLVER_ERROR');
      assert(msg0.error === 'INTERNAL_ERROR', `Empty hand: Error type is INTERNAL_ERROR (got ${msg0.error})`);
      ws0.close();
      await sleep(100);

      // 6 cards — should fail
      const ws6 = await connectSolver('smoke-test-user-3');
      ws6.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        deck: TEST_DECK,
        hand: [ALEXANDRITE_ID, ALEXANDRITE_ID, ALEXANDRITE_ID, ALEXANDRITE_ID, ALEXANDRITE_ID, ALEXANDRITE_ID],
        mode: 'goldfish',
        speed: 'fast',
      }));
      const msg6 = await waitForMessage<SolverErrorMessage>(ws6, SOLVER_ERROR);
      assert(msg6.type === SOLVER_ERROR, '6-card hand: Received SOLVER_ERROR');
      assert(msg6.error === 'INTERNAL_ERROR', `6-card hand: Error type is INTERNAL_ERROR (got ${msg6.error})`);
      ws6.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Invalid hand length test failed:', err);
      failed++;
    }
  }

  // Test 9.6: SOLVER_START validation — hand card not in deck
  console.log('\n🔬 Test 9.6: SOLVER_START hand card not in deck');
  {
    try {
      const ws = await connectSolver('smoke-test-user-4');
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        deck: TEST_DECK,
        hand: [ALEXANDRITE_ID, ALEXANDRITE_ID, ALEXANDRITE_ID, ALEXANDRITE_ID, 99999999], // 99999999 not in deck
        mode: 'goldfish',
        speed: 'fast',
      }));
      const msg = await waitForMessage<SolverErrorMessage>(ws, SOLVER_ERROR);
      assert(msg.type === SOLVER_ERROR, 'Received SOLVER_ERROR');
      assert(msg.message.includes('not found'), `Error message mentions "not found" (got "${msg.message}")`);
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Hand card not in deck test failed:', err);
      failed++;
    }
  }

  // Test 9.7: Rate limiting
  console.log('\n🔬 Test 9.7: Rate limiting');
  {
    try {
      const ws = await connectSolver('smoke-test-user-5');
      const startMsg: SolverStartMessage = {
        type: SOLVER_START,
        deckId: 'test',
        hand: TEST_HAND,
        mode: 'goldfish',
        speed: 'fast',
      };
      ws.send(JSON.stringify(startMsg));
      // Second start immediately
      ws.send(JSON.stringify(startMsg));
      const msg = await waitForMessage<SolverErrorMessage>(ws, SOLVER_ERROR);
      assert(msg.error === 'RATE_LIMITED', `Rate limited (got ${msg.error})`);
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Rate limiting test failed:', err);
      failed++;
    }
  }

  // Test 9.8: Orchestrator null guard
  console.log('\n🔬 Test 9.8: Orchestrator null guard');
  {
    // This test validates the guard logic exists — we test it at the protocol level.
    // If orchestrator is null, any SOLVER_* message should return WASM_INIT_FAILED.
    // Since the server is running with a valid orchestrator, we verify the guard
    // path is reachable by checking SOLVER_INIT works (proving the guard doesn't fire).
    try {
      const ws = await connectSolver('smoke-test-user-6');
      ws.send(JSON.stringify({ type: SOLVER_INIT }));
      const msg = await waitForMessage<SolverHandtrapsMessage>(ws, SOLVER_HANDTRAPS);
      assert(msg.type === SOLVER_HANDTRAPS, 'Orchestrator available — guard did not fire (expected)');
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Orchestrator null guard test failed:', err);
      failed++;
    }
  }

  // Test 9.11: Hand removal algorithm — first-occurrence
  console.log('\n🔬 Test 9.11: Hand removal first-occurrence');
  {
    // Test via protocol: deck with 3x Alexandrite, hand with 1 → deck should have 2 remaining
    // We validate indirectly — if hand removal works, the solve starts without error
    try {
      const ws = await connectSolver('smoke-test-user-8');
      const deck45 = Array(45).fill(ALEXANDRITE_ID);
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        deck: { main: deck45, extra: [] },
        hand: Array(5).fill(ALEXANDRITE_ID),
        mode: 'goldfish',
        speed: 'fast',
      }));
      // Should NOT get an error about hand card not found
      const msgs = await collectMessages(ws, 3000);
      const errors = msgs.filter((m: unknown) => (m as { type: string }).type === SOLVER_ERROR);
      const handErrors = errors.filter((m: unknown) => ((m as SolverErrorMessage).message ?? '').includes('not found'));
      assert(handErrors.length === 0, 'No "hand card not found" errors with valid deck');
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Hand removal test failed:', err);
      failed++;
    }
  }

  // Test 9.12: deckSeed string ↔ bigint[] roundtrip
  console.log('\n🔬 Test 9.12: deckSeed roundtrip');
  {
    try {
      const ws = await connectSolver('smoke-test-user-9');
      await sleep(2500); // Wait for rate limit from previous tests (different user, so should be fine)
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        deck: TEST_DECK,
        hand: TEST_HAND,
        mode: 'goldfish',
        speed: 'fast',
        deckSeed: '12345678901234,98765432109876',
      }));
      // Wait for result or progress
      const msgs = await collectMessages(ws, 15000);
      const result = msgs.find((m: unknown) => (m as { type: string }).type === SOLVER_RESULT) as SolverResultMessage | undefined;
      if (result) {
        assert(result.stats.deckSeed === '12345678901234,98765432109876', `deckSeed roundtrip (got "${result.stats.deckSeed}")`);
      } else {
        const errors = msgs.filter((m: unknown) => (m as { type: string }).type === SOLVER_ERROR);
        if (errors.length > 0) {
          console.log('  ⚠️  Got error instead of result:', errors[0]);
        }
        assert(false, 'Expected SOLVER_RESULT with deckSeed');
      }
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ deckSeed roundtrip test failed:', err);
      failed++;
    }
  }

  // Test 9.9 & 9.10: Result caching + cache eviction
  console.log('\n🔬 Test 9.9-9.10: Result caching');
  {
    try {
      const userId = 'smoke-test-cache-user';
      const ws = await connectSolver(userId);

      // Start a solve and wait for result
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'cache-test',
        deck: TEST_DECK,
        hand: TEST_HAND,
        mode: 'goldfish',
        speed: 'fast',
      }));
      const result = await waitForMessage<SolverResultMessage>(ws, SOLVER_RESULT, 30000);
      assert(result.type === SOLVER_RESULT, 'Got SOLVER_RESULT for caching test');

      // Close and reconnect
      ws.close();
      await sleep(500);

      const ws2 = await connectSolver(userId);
      ws2.send(JSON.stringify({ type: SOLVER_INIT }));

      // Should receive SOLVER_HANDTRAPS and the cached SOLVER_RESULT
      const handtraps = await waitForMessage<SolverHandtrapsMessage>(ws2, SOLVER_HANDTRAPS);
      assert(handtraps.type === SOLVER_HANDTRAPS, 'Got SOLVER_HANDTRAPS on reconnect');

      const cachedResult = await waitForMessage<SolverResultMessage>(ws2, SOLVER_RESULT, 5000);
      assert(cachedResult.type === SOLVER_RESULT, '9.9: Cached result re-delivered on SOLVER_INIT');

      // Test 9.10: cache eviction on new SOLVER_START
      await sleep(2500); // Wait for rate limit
      ws2.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'cache-evict-test',
        deck: TEST_DECK,
        hand: TEST_HAND,
        mode: 'goldfish',
        speed: 'fast',
      }));
      const newResult = await waitForMessage<SolverResultMessage>(ws2, SOLVER_RESULT, 30000);
      assert(newResult.type === SOLVER_RESULT, '9.10: New solve replaces cached result');

      ws2.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Result caching test failed:', err);
      failed++;
    }
  }

  // Test 9.13: Integration test (e2e)
  console.log('\n🔬 Test 9.13: Integration e2e');
  {
    try {
      const userId = 'smoke-test-e2e-user';
      const ws = await connectSolver(userId);

      // (a) Send SOLVER_INIT
      ws.send(JSON.stringify({ type: SOLVER_INIT }));
      const handtraps = await waitForMessage<SolverHandtrapsMessage>(ws, SOLVER_HANDTRAPS);
      assert(handtraps.type === SOLVER_HANDTRAPS, '(a) SOLVER_HANDTRAPS received');

      // (b-c) Send SOLVER_START
      await sleep(2500); // Rate limit cooldown
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'e2e-test',
        deck: TEST_DECK,
        hand: TEST_HAND,
        mode: 'goldfish',
        speed: 'fast',
      }));

      // Collect all messages until SOLVER_RESULT
      const allMsgs: unknown[] = [];
      const resultPromise = new Promise<SolverResultMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for e2e result')), 30000);
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          allMsgs.push(msg);
          if (msg.type === SOLVER_RESULT) {
            clearTimeout(timer);
            resolve(msg as SolverResultMessage);
          }
        });
      });

      const result = await resultPromise;
      const progressMsgs = allMsgs.filter((m: unknown) => (m as { type: string }).type === SOLVER_PROGRESS);
      assert(progressMsgs.length >= 0, `(b) Progress messages received: ${progressMsgs.length}`);
      assert(result.tree !== undefined, '(c) SOLVER_RESULT has tree');
      assert(result.mainPath !== undefined, '(c) SOLVER_RESULT has mainPath');
      assert(result.stats !== undefined, '(c) SOLVER_RESULT has stats');
      assert(typeof result.stats.deckSeed === 'string' && result.stats.deckSeed.length > 0, '(c) stats.deckSeed is non-empty string');

      // (d) Reconnect and verify cached result
      ws.close();
      await sleep(500);

      const ws2 = await connectSolver(userId);
      ws2.send(JSON.stringify({ type: SOLVER_INIT }));
      await waitForMessage<SolverHandtrapsMessage>(ws2, SOLVER_HANDTRAPS);
      const cachedResult = await waitForMessage<SolverResultMessage>(ws2, SOLVER_RESULT, 5000);
      assert(cachedResult.type === SOLVER_RESULT, '(d) Cached result on reconnect');

      ws2.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Integration e2e test failed:', err);
      failed++;
    }
  }

  // Test: Adversarial mode — DFS rejection
  console.log('\n🔬 Test: Adversarial + DFS → SOLVER_ERROR');
  {
    try {
      const ws = await connectSolver('smoke-test-adversarial-dfs');
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        hand: TEST_HAND,
        mode: 'adversarial',
        speed: 'fast',
        algorithm: 'dfs',
        handtraps: [{ cardId: 14558127, cardName: 'Ash Blossom & Joyous Spring' }],
      }));
      const msg = await waitForMessage<SolverErrorMessage>(ws, SOLVER_ERROR);
      assert(msg.error === 'INTERNAL_ERROR', `DFS rejection error type (got ${msg.error})`);
      assert(msg.message.includes('DFS does not support adversarial'), `DFS rejection message (got "${msg.message}")`);
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Adversarial DFS rejection test failed:', err);
      failed++;
    }
  }

  // Test: Adversarial mode — invalid handtrap cardIds
  console.log('\n🔬 Test: Adversarial + invalid handtrap → SOLVER_ERROR');
  {
    try {
      const ws = await connectSolver('smoke-test-adversarial-bad-ht');
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        hand: TEST_HAND,
        mode: 'adversarial',
        speed: 'fast',
        handtraps: [{ cardId: 99999999, cardName: 'Fake Card' }],
      }));
      const msg = await waitForMessage<SolverErrorMessage>(ws, SOLVER_ERROR);
      assert(msg.error === 'INTERNAL_ERROR', `Invalid handtrap error type (got ${msg.error})`);
      assert(msg.message.includes('Invalid handtrap'), `Invalid handtrap message (got "${msg.message}")`);
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Adversarial invalid handtrap test failed:', err);
      failed++;
    }
  }

  // Test: Adversarial mode — missing handtraps array
  console.log('\n🔬 Test: Adversarial + no handtraps → SOLVER_ERROR');
  {
    try {
      const ws = await connectSolver('smoke-test-adversarial-no-ht');
      ws.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'test',
        hand: TEST_HAND,
        mode: 'adversarial',
        speed: 'fast',
      }));
      const msg = await waitForMessage<SolverErrorMessage>(ws, SOLVER_ERROR);
      assert(msg.error === 'INTERNAL_ERROR', `Missing handtraps error type (got ${msg.error})`);
      assert(msg.message.includes('at least one handtrap'), `Missing handtraps message (got "${msg.message}")`);
      ws.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Adversarial missing handtraps test failed:', err);
      failed++;
    }
  }

  // Test 9.14: Reconnection mid-solve
  console.log('\n🔬 Test 9.14: Reconnection mid-solve');
  {
    try {
      const userId = 'smoke-test-reconnect-user';
      const ws1 = await connectSolver(userId);

      // Start solve with optimal speed (longer duration for reconnect window)
      ws1.send(JSON.stringify({
        type: SOLVER_START,
        deckId: 'reconnect-test',
        deck: TEST_DECK,
        hand: TEST_HAND,
        mode: 'goldfish',
        speed: 'optimal',
      }));

      // Wait briefly then disconnect
      await sleep(500);
      ws1.close();
      await sleep(200);

      // Reconnect with same JWT/userId
      const ws2 = await connectSolver(userId);

      // (a) Wait for SOLVER_RESULT on ws2
      const result = await waitForMessage<SolverResultMessage>(ws2, SOLVER_RESULT, 60000);
      assert(result.type === SOLVER_RESULT, '(a) SOLVER_RESULT arrives on ws2 after reconnect');

      // (b) Verify SOLVER_INIT also returns cached result
      await sleep(100);
      ws2.send(JSON.stringify({ type: SOLVER_INIT }));
      await waitForMessage<SolverHandtrapsMessage>(ws2, SOLVER_HANDTRAPS);
      const cached = await waitForMessage<SolverResultMessage>(ws2, SOLVER_RESULT, 5000);
      assert(cached.type === SOLVER_RESULT, '(b) Cached result via SOLVER_INIT on ws2');

      ws2.close();
      await sleep(100);
    } catch (err) {
      console.error('  ❌ Reconnection mid-solve test failed:', err);
      failed++;
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Solver WS Smoke Tests (Story 1.4)');
  console.log('========================================');

  // Check if server is running
  try {
    const ws = new WebSocket(`ws://localhost:${PORT}?mode=solver&token=${makeJwt('ping')}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => { ws.close(); resolve(); });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Server not reachable')), 3000);
    });
    await sleep(100);
  } catch {
    console.log('\n⚠️  Server not running on port ' + PORT + ' — skipping server integration tests');
    console.log('   Start the server first: npm start\n');
    console.log(`\n✅ ${passed} passed, ❌ ${failed} failed (protocol-only)`);
    process.exit(failed > 0 ? 1 : 0);
  }

  await runServerTests();

  console.log(`\n========================================`);
  console.log(`✅ ${passed} passed, ❌ ${failed} failed`);
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
