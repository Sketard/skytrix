// =============================================================================
// ocgcore-adapter.ts — GameOracle implementation backed by OCGCore WASM
// Runs inside solver worker threads. One WASM instance per worker.
// =============================================================================

import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
  type OcgCoreSync,
  type OcgDuelHandle as OcgNativeHandle,
  type OcgMessage,
} from '@n1xx1/ocgcore-wasm';

import type { CardDB, ScriptDB } from '../types.js';
import type { Phase } from '../ws-protocol.js';
import { STARTUP_SCRIPTS } from '../ocg-scripts.js';
import { createCardReader, createScriptReader } from '../ocg-callbacks.js';
import type { GameOracle, DuelHandle } from './game-oracle.js';
import type {
  ActivationLog,
  Action,
  DuelConfig,
  FieldState,
  InterruptionTag,
  PromptType,
  SolverAction,
} from './solver-types.js';
import { EXPLORATORY_PROMPTS, cloneActivationLog } from './solver-types.js';
import { disambiguateEffect, isFieldActivation } from './interruption-disambiguation.js';
import {
  PLAYER,
  OPPONENT,
  FILLER_CARD,
  PHASE_MAP,
  MESSAGE_TO_PROMPT,
  SELECT_MSG_TYPES,
} from './ocg-constants.js';
import { queryFieldState, decodeFieldMask } from './ocg-field-query.js';
import { solverAssert } from './solver-assert.js';
import { time as instrumentTime } from './solver-instrumentation.js';

// =============================================================================
// Internal Handle State
// =============================================================================

interface InternalHandle {
  id: number;
  nativeHandle: OcgNativeHandle;
  actionHistory: Action[];
  responseHistory: unknown[];
  config: DuelConfig;
  isActive: boolean;
  turn: number;
  phase: Phase;
  /** Per-turn log of interruption effect activations consumed by this handle.
   *  Key: cardId. Value: list of effect indices (positions in
   *  `InterruptionTag.effects[]`) that have been activated, in chronological
   *  order. The same index can appear multiple times when an effect's
   *  `usesPerTurn > 1`. Cleared on every NEW_TURN. Cloned by `forkViaReplay`.
   *  Populated only for player-side activations of tagged cards (Story 1.8). */
  activationLog: Map<number, number[]>;
}

// =============================================================================
// OCGCoreAdapter
// =============================================================================

export class OCGCoreAdapter implements GameOracle {
  private core: OcgCoreSync;
  private cardDB: CardDB;
  private scripts: ScriptDB;
  private cardReader: (code: number) => unknown;
  private scriptReader: (name: string) => string | null;
  private activeHandles = new Map<number, InternalHandle>();
  private nextHandleId = 1;
  private _snapshotAvailable = false;
  /** Boot-loaded interruption tags (Story 1.8). Used by `applyAction` to
   *  detect player-side activations of tagged cards and update each handle's
   *  `activationLog`. Empty when the adapter is constructed without tags
   *  (legacy code paths and tests) — in that case the activation log stays
   *  empty and OPT-aware scoring degrades gracefully to pre-1.8 behavior. */
  private readonly tags: Record<string, InterruptionTag>;

  get snapshotAvailable(): boolean {
    return this._snapshotAvailable;
  }

  private constructor(
    core: OcgCoreSync,
    cardDB: CardDB,
    scripts: ScriptDB,
    tags: Record<string, InterruptionTag>,
  ) {
    this.core = core;
    this.cardDB = cardDB;
    this.scripts = scripts;
    this.tags = tags;
    this.cardReader = createCardReader(cardDB);
    this.scriptReader = createScriptReader(scripts);
  }

  /**
   * Factory: initialize OCGCore WASM, run smoke test, return adapter.
   * `tags` MUST be provided (boot-loaded from `solver-config-loader.ts`).
   * Pass `{}` explicitly only in tests where OPT-aware scoring is irrelevant —
   * this makes the silent OPT downgrade visible at the call site instead of
   * happening implicitly via a default parameter.
   */
  static async create(
    cardDB: CardDB,
    scripts: ScriptDB,
    tags: Record<string, InterruptionTag>,
  ): Promise<OCGCoreAdapter> {
    const core = await createCore({ sync: true });
    const version = core.getVersion();
    console.log(`[Solver] OCGCore v${version[0]}.${version[1]} initialized`);

    const adapter = new OCGCoreAdapter(core, cardDB, scripts, tags);
    adapter.runSmokeTest();
    return adapter;
  }

  // ===========================================================================
  // GameOracle Interface
  // ===========================================================================

  createDuel(config: DuelConfig): DuelHandle {
    const nativeHandle = this.createNativeDuel(config);
    const id = this.nextHandleId++;
    const internal: InternalHandle = {
      id,
      nativeHandle,
      actionHistory: [],
      responseHistory: [],
      config,
      isActive: true,
      turn: 0,
      phase: 'DRAW',
      activationLog: new Map(),
    };
    internal.id = id;
    this.activeHandles.set(id, internal);
    return this.toPublicHandle(internal);
  }

  getLegalActions(handle: DuelHandle): Action[] {
    const internal = this.resolveHandle(handle);
    return this.runUntilPlayerPrompt(internal);
  }

  applyAction(handle: DuelHandle, action: Action): void {
    return instrumentTime('apply', () => this._applyActionImpl(handle, action));
  }

  private _applyActionImpl(handle: DuelHandle, action: Action): void {
    const internal = this.resolveHandle(handle);
    const response = this.actionToResponse(action);
    try {
      this.core.duelSetResponse(internal.nativeHandle, response as never);
    } catch (err) {
      // WASM threw — the handle is now in an unknown state. Mark it inactive
      // so any subsequent fork/getLegalActions on the same handle fails fast
      // instead of replaying corrupted history.
      internal.isActive = false;
      throw new Error(`[Solver] applyAction failed for action responseIndex=${action.responseIndex}: ${String(err)}`);
    }
    internal.actionHistory.push(action);
    internal.responseHistory.push(response);
    // Story 1.8: track player-side activations of tagged cards.
    // We do this AFTER duelSetResponse to avoid logging on actions that
    // would throw inside the engine. The pass-action (responseIndex === -1
    // for SELECT_CHAIN) carries cardId === 0 so it's filtered out below.
    this.recordActivation(internal, action);
  }

  fork(handle: DuelHandle): DuelHandle {
    return instrumentTime('fork', () => {
      const internal = this.resolveHandle(handle);
      // WASM Memory snapshot not available in current @n1xx1/ocgcore-wasm v0.1.1.
      // When snapshot API becomes available, try snapshot here with
      // try/catch fallback to forkViaReplay on failure.
      return this.forkViaReplay(internal);
    });
  }

  getFieldState(handle: DuelHandle): FieldState {
    const internal = this.resolveHandle(handle);
    return this.queryFieldState(internal);
  }

  getActivationLog(handle: DuelHandle): ActivationLog {
    const internal = this.resolveHandle(handle);
    // Return the live Map — readers must not mutate. The ReadonlyMap type on
    // GameOracle enforces this at compile time.
    return internal.activationLog;
  }

  destroyDuel(handle: DuelHandle): void {
    const internal = this.findInternal(handle);
    if (!internal || !internal.isActive) return;
    this.destroyInternal(internal);
  }

  destroyAll(): void {
    for (const internal of this.activeHandles.values()) {
      try {
        this.core.destroyDuel(internal.nativeHandle);
      } catch { /* best effort */ }
      internal.isActive = false;
    }
    this.activeHandles.clear();
  }

  // ===========================================================================
  // Annotation: Action -> SolverAction enrichment
  // ===========================================================================

  enrichAction(action: Action): SolverAction {
    const cardName = this.getCardName(action.cardId);
    return {
      responseIndex: action.responseIndex,
      cardId: action.cardId,
      cardName,
      actionDescription: `${action.promptType} response ${action.responseIndex} (${cardName})`,
    };
  }

  // ===========================================================================
  // Internal: Native Duel Lifecycle
  // ===========================================================================

  private createNativeDuel(config: DuelConfig): OcgNativeHandle {
    const seed: [bigint, bigint, bigint, bigint] = config.deckSeed.length >= 4
      ? [config.deckSeed[0], config.deckSeed[1], config.deckSeed[2], config.deckSeed[3]]
      : [42n, 123n, 456n, 789n];

    const startingDrawCount = config.startingDrawCount ?? 5;
    const drawCountPerTurn = config.drawCountPerTurn ?? 1;

    const duel = this.core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed,
      team1: { startingLP: 8000, startingDrawCount, drawCountPerTurn },
      team2: { startingLP: 8000, startingDrawCount, drawCountPerTurn },
      cardReader: this.cardReader as never,
      scriptReader: this.scriptReader,
      errorHandler: () => {},
    });
    if (!duel) throw new Error('[Solver] Failed to create OCGCore duel');

    // Load startup scripts
    for (const name of STARTUP_SCRIPTS) {
      const content = this.scripts.startupScripts.get(name);
      if (content) this.core.loadScript(duel, name, content);
    }

    // Player 0 deck: hand -> HAND, mainDeck -> DECK, extraDeck -> EXTRA
    for (const code of config.hand) {
      this.core.duelNewCard(duel, {
        code, team: PLAYER, duelist: 0, controller: PLAYER,
        location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
    for (const code of config.mainDeck) {
      this.core.duelNewCard(duel, {
        code, team: PLAYER, duelist: 0, controller: PLAYER,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
    for (const code of config.extraDeck) {
      this.core.duelNewCard(duel, {
        code, team: PLAYER, duelist: 0, controller: PLAYER,
        location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }

    // Opponent deck: either provided or 40x filler
    const opponentDeck = config.opponentDeck.length > 0
      ? config.opponentDeck
      : Array(40).fill(FILLER_CARD);
    for (const code of opponentDeck) {
      this.core.duelNewCard(duel, {
        code, team: OPPONENT, duelist: 0, controller: OPPONENT,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }

    // Inject handtraps into opponent hand (adversarial mode)
    if (config.handtraps) {
      for (const ht of config.handtraps) {
        this.core.duelNewCard(duel, {
          code: ht.cardId, team: OPPONENT, duelist: 0, controller: OPPONENT,
          location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
        });
      }
    }

    this.core.startDuel(duel);
    return duel;
  }

  // ===========================================================================
  // Internal: Run Until Player Prompt
  // ===========================================================================

  /**
   * Process the duel loop until we find a SELECT_* prompt for player 0.
   * Auto-responds opponent prompts and mechanical prompts.
   * Returns the legal actions array when an exploratory prompt is found.
   */
  private runUntilPlayerPrompt(internal: InternalHandle): Action[] {
    while (true) {
      const status = this.core.duelProcess(internal.nativeHandle);
      const messages = this.core.duelGetMessage(internal.nativeHandle);

      // Track turn/phase from messages
      for (const m of messages) {
        if (m.type === OcgMessageType.NEW_TURN) {
          internal.turn = (m as unknown as { turn_count: number }).turn_count ?? internal.turn + 1;
          // Story 1.8: OPT counters reset on every NEW_TURN. The solver
          // currently runs only turn 1 in goldfish mode, so this clear is
          // defensive — but Epic 2 (adversarial multi-turn) will rely on it.
          internal.activationLog.clear();
        } else if (m.type === OcgMessageType.NEW_PHASE) {
          const p = (m as unknown as { phase: number }).phase;
          if (p && PHASE_MAP[p]) internal.phase = PHASE_MAP[p];
        }
      }

      if (status === OcgProcessResult.END) return [];

      if (status === OcgProcessResult.WAITING) {
        const selectMsg = messages.find((m) => SELECT_MSG_TYPES.has(m.type));
        if (!selectMsg) return [];

        const promptType = MESSAGE_TO_PROMPT[selectMsg.type];
        const msgAny = selectMsg as unknown as Record<string, unknown>;

        // Opponent prompts
        if ((msgAny['player'] as number) === OPPONENT) {
          // Adversarial mode: yield opponent SELECT_CHAIN to the solver so
          // the minimax tree can explore opponent activation timing. All
          // configured handtraps are always available (no subset filter).
          const isAdversarial = (internal.config.handtraps?.length ?? 0) > 0;
          if (isAdversarial && promptType === 'SELECT_CHAIN') {
            const actions = this.enumerateActionsWithResponses(msgAny, promptType);
            // Tag all actions as opponent (team: 1)
            for (const a of actions) a.team = 1;
            return actions;
          }
          // All other opponent prompts: auto-respond
          const resp = this.autoRespondOpponent(msgAny);
          this.core.duelSetResponse(internal.nativeHandle, resp as never);
          internal.responseHistory.push(resp);
          continue;
        }

        // Mechanical prompts: auto-resolve with defaults
        if (promptType && !EXPLORATORY_PROMPTS.has(promptType)) {
          const resp = this.autoRespondMechanical(msgAny, internal.config);
          this.core.duelSetResponse(internal.nativeHandle, resp as never);
          internal.responseHistory.push(resp);
          continue;
        }

        // Exploratory prompt for player 0 — enumerate legal actions
        if (promptType) {
          return this.enumerateActionsWithResponses(msgAny, promptType);
        }

        return [];
      }
      // CONTINUE → loop
    }
  }

  // ===========================================================================
  // Internal: Action -> OCGCore Response Conversion
  // ===========================================================================

  private actionToResponse(action: Action): unknown {
    // Prefer response stored on the action itself (survives DFS recursion)
    if (action._response !== undefined) return action._response;

    const cached = this._lastActionResponses.get(action.responseIndex);
    if (cached) return cached;

    // Fallback for non-cached prompts (EFFECTYN, YESNO, OPTION, CHAIN)
    switch (action.promptType) {
      case 'SELECT_CHAIN':
        return { type: 8, index: action.responseIndex === -1 ? null : action.responseIndex };
      case 'SELECT_EFFECTYN':
        return { type: 2, yes: action.responseIndex === 1 };
      case 'SELECT_YESNO':
        return { type: 3, yes: action.responseIndex === 1 };
      case 'SELECT_OPTION':
        return { type: 4, index: action.responseIndex };
      default:
        throw new Error(`[Solver] Cannot convert action with promptType ${action.promptType}`);
    }
  }

  // Cache: responseIndex -> OCGCore response object for the last enumerated prompt.
  // Single-threaded worker context: only one handle calls getLegalActions at a time,
  // so a single instance-level cache is safe. Cleared on each getLegalActions call.
  private _lastActionResponses = new Map<number, unknown>();

  /**
   * Enumerate legal actions and cache their OCGCore response objects.
   * The response cache is used by actionToResponse() to convert Actions back
   * to the format OCGCore expects (which varies per prompt type and sub-action).
   */
  private enumerateActionsWithResponses(msg: Record<string, unknown>, promptType: PromptType): Action[] {
    this._lastActionResponses.clear();
    const actions: Action[] = [];
    const isExploratory = true;

    // Helper: cache response AND store it on the action for DFS recursion safety
    const pushAction = (action: Action, response: unknown): void => {
      action._response = response;
      this._lastActionResponses.set(action.responseIndex, response);
      actions.push(action);
    };

    // Story 1.8: a card whose effect is "activated" from EXTRA is by
    // construction a Synchro/Xyz/Link summon procedure, NOT an interruption
    // effect activation. The interruption effect (if any) only exists once
    // the monster is on the field. `isFieldActivation` (in
    // interruption-disambiguation.ts) filters EXTRA out at the source so
    // the activation log stays clean.

    switch (promptType) {
      case 'SELECT_IDLECMD': {
        let idx = 0;
        for (let i = 0; i < ((msg['summons'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['summons'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory }, { type: 1, action: 0, index: i });
        }
        for (let i = 0; i < ((msg['special_summons'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['special_summons'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory }, { type: 1, action: 1, index: i });
        }
        for (let i = 0; i < ((msg['pos_changes'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['pos_changes'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory }, { type: 1, action: 2, index: i });
        }
        for (let i = 0; i < ((msg['monster_sets'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['monster_sets'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory }, { type: 1, action: 3, index: i });
        }
        for (let i = 0; i < ((msg['spell_sets'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['spell_sets'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory }, { type: 1, action: 4, index: i });
        }
        for (let i = 0; i < ((msg['activates'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['activates'] as { code: number; location?: number }[])[i]);
          pushAction({
            responseIndex: idx++, cardId: card.code, promptType, isExploratory,
            actionTag: 'activate',
            _isEffectActivation: isFieldActivation(card.location),
          }, { type: 1, action: 5, index: i });
        }
        if (msg['to_bp']) {
          pushAction({ responseIndex: idx++, cardId: 0, promptType, isExploratory }, { type: 1, action: 6 });
        }
        if (msg['to_ep']) {
          pushAction({ responseIndex: idx++, cardId: 0, promptType, isExploratory }, { type: 1, action: 7 });
        }
        break;
      }
      case 'SELECT_BATTLECMD': {
        let idx = 0;
        for (let i = 0; i < ((msg['attacks'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['attacks'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'attack' }, { type: 0, action: 0, index: i });
        }
        for (let i = 0; i < ((msg['chains'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['chains'] as { code: number; location?: number }[])[i]);
          pushAction({
            responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'chain',
            _isEffectActivation: isFieldActivation(card.location),
          }, { type: 0, action: 1, index: i });
        }
        if (msg['to_m2']) {
          pushAction({ responseIndex: idx++, cardId: 0, promptType, isExploratory, actionTag: 'to_m2' }, { type: 0, action: 2 });
        }
        if (msg['to_ep']) {
          pushAction({ responseIndex: idx++, cardId: 0, promptType, isExploratory, actionTag: 'to_ep' }, { type: 0, action: 3 });
        }
        break;
      }
      case 'SELECT_CHAIN': {
        const selects = (msg['selects'] ?? []) as { code: number; description: bigint; location?: number }[];
        for (let i = 0; i < selects.length; i++) {
          pushAction({
            responseIndex: i, cardId: selects[i].code, promptType, isExploratory,
            description: this.decodeDescription(selects[i].description),
            actionTag: 'activate',
            _isEffectActivation: isFieldActivation(selects[i].location),
          }, { type: 8, index: i });
        }
        if (!(msg['forced'] as boolean)) {
          pushAction({ responseIndex: -1, cardId: 0, promptType, isExploratory, actionTag: 'pass' }, { type: 8, index: null });
        }
        break;
      }
      case 'SELECT_EFFECTYN': {
        const cardId = (msg['code'] as number) ?? 0;
        // Only the "yes" branch represents an actual effect activation. The
        // "no" branch declines the trigger and must NOT pollute the OPT log.
        pushAction({ responseIndex: 0, cardId, promptType, isExploratory }, { type: 2, yes: false });
        pushAction({ responseIndex: 1, cardId, promptType, isExploratory, _isEffectActivation: true }, { type: 2, yes: true });
        break;
      }
      case 'SELECT_YESNO': {
        pushAction({ responseIndex: 0, cardId: 0, promptType, isExploratory }, { type: 3, yes: false });
        pushAction({ responseIndex: 1, cardId: 0, promptType, isExploratory }, { type: 3, yes: true });
        break;
      }
      case 'SELECT_OPTION': {
        const options = (msg['options'] ?? []) as unknown[];
        for (let i = 0; i < options.length; i++) {
          pushAction({ responseIndex: i, cardId: 0, promptType, isExploratory }, { type: 4, index: i });
        }
        break;
      }
    }

    return actions;
  }

  // ===========================================================================
  // Internal: Mechanical & Opponent Auto-Responses
  // ===========================================================================

  private autoRespondMechanical(msg: Record<string, unknown>, config?: DuelConfig): unknown {
    const type = (msg as { type: number }).type;
    switch (type) {
      case OcgMessageType.SELECT_POSITION:
        return { type: 11, position: OcgPosition.FACEUP_ATTACK };
      case OcgMessageType.SELECT_PLACE:
        return { type: 10, places: decodeFieldMask(msg['field_mask'] as number, msg['count'] as number) };
      case OcgMessageType.SELECT_DISFIELD:
        return { type: 9, places: decodeFieldMask(msg['field_mask'] as number, msg['count'] as number) };
      case OcgMessageType.SELECT_TRIBUTE:
        return { type: 12, indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i) };
      case OcgMessageType.SELECT_SUM:
        return { type: 14, indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i) };
      case OcgMessageType.SELECT_COUNTER:
        return { type: 13, counters: ((msg['cards'] ?? []) as unknown[]).map(() => 0) };
      case OcgMessageType.SELECT_CARD: {
        const min = (msg['min'] as number) ?? 1;
        const selects = (msg['selects'] as { code?: number; location?: number }[] | undefined) ?? [];
        // Spike-only: apply `config.preferredSearchTargets` ONLY when every
        // candidate is located in the DECK — i.e. this is a pure search-
        // from-deck prompt like Dracotail Lukias or Mitsurugi Prayers.
        //
        // Broadening the gate to include GY or FIELD pools was attempted
        // in the 2026-04-13 spike round 4 and rolled back: adding FIELD
        // caused self-bounce on Arthalion (Arthalion on player field was
        // in its own bounce pool and got picked as a preferred cardId),
        // and adding GY-only caused regressions on other GY-sourced
        // selections. DECK-only is the only gate that gave a stable
        // Arthalion match on Branded Dracotail.
        const preferred = config?.preferredSearchTargets;
        const allFromDeck = selects.length > 0
          && selects.every(s => s.location === OcgLocation.DECK);
        if (allFromDeck && preferred && preferred.length > 0) {
          const preferredSet = new Set(preferred);
          const preferredIdx: number[] = [];
          for (let i = 0; i < selects.length && preferredIdx.length < min; i++) {
            const code = selects[i].code;
            if (code !== undefined && preferredSet.has(code)) preferredIdx.push(i);
          }
          // Top up with remaining indices (first available non-preferred)
          // if we didn't find `min` preferred matches.
          if (preferredIdx.length < min) {
            for (let i = 0; i < selects.length && preferredIdx.length < min; i++) {
              if (!preferredIdx.includes(i)) preferredIdx.push(i);
            }
          }
          return { type: 5, indicies: preferredIdx };
        }
        return { type: 5, indicies: Array.from({ length: min }, (_, i) => i) };
      }
      case OcgMessageType.SELECT_UNSELECT_CARD:
        if (msg['can_finish']) return { type: 7, index: null };
        return { type: 7, index: 0 };
      default:
        // Latent risk on OCGCore upgrades: an unhandled prompt type silently
        // falls back to SELECT_OPTION first choice. Throw in dev to surface
        // it; keep the fallback in prod so live solves don't crash.
        solverAssert(
          false,
          'OCGCoreAdapter.autoRespondMechanical',
          `unhandled msg.type=${type} — falling back to SELECT_OPTION first choice`,
          { msg },
        );
        return { type: 4, index: 0 };
    }
  }

  private autoRespondOpponent(msg: Record<string, unknown>): unknown {
    const type = (msg as { type: number }).type;
    switch (type) {
      case OcgMessageType.SELECT_IDLECMD:
        return (msg['to_ep']) ? { type: 1, action: 7 } : { type: 1, action: 6 };
      case OcgMessageType.SELECT_BATTLECMD:
        return (msg['to_ep']) ? { type: 0, action: 3 } : { type: 0, action: 2 };
      case OcgMessageType.SELECT_CHAIN:
        return { type: 8, index: null };
      case OcgMessageType.SELECT_EFFECTYN:
        return { type: 2, yes: true };
      case OcgMessageType.SELECT_YESNO:
        return { type: 3, yes: false };
      default:
        return this.autoRespondMechanical(msg);
    }
  }

  // ===========================================================================
  // Internal: Field State Query (delegated to ocg-field-query.ts)
  // ===========================================================================

  private queryFieldState(internal: InternalHandle): FieldState {
    return queryFieldState({
      core: this.core,
      nativeHandle: internal.nativeHandle,
      turn: internal.turn,
      phase: internal.phase,
      getCardName: (code) => this.getCardName(code),
    });
  }

  // ===========================================================================
  // Internal: Fork via Replay
  // ===========================================================================

  private forkViaReplay(parent: InternalHandle): DuelHandle {
    const nativeHandle = this.createNativeDuel(parent.config);

    // Replay all responses from parent. If WASM throws mid-replay, the
    // partially-built native duel must be released — otherwise it leaks
    // outside `activeHandles`, never reaching `destroyAll()`.
    try {
      for (const resp of parent.responseHistory) {
        this.runUntilWaitingRaw(nativeHandle);
        this.core.duelSetResponse(nativeHandle, resp as never);
      }
      // After all replayed responses, advance the engine to its next
      // waiting state so the caller (applyAction) can immediately set the
      // next response. Without this, a fork from a parent with empty
      // responseHistory would hand back an engine still at its initial
      // pre-duel state — subsequent duelSetResponse would either no-op or
      // misalign with what OCGCore expects. Empirically isolated via the
      // empirical-validation spike (SELECT_EFFECTYN never surfaced through
      // DFS even though direct-apply probes saw it).
      this.runUntilWaitingRaw(nativeHandle);
    } catch (err) {
      try { this.core.destroyDuel(nativeHandle); } catch { /* best effort */ }
      throw new Error(`[Solver] forkViaReplay failed at step ${parent.responseHistory.length}: ${String(err)}`);
    }

    const id = this.nextHandleId++;
    const internal: InternalHandle = {
      id,
      nativeHandle,
      actionHistory: [...parent.actionHistory],
      responseHistory: [...parent.responseHistory],
      config: parent.config,
      isActive: true,
      turn: parent.turn,
      phase: parent.phase,
      // Story 1.8: deep clone the activation log so DFS branches do not share
      // state. Each entry is a fresh array — mutating the parent's log after
      // a fork must NOT affect the child, and vice versa.
      activationLog: cloneActivationLog(parent.activationLog),
    };
    this.activeHandles.set(id, internal);
    return this.toPublicHandle(internal);
  }

  // ===========================================================================
  // Internal: Activation Log Tracking (Story 1.8)
  // ===========================================================================

  /** Records a player-side activation of a tagged card into the handle's
   *  activation log. Called from `applyAction` after the OCGCore response is
   *  set. The `_isEffectActivation` flag is set by `enumerateActionsWithResponses`
   *  at the source — see that method for which prompt sub-types qualify. This
   *  filter excludes summons, sets, attacks, summon procedures from EXTRA, and
   *  SELECT_EFFECTYN "no" responses. The effect index is resolved via
   *  `disambiguateEffect()` using the tag's `trigger` field. */
  private recordActivation(internal: InternalHandle, action: Action): void {
    if (action._isEffectActivation !== true) return;
    if (action.cardId <= 0) return; // belt-and-braces (pass-action carries cardId=0)
    const tag = this.tags[String(action.cardId)];
    if (!tag) return;

    // Pass action.description through so disambiguateEffect can break trigger
    // ties via keyword matching (e.g. Underworld Goddess omniNegate(quick) +
    // controlChange(quick) — same trigger, distinguished by description).
    // H1 fix from Epic 1 review.
    const effectIndex = disambiguateEffect(tag, action.cardId, action.promptType, action.description);
    const log = internal.activationLog.get(action.cardId);
    if (log) {
      log.push(effectIndex);
    } else {
      internal.activationLog.set(action.cardId, [effectIndex]);
    }
  }

  /** Run duelProcess until WAITING or END — used during replay phase. */
  private runUntilWaitingRaw(nativeHandle: OcgNativeHandle): void {
    while (true) {
      const status = this.core.duelProcess(nativeHandle);
      if (status === OcgProcessResult.END || status === OcgProcessResult.WAITING) return;
    }
  }

  // ===========================================================================
  // Internal: Helpers
  // ===========================================================================

  private decodeDescription(desc: bigint): string | undefined {
    if (typeof desc !== 'bigint') return undefined;
    const cardCode = Number(desc >> 20n);
    const strIndex = Number(desc & 0xFFFFFn);
    if (!cardCode) return undefined;
    const row = this.cardDB.descStmt.get(cardCode) as Record<string, string> | undefined;
    if (!row) return undefined;
    return row[`str${strIndex + 1}`] || undefined;
  }

  private getCardName(code: number): string {
    if (!code) return '';
    const row = this.cardDB.nameStmt.get(code) as { name: string } | undefined;
    return row?.name ?? `#${code}`;
  }

  private resolveHandle(handle: DuelHandle): InternalHandle {
    const internal = this.findInternal(handle);
    if (!internal || !internal.isActive) {
      throw new Error(`[Solver] Invalid or inactive DuelHandle id=${handle.id}`);
    }
    return internal;
  }

  private findInternal(handle: DuelHandle): InternalHandle | undefined {
    return this.activeHandles.get(handle.id);
  }

  private toPublicHandle(internal: InternalHandle): DuelHandle {
    return {
      id: internal.id,
      get actionHistory() { return [...internal.actionHistory]; },
      get isActive() { return internal.isActive; },
    };
  }

  private destroyInternal(internal: InternalHandle): void {
    try {
      this.core.destroyDuel(internal.nativeHandle);
    } catch { /* best effort */ }
    internal.isActive = false;
    this.activeHandles.delete(internal.id);
  }

  // ===========================================================================
  // Smoke Test
  // ===========================================================================

  private runSmokeTest(): void {
    try {
      // Create a dummy duel to test WASM health
      const duel = this.core.createDuel({
        flags: OcgDuelMode.MODE_MR5,
        seed: [1n, 2n, 3n, 4n],
        team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
        team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
        cardReader: this.cardReader as never,
        scriptReader: this.scriptReader,
        errorHandler: () => {},
      });

      if (!duel) {
        console.warn('[Solver] WASM smoke test FAILED: could not create duel');
        this._snapshotAvailable = false;
        return;
      }

      // WASM Memory snapshot is not available in current @n1xx1/ocgcore-wasm
      // The API would be: new ArrayBuffer from wasm.memory.buffer
      // Since it's not exposed, we mark snapshot as unavailable
      this._snapshotAvailable = false;
      console.log(`[Solver] WASM smoke test passed (snapshot: ${this._snapshotAvailable ? 'available' : 'not available — using replay fallback'})`);

      this.core.destroyDuel(duel);
    } catch (err) {
      console.warn('[Solver] WASM smoke test FAILED:', err);
      this._snapshotAvailable = false;
    }
  }
}
