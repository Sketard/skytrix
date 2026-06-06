import type { OcgCoreSync, OcgDuelHandle, OcgMessage } from '@n1xx1/ocgcore-wasm';
import { OcgMessageType, OcgProcessResult } from '@n1xx1/ocgcore-wasm';
import { ChainSnapshotTracker } from './chain-snapshot-tracker.js';
import { applyChainTransition, emptyChainState, type ChainStateContainer } from './chain-state-tracker.js';
import {
  capturePreProcessOverlays, buildSettlingSourceFifo,
  type PreProcessOverlayKey, type SettlingSourceFifo,
} from './pre-process-overlays.js';
import { capturePreProcessHandCounts, type HandCountSnapshot } from './pre-process-hand-counts.js';
import { filterMessage } from './message-filter.js';
import type { DuelLogger } from './logger.js';
import type { InitReplayMessage } from './types.js';
import type {
  ServerMessage,
  BoardStateMsg,
  BoardStatePayload,
  CardInfo,
  Player,
  PreComputedState,
  DecisionMoment,
  ChainingMsg,
  ReplayStreamAutoResponse,
  ReplayStreamNavEntry,
} from './ws-protocol.js';
import { LOCATION, POSITION } from './ws-protocol.js';

/**
 * H3.5 — extracted from `duel-worker.ts`. Owns the `runReplayPreComputation`
 * loop and its private helpers (state flushing, label generation, chain
 * grouping, turn batching). Coupled to the worker via `ReplayPrecomputeDeps`
 * — the OCG runtime, dlog, port, and the 4 stateful helpers
 * (`transformMessage`, `updateState`, `buildBoardState`, `cleanup`) stay in
 * `duel-worker.ts` since they touch its module-level OCG state.
 */

// =============================================================================
// Constants
// =============================================================================

/** Public — `runForkReconstruction` in duel-worker.ts also gates on this set
 *  to detect player-input prompts. Kept here as the single source of truth so
 *  fork + replay can never drift on which OCG messages count as "select prompts". */
export const SELECT_MESSAGE_TYPES = new Set([
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_OPTION,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.SELECT_COUNTER,
  OcgMessageType.SORT_CARD,
  OcgMessageType.SORT_CHAIN,
  OcgMessageType.ANNOUNCE_RACE,
  OcgMessageType.ANNOUNCE_ATTRIB,
  OcgMessageType.ANNOUNCE_CARD,
  OcgMessageType.ANNOUNCE_NUMBER,
  OcgMessageType.ROCK_PAPER_SCISSORS,
]);

const TRANSITION_BOUNDARY_PROMPTS = new Set([
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_BATTLECMD,
]);

/** Anim-pipeline v4 (Phase 2) — `ServerMessage.type` values that correspond
 *  to a player prompt and thus trigger a `lastSelectOffset` update in the
 *  stream builder. Mirrors `SELECT_MESSAGE_TYPES` (which is keyed by
 *  `OcgMessageType`) but at the post-`transformMessage` level. */
const PROMPT_TYPES_STREAM: ReadonlySet<string> = new Set([
  'SELECT_IDLECMD', 'SELECT_BATTLECMD',
  'SELECT_CARD', 'SELECT_CHAIN', 'SELECT_EFFECTYN', 'SELECT_YESNO',
  'SELECT_PLACE', 'SELECT_DISFIELD', 'SELECT_POSITION', 'SELECT_OPTION',
  'SELECT_TRIBUTE', 'SELECT_SUM', 'SELECT_UNSELECT_CARD', 'SELECT_COUNTER',
  'SORT_CARD', 'SORT_CHAIN',
  'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_CARD', 'ANNOUNCE_NUMBER',
]);

const PHASE_LABELS: Record<number, string> = {
  1: 'Draw Phase', 2: 'Standby Phase', 4: 'Main Phase 1', 8: 'Battle Start',
  16: 'Battle Step', 32: 'Damage Step', 64: 'Damage Calc',
  128: 'Battle Phase', 256: 'Main Phase 2', 512: 'End Phase',
};

// β.3 cas #12 R9 fix (2026-05-26) — REASON_* now imported from the
// authoritative shared module. The old local declarations carried FAUX
// values (REASON_FUSION=0x8 vs real 0x40000, REASON_XYZ=0x40 vs real
// 0x200000, …) which never &-matched the real wasm `reason` field — every
// Fusion/Synchro/XYZ/Link summon fell through `describeMoveLabel` and
// landed in the `Send to GY` / generic-move fallback instead of its
// specific verb. Cf. `ocgcore-reason-flags.ts` for the full constant table
// sourced from `constant.lua:125-152`.
import {
  REASON_DESTROY, REASON_RELEASE, REASON_FUSION, REASON_RITUAL, REASON_SYNCHRO,
  REASON_XYZ, REASON_LINK, REASON_DISCARD, REASON_SUMMON, REASON_SPSUMMON,
} from './ocgcore-reason-flags.js';

const DEFAULT_MAX_ITERATIONS = 100_000;

// =============================================================================
// Label generation
// =============================================================================

function describeMoveLabel(from: number, to: number, reason: number, cardName: string, toPosition?: number): string {
  // Summon to Monster Zone
  if (to === LOCATION.MZONE) {
    if (reason & REASON_SUMMON)    return `Normal Summon: ${cardName}`;
    if (reason & REASON_FUSION)    return `Fusion Summon: ${cardName}`;
    if (reason & REASON_RITUAL)    return `Ritual Summon: ${cardName}`;
    if (reason & REASON_SYNCHRO)   return `Synchro Summon: ${cardName}`;
    if (reason & REASON_XYZ)       return `XYZ Summon: ${cardName}`;
    if (reason & REASON_LINK)      return `Link Summon: ${cardName}`;
    if (reason & REASON_SPSUMMON)  return `Special Summon: ${cardName}`;
    return `Summon: ${cardName}`;
  }
  // To graveyard
  if (to === LOCATION.GRAVE) {
    if (reason & REASON_DESTROY)  return `Destroy: ${cardName}`;
    if (reason & REASON_RELEASE)  return `Tribute: ${cardName}`;
    if (reason & REASON_DISCARD)  return `Discard: ${cardName}`;
    return `Send to GY: ${cardName}`;
  }
  if (to === LOCATION.BANISHED)                    return `Banish: ${cardName}`;
  if (to === LOCATION.HAND && from !== LOCATION.DECK) return `Return to hand: ${cardName}`;
  if (to === LOCATION.DECK)                        return `Return to Deck: ${cardName}`;
  if (to === LOCATION.OVERLAY)                     return `Attach: ${cardName}`;
  if (to === LOCATION.SZONE) {
    // "Set" only when the card lands face-down. A face-up SZONE landing is a
    // Spell/Trap activation from hand (or Pendulum scale set face-up) — the
    // sibling MSG_CHAINING / Pendulum verb in the same batch describes it
    // better. Return generic "Move" so `generateLabel` falls through to the
    // next event (MSG_CHAINING wins via the priority pass).
    const isFaceDown = toPosition != null
      && (toPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    return isFaceDown ? `Set: ${cardName}` : `Move: ${cardName}`;
  }
  return `Move: ${cardName}`;
}

function generateLabel(events: ServerMessage[]): string {
  // Priority pass — MSG_CHAINING is authoritative when a card is activated.
  // A Spell/Trap activated from hand emits MSG_MOVE (HAND→SZONE) AND
  // MSG_CHAINING in the same batch; without this pass the MSG_MOVE label
  // wins and the timeline displays "Set: ..." for an activation.
  for (const e of events) {
    if (e.type === 'MSG_CHAINING') return `Activate: ${e.cardName}`;
  }
  for (const e of events) {
    switch (e.type) {
      case 'MSG_MOVE': return describeMoveLabel(e.fromLocation, e.toLocation, e.reason, e.cardName, e.toPosition);
      case 'MSG_DRAW': return `Draw: ${e.cards.length} card(s)`;
      case 'MSG_DAMAGE': return `Damage: Player ${e.player + 1} -${e.amount}`;
      case 'MSG_FLIP_SUMMONING': return `Flip Summon: ${e.cardName}`;
      case 'MSG_SET': return `Set: card`;
      case 'MSG_ATTACK':
        return e.defenderPlayer !== null
          ? `Attack: P${e.attackerPlayer + 1} M${e.attackerSequence + 1} → P${e.defenderPlayer + 1} M${e.defenderSequence! + 1}`
          : `Direct Attack: P${e.attackerPlayer + 1} M${e.attackerSequence + 1}`;
      case 'MSG_RECOVER': return `Recover: Player ${e.player + 1} +${e.amount}`;
      default: break;
    }
  }
  // Skip non-visual event types — find the first meaningful game event
  const SKIP_TYPES = new Set(['WAITING_RESPONSE', 'MSG_CHAIN_END', 'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED', 'MSG_HINT', 'MSG_CONFIRM_CARDS']);
  for (const e of events) {
    if (!e.type.startsWith('SELECT_') && !SKIP_TYPES.has(e.type)) {
      return e.type;
    }
  }
  return '';
}

/** Strip chainIndex from single-link chains; prefix label with CL{n} for multi-link chains. */
function finalizeChainGroups(states: PreComputedState[]): void {
  let i = 0;
  while (i < states.length) {
    if (states[i].chainIndex == null) { i++; continue; }
    // Find the contiguous run of chain-linked states
    const start = i;
    while (i < states.length && states[i].chainIndex != null) i++;
    if (i - start <= 1) {
      // Single-link chain — remove chainIndex, keep plain label
      delete states[start].chainIndex;
    } else {
      // Multi-link chain — prefix labels with CL{n}
      for (let j = start; j < i; j++) {
        states[j].label = `CL${states[j].chainIndex! + 1}: ${states[j].label}`;
      }
    }
  }
}

// =============================================================================
// Dependencies + entry point
// =============================================================================

/** Minimal port surface — only postMessage is consumed. */
export interface PortLike {
  postMessage(msg: unknown): void;
}

/**
 * Dependencies injected by `duel-worker.ts`. The 4 helpers
 * (`transformMessage`, `updateState`, `buildBoardState`, `cleanup`) stay in
 * the worker since they read/write its module-level OCG state — extracting
 * them would balloon the refactor by ~1500 LOC.
 */
export interface ReplayPrecomputeDeps {
  core: OcgCoreSync;
  duel: OcgDuelHandle;
  duelId: string;
  dlog: DuelLogger;
  port: PortLike;
  transformMessage: (msg: OcgMessage, preProcessOverlays?: Map<PreProcessOverlayKey, number[]>, settlingFifo?: SettlingSourceFifo, handCountsPreBatch?: HandCountSnapshot) => ServerMessage | null;
  updateState: (msg: OcgMessage) => void;
  buildBoardState: () => ServerMessage;
  cleanup: () => void;
  getBuildBoardStatePerfStats: () => { calls: number; cumulativeMs: number; avgMs: number };
  /** Test-only override. Defaults to 100_000 (well above any real duel). */
  maxIterations?: number;
}

// =============================================================================
// Anim-pipeline v4 — replay-as-PvP-readonly stream builder (Phase 2)
// =============================================================================

/**
 * Accumulator for the new `REPLAY_STREAM_*` messages emitted alongside the
 * legacy `WORKER_REPLAY_BOARD_STATES`. The precompute loop pushes one
 * `ServerMessage` per `ingest` call ; on every turn boundary it `flushTurn`s
 * the accumulated chunk over the worker port. At the end of the duel
 * `emitInit` ships the final `navIndex` + `totalMessages` count.
 *
 * **Why per-turn chunks** : matches the existing `emitTurnBatch` cadence
 * (Phase 2 doctrine — minimal disruption to the worker thread's emission
 * pattern). The size threshold (`MAX_CHUNK_BYTES`, same 512 KB as legacy)
 * splits long turns to keep WS frames bounded.
 *
 * **Why a separate accumulator** (vs. piggybacking on the legacy `events`
 * array) : the legacy `events[]` is mutated/cleared at every `flushState`
 * call to scope events to a `PreComputedState`. The stream needs a LINEAR
 * append-only buffer keyed by global cursor offset — clearing it per
 * flush would lose the offset semantic. Separate buffer = no impact on
 * the legacy code path's correctness.
 */
class ReplayStreamBuilder {
  private static readonly MAX_CHUNK_BYTES = 512 * 1024;
  private readonly _port: PortLike;
  private readonly _duelId: string;

  /** Per-turn chunk being assembled. Flushed on turn boundary. */
  private _turnMessages: ServerMessage[] = [];
  private _turnAutoResponses: ReplayStreamAutoResponse[] = [];
  /** Per-turn nav entries accumulated since the last flushTurn. Shipped on
   *  the chunk so the client transport sees them immediately, without
   *  waiting for `emitInit`. */
  private _turnNavEntries: ReplayStreamNavEntry[] = [];
  /** Global cursor — incremented on every `ingest`. */
  private _cursor = 0;
  /** Global offset of `_turnMessages[0]` in the full stream. */
  private _turnBaseOffset = 0;
  /** Built incrementally during precompute, shipped in one shot at the end. */
  private readonly _navIndex: ReplayStreamNavEntry[] = [];

  constructor(port: PortLike, duelId: string) {
    this._port = port;
    this._duelId = duelId;
  }

  /** Push a server message onto the stream. Returns its global offset
   *  (the offset of the message just pushed). */
  ingest(msg: ServerMessage): number {
    const offset = this._cursor;
    this._turnMessages.push(msg);
    this._cursor++;
    return offset;
  }

  /** Record an auto-response payload for the SELECT_* at `offset`. The
   *  precompute calls this when consuming a `playerResponses[i]` entry,
   *  with `offset` = the offset of the SELECT_* that was just ingested. */
  recordAutoResponse(offset: number, promptType: string, data: Record<string, unknown>): void {
    this._turnAutoResponses.push({ offset, promptType, data });
  }

  /** Add a nav entry pointing to the current cursor. Called at the same
   *  sites where `flushState` is called — keeps the nav index aligned with
   *  the legacy `PreComputedState[]` boundaries. v4 Phase 3 — also pushed
   *  on `_turnNavEntries` so the next `flushTurn` carries it on the chunk
   *  (instead of waiting for the final `emitInit`).
   *
   *  v4 Phase 4 (2026-06-05) — `boardStateSnapshot` + `chainSnapshot`
   *  required so the client's `mockConn.seekToOffset(N)` restores in
   *  O(1) instead of replaying messages forward. The boardState is the
   *  same value the legacy `flushState` captures via
   *  `(buildBoardState() as BoardStateMsg).data`, kept in ABSOLUTE
   *  perspective (the mock swaps at consume time). */
  recordNavEntry(
    label: string, turnNumber: number,
    boardStateSnapshot: BoardStatePayload,
    chainSnapshot: ReplayStreamNavEntry['chainSnapshot'],
    chainIndex?: number,
  ): void {
    if (!label) return; // mirror flushState skip — empty-label states are not navigable
    const entry: ReplayStreamNavEntry = {
      messageOffset: this._cursor,
      label,
      turnNumber,
      boardStateSnapshot,
      ...(chainIndex != null ? { chainIndex } : {}),
      ...(chainSnapshot ? { chainSnapshot } : {}),
    };
    this._navIndex.push(entry);
    this._turnNavEntries.push(entry);
  }

  /** Flush the current turn's chunk(s). Splits into multiple chunks if
   *  `MAX_CHUNK_BYTES` is exceeded — same defense-in-depth as
   *  `emitTurnBatch` for the legacy format. */
  flushTurn(turnNumber: number): void {
    if (this._turnMessages.length === 0) {
      // Reset side-buffers just in case a flush is called without messages
      this._turnAutoResponses = [];
      this._turnNavEntries = [];
      this._turnBaseOffset = this._cursor;
      return;
    }
    const total = this._turnMessages;
    const totalResp = this._turnAutoResponses;
    const totalNav = this._turnNavEntries;
    const baseOffset = this._turnBaseOffset;
    // Try one big chunk first (matches the legacy code path's first-attempt).
    const serialized = JSON.stringify({ messages: total, autoResponses: totalResp, navEntries: totalNav });
    const totalBytes = Buffer.byteLength(serialized, 'utf-8');
    if (totalBytes <= ReplayStreamBuilder.MAX_CHUNK_BYTES) {
      this._port.postMessage({
        type: 'WORKER_REPLAY_STREAM_CHUNK',
        duelId: this._duelId,
        turnNumber,
        baseOffset,
        messages: total,
        autoResponses: totalResp,
        navEntries: totalNav,
      });
      this._turnMessages = [];
      this._turnAutoResponses = [];
      this._turnNavEntries = [];
      this._turnBaseOffset = this._cursor;
      return;
    }
    // Split: same arithmetic chunk-size strategy as `emitTurnBatch`. Both
    // `autoResponses` and `navEntries` are partitioned by their
    // `messageOffset` / `offset` field so each chunk carries only what
    // belongs to its message range.
    const avgPerMsg = totalBytes / total.length;
    const targetChunkSize = Math.max(1, Math.floor((ReplayStreamBuilder.MAX_CHUNK_BYTES * 0.8) / avgPerMsg));
    for (let i = 0; i < total.length;) {
      let chunkSize = Math.min(targetChunkSize, total.length - i);
      // Defense in depth: shrink until under budget. Borderline only.
      let chunkMsgs = total.slice(i, i + chunkSize);
      let chunkResp = totalResp.filter(r =>
        r.offset >= baseOffset + i && r.offset < baseOffset + i + chunkSize);
      let chunkNav = totalNav.filter(n =>
        n.messageOffset >= baseOffset + i && n.messageOffset < baseOffset + i + chunkSize);
      while (chunkMsgs.length > 1 &&
        Buffer.byteLength(JSON.stringify({ messages: chunkMsgs, autoResponses: chunkResp, navEntries: chunkNav }), 'utf-8')
          > ReplayStreamBuilder.MAX_CHUNK_BYTES) {
        chunkSize = Math.ceil(chunkSize / 2);
        chunkMsgs = total.slice(i, i + chunkSize);
        chunkResp = totalResp.filter(r =>
          r.offset >= baseOffset + i && r.offset < baseOffset + i + chunkSize);
        chunkNav = totalNav.filter(n =>
          n.messageOffset >= baseOffset + i && n.messageOffset < baseOffset + i + chunkSize);
      }
      this._port.postMessage({
        type: 'WORKER_REPLAY_STREAM_CHUNK',
        duelId: this._duelId,
        turnNumber,
        baseOffset: baseOffset + i,
        messages: chunkMsgs,
        autoResponses: chunkResp,
        navEntries: chunkNav,
      });
      i += chunkMsgs.length;
    }
    this._turnMessages = [];
    this._turnAutoResponses = [];
    this._turnNavEntries = [];
    this._turnBaseOffset = this._cursor;
  }

  /** Ship the finalisation message. Called ONCE after the final `flushTurn`. */
  emitInit(): void {
    this._port.postMessage({
      type: 'WORKER_REPLAY_STREAM_INIT',
      duelId: this._duelId,
      totalMessages: this._cursor,
      navIndex: this._navIndex,
    });
  }
}

/**
 * Emit a turn's pre-computed states in chunks bounded by `MAX_BATCH_BYTES`.
 *
 * Audit finding M5 — previous implementation re-serialized chunks while
 * halving them until they fit, worst-case O(n × log(start_chunk_size))
 * stringifies on a long turn. Now: one byteLength measurement up-front
 * derives an arithmetic chunk size from the observed avg-bytes-per-state,
 * with a 20% safety margin to absorb per-state variance. The chunk-fits
 * guard is kept (defense in depth — a chain with one giant boardStateAfter
 * after dozens of trivial events could still drift), but in practice it
 * almost never fires because the margin already covers typical variance.
 */
function emitTurnBatch(
  port: PortLike,
  replayDuelId: string,
  turnNum: number,
  states: PreComputedState[],
): void {
  if (states.length === 0) return;
  const MAX_BATCH_BYTES = 512 * 1024;
  const serialized = JSON.stringify(states);
  const totalBytes = Buffer.byteLength(serialized, 'utf-8');
  if (totalBytes <= MAX_BATCH_BYTES) {
    port.postMessage({
      type: 'WORKER_REPLAY_BOARD_STATES',
      duelId: replayDuelId,
      turnNumber: turnNum,
      states,
    });
    return;
  }
  // Derive chunk size arithmetically: target 80% of MAX to absorb per-state
  // size variance. Floor at 1 so the loop always advances.
  const avgPerState = totalBytes / states.length;
  const targetChunkSize = Math.max(1, Math.floor((MAX_BATCH_BYTES * 0.8) / avgPerState));
  for (let i = 0; i < states.length;) {
    let chunk = states.slice(i, Math.min(i + targetChunkSize, states.length));
    // Defense in depth: if variance pushed this chunk over MAX, halve it
    // until it fits. Borderline cases only — typical chunks pass first try.
    while (chunk.length > 1 && Buffer.byteLength(JSON.stringify(chunk), 'utf-8') > MAX_BATCH_BYTES) {
      chunk = chunk.slice(0, Math.ceil(chunk.length / 2));
    }
    port.postMessage({
      type: 'WORKER_REPLAY_BOARD_STATES',
      duelId: replayDuelId,
      turnNumber: turnNum,
      states: chunk,
    });
    i += chunk.length;
  }
}

function flushState(
  buildBoardState: () => ServerMessage,
  turnStates: PreComputedState[],
  events: ServerMessage[],
  decisions: DecisionMoment[],
  label: string,
  responseIndex: number,
  chainIndex?: number,
  chainSnapshot?: PreComputedState['chainSnapshot'],
): void {
  // Skip empty states (only SELECT_*/WAITING_RESPONSE, no visual events)
  if (!label) return;
  const boardState = (buildBoardState() as BoardStateMsg).data;
  turnStates.push({
    boardState,
    events: [...events],
    label,
    responseCount: responseIndex,
    ...(decisions.length > 0 ? { decisions: [...decisions] } : {}),
    ...(chainIndex != null ? { chainIndex } : {}),
    ...(chainSnapshot ? { chainSnapshot } : {}),
  });
}

/** Build a `chainSnapshot` payload from the current chain state container,
 *  or `undefined` when no chain is open (so flushState skips the field).
 *
 *  Called from every flushState site so a state captured mid-chain carries
 *  the snapshot the replay viewer needs to restore `activeChainLinks` +
 *  `chainPhase` on a seek that lands inside the chain. Mirrors the PvP
 *  `CHAIN_STATE` reconnect handshake — same shape, same restore code path
 *  (`processor.restoreChainState`). F9 (cross-side `chainPhase` parity)
 *  gains a 3rd consumer with this function: replay-precompute now also
 *  runs `applyChainTransition` to drive `chainStateContainer`. */
function buildChainSnapshot(container: ChainStateContainer): PreComputedState['chainSnapshot'] {
  if (container.chainPhase === 'idle') return undefined;
  // F9-bis bug fix (2026-06-04) — defensive shallow copy of `activeChainLinks`.
  // `applyChainTransition` MUTATES the underlying array (push on MSG_CHAINING),
  // so embedding a direct reference made every snapshot point to the SAME
  // array — by the time the precompute finishes pushing all N links, all N
  // states' snapshots displayed `[link0, …, linkN]` instead of growing
  // [link0], [link0, link1], ... See diagnostic spec
  // `f9-bis-diagnostic.spec.ts` for the symptom (state 5 carrying 4 links
  // even though only 1 MSG_CHAINING was in its events[]).
  return {
    links: [...container.activeChainLinks] as ChainingMsg[],
    phase: container.chainPhase,
    negatedIndices: [...container.negatedChainIndices],
    currentSolvingChainIndex: container.currentSolvingChainIndex,
  };
}

export function runReplayPreComputation(
  msg: InitReplayMessage,
  deps: ReplayPrecomputeDeps,
): void {
  const {
    core, duel, duelId, dlog, port,
    transformMessage, updateState, buildBoardState, cleanup,
    getBuildBoardStatePerfStats,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = deps;

  let responseIndex = 0;
  let currentTurn = 0; // Turn 0 = "Setup"
  let turnStates: PreComputedState[] = [];
  let events: ServerMessage[] = [];
  let currentDecisions: DecisionMoment[] = [];
  let lastHint: { hintType: number; value: number; cardName: string } | null = null;
  let lastConfirmedCards: CardInfo[] | null = null;
  let hasWinOrDraw = false;
  let activeChainIndex: number | null = null; // Track current chain link depth
  // Local chain tracker — replay precompute doesn't share state with cancel,
  // so a per-run instance is enough (vs `liveChainTracker` for live PvP).
  const chainTracker = new ChainSnapshotTracker();
  // F9-bis (2026-06-04) — local chain state container driven by the same
  // `applyChainTransition` the live worker uses (`worker-message-router.ts`).
  // Embedded into every `PreComputedState` captured while a chain is open
  // (`chainPhase !== 'idle'`) so the replay viewer can restore
  // `activeChainLinks` + `chainPhase` on a mid-chain seek via
  // `processor.restoreChainState` — the same code path as the PvP
  // `CHAIN_STATE` reconnect handshake. Without this, seeking into a chain
  // leaves the overlay + chain badges empty (the processor is wiped by
  // `adapter.abort()` and no `MSG_CHAINING(1..N-1)` is re-fed).
  const chainStateContainer: ChainStateContainer = emptyChainState();
  let iterations = 0;

  // Anim-pipeline v4 (Phase 2) — accumulate the replay-as-PvP-readonly
  // stream alongside the legacy `PreComputedState[]` emission. Ingested
  // at the SAME sites where `events.push(filtered)` fires + at the
  // SELECT_IDLECMD/BATTLECMD/MSG_HINT sites (which the legacy events[]
  // skips but the mock needs for strict PvP-doctrine equivalence). Nav
  // entries are recorded alongside every non-empty flushState call. The
  // final `emitInit` ships at the END / responses-exhausted exits.
  const streamBuilder = new ReplayStreamBuilder(port, duelId);
  /** Helper — emit a synthetic BOARD_STATE into the stream + record a nav
   *  entry. Called at each `flushState` boundary so the client mock has
   *  an authoritative state to `updateLogical` against (matches what a
   *  live PvP worker emits between user-visible moments) AND a scrubber
   *  target. The boardState is identical to what the legacy `flushState`
   *  captures via `(buildBoardState() as BoardStateMsg).data`. The order
   *  on the stream is: events.push x N (already done in the loop), THEN
   *  BOARD_STATE, mirroring the live PvP ordering (events FIRST, then
   *  BOARD_STATE confirms). Gated on `label` non-empty just like
   *  `flushState` itself, so empty-label states (SELECT_/WAITING-only
   *  batches) do not produce a phantom scrubber entry. */
  function recordStreamFlush(label: string, chainIndex?: number): void {
    if (!label) return;
    const bs = buildBoardState() as BoardStateMsg;
    streamBuilder.ingest({ type: 'BOARD_STATE', data: bs.data });
    // v4 Phase 4 — same boardState payload feeds the nav entry's
    // snapshot, so `mockConn.seekToOffset(N)` can restore the rendered
    // state in O(1). `buildChainSnapshot` is the SHARED helper already
    // used by the legacy `PreComputedState.chainSnapshot` ; reusing it
    // guarantees the two paths can't drift.
    streamBuilder.recordNavEntry(label, currentTurn, bs.data, buildChainSnapshot(chainStateContainer), chainIndex);
  }
  /** Tracks the global cursor offset of the most recent SELECT_* / SORT_* /
   *  ANNOUNCE_* ingested into the stream. The `responseIndex` consumer uses
   *  this to pair `playerResponses[i]` with the SELECT_* it answers via
   *  `streamBuilder.recordAutoResponse(lastSelectOffset, …)`. -1 sentinel
   *  catches the impossible case "auto-respond fired but no prompt was
   *  streamed" (would indicate the precompute ingested a SELECT_* without
   *  updating this tracker — assertion-style guard in the recordAutoResponse
   *  helper below). */
  let lastSelectOffset = -1;
  /** Wrapper around `streamBuilder.ingest` that detects prompt-type
   *  messages and updates `lastSelectOffset`. Keeps the call sites in the
   *  main loop short — they just call `ingestStream(filtered)` instead of
   *  remembering to update the tracker. */
  function ingestStream(msg: ServerMessage): void {
    const offset = streamBuilder.ingest(msg);
    if (PROMPT_TYPES_STREAM.has(msg.type)) lastSelectOffset = offset;
  }
  /** Auto-respond helper — pairs `lastSelectOffset` with the response data
   *  being fed to OCGCore. Guards against the "no prior SELECT_*" case
   *  (logged once, drops the auto-respond for that index). */
  function recordAutoResponse(promptType: string, data: Record<string, unknown>): void {
    if (lastSelectOffset === -1) {
      dlog.warn('Replay v4 stream — recordAutoResponse called without a prior SELECT_* ingest', { promptType, responseIndex });
      return;
    }
    streamBuilder.recordAutoResponse(lastSelectOffset, promptType, data);
    lastSelectOffset = -1; // consume; next prompt resets it
  }

  dlog.log('Starting pre-computation', { responses: msg.playerResponses.length });

  while (true) {
    if (++iterations > maxIterations) {
      dlog.error('Max iterations reached — aborting', { maxIterations });
      port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code: 'REPLAY_MAX_ITERATIONS', message: 'Pre-computation exceeded maximum iterations' });
      cleanup();
      return;
    }

    // β.3 cas #12 (Commit 0bis) — capture MZONE overlayMaterials BEFORE
    // duelProcess applies the next batch of mutations. Identical mechanism
    // to runDuelLoop — the replay precompute reruns OCGCore and emits the
    // same MSG_MOVE family the live worker emits.
    const preProcessOverlays = capturePreProcessOverlays(core, duel, dlog);
    // β.3 cas #12 post-review B3 (2026-05-28) — settling FIFO derived from
    // the snapshot. Same as runDuelLoop ; replay parity by construction
    // (transformMessage is shared, the FIFO is built and consumed identically).
    const settlingFifo = buildSettlingSourceFifo(preProcessOverlays);
    // F9-bis hand-discard fix (2026-06-04) — capture HAND cardCode counts
    // BEFORE the batch, so MSG_CHAINING carries `handCopiesAtChaining`
    // even when its own cost MSG_MOVE is in the same batch (querying the
    // live HAND post-process would already reflect the discard).
    const handCountsPreBatch = capturePreProcessHandCounts(core, duel, dlog);

    let status: number;
    try {
      status = core.duelProcess(duel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dlog.error('Replay duelProcess threw', { error: message });
      port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code: 'REPLAY_COMPUTATION_ERROR', message: `Pre-computation error: ${message}` });
      cleanup();
      return;
    }

    const messages = core.duelGetMessage(duel);

    for (const rawMsg of messages) {
      // Explicit MSG_RETRY detection (AC#4)
      if (rawMsg.type === OcgMessageType.RETRY) {
        dlog.error('MSG_RETRY encountered — divergence', { responseIndex });
        port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code: 'REPLAY_DIVERGED_RETRY', message: 'Replay diverged: MSG_RETRY encountered (script/core version mismatch)' });
        cleanup();
        return;
      }

      // Flush accumulated events BEFORE phase update so boardState captures the old phase
      if (rawMsg.type === OcgMessageType.NEW_PHASE) {
        if (events.length > 0 || currentDecisions.length > 0) {
          const label = generateLabel(events);
          flushState(buildBoardState, turnStates, events, currentDecisions, label, responseIndex, undefined, buildChainSnapshot(chainStateContainer));
          recordStreamFlush(label);
          events = [];
          currentDecisions = [];
        }
      }

      // Track state for buildBoardState()
      updateState(rawMsg);

      // Track win/draw for end-of-duel verification
      if (rawMsg.type === OcgMessageType.WIN || rawMsg.type === OcgMessageType.DRAW) {
        hasWinOrDraw = true;
      }

      // Track turn changes — flush accumulated decisions before emitting turn batch
      if (rawMsg.type === OcgMessageType.NEW_TURN) {
        if (events.length > 0 || currentDecisions.length > 0) {
          const label = generateLabel(events);
          flushState(buildBoardState, turnStates, events, currentDecisions, label, responseIndex, undefined, buildChainSnapshot(chainStateContainer));
          recordStreamFlush(label);
          events = [];
          currentDecisions = [];
        }
        // Emit completed turn batch BEFORE incrementing
        finalizeChainGroups(turnStates);
        emitTurnBatch(port, duelId, currentTurn, turnStates);
        streamBuilder.flushTurn(currentTurn);
        currentTurn++;
        turnStates = [];
        dlog.debug('Replay turn started', { turn: currentTurn });
      }

      // Translate via message pipeline + omniscient filter — pass the
      // pre-process overlay snapshot so XYZ leaving MZONE carry their
      // matériaux on the resulting MSG_MOVE (β.3 cas #12 Commit 0bis).
      // settlingFifo tags GRAVE→GRAVE settlings with sourceMzoneSeq for the
      // discriminating rule predicate (B3 post-review).
      const translated = transformMessage(rawMsg, preProcessOverlays, settlingFifo, handCountsPreBatch);
      if (translated) {
        const filtered = filterMessage(translated, 0 as Player, true); // omniscient
        if (filtered) {
          // Track chain-resolving window + attach `boardStateAfter` snapshot.
          // Client's `replayBuffer` uses it to progress logical state across
          // events instead of jumping to the final chain state at commit. The
          // snapshot reflects ocgcore state at capture time (post-batch if
          // multiple events fire in one `duelProcess` call); still strictly
          // better than no snapshot at all.
          chainTracker.process(filtered, () => (buildBoardState() as BoardStateMsg).data);

          // F9-bis (2026-06-04) — chain state container transition timing.
          // The container drives `chainSnapshot` on every flushed state. The
          // rule is: a flushed state's snapshot must reflect the chain state
          // AFTER the last event in the state's `events[]`. So
          // `applyChainTransition` happens AFTER any flush triggered by
          // `filtered` itself (CHAINING / CHAIN_END branches below — those
          // flush events that PRECEDE `filtered`) and BEFORE `filtered` is
          // pushed into `events[]` for any other branch (so the next flush
          // triggered by a later message sees the post-transition state on
          // `filtered`). Concretely: CHAINING/CHAIN_END handle their own
          // transition timing inline; every other branch falls through to
          // the `applyChainTransition` call at the end.

          // Track hint/confirmedCards accumulators (metadata, not pushed to events)
          if (filtered.type === 'MSG_HINT') {
            lastHint = { hintType: filtered.hintType, value: filtered.value, cardName: filtered.cardName };
            applyChainTransition(chainStateContainer, filtered);
            // v4 Phase 2 — MSG_HINT lives on the live PvP wire (DuelConnection
            // routes it via _handleMsgHint) ; mock-side parity requires it in
            // the stream so the per-slot hintContext flips identically.
            ingestStream(filtered);
          } else if (filtered.type === 'MSG_CONFIRM_CARDS') {
            lastConfirmedCards = filtered.cards;
            applyChainTransition(chainStateContainer, filtered);
            events.push(filtered); // Also push to events so the front-end can animate the reveal
            ingestStream(filtered);
          } else if (filtered.type !== 'SELECT_IDLECMD' && filtered.type !== 'SELECT_BATTLECMD') {
            // Flush before each chain activation so each effect gets its own timeline entry.
            //
            // F10 (2026-05-31) — cross-side parity. This flush is the replay
            // counterpart to the PvP intermediate BOARD_STATE emitted in
            // duel-worker.ts:1376-1379 (after the "if (dto.type === 'MSG_CHAIN_SOLVING'
            // && hasCostMoves)" guard). Both mechanisms surface a board sync
            // between chain cost moves (the events flushed here) and the
            // chain entering resolving. The ORDER vs MSG_CHAINING differs
            // between modes (PvP after, replay before) but the practical
            // effect (DECK/EXTRA pile counts + metadata up to date before
            // resolving) is equivalent. See CLAUDE.md → "Intermediate
            // post-cost board sync (F10)". If you change this flush
            // condition (e.g. only flush when cost moves are present), make
            // sure the PvP counterpart still matches the new contract.
            if (filtered.type === 'MSG_CHAINING') {
              if (events.length > 0) {
                // F9-bis — flush BEFORE applyChainTransition so the snapshot
                // reflects the chain state as of the events being flushed
                // (which precede this `MSG_CHAINING`). For link 1 (idle →
                // building transition), the pre-transition state is `idle`
                // → snapshot is undefined. For link N≥2, the pre-transition
                // state already has links 1..N-1, matching the events.
                const label = generateLabel(events);
                flushState(buildBoardState, turnStates, events, currentDecisions, label, responseIndex, activeChainIndex ?? undefined, buildChainSnapshot(chainStateContainer));
                recordStreamFlush(label, activeChainIndex ?? undefined);
                events = [];
                currentDecisions = [];
              }
              activeChainIndex = filtered.chainIndex;
              applyChainTransition(chainStateContainer, filtered);
            } else if (filtered.type === 'MSG_CHAIN_END') {
              // Flush the last chain link's events BEFORE clearing activeChainIndex,
              // so the final link keeps its chainIndex for timeline grouping.
              if (events.length > 0) {
                // F9-bis — flush BEFORE applyChainTransition so the snapshot
                // still reflects `phase='resolving'` or `'building'` with the
                // full link list. After applyChainTransition the container is
                // back to `idle` and `buildChainSnapshot` returns undefined.
                const label = generateLabel(events);
                flushState(buildBoardState, turnStates, events, currentDecisions, label, responseIndex, activeChainIndex ?? undefined, buildChainSnapshot(chainStateContainer));
                recordStreamFlush(label, activeChainIndex ?? undefined);
                events = [];
                currentDecisions = [];
              }
              activeChainIndex = null;
              applyChainTransition(chainStateContainer, filtered);
              // Flush MSG_CHAIN_END as its own state WITHOUT chainIndex.
              // This acts as a separator between consecutive chains in the timeline.
              // The front-end hides it (HIDDEN_LABELS in subEventSegments).
              // No `chainSnapshot` either: `applyChainTransition` flipped phase
              // to `idle` above, so `buildChainSnapshot` returns undefined.
              events.push(filtered);
              ingestStream(filtered);
              flushState(buildBoardState, turnStates, events, currentDecisions, 'MSG_CHAIN_END', responseIndex, undefined, buildChainSnapshot(chainStateContainer));
              // v4 Phase 3 (2026-06-05) — record the nav entry + synthetic
              // BOARD_STATE for MSG_CHAIN_END too, so the 1-to-1 mapping
              // between `PreComputedState[]` (legacy) and the nav entries
              // (v4) is preserved by construction. The client hides the
              // 'MSG_CHAIN_END' label via HIDDEN_SUB_EVENT_LABELS in the
              // timeline (timeline-bar.component.ts), so the nav entry is
              // present but never rendered. The synthetic BOARD_STATE is
              // load-bearing : the v4 transport's `dispatchUntil(navIndex[N
              // +1].messageOffset)` must land at the same cursor position
              // as the legacy `currentIndex` increment, and any skipped
              // flushState would skew the mapping by one entry.
              recordStreamFlush('MSG_CHAIN_END');
              events = [];
              currentDecisions = [];
              continue; // already pushed+flushed — skip the push below
            } else {
              applyChainTransition(chainStateContainer, filtered);
            }
            events.push(filtered);
            ingestStream(filtered);
          } else {
            // SELECT_IDLECMD / SELECT_BATTLECMD — not pushed to legacy events
            // (the ReplayDuelAdapter step queue handles them via a separate
            // path), but still drive the chain state container (no-op for
            // these types, kept for branch symmetry).
            //
            // v4 Phase 2 doctrine (a) — the live PvP wire DOES send these to
            // the client (DuelConnection._handleSelectSimple routes them via
            // SELECT_SIMPLE_TYPES). Strict "Replay = PvP readonly" requires
            // them in the stream so MockDuelConnection lands `pendingPrompt`
            // identically to PvP. Cf. CLAUDE.md "Replay = PvP readonly".
            applyChainTransition(chainStateContainer, filtered);
            ingestStream(filtered);
          }
        }
      }

      // Always create a state entry for the new phase (ensures every phase appears in timeline)
      if (rawMsg.type === OcgMessageType.NEW_PHASE) {
        const phaseLabel = PHASE_LABELS[rawMsg.phase as number] ?? 'Phase Change';
        flushState(buildBoardState, turnStates, events, currentDecisions, phaseLabel, responseIndex, undefined, buildChainSnapshot(chainStateContainer));
        recordStreamFlush(phaseLabel);
        events = [];
        currentDecisions = [];
      }

      // Feed responses at select prompts
      if (SELECT_MESSAGE_TYPES.has(rawMsg.type)) {
        dlog.debug('Replay SELECT prompt', { index: responseIndex, type: OcgMessageType[rawMsg.type] ?? 'UNKNOWN', player: (rawMsg as { player?: Player }).player, totalResponses: msg.playerResponses.length });

        if (responseIndex >= msg.playerResponses.length) {
          // Out of recorded responses — duel was interrupted (surrender/disconnect/timeout).
          // Always complete gracefully: pre-existing replays may have result='VICTORY'
          // due to a fixed bug that stored the winner's perspective instead of the interrupt cause.
          const interruptResults = new Set(['SURRENDER', 'DISCONNECT', 'TIMEOUT']);
          if (!msg.metadata.result || !interruptResults.has(msg.metadata.result)) {
            dlog.warn('Unexpected end of responses — possible divergence', { responseIndex, result: msg.metadata.result });
          }
          dlog.log('End of recorded responses — treating as replay end', { responseIndex, result: msg.metadata.result });
          if (events.length > 0 || currentDecisions.length > 0) {
            const label = generateLabel(events);
            flushState(buildBoardState, turnStates, events, currentDecisions, label, responseIndex, undefined, buildChainSnapshot(chainStateContainer));
            recordStreamFlush(label);
          }
          finalizeChainGroups(turnStates);
          emitTurnBatch(port, duelId, currentTurn, turnStates);
          streamBuilder.flushTurn(currentTurn);
          streamBuilder.emitInit();
          port.postMessage({ type: 'WORKER_REPLAY_COMPLETE', duelId });
          cleanup();
          return;
        }

        const response = msg.playerResponses[responseIndex];
        const isBoundary = TRANSITION_BOUNDARY_PROMPTS.has(rawMsg.type);

        if (isBoundary) {
          // Boundary prompt: flush accumulated events + decisions, then feed response
          if (events.length > 0 || currentDecisions.length > 0) {
            const label = generateLabel(events);
            flushState(buildBoardState, turnStates, events, currentDecisions, label, responseIndex, undefined, buildChainSnapshot(chainStateContainer));
            recordStreamFlush(label);
            events = [];
            currentDecisions = [];
          }
        } else {
          // Intermediate prompt: accumulate decision with hint/confirmedCards context.
          // Capture a board state snapshot BEFORE feeding the response — this matches
          // the BOARD_STATE the live PvP client receives when status === WAITING.
          const prompt = events[events.length - 1]; // The SELECT_* translated message
          const snapshotData = (buildBoardState() as BoardStateMsg).data;
          const snapshot = filterMessage({ type: 'BOARD_STATE', data: snapshotData } as ServerMessage, 0 as Player, true);
          const decision: DecisionMoment = {
            prompt,
            response: { data: response.data, ...(response.timestamp ? { timestamp: response.timestamp } : {}) },
            player: (rawMsg as { player: Player }).player,
            ...(lastHint ? { hint: lastHint } : {}),
            ...(lastConfirmedCards ? { confirmedCards: lastConfirmedCards } : {}),
            boardState: (snapshot as BoardStateMsg).data,
          };
          currentDecisions.push(decision);
          // Consume hint/confirmedCards after use
          lastHint = null;
          lastConfirmedCards = null;
        }

        dlog.debug('Replay feeding response', { index: responseIndex });
        // v4 Phase 2 — record the auto-respond payload for the SELECT_*
        // just consumed. The mock's transport scheduler reads this map
        // and arms a `setTimeout(REPLAY_PROMPT_DELAY_MS)` to call
        // `simulatePlayerResponse(autoResponse)` after dispatch.
        const promptTypeStr = OcgMessageType[rawMsg.type] ?? '';
        recordAutoResponse(promptTypeStr, response.data as Record<string, unknown>);
        core.duelSetResponse(duel, response.data as never);
        responseIndex++;
      }
    }

    if (status === OcgProcessResult.END) {
      // Capture any remaining events (MSG_WIN, final damage, etc.) into a final state
      if (events.length > 0 || currentDecisions.length > 0) {
        const label = generateLabel(events);
        flushState(buildBoardState, turnStates, events, currentDecisions, label, responseIndex, undefined, buildChainSnapshot(chainStateContainer));
        recordStreamFlush(label);
      }
      // Emit final turn batch
      finalizeChainGroups(turnStates);
      emitTurnBatch(port, duelId, currentTurn, turnStates);
      streamBuilder.flushTurn(currentTurn);
      streamBuilder.emitInit();

      // Verify duel ended normally (Task 3.5: END without MSG_WIN/MSG_DRAW = divergence)
      if (!hasWinOrDraw) {
        dlog.error('duelProcess returned END without MSG_WIN or MSG_DRAW — possible divergence');
        port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code: 'REPLAY_DIVERGED_NO_RESULT', message: 'Replay diverged: duel ended without a win or draw result' });
        cleanup();
        return;
      }

      dlog.log('Pre-computation complete', {
        turns: currentTurn + 1,
        responsesConsumed: responseIndex,
        buildBoardStatePerf: getBuildBoardStatePerfStats(),
      });
      port.postMessage({ type: 'WORKER_REPLAY_COMPLETE', duelId });
      cleanup();
      return;
    }

    // WAITING without a select prompt means MSG_RETRY or unexpected state
    if (status === OcgProcessResult.WAITING && responseIndex > 0) {
      const hasSelect = messages.some(m => SELECT_MESSAGE_TYPES.has(m.type));
      if (!hasSelect) {
        dlog.error('WAITING but no select message — possible divergence');
        port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code: 'REPLAY_DIVERGED_UNEXPECTED', message: 'Replay diverged: unexpected WAITING state without select prompt' });
        cleanup();
        return;
      }
    }

    // OcgProcessResult.CONTINUE → loop again
  }
}

// =============================================================================
// Test-only exports (not for production consumers)
// =============================================================================

/** @internal — exported for spec coverage of label generation. */
export const __test__ = {
  describeMoveLabel,
  generateLabel,
  finalizeChainGroups,
  emitTurnBatch,
  flushState,
  buildChainSnapshot,
  PHASE_LABELS,
  TRANSITION_BOUNDARY_PROMPTS,
  DEFAULT_MAX_ITERATIONS,
  ReplayStreamBuilder,
  PROMPT_TYPES_STREAM,
};
