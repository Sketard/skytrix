// =============================================================================
// game-log-builder-cli.ts — offline harness for the Game Log validation
// prototype (game-log-feed-chantier.md §8).
// -----------------------------------------------------------------------------
// Connects to the running duel-server as a replay client, collects the
// precomputed PreComputedState[] stream, resolves effect descriptions from
// cards.cdb, feeds the pure GameLogBuilder, and writes BOTH a Markdown file
// (diff-friendly) and a standalone HTML file (visual preview).
//
// This is the ONLY impure file of the prototype — WS, fs, sqlite live here.
// The four `game-log/` modules stay pure.
//
// Usage:
//   npm run game-log -- --replayId <id> --perspective 0 \
//     --output ../_bmad-output/game-log/<id>.md
//
// Flags:
//   --replayId      replay UUID to render (required, unless --from-file)
//   --perspective   0 | 1 — the viewer the log is rendered from (default 0)
//   --output        output .md path; the .html sibling is written alongside
//   --duelServerUrl ws base (default ws://localhost:3001)
//   --springBootUrl Spring Boot base for HTML card artwork
//                   (default http://localhost:8080/api)
//   --userId        participant user id for the replay JWT (default 1)
//   --from-file     read a captured states JSON instead of the live WS
//   --capture       also write the raw states JSON next to the output
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import Database from 'better-sqlite3';

import type { PreComputedState } from '../ws-protocol-replay.js';
import type { ServerMessage } from '../ws-protocol.js';
import type { CardDB } from '../types.js';
import { loadSystemStrings } from '../ocg-scripts.js';
import { resolveDescription } from '../game-log/effect-desc-resolver.js';
import { buildGameLogWithStats } from '../game-log/game-log-builder.js';
import { renderMarkdown } from '../game-log/game-log-markdown.js';
import { renderHtml } from '../game-log/game-log-html.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../data');
const MOCKUP_PATH = resolve(HERE, '../../../_mockups/mockup-game-log.html');

// -----------------------------------------------------------------------------
// CLI argument parsing
// -----------------------------------------------------------------------------
interface CliArgs {
  replayId: string;
  perspective: 0 | 1;
  output: string;
  duelServerUrl: string;
  /** Spring Boot base — backs the card-artwork URLs in the HTML preview. */
  springBootUrl: string;
  userId: string;
  fromFile?: string;
  capture: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const replayId = get('replayId') ?? '';
  const fromFile = get('from-file');
  if (!replayId && !fromFile) {
    fail('--replayId is required (or use --from-file <states.json>)');
  }
  const perspectiveRaw = get('perspective') ?? '0';
  const perspective = perspectiveRaw === '1' ? 1 : 0;
  const output =
    get('output') ??
    resolve(HERE, `../../../_bmad-output/game-log/${replayId || 'capture'}.md`);

  return {
    replayId,
    perspective,
    output,
    duelServerUrl: get('duelServerUrl') ?? 'ws://localhost:3001',
    springBootUrl: (get('springBootUrl') ?? 'http://localhost:8080/api')
      .replace(/\/$/, ''),
    userId: get('userId') ?? '1',
    fromFile,
    capture: has('capture'),
  };
}

// -----------------------------------------------------------------------------
// Replay JWT — the duel-server replay handler base64-decodes the JWT payload
// and reads `sub` for the participant check; it does NOT verify the signature.
// A minimal unsigned token with the right `sub` is sufficient for this tool.
// -----------------------------------------------------------------------------
function buildReplayJwt(userId: string): string {
  const b64 = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'none', typ: 'JWT' });
  const payload = b64({ sub: userId });
  return `${header}.${payload}.`;
}

// -----------------------------------------------------------------------------
// Collect PreComputedState[] from the duel-server replay WebSocket.
// Protocol: connect ?mode=replay → server streams REPLAY_BOARD_STATES batches
// then REPLAY_METADATA. REPLAY_ERROR aborts.
// -----------------------------------------------------------------------------
interface ReplayResult {
  states: PreComputedState[];
  title: string;
}

function fetchReplayStates(args: CliArgs): Promise<ReplayResult> {
  const jwt = buildReplayJwt(args.userId);
  const url =
    `${args.duelServerUrl}/?mode=replay` +
    `&replayId=${encodeURIComponent(args.replayId)}` +
    `&token=${encodeURIComponent(jwt)}&pv=1`;

  return new Promise<ReplayResult>((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(url);
    const states: PreComputedState[] = [];
    let title = args.replayId;
    let settled = false;
    let gotMetadata = false;

    const finish = (ok: boolean, err?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (quietTimer) clearTimeout(quietTimer);
      try { ws.close(); } catch { /* already closing */ }
      if (ok) resolvePromise({ states, title });
      else rejectPromise(new Error(err ?? 'replay WS failed'));
    };

    // The server streams REPLAY_METADATA first, then REPLAY_BOARD_STATES
    // batches, with no terminal "complete" message — the stream simply goes
    // quiet. Finish after a short idle gap once ≥1 batch arrived. Metadata is
    // only used to enrich the title — its absence must NOT hang the tool
    // (otherwise a metadata-less server stalls the full 60 s hard timeout).
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    const armQuietFinish = (): void => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (states.length > 0) finish(true);
      }, 1_500);
    };

    const hardTimeout = setTimeout(
      () => finish(false, 'replay WS timed out (60 s)'),
      60_000,
    );

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'REPLAY_LOAD', replayId: args.replayId }));
    });

    ws.on('message', (raw: Buffer) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return; // ignore non-JSON frames
      }
      if (msg.type === 'REPLAY_BOARD_STATES') {
        states.push(...msg.states);
        armQuietFinish();
      } else if (msg.type === 'REPLAY_METADATA') {
        gotMetadata = true;
        const [p1, p2] = msg.playerUsernames;
        title = `${args.replayId} — ${p1} vs ${p2} (${msg.turnCount} tours)`;
        armQuietFinish();
      } else if (msg.type === 'REPLAY_ERROR') {
        finish(false, `REPLAY_ERROR ${msg.code}: ${msg.message}`);
      }
    });

    ws.on('error', e => {
      finish(false, `WS error: ${(e as Error).message}`);
    });

    ws.on('close', (code: number) => {
      // A graceful close after batches = end of stream; before = rejection.
      if (settled) return;
      if (states.length > 0) finish(true);
      else finish(false, `WS closed early (code ${code})`);
    });
  });
}

// -----------------------------------------------------------------------------
// Build a descriptionCode → effect-text resolver from cards.cdb.
// The builder calls this for each MSG_CHAINING with the event's raw
// `description` CODE (NOT chainIndex — that resets to 0 every chain and would
// collide across chains). Memoized so each distinct code resolves once.
// -----------------------------------------------------------------------------
function buildDescriptionResolver(
  cardDb: CardDB,
  systemStrings: ReadonlyMap<number, string>,
): (descriptionCode: number) => string {
  const cache = new Map<number, string>();
  return (descriptionCode: number): string => {
    const cached = cache.get(descriptionCode);
    if (cached !== undefined) return cached;
    const text = resolveDescription(descriptionCode, cardDb, systemStrings);
    cache.set(descriptionCode, text);
    return text;
  };
}

/** Card-code → name lookup backed by cards.cdb's `texts` table, memoized. */
function buildNameResolver(cardDb: CardDB): (cardCode: number) => string | null {
  const cache = new Map<number, string | null>();
  return (cardCode: number): string | null => {
    if (cache.has(cardCode)) return cache.get(cardCode) ?? null;
    const row = cardDb.nameStmt.get(cardCode) as { name?: string } | undefined;
    const name = row?.name ?? null;
    cache.set(cardCode, name);
    return name;
  };
}

function openCardDb(): CardDB {
  const dbPath = join(DATA_DIR, 'cards.cdb');
  const db = new Database(dbPath, { readonly: true });
  return {
    db,
    stmt: db.prepare(
      'SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?',
    ),
    nameStmt: db.prepare('SELECT name FROM texts WHERE id = ?'),
    descStmt: db.prepare(
      'SELECT str1,str2,str3,str4,str5,str6,str7,str8,str9,str10,str11,str12,str13,str14,str15,str16 FROM texts WHERE id = ?',
    ),
  };
}

// -----------------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------------
function writeOutputs(
  args: CliArgs,
  states: PreComputedState[],
  title: string,
): void {
  // One card-db pass resolves both effect descriptions and code-only names.
  const cardDb = openCardDb();
  const systemStrings = loadSystemStrings(join(DATA_DIR, 'strings.conf'));
  const descriptionResolver = buildDescriptionResolver(cardDb, systemStrings);
  const nameResolver = buildNameResolver(cardDb);

  const { entries, targetStats } = buildGameLogWithStats({
    states,
    perspective: args.perspective,
    resolveDescription: descriptionResolver,
    resolveCardName: nameResolver,
  });
  cardDb.db.close();

  const mdPath = args.output;
  const htmlPath = mdPath.replace(/\.md$/i, '') + '.html';
  mkdirSync(dirname(mdPath), { recursive: true });

  writeFileSync(mdPath, renderMarkdown(entries, title), 'utf-8');

  // The HTML preview points card thumbnails at the same Spring Boot artwork
  // endpoint the front-end uses (`/documents/small/code/{code}`). Absolute
  // URL so the standalone file resolves images when opened in a browser.
  const css = extractMockupCss();
  const cardImageUrl = (code: number): string =>
    `${args.springBootUrl}/documents/small/code/${code}`;
  writeFileSync(
    htmlPath,
    renderHtml(entries, title, css, cardImageUrl),
    'utf-8',
  );

  if (args.capture) {
    const statesPath = mdPath.replace(/\.md$/i, '') + '.states.json';
    writeFileSync(statesPath, JSON.stringify(states), 'utf-8');
    console.log(`  captured states → ${statesPath}`);
  }

  console.log(`✔ ${entries.length} log entries`);
  console.log(`  markdown → ${mdPath}`);
  console.log(`  html     → ${htmlPath}`);
  // Target-resolution telemetry — informs the fallback policy for
  // unresolvable MSG_BECOME_TARGET identities (chantier §4.2).
  const { total, unresolved } = targetStats;
  if (total > 0) {
    const pct = Math.round(((total - unresolved) / total) * 100);
    console.log(
      `  cibles   → ${total - unresolved}/${total} résolues (${pct}%)` +
        (unresolved > 0 ? ` · ${unresolved} non résolue(s)` : ''),
    );
  }
}

/** Extract the `<style>` body from the approved mockup for the HTML preview. */
function extractMockupCss(): string {
  try {
    const html = readFileSync(MOCKUP_PATH, 'utf-8');
    const match = html.match(/<style>([\s\S]*?)<\/style>/);
    return match ? match[1] : '';
  } catch {
    console.warn('  (mockup CSS not found — HTML will be unstyled)');
    return '';
  }
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------
function fail(message: string): never {
  console.error(`✖ ${message}`);
  console.error(
    '  Hint: ensure the duel-server (:3001) and Spring Boot (:8080) are running,',
  );
  console.error(
    '  or capture the states once with --capture then re-run with --from-file.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let result: ReplayResult;

  if (args.fromFile) {
    console.log(`Loading captured states from ${args.fromFile}`);
    const parsed: unknown = JSON.parse(readFileSync(args.fromFile, 'utf-8'));
    if (!Array.isArray(parsed)) {
      fail(`${args.fromFile} is not a JSON array of PreComputedState`);
    }
    result = {
      states: parsed as PreComputedState[],
      title: args.replayId || args.fromFile,
    };
  } else {
    console.log(`Fetching replay ${args.replayId} from ${args.duelServerUrl}`);
    result = await fetchReplayStates(args);
  }

  if (result.states.length === 0) {
    fail('no precomputed states received');
  }
  console.log(`Received ${result.states.length} precomputed states`);
  writeOutputs(args, result.states, result.title);
}

main().catch((e: unknown) => {
  fail(e instanceof Error ? e.message : String(e));
});
