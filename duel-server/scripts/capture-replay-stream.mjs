// Diagnostic one-shot (F10 investigation 2026-06-12) — connect to the
// duel-server replay WS endpoint, capture the full precompute stream
// (REPLAY_STREAM_CHUNK messages + REPLAY_STREAM_INIT navIndex), dump to
// stdout as JSON. No browser involved — this is the server-side wire,
// byte-identical to what MockDuelConnection consumes.
//
// Usage: node scripts/capture-replay-stream.mjs <replayId> [wsBase]
//   wsBase default: ws://localhost:13001
//
// Auth note: the duel-server replay handler base64-decodes the JWT middle
// segment without signature verification (authorization happens against
// the replay's playerIds fetched from Spring). A locally crafted token
// with the right `sub` is sufficient against the ISOLATED dev stack.

import { WebSocket } from 'ws';

const replayId = process.argv[2];
const wsBase = process.argv[3] ?? 'ws://localhost:13001';
if (!replayId) {
  console.error('usage: node capture-replay-stream.mjs <replayId> [wsBase]');
  process.exit(1);
}

const fakeJwt = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: '1' })).toString('base64url'),
  'x',
].join('.');

const url = `${wsBase}/?mode=replay&replayId=${replayId}&token=${fakeJwt}&pv=2`;
const ws = new WebSocket(url);

const out = { metadata: null, chunks: [], init: null, errors: [] };

const deadline = setTimeout(() => {
  console.error('TIMEOUT waiting for REPLAY_STREAM_INIT');
  finish(1);
}, 60_000);

function finish(code) {
  clearTimeout(deadline);
  try { ws.close(); } catch { /* noop */ }
  console.log(JSON.stringify(out));
  process.exit(code);
}

ws.on('message', raw => {
  const msg = JSON.parse(String(raw));
  if (msg.type === 'REPLAY_METADATA') out.metadata = msg;
  else if (msg.type === 'REPLAY_STREAM_CHUNK') out.chunks.push(msg);
  else if (msg.type === 'REPLAY_STREAM_INIT') { out.init = msg; finish(0); }
  else if (msg.type === 'REPLAY_ERROR') { out.errors.push(msg); finish(2); }
});
ws.on('error', err => { out.errors.push({ wsError: String(err) }); finish(3); });
ws.on('close', (code, reason) => {
  if (!out.init) { out.errors.push({ closed: code, reason: String(reason) }); finish(4); }
});
