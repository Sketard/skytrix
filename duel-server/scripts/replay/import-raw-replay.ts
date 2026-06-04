// =============================================================================
// import-raw-replay.ts — POST a `.raw-replay.json` (R&D solver format) to the
// Spring Boot persistence service so it shows up in the replay viewer.
//
// Use case: the DB record was lost (rotated, dev-reset) but the raw-replay
// file is still on disk. The raw-replay's `steps[].response` payloads are
// already in the exact shape `duelSetResponse` consumes (= the output of
// `transformResponse`, = what `CapturedResponse.data` stores natively), so
// no payload transformation is required — only a 1-to-1 shape adaptation.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/replay/import-raw-replay.ts \
//     --raw-replay=../_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json \
//     [--player1-id=1] [--player2-id=1] \
//     [--p1-username=axel] [--p2-username=axel] \
//     [--deck-name="D/D/D Doom Queen Machinex"] \
//     [--result=SURRENDER] \
//     [--spring-boot=http://localhost:8080/api] \
//     [--internal-key=dev-internal-key] \
//     [--dry-run]
//
// Defaults: player1Id=1, player2Id=1, usernames="axel", deck="Imported R&D",
// result="SURRENDER", spring-boot from $SPRING_BOOT_API_URL or localhost:8080.
//
// -----------------------------------------------------------------------------
// METHODOLOGY — how the raw-replay → Spring Boot mapping was derived
// -----------------------------------------------------------------------------
// The raw-replay-v1 format and the replay-persist payload SHARE most fields
// by historical accident: both were authored against the same OCGCore
// `duelSetResponse` shape. The mapping is therefore 1-to-1 for everything
// except metadata. Verified field-by-field:
//
//   raw-replay-v1                  →  replay-persist POST body
//   -----------------------------     -------------------------------------
//   seed: string[4]                →  replayData.seed (verbatim, 4 bigints)
//   decks: [Deck, Deck]            →  replayData.decks (verbatim)
//   steps[].response: {type,...}   →  replayData.playerResponses[].data
//                                     (raw.steps[].response IS already the
//                                     output of `transformResponse` — see
//                                     ocg-message-transforms.ts:796-856 for
//                                     the type-tagged shapes per prompt)
//   sourceReplayId, generatedAt,   →  (lost — metadata.date uses generatedAt
//   responseCount, terminated,         if present, else now())
//   iterationsUsed, playerTracked
//
// Missing in raw-replay-v1 (must be synthesised):
//   - player1Id / player2Id  : Spring Boot users.id FK. Hardcoded 1/1 by
//                              default; pass --player1-id / --player2-id if
//                              your dev DB doesn't have a user 1.
//   - metadata.result        : raw-replay terminates `responses-exhausted`
//                              (not WIN/LOSS). "SURRENDER" is the chosen
//                              convention — viewer shows it as forfeit.
//   - metadata.turnCount     : not tracked. 0 is fine; Spring derives
//                              nothing critical from it.
//   - metadata.durationSec   : `null` legacy convention. Viewer hides the
//                              duration pill when null.
//   - metadata.deckNames     : raw-replay only has cardIds, no deck name.
//                              Pass --deck-name for a meaningful label.
//   - metadata.scriptsHash   : computed live from data/scripts_full/*.lua.
//                              If it differs from the original recording,
//                              the viewer may flag a divergence warning.
//   - metadata.ocgcoreVersion: read live from package.json.
//
// -----------------------------------------------------------------------------
// PITFALL — deckOrder convention (the cause of MSG_RETRY)
// -----------------------------------------------------------------------------
// The duel-worker's `loadDeckToOcg` was fixed on 2026-05-21 (commit 92fb7f29
// "deterministic opening hand when shuffle is disabled") to insert cards
// back-to-front with sequence:0, so the live OCGCore pile matches the
// `capturedDecks` array order verbatim. Replays captured AFTER that fix
// carry `metadata.deckOrder: 'verbatim'`; replays captured BEFORE it
// carry no `deckOrder` and the pile was the decklist REVERSED (pre-fix
// loadDeckToOcg inserted front-to-back, also with sequence:0).
//
// `normalizeReplayDeck(deck, convention)` in deck-load-order.ts handles
// both: 'verbatim' → pass-through; undefined → reverse-then-load, which
// restores the original pile.
//
// **R&D raw-replay files pre-date the 2026-05-21 fix.** They were captured
// front-to-back, so they need to be marked LEGACY (omit `deckOrder` in
// the metadata) for the worker to reverse + back-to-front-load and
// reproduce the original pile. Setting `deckOrder: 'verbatim'` on a legacy
// raw-replay shuffles the seed-driven opening hand — the very first
// SELECT_CARD prompt then references a card that isn't where OCGCore
// expects it, and the engine emits MSG_RETRY.
//
// **Decision encoded below**: `deckOrder` is omitted unconditionally. This
// is correct for all raw-replay-v1 files captured during the R&D solver
// era (paused 2026-05-05, all files pre-2026-05-21). If a future raw-replay
// is captured against the post-fix worker, this script would need a
// `--deck-order=verbatim` opt-in flag.
//
// -----------------------------------------------------------------------------
// DIAGNOSING A FAILED IMPORT
// -----------------------------------------------------------------------------
// Symptom: `Replay worker error … REPLAY_DIVERGED_RETRY` in duel-server logs.
//
//   1. **Wrong deckOrder** (most common, this script handles it): check the
//      payload doesn't include `metadata.deckOrder` for legacy R&D files.
//      Server-side `normalizeReplayDeck(deck, undefined)` reverses the deck
//      before load.
//
//   2. **Lua script drift**: a `.lua` file under `data/scripts_full/`
//      changed semantics since the raw-replay was captured (a card's
//      effect resolves differently → different prompt set → captured
//      response doesn't match). Diagnostic: enable `LOG_REPLAY=1` and
//      look for the `responseIndex` at which RETRY fires. Cross-reference
//      with `raw.steps[responseIndex]` to find which prompt diverged.
//      Mitigation: out-of-scope for this script — patch the .lua file
//      back, or accept the replay is unrunnable on the current scripts.
//
//   3. **OCGCore version drift**: @n1xx1/ocgcore-wasm bumped since the
//      capture. The `metadata.ocgcoreVersion` mismatch will be visible
//      but Spring doesn't reject; the engine may simply behave
//      differently. Diagnostic: same as (2) — look at the failing step.
//
//   4. **Cosmetic "Startup script not found: proc_compat.lua"**: not a
//      cause. Same warning is logged on every live duel-server boot;
//      `proc_compat.lua` is referenced in `STARTUP_SCRIPTS` but doesn't
//      ship in `data/scripts_full/`. Harmless.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initScriptsHash, getScriptsHash, getOcgcoreVersion } from '../../src/ocg-scripts.js';

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function parseArg(name: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

const rawReplayPath = parseArg('raw-replay');
if (!rawReplayPath) {
  console.error('[import-raw-replay] required: --raw-replay=<path>');
  process.exit(2);
}

const player1Id = Number(parseArg('player1-id') ?? '1');
const player2Id = Number(parseArg('player2-id') ?? '1');
const p1Username = parseArg('p1-username') ?? 'axel';
const p2Username = parseArg('p2-username') ?? 'axel';
const deckName = parseArg('deck-name') ?? 'Imported R&D';
const result = parseArg('result') ?? 'SURRENDER';
const springBoot = parseArg('spring-boot') ?? process.env['SPRING_BOOT_API_URL'] ?? 'http://localhost:8080/api';
// F17 (2026-06-04) — no default for internal-key. Pre-F17 the fallback was
// `'dev-internal-key'`, which would silently succeed against any environment
// that happened to share the dev key. Now the script fails fast unless either
// --internal-key=... or $INTERNAL_API_KEY is set, which forces the operator
// to make an explicit choice per environment.
const internalKey = parseArg('internal-key') ?? process.env['INTERNAL_API_KEY'];
if (!internalKey) {
  console.error('[import-raw-replay] required: --internal-key=<key> (or set $INTERNAL_API_KEY). No default — would fail open against prod-like targets.');
  process.exit(2);
}
const dryRun = process.argv.includes('--dry-run');

// -----------------------------------------------------------------------------
// Raw-replay reader (raw-replay-v1 schema)
// -----------------------------------------------------------------------------
interface RawReplayFile {
  format: string;
  sourceReplayId?: string;
  generatedAt?: string;
  responseCount: number;
  playerTracked: 0 | 1;
  seed: string[];
  decks: [{ main: number[]; extra: number[] }, { main: number[]; extra: number[] }];
  steps: Array<{
    stepIdx: number;
    promptType: number;
    promptTypeName: string;
    promptPlayer: number;
    response: Record<string, unknown>;
    autoRespond: boolean;
  }>;
}

const raw = JSON.parse(readFileSync(resolve(rawReplayPath), 'utf-8')) as RawReplayFile;
if (raw.format !== 'raw-replay-v1') {
  throw new Error(`unexpected raw-replay format: ${raw.format} (expected raw-replay-v1)`);
}
if (!Array.isArray(raw.seed) || raw.seed.length !== 4) {
  throw new Error(`raw-replay seed must have 4 bigints, got ${raw.seed?.length}`);
}

// F18 (2026-06-04) — date guard for the deckOrder convention. The header
// asserts "raw-replays captured BEFORE 2026-05-21 → deckOrder omitted"
// because that's when `loadDeckToOcg` flipped to back-to-front sequence:0
// (commit 92fb7f29). A raw-replay generated AFTER that date carries the
// `verbatim` pile order, so omitting deckOrder would reverse it on load
// and the very first card-bound prompt MSG_RETRY's. Pre-F18 the convention
// was documented in the header only — silent miscompilation otherwise.
// Warn-only because: (a) the date guard is a soft signal — generatedAt
// might be missing or inaccurate; (b) the operator may know better than
// us and want to proceed anyway (e.g. importing a CURATED legacy fixture
// regenerated past the cutoff).
const DECK_ORDER_FLIP_DATE = new Date('2026-05-21');
if (raw.generatedAt) {
  const generatedAt = new Date(raw.generatedAt);
  if (!isNaN(generatedAt.getTime()) && generatedAt > DECK_ORDER_FLIP_DATE) {
    console.warn(`[import-raw-replay] WARNING: raw-replay generatedAt=${raw.generatedAt} is AFTER the 2026-05-21 deckOrder flip.`);
    console.warn('  This script omits deckOrder by convention (legacy raw-replays). Expect MSG_RETRY on the first card-bound prompt if the original capture used the new back-to-front pile.');
    console.warn('  See header "PITFALL — deckOrder convention" for context.');
  }
}

// -----------------------------------------------------------------------------
// ScriptsHash init — Spring Boot stores this verbatim; the replay viewer
// uses it to detect script drift between recording and playback. We compute
// the live hash so the import isn't flagged as "scripts changed".
// -----------------------------------------------------------------------------
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATA_DIR = process.env['DATA_DIR'] ?? join(repoRoot, 'duel-server', 'data');
initScriptsHash(join(DATA_DIR, 'scripts_full'));

// -----------------------------------------------------------------------------
// Map raw-replay → replay-persist POST body
//
// Shape contract (see duel-server/src/replay-persist.ts and types.ts):
//   - seed: string[] (4 bigints as strings) — raw.seed is already this.
//   - decks: [{main:number[], extra:number[]}, ...] — identical.
//   - playerResponses: CapturedResponse[] = {data:unknown, timestamp?:string}[]
//     where `data` is the OCGCore response object (output of transformResponse).
//     raw.steps[].response IS that exact shape — direct copy.
//   - metadata: ReplayMetadata with playerUsernames/deckNames/turnCount/result/
//     date/scriptsHash/ocgcoreVersion/durationSec/deckOrder.
// -----------------------------------------------------------------------------
const playerResponses = raw.steps.map(s => ({ data: s.response }));

const body = {
  player1Id,
  player2Id,
  metadata: {
    playerUsernames: [p1Username, p2Username] as [string, string],
    deckNames: [deckName, deckName] as [string, string],
    turnCount: 0,  // not tracked in raw-replay; Spring derives nothing critical from it
    result,
    date: raw.generatedAt ?? new Date().toISOString(),
    scriptsHash: getScriptsHash(),
    ocgcoreVersion: getOcgcoreVersion(),
    durationSec: null,
    // deckOrder INTENTIONALLY OMITTED — raw-replays captured before 2026-05-21
    // (the back-to-front loadDeckToOcg fix) stored decks in front-to-back
    // sequence:0 order, i.e. the pile was the decklist REVERSED. The current
    // worker treats `deckOrder` absent as legacy → normalizeReplayDeck reverses
    // before the back-to-front load, reproducing the original pile. Adding
    // `deckOrder: 'verbatim'` would skip the reverse and shuffle the seed-driven
    // opening hand, triggering MSG_RETRY on the first card-bound prompt.
  },
  replayData: {
    seed: raw.seed,
    decks: raw.decks,
    playerResponses,
  },
};

console.log('[import-raw-replay] summary:');
console.log('  source:', rawReplayPath);
console.log('  sourceReplayId:', raw.sourceReplayId ?? '(none)');
console.log('  steps:', raw.steps.length);
console.log('  seed[0..3]:', raw.seed);
console.log('  decks: P0 main=' + raw.decks[0].main.length + ' extra=' + raw.decks[0].extra.length
            + ', P1 main=' + raw.decks[1].main.length + ' extra=' + raw.decks[1].extra.length);
console.log('  metadata.result:', result, '| players:', `${p1Username}(${player1Id}) vs ${p2Username}(${player2Id})`);
console.log('  scriptsHash:', getScriptsHash().slice(0, 12) + '...');
console.log('  ocgcoreVersion:', getOcgcoreVersion());
console.log('  target:', springBoot + '/replays');

if (dryRun) {
  console.log('\n[import-raw-replay] --dry-run, not POSTing. Body preview (first 400 chars):');
  console.log(JSON.stringify(body).slice(0, 400) + '...');
  process.exit(0);
}

// -----------------------------------------------------------------------------
// POST
// -----------------------------------------------------------------------------
const response = await fetch(`${springBoot}/replays`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
  body: JSON.stringify(body),
});

if (!response.ok) {
  const errBody = await response.text().catch(() => '');
  console.error(`[import-raw-replay] FAILED status=${response.status}`);
  console.error('  body:', errBody);
  process.exit(1);
}

const data = await response.json() as { id: string };
console.log(`\n[import-raw-replay] ✓ persisted as replayId=${data.id}`);
// F17 (2026-06-04) — build the viewer URL from origin rather than a
// `replace('/api', '')` over the full URL. The replace pattern was
// fragile: a `--spring-boot=...localhost:8080/api/v2` would yield
// `localhost:8080/v2/replay/...` (broken). `URL` strips the path
// cleanly.
try {
  const origin = new URL(springBoot).origin;
  console.log(`  open in viewer: ${origin}/replay/${data.id}`);
} catch {
  // springBoot is not a parseable URL — fall back to the replace heuristic
  // (matches the pre-F17 behavior) so the script still logs SOMETHING useful.
  console.log(`  open in viewer: ${springBoot.replace('/api', '')}/replay/${data.id}`);
}
