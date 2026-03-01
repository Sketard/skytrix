/**
 * Duel Server — Docker Container Integration Tests
 *
 * Prerequisites:
 *   - Duel server must be running (via docker-compose or locally)
 *   - Data volume must be mounted with cards.cdb + scripts_full/
 *   - Server must pass /health check before running tests
 *
 * Usage:
 *   npm run test:integration
 *   DUEL_SERVER_URL=http://host:port npm run test:integration
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = one or more tests failed
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const BASE_URL = process.env['DUEL_SERVER_URL'] ?? 'http://localhost:3001';
const WS_URL = BASE_URL.replace(/^http/, 'ws');

// ---------------------------------------------------------------------------
// Test deck — same as poc-duel.ts (34 cards, Level 4 normals + staples)
// ---------------------------------------------------------------------------

const TEST_DECK = {
  main: [
    38232082, 38232082, 38232082, // Alexandrite Dragon
    69247929, 69247929, 69247929, // Gene-Warped Warwolf
    6368038, 6368038, 6368038,   // Mystical Space Typhoon
    83764718, 83764718, 83764718, // Monster Reborn
    5318639, 5318639, 5318639,   // Pot of Greed
    44095762, 44095762, 44095762, // Mirror Force
    4031928, 4031928, 4031928,   // Swords of Revealing Light
    64788463, 64788463, 64788463, // Luster Dragon
    66788016, 66788016, 66788016, // Vorse Raider
    76184692, 76184692, 76184692, // Mechanicalchaser
    55144522, 55144522, 55144522, // Insect Knight
    85309439,                      // Luster Dragon #2
  ],
  extra: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ServerMsg {
  type: string;
  [key: string]: unknown;
}

function connectWs(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: ServerMsg) => boolean, timeoutMs = 30_000): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for message (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(data: WebSocket.Data) {
      const msg: ServerMsg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    }

    ws.on('message', handler);
  });
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise(resolve => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.on('close', () => resolve());
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Duel Server Integration Tests', { timeout: 30_000 }, () => {

  it('GET /health returns 200 with { status: "ok" }', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string };
    assert.equal(body.status, 'ok');
  });

  it('GET /status returns valid JSON with expected fields', async () => {
    const res = await fetch(`${BASE_URL}/status`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(typeof body.activeDuels, 'number');
    assert.equal(typeof body.totalDuelsServed, 'number');
    assert.equal(typeof body.uptimeMs, 'number');
    assert.equal(typeof body.memoryUsageMb, 'number');
  });

  it('WebSocket connection can be established on the server port', async () => {
    const ws = new WebSocket(WS_URL);
    // Verify the WS connection opens (HTTP upgrade succeeds)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    // Without a valid token, server closes with 4001 — proves WS is listening and validates
    const code = await new Promise<number>(resolve => {
      ws.on('close', (code) => resolve(code));
    });
    assert.equal(code, 4001, 'Server should reject connection without valid token');
  });

  it('Minimal duel lifecycle: create → RPS → BOARD_STATE → surrender → DUEL_END', async () => {
    // 1. Create duel via HTTP
    const createRes = await fetch(`${BASE_URL}/api/duels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player1: { id: 'test-p1', deck: TEST_DECK },
        player2: { id: 'test-p2', deck: TEST_DECK },
      }),
    });

    assert.equal(createRes.status, 201);
    const { duelId, tokens } = await createRes.json() as { duelId: string; tokens: [string, string] };
    assert.ok(duelId, 'duelId should be present');
    assert.equal(tokens.length, 2, 'should have 2 tokens');

    // 2. Connect both players — set up listeners immediately to avoid race condition
    //    (SESSION_TOKEN may arrive before waitForMessage is called if we await between connect and listen)
    const ws0 = await connectWs(tokens[0]);
    const session0Promise = waitForMessage(ws0, m => m.type === 'SESSION_TOKEN');

    const ws1 = await connectWs(tokens[1]);
    const session1Promise = waitForMessage(ws1, m => m.type === 'SESSION_TOKEN');

    try {
      // 3. Both should receive SESSION_TOKEN
      const session0 = await session0Promise;
      assert.ok(session0, 'Player 0 should receive SESSION_TOKEN');

      const session1 = await session1Promise;
      assert.ok(session1, 'Player 1 should receive SESSION_TOKEN');

      // 4. Handle RPS flow (may require multiple rounds if tie)
      let boardStateReceived = false;
      let rpsRounds = 0;
      const MAX_RPS_ROUNDS = 5;

      while (!boardStateReceived && rpsRounds < MAX_RPS_ROUNDS) {
        rpsRounds++;

        // Player 0 gets RPS_CHOICE prompt (OCGCore asks player 0 first)
        await waitForMessage(ws0, m => m.type === 'RPS_CHOICE');
        ws0.send(JSON.stringify({
          type: 'PLAYER_RESPONSE',
          promptType: 'RPS_CHOICE',
          data: { choice: 2 }, // Rock
        }));

        // Player 1 gets RPS_CHOICE prompt
        await waitForMessage(ws1, m => m.type === 'RPS_CHOICE');
        ws1.send(JSON.stringify({
          type: 'PLAYER_RESPONSE',
          promptType: 'RPS_CHOICE',
          data: { choice: 1 }, // Scissors — player 0 should win
        }));

        // Wait for BOARD_STATE with LP > 0 (duel started, hands drawn)
        // After RPS, OCGCore runs draw phase automatically
        try {
          await waitForMessage(ws0, m => {
            if (m.type !== 'BOARD_STATE') return false;
            const players = (m.data as any)?.players;
            if (!players?.[0]?.lp || !players?.[1]?.lp) return false;
            return players[0].lp > 0 && players[1].lp > 0;
          }, 10_000);
          boardStateReceived = true;
        } catch {
          // RPS might have been a tie (shouldn't happen with Rock vs Scissors)
          // or OCGCore hasn't reached BOARD_STATE yet — retry
        }
      }

      assert.ok(boardStateReceived, `BOARD_STATE with LP > 0 should be received within ${MAX_RPS_ROUNDS} RPS rounds`);

      // 5. Player 0 surrenders
      ws0.send(JSON.stringify({ type: 'SURRENDER' }));

      // 6. Both should receive DUEL_END
      const end0 = await waitForMessage(ws0, m => m.type === 'DUEL_END');
      assert.equal(end0.reason, 'surrender');

      const end1 = await waitForMessage(ws1, m => m.type === 'DUEL_END');
      assert.equal(end1.reason, 'surrender');
    } finally {
      // 7. Cleanup
      await closeWs(ws0);
      await closeWs(ws1);
    }
  });

});
