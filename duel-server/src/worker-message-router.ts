import type { ActiveDuelSession, WorkerToMainMessage } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import { filterMessage } from './message-filter.js';
import * as duelInstr from './duel-instrumentation.js';
import { applyChainTransition } from './chain-state-tracker.js';
import { ingestMessage as ingestIntoSessionGameLog } from './session-game-log.js';
import {
  handleTurnChange,
  scheduleTimerStart,
  startInactivityTimer,
  sendTimerStateToAll,
} from './timer-management.js';
import {
  handleDuelEnd,
  requestReplayFromWorker,
  safeTerminateWorker,
} from './worker-lifecycle.js';
import { persistReplay } from './replay-persist.js';
import * as logger from './logger.js';

/**
 * Inbound worker message routing + outbound client broadcast.
 *
 * `handleWorkerMessage` dispatches on the worker-to-main message kind
 * (WORKER_DUEL_CREATED / WORKER_MESSAGE / WORKER_RETRY / WORKER_CANCEL_DONE /
 * WORKER_ERROR / WORKER_REPLAY_DATA). Five of the six branches end with
 * `broadcastMessage` (the WORKER_MESSAGE pass-through), or with one of the
 * lifecycle helpers (handleDuelEnd, safeTerminateWorker,
 * requestReplayFromWorker, persistReplay).
 *
 * `broadcastMessage` is the outbound side: it detects natural duel-end
 * (DUEL_END / MSG_WIN), updates server-side chain state, tags
 * MSG_CONFIRM_CARDS with the current chainIndex, caches the latest
 * BOARD_STATE for late-connecting players, arms response/inactivity
 * timers on SELECT_*, and finally runs each outbound message through
 * `filterMessage` per player.
 *
 * The module owns no state of its own: it reads + mutates fields on the
 * passed `session` object exactly as the inline pre-extraction code did.
 *
 * `sendToPlayer` is injected (server.ts has 37 inline call sites, so
 * keeping its implementation there avoids duplicating the safeSend
 * helper).
 *
 * The `WORKER_CANCEL_DONE` branch is intentionally verbose — for the
 * full inventory of state slots reset across the cancel flow (worker +
 * server + client), see
 * `_bmad-output/planning-artifacts/cancel-rollback-contract.md`.
 */

export interface WorkerMessageRouterConfig {
  sendToPlayer: (session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage) => void;
  /** Per-player strike count before forfeit on engine-reject (MSG_RETRY storm). */
  maxInvalidResponses: number;
}

const configurable = createConfigurable<WorkerMessageRouterConfig>('worker-message-router');
export const configureWorkerMessageRouter = configurable.configure;
export const isWorkerMessageRouterConfigured = configurable.isConfigured;
const getCfg = configurable.get;

const SELECT_TYPES = new Set([
  'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_CARD', 'SELECT_CHAIN',
  'SELECT_EFFECTYN', 'SELECT_YESNO', 'SELECT_PLACE', 'SELECT_DISFIELD',
  'SELECT_POSITION', 'SELECT_OPTION', 'SELECT_TRIBUTE', 'SELECT_SUM',
  'SELECT_UNSELECT_CARD', 'SELECT_COUNTER', 'SORT_CARD', 'SORT_CHAIN',
  'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_CARD', 'ANNOUNCE_NUMBER',
  // Pre-duel coordinator prompts (since 2026-05-13). They're not "select" in
  // the OCGCore sense and DO NOT actually reach `broadcastMessage` in prod
  // (first-player-coordinator sends them via `sendToPlayer` direct, not via
  // the worker pipeline) — so the `isSelectMessage(...)` gates at
  // `broadcastMessage:289/342/359` never fire for these two types. Kept in
  // the set as a defensive declaration : if a future refactor ever routes
  // pre-duel prompts through `broadcastMessage`, they're correctly classified
  // as "awaiting-response" prompts by intent. The `lastSentPrompt` cache
  // (written by `first-player-coordinator` directly, validated by
  // `client-message-router` PLAYER_RESPONSE handler) is the actual shared
  // pipeline — `isSelectMessage` is not part of that path. Audit U21 (2026-06-01).
  'DICE_ROLL', 'SELECT_FIRST_PLAYER',
]);

export function isSelectMessage(message: ServerMessage): boolean {
  return SELECT_TYPES.has(message.type);
}

/**
 * Worker→main message types handled by THIS dispatcher (live PvP / SOLO /
 * fork-solo paths). The 5 replay-specific types (`WORKER_REPLAY_*` +
 * `WORKER_FORK_*`) are handled by `replay-handlers.ts` instead and never
 * reach this function — excluded from the union so the exhaustive `default`
 * arm below (audit C8) can narrow to `never`.
 */
type LiveDuelWorkerMessage = Exclude<
  WorkerToMainMessage,
  { type: 'WORKER_REPLAY_BOARD_STATES' | 'WORKER_REPLAY_COMPLETE' | 'WORKER_REPLAY_ERROR' | 'WORKER_FORK_READY' | 'WORKER_FORK_ERROR' }
>;

export function handleWorkerMessage(session: ActiveDuelSession, wmsg: WorkerToMainMessage): void {
  const cfg = getCfg();
  const send = cfg.sendToPlayer;

  // Replay-specific messages are routed by replay-handlers.ts ; not reachable here.
  if (
    wmsg.type === 'WORKER_REPLAY_BOARD_STATES' ||
    wmsg.type === 'WORKER_REPLAY_COMPLETE' ||
    wmsg.type === 'WORKER_REPLAY_ERROR' ||
    wmsg.type === 'WORKER_FORK_READY' ||
    wmsg.type === 'WORKER_FORK_ERROR'
  ) {
    logger.error('Replay/fork worker message reached live dispatcher (replay-handlers should have caught it)', { type: wmsg.type });
    return;
  }
  const liveMsg: LiveDuelWorkerMessage = wmsg;

  switch (liveMsg.type) {
    // Audit C10 (2026-06-01) — fork-solo BYPASSES this entire branch.
    // The fork worker emits WORKER_FORK_READY (duel-worker.ts:1805) instead
    // of WORKER_DUEL_CREATED ; `session.startedAt` is set manually in
    // `fork-handlers.ts:createForkSoloSession` to compensate. Future
    // additions to this case (timer setup, instrumentation, etc.) MUST
    // either also land in createForkSoloSession OR be conditional on a
    // discriminator that excludes fork-solo.
    case 'WORKER_DUEL_CREATED':
      logger.log('Duel created in worker', { duelId: liveMsg.duelId });
      session.startedAt = Date.now();
      // F5-bis (2026-05-31) — turn timer is meaningless against oneself.
      // SOLO multiplex (POST quick-duel) and fork-solo (forkMode implies
      // soloMode) both skip timer init. Inactivity timer stays enabled
      // (load-bearing: protects against worker leaks when the socket stays
      // open without activity ; see CLAUDE.md → "Fork-solo unification (F5-bis)").
      // All timer-management functions early-return on `timerContext === null`
      // so no further branches are required.
      if (!session.soloMode) {
        session.timerContext = {
          pools: [session.turnTimeSecs * 1000, session.turnTimeSecs * 1000],
          running: false,
          activePlayer: 0,
          intervalRef: null,
          lastTickMs: 0,
          turnCount: 0,
          pendingPlayer: null,
          pendingTimeout: null,
        };
        // Note: no-ops if players haven't connected yet —
        // sendTimerStateToPlayer covers on connection.
        sendTimerStateToAll(session);
      }
      break;

    case 'WORKER_MESSAGE':
      broadcastMessage(session, liveMsg.message);
      break;

    case 'WORKER_RETRY': {
      // OCGCore rejected the player's response — re-send the cached prompt.
      // lastSentPrompt is intentionally NOT cleared on PLAYER_RESPONSE for
      // exactly this case.
      const p = liveMsg.playerIndex;
      const cached = session.lastSentPrompt[p];
      if (cached) {
        session.invalidResponseCount[p]++;
        logger.warn('RETRY: re-sending prompt', {
          duelId: session.duelId,
          retryCount: session.invalidResponseCount[p],
          promptType: cached.type,
          player: p,
        });

        if (session.invalidResponseCount[p] >= cfg.maxInvalidResponses) {
          const winner: Player = p === 0 ? 1 : 0;
          const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'too_many_invalid_responses' };
          logger.log('DUEL_END', { duelId: session.duelId, winner, reason: 'too_many_invalid_responses' });
          send(session, 0, endMsg);
          send(session, 1, endMsg);
          handleDuelEnd(session);
          requestReplayFromWorker(session, 'TIMEOUT');
          return;
        }

        session.awaitingResponse[p] = true;
        send(session, p, cached);
      }
      break;
    }

    case 'WORKER_CANCEL_DONE': {
      // P0-3bis.3 — the worker has rolled back to the IDLECMD/BATTLECMD
      // boundary. Re-broadcast the IDLECMD/BATTLECMD prompt cached at
      // commit time so the client returns to the action menu. NOT
      // counted as a retry. See cancel-rollback-contract.md for the
      // full inventory of state slots reset across this flow.
      const p = liveMsg.playerIndex;
      const cached = session.cancelTargetPrompt[p];
      if (cached) {
        // γ Option C PR2 c6bis (A30) — SOLO multiplex routes the 3 sends
        // to socket 0 (the only one). STATE_SYNC filter goes omniscient
        // so the SOLO viewer's player-1 perspective sees the rollback's
        // private fields (hand contents, deck order) it needs to render
        // its slot correctly. PvP normal routes to socket `p` with the
        // standard per-player filter.
        const dest: 0 | 1 = session.soloMode ? 0 : p;
        const omniscient = session.soloMode;

        logger.log('CANCEL: re-broadcasting IDLECMD/BATTLECMD prompt', {
          duelId: session.duelId, promptType: cached.type, player: p, dest,
        });

        // STATE_SYNC + empty CHAIN_STATE so the client's reset machinery
        // runs (processor.reset + commitAll + clear pendingPrompt + clear
        // chain overlay). Same path as a reconnection re-sync.
        if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
          const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
          const filtered = filterMessage(stateSync, p, omniscient);
          if (filtered) send(session, dest, filtered);
        }
        send(session, dest, {
          type: 'CHAIN_STATE', links: [], phase: 'idle', negatedIndices: [],
        } as ServerMessage);

        // Mirror server-side chain bookkeeping so a subsequent
        // reconnect-resync sends the same empty chain.
        session.activeChainLinks = [];
        session.chainPhase = 'idle';
        session.negatedChainIndices.clear();
        session.currentSolvingChainIndex = null;

        // Hint replayed verbatim on reconnect would point at an effect
        // that no longer exists — drop it.
        session.lastSentHint[p] = null;

        // Cancel is a legitimate user action — don't accumulate retry
        // strikes toward `maxInvalidResponses`.
        session.invalidResponseCount[p] = 0;

        session.lastSentPrompt[p] = cached;
        session.awaitingResponse[p] = true;
        // The cached prompt already carries `player = p` (it's a SELECT_*
        // / IDLECMD payload), so the SOLO front routes it through slot p
        // via slotIndex(). PvP normal sends to player p directly.
        send(session, dest, cached);
        // Drop the cache — the prompt is now in flight and a future
        // commit will re-snapshot it.
        session.cancelTargetPrompt[p] = null;
      } else {
        logger.warn('CANCEL: no cached IDLECMD/BATTLECMD to re-broadcast', { duelId: session.duelId, player: p });
      }
      break;
    }

    case 'WORKER_ERROR': {
      logger.error('Worker error', { duelId: liveMsg.duelId, error: liveMsg.error });
      const errorMsg: ServerMessage = { type: 'DUEL_END', winner: null, reason: 'worker_error' };
      logger.log('DUEL_END', { duelId: session.duelId, winner: null, reason: 'engine_error' });
      send(session, 0, errorMsg);
      send(session, 1, errorMsg);
      handleDuelEnd(session);
      safeTerminateWorker(session);
      break;
    }

    case 'WORKER_REPLAY_DATA': {
      logger.log('Received WORKER_REPLAY_DATA', { duelId: liveMsg.duelId, responses: liveMsg.payload.playerResponses.length });
      // F5-bis (2026-05-31) — fork-solo is exploratory by design and not
      // archived (it derives from an existing replay). Skip the POST to
      // Spring Boot ; just terminate the worker.
      if (session.forkMode) {
        safeTerminateWorker(session);
        break;
      }
      persistReplay(session, liveMsg.payload).finally(() => {
        safeTerminateWorker(session);
      });
      break;
    }

    // Audit C8 (2026-06-01) — exhaustiveness check. If a new member is added
    // to the `LiveDuelWorkerMessage` union (i.e. to `WorkerToMainMessage`
    // without simultaneously being added to the replay-handlers' Exclude
    // list above), `liveMsg` will not narrow to `never` here and TS will
    // fail at compile time.
    default: {
      const _exhaustive: never = liveMsg;
      logger.error('Unhandled worker message type', { type: (liveMsg as { type: string }).type });
      void _exhaustive;
    }
  }
}

export function broadcastMessage(session: ActiveDuelSession, message: ServerMessage): void {
  const cfg = getCfg();
  const send = cfg.sendToPlayer;

  // Game-log ingestion — fed BEFORE the MSG_WIN→DUEL_END synthesis below so
  // the natural-end victory row is built from the raw MSG_WIN the worker
  // emitted. Both per-perspective builders ingest the same raw message; only
  // the board snapshot is sanitized per recipient (handled inside ingest).
  // Safe to run on every message: the builder switches on type and silently
  // skips ones it doesn't care about.
  if (session.gameLog) ingestIntoSessionGameLog(session.gameLog, message);

  // Natural DUEL_END from worker (LP=0, deck-out, etc.)
  if (message.type === 'DUEL_END') {
    logger.log('DUEL_END', { duelId: session.duelId, winner: message.winner, reason: 'worker' });
    handleDuelEnd(session);
  }

  // Natural game end via MSG_WIN — generate DUEL_END for clients.
  // The worker sends MSG_WIN (not DUEL_END) for LP=0, deck-out, Exodia.
  if (message.type === 'MSG_WIN') {
    // Carry the raw OCGCore `!victory` code so the client localizes the
    // exact win reason (LP=0 vs deck-out vs Exodia) instead of a generic label.
    const endMsg: ServerMessage = {
      type: 'DUEL_END', winner: message.player, reason: 'win', winReasonCode: message.reason,
    };
    // F5-bis (2026-05-31) — mode tag distinguishes the three session
    // shapes for replay audit log filtering.
    const mode = session.forkMode ? 'fork_solo' : (session.soloMode ? 'solo' : 'pvp');
    logger.log('DUEL_END', { duelId: session.duelId, winner: message.player, reason: 'win', mode });
    send(session, 0, endMsg);
    send(session, 1, endMsg);
    handleDuelEnd(session);
  }

  // Server-side chain state mirror (for reconnect resync).
  applyChainTransition(session, message);

  // M22 — Tag MSG_CONFIRM_CARDS with the currently-resolving link's
  // chainIndex so the client can filter prompt reveals per-link.
  if (message.type === 'MSG_CONFIRM_CARDS' && session.currentSolvingChainIndex !== null) {
    (message as { chainIndex?: number }).chainIndex = session.currentSolvingChainIndex;
  }

  // Cache last BOARD_STATE for late-connecting players + detect turn change.
  if (message.type === 'BOARD_STATE') {
    session.lastBoardState = message;
    handleTurnChange(session, message.data.turnPlayer, message.data.turnCount);
  }

  // SELECT_* — arm response/inactivity timers + drop stale cancel cache.
  if (isSelectMessage(message)) {
    const targetPlayer = (message as { player: Player }).player;
    // F-bugB3 verbose — promoted from debug. We want every server→client
    // SELECT_* to leave a trace, with the per-player awaitingResponse +
    // previously cached prompt so a 3rd back-to-back SELECT_CHAIN is
    // visible alongside the matching PLAYER_RESPONSE rows above.
    logger.log('SELECT prompt sent', {
      duelId: session.duelId, type: message.type, player: targetPlayer,
      forced: (message as any).forced,
      cardsLen: (message as any).cards?.length,
      hintTiming: (message as any).hintTiming ?? (message as any).hint_timing,
      prevAwaitingResponse: session.awaitingResponse.slice(),
      prevLastSentType: session.lastSentPrompt[targetPlayer]?.type ?? null,
      timerRunning: session.timerContext?.running,
    });
    session.awaitingResponse[targetPlayer] = true;
    session.promptSentAt[targetPlayer] = Date.now();
    const opponentOfTarget: 0 | 1 = targetPlayer === 0 ? 1 : 0;
    // γ Option C A19 — `targetPlayer` lets the SOLO multiplex front route
    // WAITING_RESPONSE to the right perspective slot. Populated in both modes
    // for protocol consistency; PvP normal front ignores the field.
    //
    // SOLO routing note — in PR1 this send is intentionally a no-op when the
    // opponent slot is player 1, because `PSEUDO_PAIRWISE_SOLO_ROUTED` is
    // empty (PR1 stays strictly additive). PR2 commit 4f populates the
    // whitelist with 'WAITING_RESPONSE' so the SOLO front's PerspectiveSlot
    // machinery starts seeing it. The send is kept here unconditionally so
    // PvP parity is structural and the routing decision lives in ONE place
    // (`decideSoloRouting`), not in scattered per-callsite branches.
    send(session, opponentOfTarget, { type: 'WAITING_RESPONSE', targetPlayer: opponentOfTarget });
    scheduleTimerStart(session, targetPlayer);
    startInactivityTimer(session, targetPlayer);
    // P0-3bis.3 — a fresh IDLECMD/BATTLECMD = new rollback boundary.
    if (message.type === 'SELECT_IDLECMD' || message.type === 'SELECT_BATTLECMD') {
      session.cancelTargetPrompt[targetPlayer] = null;
    }
  }

  // Per-player perspective filter + reconnection caches.
  // Phase 0b instrumentation: filterMessage runs twice per outbound message
  // (once per player) — finding D-C3. time() is a no-op unless
  // DUEL_INSTRUMENT=1; see duel-instrumentation.ts.
  //
  // γ Option C A1 + A10 — in SOLO multiplex the user is both players, so a
  // single omniscient filter pass replaces the per-player loop. The per-slot
  // perspective swap happens client-side on `switchPerspective` (the front
  // re-applies `swapBoardState` when the active slot is player 1).
  // A11 — DICE_RESULT never reaches here in SOLO (A36 guards
  // `startFirstPlayerPhase`), so the omniscient pass does not have to worry
  // about its per-player swap.
  if (session.soloMode) {
    const filtered = duelInstr.time('filterMessage', () => filterMessage(message, 0, true));
    if (!filtered) return;
    if (isSelectMessage(message)) {
      const targetPlayer = (message as { player: Player }).player;
      session.lastSentPrompt[targetPlayer] = filtered;
    }
    if (message.type === 'MSG_HINT') {
      // MSG_HINT carries the deciding player as `message.player`; index the
      // hint cache by it so a SOLO reconnect resends the right slot's hint.
      const hintPlayer = (message as { player: Player }).player;
      session.lastSentHint[hintPlayer] = filtered;
    }
    send(session, 0, filtered);
    return;
  }

  for (const playerIndex of [0, 1] as const) {
    const filtered = duelInstr.time('filterMessage', () => filterMessage(message, playerIndex));
    if (filtered) {
      if (isSelectMessage(message) && (message as { player: Player }).player === playerIndex) {
        session.lastSentPrompt[playerIndex] = filtered;
      }
      if (message.type === 'MSG_HINT') {
        session.lastSentHint[playerIndex] = filtered;
      }
      send(session, playerIndex, filtered);
    }
  }
}
