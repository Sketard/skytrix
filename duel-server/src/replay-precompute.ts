import type { OcgCoreSync, OcgDuelHandle, OcgMessage } from '@n1xx1/ocgcore-wasm';
import { OcgMessageType, OcgProcessResult } from '@n1xx1/ocgcore-wasm';
import { ChainSnapshotTracker } from './chain-snapshot-tracker.js';
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
} from './ws-protocol.js';
import { LOCATION } from './ws-protocol.js';

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

const PHASE_LABELS: Record<number, string> = {
  1: 'Draw Phase', 2: 'Standby Phase', 4: 'Main Phase 1', 8: 'Battle Start',
  16: 'Battle Step', 32: 'Damage Step', 64: 'Damage Calc',
  128: 'Battle Phase', 256: 'Main Phase 2', 512: 'End Phase',
};

// OCGCore reason bitmask flags (from card_data.h)
const REASON_DESTROY   = 0x1;
const REASON_RELEASE   = 0x2;
const REASON_FUSION    = 0x8;
const REASON_RITUAL    = 0x10;
const REASON_SYNCHRO   = 0x20;
const REASON_XYZ       = 0x40;
const REASON_LINK      = 0x80;
const REASON_DISCARD   = 0x400;
const REASON_SUMMON    = 0x800;
const REASON_SPSUMMON  = 0x1000;

const DEFAULT_MAX_ITERATIONS = 100_000;

// =============================================================================
// Label generation
// =============================================================================

function describeMoveLabel(from: number, to: number, reason: number, cardName: string): string {
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
  if (to === LOCATION.SZONE)                       return `Set: ${cardName}`;
  return `Move: ${cardName}`;
}

function generateLabel(events: ServerMessage[]): string {
  for (const e of events) {
    switch (e.type) {
      case 'MSG_MOVE': return describeMoveLabel(e.fromLocation, e.toLocation, e.reason, e.cardName);
      case 'MSG_DRAW': return `Draw: ${e.cards.length} card(s)`;
      case 'MSG_DAMAGE': return `Damage: Player ${e.player + 1} -${e.amount}`;
      case 'MSG_CHAINING': return `Activate: ${e.cardName}`;
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
  transformMessage: (msg: OcgMessage) => ServerMessage | null;
  updateState: (msg: OcgMessage) => void;
  buildBoardState: () => ServerMessage;
  cleanup: () => void;
  getBuildBoardStatePerfStats: () => { calls: number; cumulativeMs: number; avgMs: number };
  /** Test-only override. Defaults to 100_000 (well above any real duel). */
  maxIterations?: number;
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
  });
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
  let lastHint: { hintType: number; value: number; cardName: string; hintAction: string } | null = null;
  let lastConfirmedCards: CardInfo[] | null = null;
  let hasWinOrDraw = false;
  let activeChainIndex: number | null = null; // Track current chain link depth
  // Local chain tracker — replay precompute doesn't share state with cancel,
  // so a per-run instance is enough (vs `liveChainTracker` for live PvP).
  const chainTracker = new ChainSnapshotTracker();
  let iterations = 0;

  dlog.log('Starting pre-computation', { responses: msg.playerResponses.length });

  while (true) {
    if (++iterations > maxIterations) {
      dlog.error('Max iterations reached — aborting', { maxIterations });
      port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code: 'REPLAY_MAX_ITERATIONS', message: 'Pre-computation exceeded maximum iterations' });
      cleanup();
      return;
    }

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
          flushState(buildBoardState, turnStates, events, currentDecisions, generateLabel(events), responseIndex);
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
          flushState(buildBoardState, turnStates, events, currentDecisions, generateLabel(events), responseIndex);
          events = [];
          currentDecisions = [];
        }
        // Emit completed turn batch BEFORE incrementing
        finalizeChainGroups(turnStates);
        emitTurnBatch(port, duelId, currentTurn, turnStates);
        currentTurn++;
        turnStates = [];
        dlog.debug('Replay turn started', { turn: currentTurn });
      }

      // Translate via message pipeline + omniscient filter
      const translated = transformMessage(rawMsg);
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

          // Track hint/confirmedCards accumulators (metadata, not pushed to events)
          if (filtered.type === 'MSG_HINT') {
            lastHint = { hintType: filtered.hintType, value: filtered.value, cardName: filtered.cardName, hintAction: filtered.hintAction };
          } else if (filtered.type === 'MSG_CONFIRM_CARDS') {
            lastConfirmedCards = filtered.cards;
            events.push(filtered); // Also push to events so the front-end can animate the reveal
          } else if (filtered.type !== 'SELECT_IDLECMD' && filtered.type !== 'SELECT_BATTLECMD') {
            // Flush before each chain activation so each effect gets its own timeline entry
            if (filtered.type === 'MSG_CHAINING') {
              if (events.length > 0) {
                flushState(buildBoardState, turnStates, events, currentDecisions, generateLabel(events), responseIndex, activeChainIndex ?? undefined);
                events = [];
                currentDecisions = [];
              }
              activeChainIndex = filtered.chainIndex;
            } else if (filtered.type === 'MSG_CHAIN_END') {
              // Flush the last chain link's events BEFORE clearing activeChainIndex,
              // so the final link keeps its chainIndex for timeline grouping.
              if (events.length > 0) {
                flushState(buildBoardState, turnStates, events, currentDecisions, generateLabel(events), responseIndex, activeChainIndex ?? undefined);
                events = [];
                currentDecisions = [];
              }
              activeChainIndex = null;
              // Flush MSG_CHAIN_END as its own state WITHOUT chainIndex.
              // This acts as a separator between consecutive chains in the timeline.
              // The front-end hides it (HIDDEN_LABELS in subEventSegments).
              events.push(filtered);
              flushState(buildBoardState, turnStates, events, currentDecisions, 'MSG_CHAIN_END', responseIndex);
              events = [];
              currentDecisions = [];
              continue; // already pushed+flushed — skip the push below
            }
            events.push(filtered);
          }
        }
      }

      // Always create a state entry for the new phase (ensures every phase appears in timeline)
      if (rawMsg.type === OcgMessageType.NEW_PHASE) {
        const phaseLabel = PHASE_LABELS[rawMsg.phase as number] ?? 'Phase Change';
        flushState(buildBoardState, turnStates, events, currentDecisions, phaseLabel, responseIndex);
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
            flushState(buildBoardState, turnStates, events, currentDecisions, generateLabel(events), responseIndex);
          }
          finalizeChainGroups(turnStates);
          emitTurnBatch(port, duelId, currentTurn, turnStates);
          port.postMessage({ type: 'WORKER_REPLAY_COMPLETE', duelId });
          cleanup();
          return;
        }

        const response = msg.playerResponses[responseIndex];
        const isBoundary = TRANSITION_BOUNDARY_PROMPTS.has(rawMsg.type);

        if (isBoundary) {
          // Boundary prompt: flush accumulated events + decisions, then feed response
          if (events.length > 0 || currentDecisions.length > 0) {
            flushState(buildBoardState, turnStates, events, currentDecisions, generateLabel(events), responseIndex);
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
        core.duelSetResponse(duel, response.data as never);
        responseIndex++;
      }
    }

    if (status === OcgProcessResult.END) {
      // Capture any remaining events (MSG_WIN, final damage, etc.) into a final state
      if (events.length > 0 || currentDecisions.length > 0) {
        flushState(buildBoardState, turnStates, events, currentDecisions, generateLabel(events), responseIndex);
      }
      // Emit final turn batch
      finalizeChainGroups(turnStates);
      emitTurnBatch(port, duelId, currentTurn, turnStates);

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
  PHASE_LABELS,
  TRANSITION_BOUNDARY_PROMPTS,
  DEFAULT_MAX_ITERATIONS,
};
