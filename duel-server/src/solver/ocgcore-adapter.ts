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
  OcgQueryFlags,
  type OcgCoreSync,
  type OcgDuelHandle as OcgNativeHandle,
  type OcgMessage,
} from '@n1xx1/ocgcore-wasm';

import type { CardDB, ScriptDB } from '../types.js';
import type { Phase, ZoneId } from '../ws-protocol.js';
import { STARTUP_SCRIPTS } from '../ocg-scripts.js';
import { createCardReader, createScriptReader } from '../ocg-callbacks.js';
import type { GameOracle, DuelHandle } from './game-oracle.js';
import type { Action, DuelConfig, FieldCard, FieldState, SolverAction, PromptType } from './solver-types.js';
import { EXPLORATORY_PROMPTS } from './solver-types.js';

// =============================================================================
// Constants
// =============================================================================

const PLAYER = 0 as const;
const OPPONENT = 1 as const;
const FILLER_CARD = 43096270; // Alexandrite Dragon (vanilla Lv4)

const PHASE_MAP: Record<number, Phase> = {
  0x01: 'DRAW',
  0x02: 'STANDBY',
  0x04: 'MAIN1',
  0x08: 'BATTLE_START',
  0x10: 'BATTLE_STEP',
  0x20: 'DAMAGE',
  0x40: 'DAMAGE_CALC',
  0x80: 'BATTLE',
  0x100: 'MAIN2',
  0x200: 'END',
};

const POSITION_MAP: Record<number, FieldCard['position']> = {
  [OcgPosition.FACEUP_ATTACK]: 'faceup-atk',
  [OcgPosition.FACEUP_DEFENSE]: 'faceup-def',
  [OcgPosition.FACEDOWN_DEFENSE]: 'facedown-def',
  [OcgPosition.FACEDOWN_ATTACK]: 'facedown',
};

// OCGCore SELECT_* message types mapped to our PromptType
const MESSAGE_TO_PROMPT: Record<number, PromptType> = {
  [OcgMessageType.SELECT_IDLECMD]: 'SELECT_IDLECMD',
  [OcgMessageType.SELECT_BATTLECMD]: 'SELECT_BATTLECMD',
  [OcgMessageType.SELECT_CHAIN]: 'SELECT_CHAIN',
  [OcgMessageType.SELECT_EFFECTYN]: 'SELECT_EFFECTYN',
  [OcgMessageType.SELECT_YESNO]: 'SELECT_YESNO',
  [OcgMessageType.SELECT_OPTION]: 'SELECT_OPTION',
  [OcgMessageType.SELECT_CARD]: 'SELECT_CARD',
  [OcgMessageType.SELECT_UNSELECT_CARD]: 'SELECT_UNSELECT_CARD',
  [OcgMessageType.SELECT_POSITION]: 'SELECT_POSITION',
  [OcgMessageType.SELECT_PLACE]: 'SELECT_PLACE',
  [OcgMessageType.SELECT_TRIBUTE]: 'SELECT_TRIBUTE',
  [OcgMessageType.SELECT_SUM]: 'SELECT_SUM',
  [OcgMessageType.SELECT_COUNTER]: 'SELECT_COUNTER',
  [OcgMessageType.SELECT_DISFIELD]: 'SELECT_DISFIELD',
};

// SELECT_* message types that we recognize
const SELECT_MSG_TYPES = new Set(Object.keys(MESSAGE_TO_PROMPT).map(Number));

// All ZoneId values — kept in sync with ws-protocol.ts ZoneId type
const ALL_ZONE_IDS: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
  'GY', 'BANISHED', 'EXTRA', 'DECK', 'HAND',
] satisfies readonly ZoneId[];

// =============================================================================
// Runtime field types (richer than @n1xx1/ocgcore-wasm type defs)
// =============================================================================

interface RuntimeFieldCard {
  code: number;
  position: number;
  materials: number;
}

interface RuntimeFieldPlayer {
  lp: number;
  monsters: (RuntimeFieldCard | null)[];
  spells: (RuntimeFieldCard | null)[];
  deck_size: number;
  hand_size: number;
  grave_size: number;
  banish_size: number;
  extra_size: number;
  extra_faceup_count: number;
}

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

  get snapshotAvailable(): boolean {
    return this._snapshotAvailable;
  }

  private constructor(core: OcgCoreSync, cardDB: CardDB, scripts: ScriptDB) {
    this.core = core;
    this.cardDB = cardDB;
    this.scripts = scripts;
    this.cardReader = createCardReader(cardDB);
    this.scriptReader = createScriptReader(scripts);
  }

  /**
   * Factory: initialize OCGCore WASM, run smoke test, return adapter.
   */
  static async create(cardDB: CardDB, scripts: ScriptDB): Promise<OCGCoreAdapter> {
    const core = await createCore({ sync: true });
    const version = core.getVersion();
    console.log(`[Solver] OCGCore v${version[0]}.${version[1]} initialized`);

    const adapter = new OCGCoreAdapter(core, cardDB, scripts);
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
    const internal = this.resolveHandle(handle);
    const response = this.actionToResponse(action);
    this.core.duelSetResponse(internal.nativeHandle, response as never);
    internal.actionHistory.push(action);
    internal.responseHistory.push(response);
  }

  fork(handle: DuelHandle): DuelHandle {
    const internal = this.resolveHandle(handle);
    // WASM Memory snapshot not available in current @n1xx1/ocgcore-wasm v0.1.1.
    // When snapshot API becomes available, try snapshot here with
    // try/catch fallback to forkViaReplay on failure.
    return this.forkViaReplay(internal);
  }

  getFieldState(handle: DuelHandle): FieldState {
    const internal = this.resolveHandle(handle);
    return this.queryFieldState(internal);
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

    const duel = this.core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed,
      team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
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

        // Opponent prompts: always auto-respond
        if ((msgAny['player'] as number) === OPPONENT) {
          const resp = this.autoRespondOpponent(msgAny);
          this.core.duelSetResponse(internal.nativeHandle, resp as never);
          internal.responseHistory.push(resp);
          continue;
        }

        // Mechanical prompts: auto-resolve with defaults
        if (promptType && !EXPLORATORY_PROMPTS.has(promptType)) {
          const resp = this.autoRespondMechanical(msgAny);
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

    switch (promptType) {
      case 'SELECT_IDLECMD': {
        let idx = 0;
        for (let i = 0; i < ((msg['summons'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['summons'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 1, action: 0, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        for (let i = 0; i < ((msg['special_summons'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['special_summons'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 1, action: 1, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        for (let i = 0; i < ((msg['pos_changes'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['pos_changes'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 1, action: 2, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        for (let i = 0; i < ((msg['monster_sets'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['monster_sets'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 1, action: 3, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        for (let i = 0; i < ((msg['spell_sets'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['spell_sets'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 1, action: 4, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        for (let i = 0; i < ((msg['activates'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['activates'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 1, action: 5, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        if (msg['to_bp']) {
          this._lastActionResponses.set(idx, { type: 1, action: 6 });
          actions.push({ responseIndex: idx++, cardId: 0, promptType, isExploratory });
        }
        if (msg['to_ep']) {
          this._lastActionResponses.set(idx, { type: 1, action: 7 });
          actions.push({ responseIndex: idx++, cardId: 0, promptType, isExploratory });
        }
        break;
      }
      case 'SELECT_BATTLECMD': {
        let idx = 0;
        for (let i = 0; i < ((msg['attacks'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['attacks'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 0, action: 0, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        for (let i = 0; i < ((msg['chains'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['chains'] as { code: number }[])[i]);
          this._lastActionResponses.set(idx, { type: 0, action: 1, index: i });
          actions.push({ responseIndex: idx++, cardId: card.code, promptType, isExploratory });
        }
        if (msg['to_m2']) {
          this._lastActionResponses.set(idx, { type: 0, action: 2 });
          actions.push({ responseIndex: idx++, cardId: 0, promptType, isExploratory });
        }
        if (msg['to_ep']) {
          this._lastActionResponses.set(idx, { type: 0, action: 3 });
          actions.push({ responseIndex: idx++, cardId: 0, promptType, isExploratory });
        }
        break;
      }
      case 'SELECT_CHAIN': {
        const selects = (msg['selects'] ?? []) as { code: number }[];
        for (let i = 0; i < selects.length; i++) {
          this._lastActionResponses.set(i, { type: 8, index: i });
          actions.push({ responseIndex: i, cardId: selects[i].code, promptType, isExploratory });
        }
        if (!(msg['forced'] as boolean)) {
          this._lastActionResponses.set(-1, { type: 8, index: null });
          actions.push({ responseIndex: -1, cardId: 0, promptType, isExploratory });
        }
        break;
      }
      case 'SELECT_EFFECTYN': {
        const cardId = (msg['code'] as number) ?? 0;
        this._lastActionResponses.set(0, { type: 2, yes: false });
        this._lastActionResponses.set(1, { type: 2, yes: true });
        actions.push(
          { responseIndex: 0, cardId, promptType, isExploratory },
          { responseIndex: 1, cardId, promptType, isExploratory },
        );
        break;
      }
      case 'SELECT_YESNO': {
        this._lastActionResponses.set(0, { type: 3, yes: false });
        this._lastActionResponses.set(1, { type: 3, yes: true });
        actions.push(
          { responseIndex: 0, cardId: 0, promptType, isExploratory },
          { responseIndex: 1, cardId: 0, promptType, isExploratory },
        );
        break;
      }
      case 'SELECT_OPTION': {
        const options = (msg['options'] ?? []) as unknown[];
        for (let i = 0; i < options.length; i++) {
          this._lastActionResponses.set(i, { type: 4, index: i });
          actions.push({ responseIndex: i, cardId: 0, promptType, isExploratory });
        }
        break;
      }
    }

    return actions;
  }

  // ===========================================================================
  // Internal: Mechanical & Opponent Auto-Responses
  // ===========================================================================

  private autoRespondMechanical(msg: Record<string, unknown>): unknown {
    const type = (msg as { type: number }).type;
    switch (type) {
      case OcgMessageType.SELECT_POSITION:
        return { type: 11, position: OcgPosition.FACEUP_ATTACK };
      case OcgMessageType.SELECT_PLACE:
        return { type: 10, places: this.decodeFieldMask(msg['field_mask'] as number, msg['count'] as number) };
      case OcgMessageType.SELECT_DISFIELD:
        return { type: 9, places: this.decodeFieldMask(msg['field_mask'] as number, msg['count'] as number) };
      case OcgMessageType.SELECT_TRIBUTE:
        return { type: 12, indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i) };
      case OcgMessageType.SELECT_SUM:
        return { type: 14, indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i) };
      case OcgMessageType.SELECT_COUNTER:
        return { type: 13, counters: ((msg['cards'] ?? []) as unknown[]).map(() => 0) };
      case OcgMessageType.SELECT_CARD:
        return { type: 5, indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i) };
      case OcgMessageType.SELECT_UNSELECT_CARD:
        if (msg['can_finish']) return { type: 7, index: null };
        return { type: 7, index: 0 };
      default:
        return { type: 4, index: 0 }; // Fallback: SELECT_OPTION first choice
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
  // Internal: Field State Query
  // ===========================================================================

  // Runtime field card shape (richer than @n1xx1/ocgcore-wasm type defs)
  private queryFieldState(internal: InternalHandle): FieldState {
    const field = this.core.duelQueryField(internal.nativeHandle);

    const zones: Record<string, FieldCard[]> = {};

    // @n1xx1/ocgcore-wasm type defs are incomplete — cast through unknown
    const p0 = field.players[PLAYER] as unknown as RuntimeFieldPlayer;
    const p1 = field.players[OPPONENT] as unknown as RuntimeFieldPlayer;

    for (const z of ALL_ZONE_IDS) zones[z] = [];

    // Monster zones (player 0): M1-M5 = sequences 0-4, EMZ_L = 5, EMZ_R = 6
    for (let seq = 0; seq < p0.monsters.length; seq++) {
      const card = p0.monsters[seq];
      if (card && card.code && card.position) {
        const zoneId = seq < 5 ? `M${seq + 1}` : (seq === 5 ? 'EMZ_L' : 'EMZ_R');
        const overlayCount = this.queryOverlayCount(internal.nativeHandle, PLAYER, OcgLocation.MZONE, seq);
        zones[zoneId] = [{
          cardId: card.code,
          cardName: this.getCardName(card.code),
          position: POSITION_MAP[card.position] ?? 'faceup-atk',
          overlayCount,
        }];
      }
    }

    // Spell/Trap zones (player 0): S1-S5 = sequences 0-4, FIELD = 5
    for (let seq = 0; seq < p0.spells.length; seq++) {
      const card = p0.spells[seq];
      if (card && card.code && card.position) {
        const zoneId = seq < 5 ? `S${seq + 1}` : 'FIELD';
        zones[zoneId] = [{
          cardId: card.code,
          cardName: this.getCardName(card.code),
          position: POSITION_MAP[card.position] ?? 'facedown',
          overlayCount: 0,
        }];
      }
    }

    // Pile zones via duelQueryLocation
    zones['HAND'] = this.queryPileZone(internal.nativeHandle, PLAYER, OcgLocation.HAND);
    zones['GY'] = this.queryPileZone(internal.nativeHandle, PLAYER, OcgLocation.GRAVE);
    zones['BANISHED'] = this.queryPileZone(internal.nativeHandle, PLAYER, OcgLocation.REMOVED);
    zones['DECK'] = this.queryPileZone(internal.nativeHandle, PLAYER, OcgLocation.DECK);
    zones['EXTRA'] = this.queryPileZone(internal.nativeHandle, PLAYER, OcgLocation.EXTRA);

    return {
      zones: zones as Record<ZoneId, FieldCard[]>,
      lifePoints: [p0.lp, p1.lp],
      turn: internal.turn,
      phase: internal.phase,
    };
  }

  private queryOverlayCount(nativeHandle: OcgNativeHandle, controller: 0 | 1, location: number, sequence: number): number {
    try {
      const result = this.core.duelQuery(nativeHandle, {
        flags: OcgQueryFlags.OVERLAY_CARD as number,
        controller,
        location,
        sequence,
        overlaySequence: 0,
      } as never);
      return (result as { overlay_cards?: number[] })?.overlay_cards?.length ?? 0;
    } catch {
      return 0;
    }
  }

  private queryPileZone(nativeHandle: OcgNativeHandle, controller: 0 | 1, location: number): FieldCard[] {
    try {
      const cards = this.core.duelQueryLocation(nativeHandle, {
        flags: (OcgQueryFlags.CODE as number) | (OcgQueryFlags.POSITION as number),
        controller,
        location,
      } as never);
      return (cards as ({ code?: number; position?: number } | null)[])
        .filter((c): c is { code: number; position: number } => c != null && c.code !== undefined && c.code > 0)
        .map(c => ({
          cardId: c.code,
          cardName: this.getCardName(c.code),
          position: POSITION_MAP[c.position] ?? 'facedown',
          overlayCount: 0,
        }));
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Internal: Fork via Replay
  // ===========================================================================

  private forkViaReplay(parent: InternalHandle): DuelHandle {
    const nativeHandle = this.createNativeDuel(parent.config);

    // Replay all responses from parent
    for (const resp of parent.responseHistory) {
      this.runUntilWaitingRaw(nativeHandle);
      this.core.duelSetResponse(nativeHandle, resp as never);
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
    };
    this.activeHandles.set(id, internal);
    return this.toPublicHandle(internal);
  }

  /** Run duelProcess until WAITING or END — used during replay phase. */
  private runUntilWaitingRaw(nativeHandle: OcgNativeHandle): void {
    while (true) {
      const status = this.core.duelProcess(nativeHandle);
      if (status === OcgProcessResult.END || status === OcgProcessResult.WAITING) return;
    }
  }

  // ===========================================================================
  // Internal: Field Mask Decoding
  // ===========================================================================

  private decodeFieldMask(mask: number, count: number): { player: number; location: number; sequence: number }[] {
    const places: { player: number; location: number; sequence: number }[] = [];
    for (let p = 0; p < 2 && places.length < count; p++) {
      for (let seq = 0; seq < 5 && places.length < count; seq++) {
        const bit = p * 16 + seq;
        if (!(mask & (1 << bit))) {
          places.push({ player: p, location: OcgLocation.MZONE, sequence: seq });
        }
      }
      for (let seq = 0; seq < 5 && places.length < count; seq++) {
        const bit = p * 16 + 8 + seq;
        if (!(mask & (1 << bit))) {
          places.push({ player: p, location: OcgLocation.SZONE, sequence: seq });
        }
      }
    }
    return places;
  }

  // ===========================================================================
  // Internal: Helpers
  // ===========================================================================

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
