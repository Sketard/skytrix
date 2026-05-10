// Smoke validation script for Phase 5 (DuelSessionManager) + M3 + M4.
// Exercises:
//   - M3+M4 : protocol-version mismatch (close 4426, counter increment)
//   - S1e   : pending token consumed twice (initial handshake)
//   - S1b   : reconnect with rotating SESSION_TOKEN
//   - S1c   : stale reconnect token rejected
//   - S2    : RPS phase + winner picks turn order (C8 audit closure)
//   - S3    : REMATCH after surrender → REMATCH_STARTING (C8)
//   - S4    : admin DELETE auth + 401/404/200/idempotency (C8)
// All paths via direct WebSocket connections, no browser.
// Assumes: Spring Boot :8080, duel-server :3001.

import WebSocket from 'ws';

const BACK_URL = 'http://localhost:8080';
const WS_URL = 'ws://localhost:3001';
const USERNAME = 'admin';
const PASSWORD = 'admin';
const DECK_P1 = 19;
const DECK_P2 = 20;

let pass = 0;
let fail = 0;
const failures = [];

function ok(label) { pass++; console.log(`  ✓ ${label}`); }
function ko(label, detail) { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}\n      ${detail}`); }

async function login() {
  const auth = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  const res = await fetch(`${BACK_URL}/api/login`, { method: 'POST', headers: { Authorization: auth } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  const m = setCookie.match(/Access=([^;]+)/);
  return `Access=${m[1]}`;
}

async function createDuel(cookie) {
  const res = await fetch(`${BACK_URL}/api/rooms/quick-duel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ decklistId1: DECK_P1, decklistId2: DECK_P2, firstPlayer: 0, skipShuffle: true, turnTimeSecs: 300 })
  });
  if (res.status !== 200) throw new Error(`quick-duel failed: ${res.status}`);
  return await res.json();
}

/**
 * Connect a WS, return a controller with helpers:
 *  - msgs: array of received messages
 *  - sendType(type, extra): JSON-stringify and send
 *  - waitFor(predicate, timeoutMs): resolve with first matching msg
 *  - waitClose(timeoutMs): resolve with { code, reason }
 *  - close(): manual close
 */
function connectWs(url, label) {
  const ws = new WebSocket(url);
  const msgs = [];
  let closeInfo = null;
  const closeWaiters = [];
  const msgWaiters = [];

  ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      msgs.push(m);
      for (let i = msgWaiters.length - 1; i >= 0; i--) {
        if (msgWaiters[i].pred(m)) {
          msgWaiters[i].resolve(m);
          msgWaiters.splice(i, 1);
        }
      }
    } catch { /* ignore */ }
  });

  ws.on('close', (code, reason) => {
    closeInfo = { code, reason: reason.toString() };
    for (const w of closeWaiters) w.resolve(closeInfo);
    closeWaiters.length = 0;
  });

  ws.on('error', () => { /* swallow — we observe via close */ });

  return {
    ws, msgs, label,
    open: () => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`open timeout ${label}`)), 5000);
      ws.once('open', () => { clearTimeout(t); resolve(); });
      ws.once('close', (code, reason) => {
        clearTimeout(t);
        reject(new Error(`closed before open: ${code} ${reason.toString()}`));
      });
    }),
    sendType: (type, extra = {}) => ws.send(JSON.stringify({ type, ...extra })),
    waitFor: (pred, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const found = msgs.find(pred);
      if (found) return resolve(found);
      const t = setTimeout(() => reject(new Error(`waitFor timeout ${label}`)), timeoutMs);
      msgWaiters.push({ pred, resolve: m => { clearTimeout(t); resolve(m); } });
    }),
    waitClose: (timeoutMs = 5000) => new Promise((resolve, reject) => {
      if (closeInfo) return resolve(closeInfo);
      const t = setTimeout(() => reject(new Error(`waitClose timeout ${label}`)), timeoutMs);
      closeWaiters.push({ resolve: c => { clearTimeout(t); resolve(c); } });
    }),
    close: () => ws.close(),
    closeInfo: () => closeInfo,
  };
}

async function getStatus() {
  const r = await fetch('http://localhost:3001/status');
  return await r.json();
}

// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== M3: protocolMismatchCount baseline ===');
const startStatus = await getStatus();
console.log('  baseline counter =', startStatus.protocolMismatchCount);

console.log('\n=== M3+M4: pv mismatch increments counter for both pvp+solver ===');
{
  const before = (await getStatus()).protocolMismatchCount;
  const c1 = connectWs(`${WS_URL}/ws?token=fake-mismatch-test&pv=99`, 'pvp-pv99');
  await c1.open().catch(() => {});
  const ci1 = await c1.waitClose(2000);
  if (ci1.code === 4426) ok('pvp pv=99 → close 4426');
  else ko('pvp pv=99 → close 4426', `got code=${ci1.code} reason=${ci1.reason}`);

  const c2 = connectWs(`${WS_URL}/ws?mode=solver&token=fake-mismatch-test&pv=99`, 'solver-pv99');
  await c2.open().catch(() => {});
  const ci2 = await c2.waitClose(2000);
  if (ci2.code === 4426) ok('solver pv=99 → close 4426');
  else ko('solver pv=99 → close 4426', `got code=${ci2.code} reason=${ci2.reason}`);

  await new Promise(r => setTimeout(r, 200));
  const after = (await getStatus()).protocolMismatchCount;
  if (after >= before + 2) ok(`counter incremented by 2+ (${before} → ${after})`);
  else ko('counter incremented by 2+', `before=${before} after=${after}`);
}

console.log('\n=== Login + create duel ===');
const cookie = await login();
ok('Spring Boot login');
const duel = await createDuel(cookie);
ok(`Quick-duel created: room=${duel.roomCode} tokens issued`);

// ─── S1e: token consommé puis re-handshake initial ───────────────────────────
console.log('\n=== S1e: pending token consumed twice (initial handshake) ===');
{
  const c1 = connectWs(`${WS_URL}/ws?token=${duel.wsToken1}&pv=1`, 'first-handshake');
  await c1.open();
  ok('first handshake with wsToken1 → open');
  // Wait for the Player connected log via /status (activeDuels=1 means session is wired)
  const status = await getStatus();
  if (status.activeDuels >= 1) ok(`activeDuels >= 1 (${status.activeDuels})`);
  else ko('activeDuels >= 1', `got ${status.activeDuels}`);

  // Try to reuse the SAME wsToken1 → must be rejected as 4001
  const c1bis = connectWs(`${WS_URL}/ws?token=${duel.wsToken1}&pv=1`, 'second-handshake');
  await c1bis.open().catch(() => {});
  const ci = await c1bis.waitClose(2000);
  if (ci.code === 4001) ok(`reused pending token → close 4001 (${ci.reason})`);
  else ko('reused pending token → close 4001', `got code=${ci.code} reason=${ci.reason}`);

  // S1f — totally unknown token → also 4001 (token-unknown branch)
  const cBogus = connectWs(`${WS_URL}/ws?token=00000000-0000-0000-0000-000000000000&pv=1`, 'bogus-token');
  await cBogus.open().catch(() => {});
  const ciB = await cBogus.waitClose(2000);
  if (ciB.code === 4001) ok(`bogus token → close 4001 (${ciB.reason})`);
  else ko('bogus token → close 4001', `got code=${ciB.code} reason=${ciB.reason}`);

  // Open the second player WS to start the duel proper
  const c2 = connectWs(`${WS_URL}/ws?token=${duel.wsToken2}&pv=1`, 'second-player');
  await c2.open();
  ok('second handshake with wsToken2 → open');

  // Wait for SESSION_TOKEN on both sides (issued post-handshake) for reconnect
  const tok1 = await c1.waitFor(m => m.type === 'SESSION_TOKEN', 5000);
  const tok2 = await c2.waitFor(m => m.type === 'SESSION_TOKEN', 5000);
  if (tok1?.token && tok2?.token) ok('SESSION_TOKEN issued on both sides');
  else ko('SESSION_TOKEN issued on both sides', `tok1=${JSON.stringify(tok1)} tok2=${JSON.stringify(tok2)}`);

  // ─── S1b: reconnect via reconnect token ───
  console.log('\n=== S1b: reconnect with reconnect token (mid-init) ===');
  c1.close();
  await c1.waitClose(2000);
  // Brief delay so server sees disconnect before we reconnect
  await new Promise(r => setTimeout(r, 300));
  const cRec = connectWs(`${WS_URL}/ws?reconnect=${tok1.token}&pv=1`, 'reconnect-1');
  await cRec.open();
  ok('reconnect with valid token → open');
  // After reconnect, server should emit a NEW SESSION_TOKEN (rotation)
  const tok1bis = await cRec.waitFor(m => m.type === 'SESSION_TOKEN', 5000);
  if (tok1bis?.token && tok1bis.token !== tok1.token) ok(`reconnect token rotated (${tok1.token.slice(0, 8)}… → ${tok1bis.token.slice(0, 8)}…)`);
  else if (tok1bis?.token === tok1.token) ko('reconnect token rotated', 'token unchanged after reconnect');
  else ko('reconnect token rotated', `no new SESSION_TOKEN: ${JSON.stringify(tok1bis)}`);

  // ─── S1c: old reconnect token must now be rejected ───
  console.log('\n=== S1c: stale reconnect token rejected ===');
  const cStale = connectWs(`${WS_URL}/ws?reconnect=${tok1.token}&pv=1`, 'stale-reconnect');
  await cStale.open().catch(() => {});
  const ciStale = await cStale.waitClose(2000);
  if (ciStale.code === 4001) ok(`stale reconnect token → close 4001 (${ciStale.reason})`);
  else ko('stale reconnect token → close 4001', `got code=${ciStale.code} reason=${ciStale.reason}`);

  // Cleanup: terminate the duel
  cRec.close();
  c2.close();
  await new Promise(r => setTimeout(r, 500));

  // Try to delete the duel cleanly
  try {
    const internalKey = 'dev-internal-key';
    const delRes = await fetch(`http://localhost:3001/api/duels/${duel.roomCode}`, {
      method: 'DELETE',
      headers: { 'X-Internal-Key': internalKey }
    });
    if (delRes.status === 200 || delRes.status === 404) ok('duel cleanup');
    else ko('duel cleanup', `DELETE returned ${delRes.status}`);
  } catch (e) { ko('duel cleanup', e.message); }
}

// ─── S2: RPS + SELECT_TP happy path ─────────────────────────────────────────
console.log('\n=== S2: RPS phase + winner picks turn order ===');
{
  // Fresh duel — RPS state requires the session to be in 'RPS' phase, which
  // only happens after BOTH WS handshakes complete on a freshly-created session.
  const duel2 = await createDuel(cookie);
  const cA = connectWs(`${WS_URL}/ws?token=${duel2.wsToken1}&pv=1`, 's2-p0');
  const cB = connectWs(`${WS_URL}/ws?token=${duel2.wsToken2}&pv=1`, 's2-p1');
  await Promise.all([cA.open(), cB.open()]);

  // Both players receive RPS_CHOICE prompts (player-scoped) once the second
  // handshake completes. We wait for the prompt rather than send blindly —
  // the server emits AFTER both handshakes register session.phase = 'RPS'.
  const rpsP0 = await cA.waitFor(m => m.type === 'RPS_CHOICE', 5000).catch(() => null);
  const rpsP1 = await cB.waitFor(m => m.type === 'RPS_CHOICE', 5000).catch(() => null);
  if (rpsP0 && rpsP1) ok('both players received RPS_CHOICE');
  else ko('both players received RPS_CHOICE', `p0=${JSON.stringify(rpsP0)} p1=${JSON.stringify(rpsP1)}`);

  // Send choices: P0=Rock(0), P1=Scissors(2) → P0 wins (Rock crushes Scissors).
  cA.sendType('PLAYER_RESPONSE', { promptType: 'RPS_CHOICE', data: { choice: 0 } });
  cB.sendType('PLAYER_RESPONSE', { promptType: 'RPS_CHOICE', data: { choice: 2 } });

  // Both clients receive RPS_RESULT after server resolves.
  const rpsResultA = await cA.waitFor(m => m.type === 'RPS_RESULT', 5000).catch(() => null);
  const rpsResultB = await cB.waitFor(m => m.type === 'RPS_RESULT', 5000).catch(() => null);
  if (rpsResultA?.winner === 0 && rpsResultB?.winner === 0) ok('RPS_RESULT winner=0 (Rock vs Scissors)');
  else ko('RPS_RESULT winner=0 (Rock vs Scissors)', `A=${JSON.stringify(rpsResultA)} B=${JSON.stringify(rpsResultB)}`);

  // Winner (P0) gets SELECT_TP after a 1.5s delay.
  // (We don't assert WAITING_RESPONSE on P1 — the RPS phase itself emits
  // WAITING_RESPONSE messages already, so a waitFor would match noise.)
  const tpPrompt = await cA.waitFor(m => m.type === 'SELECT_TP', 4000).catch(() => null);
  if (tpPrompt?.player === 0) ok('winner received SELECT_TP');
  else ko('winner received SELECT_TP', `got ${JSON.stringify(tpPrompt)}`);

  // P0 chooses goFirst=true → both get TP_RESULT.
  cA.sendType('PLAYER_RESPONSE', { promptType: 'SELECT_TP', data: { goFirst: true } });
  const tpResA = await cA.waitFor(m => m.type === 'TP_RESULT', 4000).catch(() => null);
  const tpResB = await cB.waitFor(m => m.type === 'TP_RESULT', 4000).catch(() => null);
  if (tpResA?.goFirst === true && tpResB?.goFirst === false) ok('TP_RESULT: P0=goFirst, P1=goSecond (perspective-correct)');
  else ko('TP_RESULT perspective', `A=${JSON.stringify(tpResA)} B=${JSON.stringify(tpResB)}`);

  cA.close(); cB.close();
  await new Promise(r => setTimeout(r, 300));
  await fetch(`http://localhost:3001/api/duels/${duel2.roomCode}`, {
    method: 'DELETE', headers: { 'X-Internal-Key': 'dev-internal-key' }
  }).catch(() => {});
}

// ─── S3: REMATCH happy path (surrender → both REMATCH_REQUEST → REMATCH_STARTING) ─
console.log('\n=== S3: REMATCH after surrender → REMATCH_STARTING ===');
{
  const duel3 = await createDuel(cookie);
  const cA = connectWs(`${WS_URL}/ws?token=${duel3.wsToken1}&pv=1`, 's3-p0');
  const cB = connectWs(`${WS_URL}/ws?token=${duel3.wsToken2}&pv=1`, 's3-p1');
  await Promise.all([cA.open(), cB.open()]);

  // Resolve RPS quickly so the duel reaches the 'PLAYING' state where SURRENDER
  // is meaningful (REMATCH_REQUEST is gated on `endedAt !== null`).
  await Promise.all([
    cA.waitFor(m => m.type === 'RPS_CHOICE', 5000),
    cB.waitFor(m => m.type === 'RPS_CHOICE', 5000),
  ]);
  cA.sendType('PLAYER_RESPONSE', { promptType: 'RPS_CHOICE', data: { choice: 0 } });
  cB.sendType('PLAYER_RESPONSE', { promptType: 'RPS_CHOICE', data: { choice: 2 } });
  await cA.waitFor(m => m.type === 'SELECT_TP', 5000).catch(() => null);
  cA.sendType('PLAYER_RESPONSE', { promptType: 'SELECT_TP', data: { goFirst: true } });
  await Promise.all([
    cA.waitFor(m => m.type === 'TP_RESULT', 5000).catch(() => null),
    cB.waitFor(m => m.type === 'TP_RESULT', 5000).catch(() => null),
  ]);

  // Wait a beat for the worker to spin up + send DUEL_STARTING + initial BOARD_STATE.
  // The worker boot is what makes endedAt observable — surrender BEFORE worker
  // ready races with the worker handshake, so guard with DUEL_STARTING.
  const duelStartingA = await cA.waitFor(m => m.type === 'DUEL_STARTING', 10000).catch(() => null);
  if (duelStartingA) ok('DUEL_STARTING received post-TP (worker booted)');
  else ko('DUEL_STARTING received post-TP', 'worker did not signal start within 10s');

  // P0 surrenders → both clients get DUEL_END with reason='surrender'.
  cA.sendType('SURRENDER');
  const endA = await cA.waitFor(m => m.type === 'DUEL_END' && m.reason === 'surrender', 5000).catch(() => null);
  const endB = await cB.waitFor(m => m.type === 'DUEL_END' && m.reason === 'surrender', 5000).catch(() => null);
  if (endA && endB) ok('DUEL_END(surrender) received on both sides');
  else ko('DUEL_END(surrender) received on both sides', `A=${!!endA} B=${!!endB}`);

  // P0 requests rematch → P1 receives REMATCH_INVITATION.
  cA.sendType('REMATCH_REQUEST');
  const inviteB = await cB.waitFor(m => m.type === 'REMATCH_INVITATION', 5000).catch(() => null);
  if (inviteB) ok('opponent received REMATCH_INVITATION');
  else ko('opponent received REMATCH_INVITATION', 'no message within 5s');

  // P1 accepts → both receive REMATCH_STARTING.
  cB.sendType('REMATCH_REQUEST');
  const startA = await cA.waitFor(m => m.type === 'REMATCH_STARTING', 5000).catch(() => null);
  const startB = await cB.waitFor(m => m.type === 'REMATCH_STARTING', 5000).catch(() => null);
  if (startA && startB) ok('REMATCH_STARTING received on both sides');
  else ko('REMATCH_STARTING received on both sides', `A=${!!startA} B=${!!startB}`);

  cA.close(); cB.close();
  await new Promise(r => setTimeout(r, 500));
  await fetch(`http://localhost:3001/api/duels/${duel3.roomCode}`, {
    method: 'DELETE', headers: { 'X-Internal-Key': 'dev-internal-key' }
  }).catch(() => {});
}

// ─── S4: Admin DELETE auth + error cases ────────────────────────────────────
console.log('\n=== S4: admin DELETE /api/duels/:id auth + error cases ===');
{
  // S4a — missing X-Internal-Key → 401
  const noKey = await fetch('http://localhost:3001/api/duels/any-id', { method: 'DELETE' });
  if (noKey.status === 401) ok('DELETE without X-Internal-Key → 401');
  else ko('DELETE without X-Internal-Key → 401', `got ${noKey.status}`);

  // S4b — wrong key → 401 (timing-safe compare)
  const wrongKey = await fetch('http://localhost:3001/api/duels/any-id', {
    method: 'DELETE', headers: { 'X-Internal-Key': 'wrong-key' }
  });
  if (wrongKey.status === 401) ok('DELETE with wrong key → 401');
  else ko('DELETE with wrong key → 401', `got ${wrongKey.status}`);

  // S4c — wrong key of CORRECT length → still 401 (real timing-safe path,
  // not just length-mismatch fast-path).
  const validLengthKey = 'X'.repeat('dev-internal-key'.length);
  const wrongValidLen = await fetch('http://localhost:3001/api/duels/any-id', {
    method: 'DELETE', headers: { 'X-Internal-Key': validLengthKey }
  });
  if (wrongValidLen.status === 401) ok('DELETE with same-length wrong key → 401 (timing-safe)');
  else ko('DELETE with same-length wrong key → 401', `got ${wrongValidLen.status}`);

  // S4d — valid key but unknown duelId → 404 (auth passes, lookup fails)
  const unknown = await fetch('http://localhost:3001/api/duels/00000000-deadbeef', {
    method: 'DELETE', headers: { 'X-Internal-Key': 'dev-internal-key' }
  });
  if (unknown.status === 404) ok('DELETE unknown duelId → 404');
  else ko('DELETE unknown duelId → 404', `got ${unknown.status}`);

  // S4e — valid key + valid duelId → 200 + idempotency: second DELETE → 404
  const duel4 = await createDuel(cookie);
  // No need to open WS sockets — POST /api/duels created the session via
  // Spring Boot, sessionManager.get(roomCode) finds it directly.
  const ok200 = await fetch(`http://localhost:3001/api/duels/${duel4.roomCode}`, {
    method: 'DELETE', headers: { 'X-Internal-Key': 'dev-internal-key' }
  });
  if (ok200.status === 200) ok('DELETE valid duel → 200');
  else ko('DELETE valid duel → 200', `got ${ok200.status}`);

  const ok200bis = await fetch(`http://localhost:3001/api/duels/${duel4.roomCode}`, {
    method: 'DELETE', headers: { 'X-Internal-Key': 'dev-internal-key' }
  });
  if (ok200bis.status === 404) ok('repeated DELETE → 404 (idempotency contract)');
  else ko('repeated DELETE → 404', `got ${ok200bis.status}`);
}

// ─── M3: counter still tracks correctly ───
console.log('\n=== Final counter check ===');
const finalStatus = await getStatus();
console.log(`  protocolMismatchCount = ${finalStatus.protocolMismatchCount}`);
console.log(`  activeDuels = ${finalStatus.activeDuels} (should be 0 post-cleanup)`);

console.log('\n=== Summary ===');
console.log(`  passed: ${pass}`);
console.log(`  failed: ${fail}`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.label}: ${f.detail}`);
}
process.exit(fail === 0 ? 0 : 1);
