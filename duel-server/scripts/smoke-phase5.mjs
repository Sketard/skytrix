// Smoke validation script for Phase 5 (DuelSessionManager) + M3 + M4.
// Exercises the WS handshake / reconnect / token-rotation paths via direct
// WebSocket connections, no browser. Assumes: Spring Boot :8080, duel-server :3001.

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
