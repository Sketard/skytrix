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

import type { ZoneId as ZoneIdHelper } from '../ws-protocol.js';

/** Phase B: convert an OCGCore (location, sequence) pair to a solver ZoneId.
 *  Used to populate `Action.sourceZone` for `NeuralFeatureRanker` features.
 *  Returns `undefined` when the location can't be cleanly mapped (e.g. opp-side
 *  source — currently we treat all enumerated actions as self-perspective at
 *  SELECT_IDLECMD/BATTLECMD; SELECT_CHAIN may include opp-side chain links
 *  but we lack controller info in `selects[i]`, so we return the self-zone
 *  interpretation; Day 2 can plumb controller if needed). */
function ocgLocationToZoneId(
  location: number | undefined,
  sequence: number | undefined,
): ZoneIdHelper | undefined {
  if (location === undefined) return undefined;
  switch (location) {
    case OcgLocation.MZONE: {
      const s = sequence ?? 0;
      if (s < 5) return `M${s + 1}` as ZoneIdHelper;
      if (s === 5) return 'EMZ_L';
      if (s === 6) return 'EMZ_R';
      return undefined;
    }
    case OcgLocation.SZONE: {
      const s = sequence ?? 0;
      if (s < 5) return `S${s + 1}` as ZoneIdHelper;
      if (s === 5) return 'FIELD';
      return undefined;
    }
    case OcgLocation.PZONE:  // MR4 pendulum zone — only S1/S5 in MR5
      return sequence === 0 ? 'S1' : 'S5';
    case OcgLocation.FZONE: return 'FIELD';
    case OcgLocation.HAND: return 'HAND';
    case OcgLocation.GRAVE: return 'GY';
    case OcgLocation.REMOVED: return 'BANISHED';
    case OcgLocation.DECK: return 'DECK';
    case OcgLocation.EXTRA: return 'EXTRA';
    default: return undefined;
  }
}

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
  /** True when this handle was created by `forkViaSnapshot` and shares its
   *  `nativeHandle` with an ancestor. `destroyInternal` must NOT call
   *  `core.destroyDuel` on such handles — the native duel is owned by the
   *  stack root and would be destroyed twice. */
  isSnapshotChild?: boolean;
  /** Per-turn log of interruption effect activations consumed by this handle.
   *  Key: cardId. Value: list of effect indices (positions in
   *  `InterruptionTag.effects[]`) that have been activated, in chronological
   *  order. The same index can appear multiple times when an effect's
   *  `usesPerTurn > 1`. Cleared on every NEW_TURN. Cloned by `forkViaReplay`.
   *  Populated only for player-side activations of tagged cards (Story 1.8). */
  activationLog: Map<number, number[]>;
  /** Phase 5-lite trace-assist (2026-04-19) — accumulated partial picks for
   *  multi-pick mechanical prompts (SELECT_CARD min>1, SELECT_TRIBUTE,
   *  SELECT_SUM). Only populated when `adapter.exposeMultiPickMechanical` is
   *  true. The atomic OCG response is sent once the user issues a "commit"
   *  action; `picks` is then cleared. Caches the source msg so re-entry
   *  (second `getLegalActions` without engine advance) can re-enumerate. */
  pendingMultiPick?: PendingMultiPick;
}

interface PendingMultiPick {
  promptType: 'SELECT_CARD' | 'SELECT_TRIBUTE' | 'SELECT_SUM';
  responseType: 5 | 12 | 14;
  min: number;
  max: number;
  picks: number[];
  /** SELECT_SUM only: target sum to match against `sum(selects[i].amount)`. */
  targetSum?: number;
  /** Cached source message — re-used on re-entry (OCG drains message buffer). */
  cachedMsg: Record<string, unknown>;
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
  /** WebAssembly Memory captured at `create()` via a monkey-patch of
   *  `WebAssembly.instantiate`. When non-null, `fork` can bypass the
   *  create-duel-from-scratch + replay path and instead snapshot the entire
   *  WASM linear memory, giving ~10× throughput on deep DFS forks
   *  (validated by `poc-wasm-snapshot.ts`). */
  private wasmMemory: WebAssembly.Memory | null = null;
  /** LIFO stack of snapshots taken by `forkViaSnapshot`. Each entry records
   *  the child's logical id + the parent's WASM state at fork time. Popped
   *  and restored by `destroyDuel` when the child is released.
   *
   *  Invariant: DFS-style use only (push on fork, pop on destroy, top-only
   *  mutations in between). Non-LIFO access would corrupt the stack —
   *  `destroyDuel` falls back to regular native-destroy if the handle is not
   *  the current top. */
  private snapshotStack: Array<{ childId: number; parentSnapshot: ArrayBuffer }> = [];
  /** Toggle for the snapshot-based fork path. Enabled by passing
   *  `useSnapshot: true` to `create()` (or `SOLVER_USE_SNAPSHOT=1`). When
   *  false, `fork()` always takes the replay path — same behavior as before
   *  the snapshot feature landed. */
  private useSnapshot = false;
  /** Boot-loaded interruption tags (Story 1.8). Used by `applyAction` to
   *  detect player-side activations of tagged cards and update each handle's
   *  `activationLog`. Empty when the adapter is constructed without tags
   *  (legacy code paths and tests) — in that case the activation log stays
   *  empty and OPT-aware scoring degrades gracefully to pre-1.8 behavior. */
  private readonly tags: Record<string, InterruptionTag>;

  /** Phase 5-lite trace-assist (2026-04-19). When true, `runUntilPlayerPrompt`
   *  surfaces multi-pick mechanical prompts (SELECT_CARD min>1, SELECT_TRIBUTE,
   *  SELECT_SUM, SELECT_UNSELECT_CARD) as interactive Actions instead of
   *  auto-resolving them with first-N / first-index heuristics. Production DFS
   *  keeps this false (default) — the heuristic response is fine for scoring-
   *  bound exploration, and interactive multi-pick would produce non-terminal
   *  trees the DFS can't rank. Only set to true by `scripts/trace-assist.ts`. */
  exposeMultiPickMechanical = false;

  get snapshotAvailable(): boolean {
    return this._snapshotAvailable;
  }

  /** Accessor for boot-loaded interruption tags, consumed by ranker
   *  heuristics that promote "Set <card>" / "Activate <card>" actions for
   *  cards with tagged interruption effects. Returns the raw backing map —
   *  callers must not mutate. */
  getTags(): Record<string, InterruptionTag> {
    return this.tags;
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
    opts: { useSnapshot?: boolean } = {},
  ): Promise<OCGCoreAdapter> {
    // Capture the WebAssembly.Memory by hooking `WebAssembly.instantiate` for
    // the duration of `createCore`. The @n1xx1/ocgcore-wasm sync bundle exports
    // its Memory as instance.exports.r (confirmed by disassembly). We restore
    // the originals immediately after load so nothing else in the process is
    // affected. Failure here is non-fatal — the adapter just stays on the
    // replay-fork path.
    const captured: WebAssembly.Instance[] = [];
    const origInstantiate = WebAssembly.instantiate;
    const origStreaming = WebAssembly.instantiateStreaming;
    WebAssembly.instantiate = function patched(this: unknown, ...args: unknown[]): Promise<unknown> {
      const p = (origInstantiate as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown>;
      return Promise.resolve(p).then((result) => {
        const inst = result instanceof WebAssembly.Instance
          ? result
          : (result as { instance?: WebAssembly.Instance })?.instance;
        if (inst) captured.push(inst);
        return result;
      });
    } as typeof WebAssembly.instantiate;
    if (typeof origStreaming === 'function') {
      WebAssembly.instantiateStreaming = function patched(this: unknown, ...args: unknown[]): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
        const p = (origStreaming as (...a: unknown[]) => unknown).apply(this, args) as Promise<WebAssembly.WebAssemblyInstantiatedSource>;
        return Promise.resolve(p).then((result) => {
          if (result?.instance) captured.push(result.instance);
          return result;
        });
      } as typeof WebAssembly.instantiateStreaming;
    }

    let core: OcgCoreSync;
    try {
      core = await createCore({ sync: true });
    } finally {
      WebAssembly.instantiate = origInstantiate;
      WebAssembly.instantiateStreaming = origStreaming;
    }
    const version = core.getVersion();
    console.log(`[Solver] OCGCore v${version[0]}.${version[1]} initialized`);

    const adapter = new OCGCoreAdapter(core, cardDB, scripts, tags);

    // Locate the WebAssembly.Memory among captured instances. Success flips
    // `_snapshotAvailable`; `useSnapshot` is the runtime toggle that decides
    // whether `fork()` actually uses the snapshot path.
    for (const inst of captured) {
      for (const exp of Object.values(inst.exports)) {
        if (exp instanceof WebAssembly.Memory) {
          adapter.wasmMemory = exp;
          break;
        }
      }
      if (adapter.wasmMemory) break;
    }
    adapter._snapshotAvailable = adapter.wasmMemory !== null;
    // Default: snapshot fork is ON when Memory capture succeeds. Validated
    // bit-identical vs replay on 15/15 fixtures (2026-04-23 sweep, 5.11×
    // speedup). Opt out with `SOLVER_USE_SNAPSHOT=0` or `{ useSnapshot: false }`.
    const envFlag = process.env.SOLVER_USE_SNAPSHOT;
    const envOptIn = envFlag === '1' || envFlag === 'true';
    const envOptOut = envFlag === '0' || envFlag === 'false';
    const wantSnapshot = opts.useSnapshot ?? (envOptOut ? false : true);
    adapter.useSnapshot = wantSnapshot && adapter._snapshotAvailable;
    if (adapter.useSnapshot) {
      console.log(`[Solver] WASM Memory captured (${adapter.wasmMemory!.buffer.byteLength} bytes) — snapshot fork enabled${envOptIn ? ' (env)' : ''}`);
    } else if (adapter._snapshotAvailable) {
      console.log(`[Solver] WASM Memory captured but snapshot fork disabled${envOptOut ? ' (SOLVER_USE_SNAPSHOT=0)' : ''}`);
    } else {
      console.log('[Solver] WASM Memory not captured — snapshot fork unavailable');
    }

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
    return instrumentTime('legalActions', () => {
      const internal = this.resolveHandle(handle);
      return this.runUntilPlayerPrompt(internal);
    });
  }

  applyAction(handle: DuelHandle, action: Action): void {
    return instrumentTime('apply', () => this._applyActionImpl(handle, action));
  }

  private _applyActionImpl(handle: DuelHandle, action: Action): void {
    const internal = this.resolveHandle(handle);

    // Phase 5-lite trace-assist: partial picks mutate pending state only;
    // they never reach duelSetResponse. actionHistory still records them so
    // `forkViaReplay` and trace-assist replay semantics stay consistent.
    if (action.actionTag === 'multi-pick-add') {
      const pending = internal.pendingMultiPick;
      if (!pending) throw new Error('[Solver] multi-pick-add without pending state');
      const sentinel = action._response as { __partialPickIndex?: number };
      if (sentinel?.__partialPickIndex === undefined) {
        throw new Error('[Solver] multi-pick-add missing __partialPickIndex sentinel');
      }
      pending.picks.push(sentinel.__partialPickIndex);
      internal.actionHistory.push(action);
      return;
    }
    if (action.actionTag === 'multi-pick-undo') {
      const pending = internal.pendingMultiPick;
      if (!pending || pending.picks.length === 0) {
        throw new Error('[Solver] multi-pick-undo with no pending picks');
      }
      pending.picks.pop();
      internal.actionHistory.push(action);
      return;
    }

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
    // Clear pending multi-pick state after a successful commit (or any other
    // action that reaches duelSetResponse — the atomic response is in-flight).
    if (action.actionTag === 'multi-pick-commit' || internal.pendingMultiPick) {
      internal.pendingMultiPick = undefined;
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
      if (this.useSnapshot && this.wasmMemory) {
        try {
          return this.forkViaSnapshot(internal);
        } catch (err) {
          // Snapshot path broke (e.g., unexpected Memory detach). Fall back
          // to replay so the solve continues, and log for diagnosis.
          console.warn(`[Solver] forkViaSnapshot failed, falling back to replay: ${String(err)}`);
        }
      }
      return this.forkViaReplay(internal);
    });
  }

  /** Phase K — create a fresh pristine duel matching an existing handle's
   *  config, without advancing the engine past its initial state. Unlike
   *  `fork()` which pre-advances to the first WAITING prompt (and thus
   *  corrupts a subsequent `runUntilPlayerPrompt` call that would normally
   *  drive the advance itself), this returns a handle identical to one
   *  produced by `createDuel(config)` — the caller must still call
   *  `getLegalActions()` to drive the first advance.
   *
   *  Used by iterative deepening to create a fresh iteration handle for
   *  each DFS pass, since the adapter's `runUntilPlayerPrompt` consumes
   *  engine messages on its first call and cannot be invoked twice on the
   *  same DuelHandle. */
  cloneFromConfig(handle: DuelHandle): DuelHandle {
    const internal = this.resolveHandle(handle);
    return this.createDuel(internal.config);
  }

  getFieldState(handle: DuelHandle): FieldState {
    return instrumentTime('fieldState', () => {
      const internal = this.resolveHandle(handle);
      return this.queryFieldState(internal);
    });
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

    // Snapshot path: if this handle is the top of the snapshot stack, pop and
    // restore — DO NOT native-destroy the shared OCG duel.
    const top = this.snapshotStack[this.snapshotStack.length - 1];
    if (internal.isSnapshotChild && top && top.childId === internal.id) {
      try {
        this.restoreTopSnapshot(internal.id);
      } catch (err) {
        // Restore failed — log, but still mark the handle inactive so the
        // solver doesn't dead-lock on a stuck fork stack.
        console.warn(`[Solver] snapshot restore failed: ${String(err)}`);
      }
      internal.isActive = false;
      this.activeHandles.delete(internal.id);
      return;
    }

    this.destroyInternal(internal);
  }

  destroyAll(): void {
    // Clear the snapshot stack first — the shared native handles belong to
    // ancestors and will be reaped below.
    this.snapshotStack.length = 0;
    for (const internal of this.activeHandles.values()) {
      if (!internal.isSnapshotChild) {
        try {
          this.core.destroyDuel(internal.nativeHandle);
        } catch { /* best effort */ }
      }
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

    // Seed mid-combo starting states: place cards directly into non-deck
    // zones before startDuel. Used by bridge-validator (2026-04-24) to
    // validate compositional bridges that assume prior state (e.g.,
    // Flamberge in GY, 2 Lv4 on field).
    if (config.initialPlacements && config.initialPlacements.length > 0) {
      const perZoneCounter = new Map<string, number>();
      for (const p of config.initialPlacements) {
        const controller = p.controller ?? PLAYER;
        const locMap: Record<string, OcgLocation> = {
          MZONE: OcgLocation.MZONE, SZONE: OcgLocation.SZONE,
          GRAVE: OcgLocation.GRAVE, REMOVED: OcgLocation.REMOVED,
          FZONE: OcgLocation.FZONE, PZONE: OcgLocation.PZONE,
          HAND: OcgLocation.HAND, EXTRA: OcgLocation.EXTRA, DECK: OcgLocation.DECK,
        };
        const location = locMap[p.zone];
        if (location === undefined) throw new Error(`[Solver] unknown initialPlacement zone: ${p.zone}`);
        const zoneKey = `${controller}:${p.zone}`;
        const autoSeq = perZoneCounter.get(zoneKey) ?? 0;
        const sequence = p.sequence ?? autoSeq;
        perZoneCounter.set(zoneKey, autoSeq + 1);
        const posMap: Record<string, OcgPosition> = {
          FACEUP_ATTACK: OcgPosition.FACEUP_ATTACK,
          FACEUP_DEFENSE: OcgPosition.FACEUP_DEFENSE,
          FACEDOWN_ATTACK: OcgPosition.FACEDOWN_ATTACK,
          FACEDOWN_DEFENSE: OcgPosition.FACEDOWN_DEFENSE,
        };
        const defaultPos = (p.zone === 'MZONE') ? OcgPosition.FACEUP_ATTACK
          : (p.zone === 'SZONE' || p.zone === 'PZONE' || p.zone === 'FZONE') ? OcgPosition.FACEDOWN
          : OcgPosition.FACEDOWN_ATTACK;
        const position = p.position ? posMap[p.position] : defaultPos;
        this.core.duelNewCard(duel, {
          code: p.cardId, team: controller, duelist: 0, controller,
          location, sequence, position,
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
    // Phase 5-lite trace-assist: re-entry after a partial pick. The engine has
    // NOT been advanced (no duelSetResponse was sent), so OCG's message buffer
    // is drained — we can't re-read the SELECT_* msg. Re-enumerate from the
    // cached msg instead.
    if (this.exposeMultiPickMechanical && internal.pendingMultiPick) {
      return this.enumerateMultiPickAtomic(internal);
    }

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
            const actions = this.enumerateActionsWithResponses(msgAny, promptType, internal.config);
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
          // Phase 5-lite trace-assist: expose multi-pick mechanical prompts as
          // interactive actions BEFORE the existing exploratory gates (those
          // only handle single-pick SELECT_CARD). The interactive path covers
          // SELECT_CARD min>1, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD.
          if (this.exposeMultiPickMechanical) {
            const interactive = this.tryInteractiveMechanical(msgAny, promptType, internal);
            if (interactive !== null) return interactive;
          }
          // Phase A #3 — constraint 2.1 / SELECT_CARD context-aware: when the
          // SELECT_CARD prompt is a small-pool single-pick (≤
          // SELECT_CARD_EXPLORATORY_MAX candidates, min=max=1), expose it as
          // an exploratory branch point instead of auto-resolving. The DFS
          // then branches on each candidate and discovers which pick unlocks
          // the real combo line (e.g. Lukias → Mululu vs other Dracotail
          // search targets, Arthalion's bounce target selection, Faimena
          // fusion material picks). Larger pools or multi-pick prompts fall
          // through to the mechanical path with the existing DECK-only
          // preferredSearchTargets heuristic — branching a 20-candidate
          // SELECT_CARD would blow up the tree. See synthesis §7.10.6.
          if (promptType === 'SELECT_CARD'
            && this.selectCardIsExploratory(msgAny)) {
            return this.enumerateActionsWithResponses(msgAny, promptType, internal.config);
          }
          // 2026-04-15 large-pool tutor exposure: when the pool exceeds
          // SELECT_CARD_EXPLORATORY_MAX but `preferredSearchTargets`
          // contains matches, surface the top-K preferred matches as
          // branches. See SELECT_CARD_PREFERRED_EXPOSURE_K comment.
          if (promptType === 'SELECT_CARD'
            && this.selectCardIsPreferredExploratory(msgAny, internal.config)) {
            return this.enumeratePreferredSelectCard(msgAny, internal.config);
          }
          const resp = this.autoRespondMechanical(msgAny, internal.config);
          this.core.duelSetResponse(internal.nativeHandle, resp as never);
          internal.responseHistory.push(resp);
          continue;
        }

        // Exploratory prompt for player 0 — enumerate legal actions
        if (promptType) {
          return this.enumerateActionsWithResponses(msgAny, promptType, internal.config);
        }

        return [];
      }
      // CONTINUE → loop
    }
  }

  // ===========================================================================
  // Phase A #3 — SELECT_CARD exploratory gate
  // ===========================================================================

  /** Maximum pool size for which SELECT_CARD becomes a DFS branch point.
   *  6 balances coverage (Lukias search: 3-6 Dracotails; Arthalion bounce:
   *  1-5 opponent+own targets; Faimena fusion: 2-5 dragons) against tree
   *  explosion (6^N multiplier on multi-SELECT_CARD combos). Raising this
   *  risks budget starvation; lowering loses the Arthalion/Ecclesia line.
   *  Validated empirically in the 2026-04-14 Phase A #3 spike. */
  private static readonly SELECT_CARD_EXPLORATORY_MAX = 6;

  /** 2026-04-15 large-pool tutor branching cap. When a SELECT_CARD pool
   *  exceeds SELECT_CARD_EXPLORATORY_MAX but `preferredSearchTargets`
   *  contains K+ matches in the pool, expose the top-K preferred matches
   *  as DFS branch points instead of collapsing to a single mechanical
   *  pick. K=4 bounds multi-Gate branching (D/D/D: Gate x3) while still
   *  covering alternative combo lines. See the 2026-04-15 SELECT_CARD
   *  dump audit — D/D/D mainPath showed 2 Gate activations with ZERO
   *  SELECT_CARD branches exposed because pool > 6, preventing the DFS
   *  from discovering combo lines that require different per-activation
   *  tutor targets. */
  private static readonly SELECT_CARD_PREFERRED_EXPOSURE_K = 4;

  /** Return true when a SELECT_CARD prompt should be surfaced to the DFS
   *  as a branch point instead of auto-resolved. Single-pick only —
   *  multi-pick (min>1 or max>1) creates a combinatorial subset-selection
   *  problem that isn't amenable to per-candidate branching. */
  private selectCardIsExploratory(msg: Record<string, unknown>): boolean {
    const selects = (msg['selects'] as unknown[] | undefined) ?? [];
    const min = (msg['min'] as number) ?? 1;
    const max = (msg['max'] as number) ?? 1;
    return min === 1
      && max === 1
      && selects.length > 0
      && selects.length <= OCGCoreAdapter.SELECT_CARD_EXPLORATORY_MAX;
  }

  /** Return true when a LARGE-pool SELECT_CARD should be exposed as a
   *  DFS branch over top-K preferred targets. Complementary to
   *  `selectCardIsExploratory`: small pools handled there, large
   *  DECK-only pools with at least one preferred match handled here.
   *
   *  Gates (all must pass):
   *  - single-pick (min === max === 1)
   *  - pool > SELECT_CARD_EXPLORATORY_MAX (else regular exploratory path)
   *  - DECK-only location (same safety as autoRespondMechanical's gate —
   *    see round 4 regressions on FIELD/GY broadening)
   *  - at least 1 preferred-match in pool (else mechanical fallback is
   *    indistinguishable from first-index pick) */
  private selectCardIsPreferredExploratory(
    msg: Record<string, unknown>,
    config?: DuelConfig,
  ): boolean {
    const selects = (msg['selects'] as { code?: number; location?: number }[] | undefined) ?? [];
    const min = (msg['min'] as number) ?? 1;
    const max = (msg['max'] as number) ?? 1;
    if (min !== 1 || max !== 1) return false;
    if (selects.length <= OCGCoreAdapter.SELECT_CARD_EXPLORATORY_MAX) return false;
    const preferred = config?.preferredSearchTargets;
    if (!preferred || preferred.length === 0) return false;
    if (!selects.every(s => s.location === OcgLocation.DECK)) return false;
    const preferredSet = new Set(preferred);
    return selects.some(s => s.code !== undefined && preferredSet.has(s.code));
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
      case 'SELECT_CARD':
        // Phase A #3: reached only if `_response` was not preserved across a
        // fork/replay boundary. The enumerator sets `_response` on every
        // pushed action, so this fallback is defensive.
        return { type: 5, indicies: [action.responseIndex] };
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
  private enumerateActionsWithResponses(msg: Record<string, unknown>, promptType: PromptType, config?: DuelConfig): Action[] {
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
          // Normal Summon source = always HAND by definition.
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'summon', sourceZone: 'HAND' }, { type: 1, action: 0, index: i });
        }
        for (let i = 0; i < ((msg['special_summons'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['special_summons'] as { code: number; location?: number; sequence?: number }[])[i]);
          // Phase G-ii: Pendulum Summon trigger detection. `proc_pendulum.lua`
          // registers `EFFECT_SPSUMMON_PROC_G` on the LEFT pendulum zone card.
          // In MR5, pendulum zones are merged into SZONE at sequence 0 (left)
          // and sequence 4 (right); in MR4 they use LOCATION_PZONE. Either
          // location/sequence signature unambiguously marks an SS entry as a
          // Pendulum Summon trigger (regular SS procedures source from HAND,
          // EXTRA, or GY). Tag them `psummon` so the ranker can prioritize
          // combo motifs separately from Synchro/Xyz/Link/Fusion/Ritual SS.
          const loc = card.location;
          const seq = card.sequence ?? 0;
          const isPsummon = (loc === OcgLocation.PZONE)
            || (loc === OcgLocation.SZONE && (seq === 0 || seq === 4));
          const tag = isPsummon ? 'psummon' : 'ss';
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: tag, sourceZone: ocgLocationToZoneId(loc, seq) }, { type: 1, action: 1, index: i });
        }
        for (let i = 0; i < ((msg['pos_changes'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['pos_changes'] as { code: number }[])[i]);
          // Position change applies to a monster on the field (MZONE).
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'pos' }, { type: 1, action: 2, index: i });
        }
        for (let i = 0; i < ((msg['monster_sets'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['monster_sets'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'mset', sourceZone: 'HAND' }, { type: 1, action: 3, index: i });
        }
        for (let i = 0; i < ((msg['spell_sets'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['spell_sets'] as { code: number }[])[i]);
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'sset', sourceZone: 'HAND' }, { type: 1, action: 4, index: i });
        }
        for (let i = 0; i < ((msg['activates'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['activates'] as { code: number; location?: number; sequence?: number }[])[i]);
          pushAction({
            responseIndex: idx++, cardId: card.code, promptType, isExploratory,
            actionTag: 'activate',
            _isEffectActivation: isFieldActivation(card.location),
            sourceZone: ocgLocationToZoneId(card.location, card.sequence),
          }, { type: 1, action: 5, index: i });
        }
        if (msg['to_bp']) {
          pushAction({ responseIndex: idx++, cardId: 0, promptType, isExploratory, actionTag: 'to_bp' }, { type: 1, action: 6 });
        }
        if (msg['to_ep']) {
          pushAction({ responseIndex: idx++, cardId: 0, promptType, isExploratory, actionTag: 'to_ep' }, { type: 1, action: 7 });
        }
        break;
      }
      case 'SELECT_BATTLECMD': {
        let idx = 0;
        for (let i = 0; i < ((msg['attacks'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['attacks'] as { code: number }[])[i]);
          // Attack source = a monster on field (MZONE/EMZ); precise sequence
          // not exposed in attacks[]. We leave sourceZone undefined; ranker
          // features for attacks default to 0 across act_src_in_*.
          pushAction({ responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'attack' }, { type: 0, action: 0, index: i });
        }
        for (let i = 0; i < ((msg['chains'] ?? []) as unknown[]).length; i++) {
          const card = ((msg['chains'] as { code: number; location?: number; sequence?: number }[])[i]);
          pushAction({
            responseIndex: idx++, cardId: card.code, promptType, isExploratory, actionTag: 'chain',
            _isEffectActivation: isFieldActivation(card.location),
            sourceZone: ocgLocationToZoneId(card.location, card.sequence),
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
        const selects = (msg['selects'] ?? []) as { code: number; description: bigint; location?: number; sequence?: number }[];
        for (let i = 0; i < selects.length; i++) {
          pushAction({
            responseIndex: i, cardId: selects[i].code, promptType, isExploratory,
            description: this.decodeDescription(selects[i].description),
            actionTag: 'activate',
            _isEffectActivation: isFieldActivation(selects[i].location),
            sourceZone: ocgLocationToZoneId(selects[i].location, selects[i].sequence),
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
      case 'SELECT_CARD': {
        // Phase A #3: one action per candidate. The dispatch in
        // `runUntilPlayerPrompt` has already vetted that the prompt is a
        // small-pool single-pick; `selectCardIsExploratory` gates it.
        // Ordering: candidates whose `code` is in `preferredSearchTargets`
        // come first, so the DFS explores the likely-correct pick before
        // burning budget on alternatives. Ranker doesn't touch SELECT_CARD
        // (see GoldfishChainRanker.needsState) so the enumeration order
        // here is the order the solver walks.
        const selects = (msg['selects'] ?? []) as { code?: number; location?: number }[];
        const preferred = config?.preferredSearchTargets;
        const preferredSet = preferred && preferred.length > 0 ? new Set(preferred) : null;
        const preferredFirst: number[] = [];
        const rest: number[] = [];
        for (let i = 0; i < selects.length; i++) {
          const code = selects[i].code;
          if (preferredSet && code !== undefined && preferredSet.has(code)) {
            preferredFirst.push(i);
          } else {
            rest.push(i);
          }
        }
        for (const i of [...preferredFirst, ...rest]) {
          pushAction({
            responseIndex: i,
            cardId: selects[i].code ?? 0,
            promptType,
            isExploratory,
            actionTag: 'pick',
          }, { type: 5, indicies: [i] });
        }
        break;
      }
    }

    return actions;
  }

  /** 2026-04-15 large-pool tutor branching. Emits up to
   *  SELECT_CARD_PREFERRED_EXPOSURE_K preferred matches plus one OCG-index-0
   *  fallback branch (Phase M.2). The preferred matches iterate in
   *  `preferredSearchTargets` priority (same discipline as
   *  `autoRespondMechanical`'s Phase G-iv ordering). The fallback branch
   *  preserves access to the OCG-index-0 candidate that the mechanical
   *  path historically resolved to — without it, Phase M.1 documented a
   *  D/D/D structural regression (2/5 → 1/5) caused by forcing preferred-
   *  only exposure and excluding the serendipitous Clovis fusion material
   *  path that the baseline relied on. */
  private enumeratePreferredSelectCard(
    msg: Record<string, unknown>,
    config?: DuelConfig,
  ): Action[] {
    this._lastActionResponses.clear();
    const actions: Action[] = [];
    const selects = (msg['selects'] ?? []) as { code?: number; location?: number }[];
    const preferred = config?.preferredSearchTargets;
    if (!preferred || preferred.length === 0) return actions;

    const pushAction = (action: Action, response: unknown): void => {
      action._response = response;
      this._lastActionResponses.set(action.responseIndex, response);
      actions.push(action);
    };

    // Collect up to K distinct candidate indices whose code matches a
    // preferred target, iterating in preferred-list priority order.
    const picked = new Set<number>();
    const matches: number[] = [];
    for (const prefCode of preferred) {
      if (matches.length >= OCGCoreAdapter.SELECT_CARD_PREFERRED_EXPOSURE_K) break;
      for (let i = 0; i < selects.length; i++) {
        if (picked.has(i)) continue;
        if (selects[i].code === prefCode) {
          matches.push(i);
          picked.add(i);
          break;
        }
      }
    }

    // Phase M.2 (2026-04-15): append OCG-index-0 as a fallback branch
    // unless it's already in the preferred matches. This is the structural
    // fix for the Phase M.1 D/D/D regression — the baseline path's Clovis
    // fusion material sits at OCG-index-0 in the Gate tutor pool and must
    // remain reachable by the DFS even when preferredIntermediates are set.
    if (selects.length > 0 && !picked.has(0)) {
      matches.push(0);
      picked.add(0);
    }

    for (const i of matches) {
      pushAction({
        responseIndex: i,
        cardId: selects[i].code ?? 0,
        promptType: 'SELECT_CARD',
        isExploratory: true,
        actionTag: 'pick',
      }, { type: 5, indicies: [i] });
    }

    return actions;
  }

  // ===========================================================================
  // Phase 5-lite trace-assist — interactive multi-pick mechanical prompts
  // ===========================================================================

  /** Dispatch for multi-pick mechanical prompts when
   *  `exposeMultiPickMechanical` is true. Returns enumerated Actions for
   *  SELECT_CARD (min>1), SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD.
   *  Returns `null` to signal "not a multi-pick prompt we handle" — caller
   *  falls through to the existing single-pick exploratory gates and
   *  ultimately to `autoRespondMechanical`. */
  private tryInteractiveMechanical(
    msg: Record<string, unknown>,
    promptType: PromptType,
    internal: InternalHandle,
  ): Action[] | null {
    const msgType = (msg as { type: number }).type;

    // SELECT_UNSELECT_CARD — iterative protocol: each pick is a real OCG
    // round-trip, no pending state.
    if (msgType === OcgMessageType.SELECT_UNSELECT_CARD) {
      return this.enumerateUnselectCard(msg);
    }

    // SELECT_PLACE — destination selection for summons. Expose when EITHER
    // (a) an EMZ slot is available (ED summon — EMZ_L vs EMZ_R choice), OR
    // (b) more than 1 M-zone is available among the current-player's
    //     placements. Case (b) covers Fusion alt-SS (e.g. Doomed Dragon
    //     from S/T) where placement column matters for Link-arrow targeting
    //     of later summons. Auto-resolve only when exactly 1 placement
    //     exists (trivial NS into the last empty column).
    if (msgType === OcgMessageType.SELECT_PLACE
      && ((msg['count'] as number) ?? 1) === 1) {
      const mask = (msg['field_mask'] as number) ?? 0;
      // Count P0-side available slots across MZone seqs 0-6 (includes EMZ).
      let p0Slots = 0;
      let emzAny = false;
      for (let seq = 0; seq < 7; seq++) {
        if (!(mask & (1 << seq))) {
          p0Slots++;
          if (seq === 5 || seq === 6) emzAny = true;
        }
      }
      // Expose when EMZ available (ED SS choice matters) OR when 2-4 Main
      // Zone slots are available (alt-SS / post-summoned fields where
      // column choice matters). Skip when all 5 main zones free (fresh-NS
      // case, irrelevant column choice).
      if (emzAny || (p0Slots >= 2 && p0Slots <= 4)) {
        return this.enumerateSelectPlace(msg);
      }
    }

    // Single-pick SELECT_CARD with large pool (>SELECT_CARD_EXPLORATORY_MAX):
    // the DFS default is to first-N auto-resolve (silently loses search-target
    // control). In trace-assist mode, expose every candidate as an action so
    // the author can pick specific search targets (e.g. Habakiri's Mitsurugi-
    // card search for Great Purification).
    if (msgType === OcgMessageType.SELECT_CARD
      && ((msg['min'] as number) ?? 1) === 1
      && ((msg['max'] as number) ?? 1) === 1
      && ((msg['selects'] ?? []) as unknown[]).length > 0) {
      return this.enumerateSinglePickSelectCard(msg);
    }

    // Atomic multi-pick — accumulate picks in internal.pendingMultiPick, emit
    // a single batched duelSetResponse on commit.
    const isMultiCard = msgType === OcgMessageType.SELECT_CARD
      && ((msg['min'] as number) ?? 1) > 1;
    const isTribute = msgType === OcgMessageType.SELECT_TRIBUTE;
    const isSum = msgType === OcgMessageType.SELECT_SUM;
    if (!isMultiCard && !isTribute && !isSum) return null;

    // When the OPTIONAL pool (`selects`) is empty, there is no user choice —
    // any valid response is fully constituted from `selects_must` (SUM) or
    // is trivially forced. Fall through to autoRespondMechanical rather than
    // expose a stuck prompt with 0 interactive actions. Applies especially
    // to Ritual tributes with only 1 valid Reptile in hand (SELECT_SUM:
    // selects_must=[Habakiri] selects=[]). */
    const selectsLen = ((msg['selects'] ?? []) as unknown[]).length;
    if (selectsLen === 0) return null;

    internal.pendingMultiPick = {
      promptType: promptType as 'SELECT_CARD' | 'SELECT_TRIBUTE' | 'SELECT_SUM',
      responseType: isMultiCard ? 5 : (isTribute ? 12 : 14),
      min: (msg['min'] as number) ?? 1,
      max: (msg['max'] as number) ?? 1,
      picks: [],
      targetSum: isSum ? (msg['amount'] as number) : undefined,
      cachedMsg: msg,
    };
    return this.enumerateMultiPickAtomic(internal);
  }

  /** SELECT_PLACE enumerator for trace-assist (count=1). Decodes the field
   *  mask into candidate zones (MZONE seq 0-6, SZONE seq 0-4, FZONE) and
   *  emits one action per available slot. Used by author to force specific
   *  placements — e.g. Link monster to EMZ_R vs EMZ_L based on Link arrow
   *  targeting strategy. Each pick is atomic: response is {type:10, places:[{...}]}. */
  private enumerateSelectPlace(msg: Record<string, unknown>): Action[] {
    this._lastActionResponses.clear();
    const actions: Action[] = [];
    const pushAction = (action: Action, response: unknown): void => {
      action._response = response;
      this._lastActionResponses.set(action.responseIndex, response);
      actions.push(action);
    };

    const mask = (msg['field_mask'] as number) ?? 0;
    const places = decodeFieldMask(mask, 99); // decode ALL available places

    const zoneLabel = (p: { player: number; location: number; sequence: number }): string => {
      const side = p.player === 0 ? 'P0' : 'P1';
      if (p.location === OcgLocation.MZONE) {
        if (p.sequence <= 4) return `${side}/M${p.sequence + 1}`;
        return `${side}/${p.sequence === 5 ? 'EMZ_L' : 'EMZ_R'}`;
      }
      if (p.location === OcgLocation.SZONE) return `${side}/S${p.sequence + 1}`;
      if (p.location === OcgLocation.FZONE) return `${side}/FIELD`;
      return `${side}/loc${p.location}/seq${p.sequence}`;
    };

    for (let i = 0; i < places.length; i++) {
      const p = places[i];
      // Skip opponent zones — player 0 normally doesn't place there.
      if (p.player !== 0) continue;
      pushAction({
        responseIndex: i,
        cardId: 0,
        promptType: 'SELECT_PLACE',
        isExploratory: true,
        actionTag: 'place',
        description: `place at ${zoneLabel(p)}`,
      }, { type: 10, places: [p] });
    }
    return actions;
  }

  /** Single-pick SELECT_CARD enumerator (min=max=1). In trace-assist mode this
   *  overrides the DFS's large-pool heuristics (first-N / preferred-only K) to
   *  expose every candidate as a distinct action. Each pick is atomic — the
   *  response is `{type:5, indicies:[i]}` sent directly; no pending state. */
  private enumerateSinglePickSelectCard(msg: Record<string, unknown>): Action[] {
    this._lastActionResponses.clear();
    const actions: Action[] = [];
    const selects = (msg['selects'] ?? []) as { code?: number; location?: number }[];
    const pushAction = (action: Action, response: unknown): void => {
      action._response = response;
      this._lastActionResponses.set(action.responseIndex, response);
      actions.push(action);
    };
    for (let i = 0; i < selects.length; i++) {
      pushAction({
        responseIndex: i,
        cardId: selects[i].code ?? 0,
        promptType: 'SELECT_CARD',
        isExploratory: true,
        actionTag: 'pick',
      }, { type: 5, indicies: [i] });
    }
    return actions;
  }

  /** SELECT_UNSELECT_CARD enumerator. OCGCore protocol:
   *  - `select_cards` — not yet picked, can be toggled in (response index `i`).
   *  - `unselect_cards` — already picked, can be toggled out (response index
   *    `select_cards.length + j`).
   *  - `can_finish` — min reached (and material-validity check passes). Send
   *    `{type:7, index:null}` to commit.
   *  - `can_cancel` — same null-index path but only when OCG permits cancel.
   *  Each pick/unpick is a real `duelSetResponse`; OCG re-prompts with an
   *  updated pool until finish.
   *  See types.d.ts OcgMessageSelectUnselectCard + OcgResponseSelectUnselectCard. */
  private enumerateUnselectCard(msg: Record<string, unknown>): Action[] {
    this._lastActionResponses.clear();
    const actions: Action[] = [];
    const pushAction = (action: Action, response: unknown): void => {
      action._response = response;
      this._lastActionResponses.set(action.responseIndex, response);
      actions.push(action);
    };

    const selectCards = ((msg['select_cards'] ?? []) as { code?: number }[]);
    const unselectCards = ((msg['unselect_cards'] ?? []) as { code?: number }[]);
    const canFinish = Boolean(msg['can_finish']);

    let idx = 0;
    for (let i = 0; i < selectCards.length; i++) {
      pushAction({
        responseIndex: idx++,
        cardId: selectCards[i].code ?? 0,
        promptType: 'SELECT_UNSELECT_CARD',
        isExploratory: true,
        actionTag: 'unselect-pick',
        description: `pick select_cards[${i}]`,
      }, { type: 7, index: i });
    }
    for (let j = 0; j < unselectCards.length; j++) {
      const engineIdx = selectCards.length + j;
      pushAction({
        responseIndex: idx++,
        cardId: unselectCards[j].code ?? 0,
        promptType: 'SELECT_UNSELECT_CARD',
        isExploratory: true,
        actionTag: 'unselect-drop',
        description: `drop unselect_cards[${j}]`,
      }, { type: 7, index: engineIdx });
    }
    if (canFinish) {
      pushAction({
        responseIndex: idx++,
        cardId: 0,
        promptType: 'SELECT_UNSELECT_CARD',
        isExploratory: true,
        actionTag: 'unselect-finish',
        description: `finish selection`,
      }, { type: 7, index: null });
    }
    return actions;
  }

  /** Atomic multi-pick enumerator for SELECT_CARD (min>1), SELECT_TRIBUTE,
   *  SELECT_SUM. Reads the cached msg + pending picks from `internal.pendingMultiPick`.
   *  Emits one action per remaining candidate (`multi-pick-add`), optionally
   *  an undo action (`multi-pick-undo`), and a commit action
   *  (`multi-pick-commit`) when the current picks satisfy the prompt's
   *  constraints. The commit action's `_response` is the batched OCG payload. */
  private enumerateMultiPickAtomic(internal: InternalHandle): Action[] {
    this._lastActionResponses.clear();
    const actions: Action[] = [];
    const pending = internal.pendingMultiPick;
    if (!pending) return actions;

    const selects = (pending.cachedMsg['selects'] ?? []) as {
      code?: number; amount?: number; release_param?: number;
    }[];
    const pickedSet = new Set(pending.picks);
    const pushAction = (action: Action, response: unknown): void => {
      action._response = response;
      this._lastActionResponses.set(action.responseIndex, response);
      actions.push(action);
    };

    let idx = 0;
    // "Add" actions — every candidate not yet picked, while under max.
    if (pending.picks.length < pending.max) {
      for (let i = 0; i < selects.length; i++) {
        if (pickedSet.has(i)) continue;
        const c = selects[i];
        let desc = `add selects[${i}]`;
        if (pending.promptType === 'SELECT_SUM' && c.amount !== undefined) {
          desc += ` (amount=${c.amount})`;
        } else if (pending.promptType === 'SELECT_TRIBUTE' && c.release_param !== undefined) {
          desc += ` (release=${c.release_param})`;
        }
        pushAction({
          responseIndex: idx++,
          cardId: c.code ?? 0,
          promptType: pending.promptType,
          isExploratory: true,
          actionTag: 'multi-pick-add',
          description: desc,
        }, { __partialPickIndex: i });
      }
    }

    // "Undo" — pop last pick. Cheap built-in correction.
    if (pending.picks.length > 0) {
      pushAction({
        responseIndex: idx++,
        cardId: 0,
        promptType: pending.promptType,
        isExploratory: true,
        actionTag: 'multi-pick-undo',
        description: `undo last (picks=[${pending.picks.join(',')}])`,
      }, { __unpickLast: true });
    }

    // "Commit" — only when constraints satisfied.
    if (this.canCommitMultiPick(pending, selects)) {
      pushAction({
        responseIndex: idx++,
        cardId: 0,
        promptType: pending.promptType,
        isExploratory: true,
        actionTag: 'multi-pick-commit',
        description: `commit [${pending.picks.join(',')}]`,
      }, { type: pending.responseType, indicies: [...pending.picks] });
    }

    return actions;
  }

  /** Gate for enabling the "commit" action in `enumerateMultiPickAtomic`.
   *  - SELECT_CARD / SELECT_TRIBUTE: count in [min, max].
   *  - SELECT_SUM: count in [min, max] AND sum(picks[i].amount) === targetSum.
   *  Callers are responsible for catching `duelSetResponse` throws — OCG
   *  applies its own material-validity check on top of these surface checks. */
  private canCommitMultiPick(
    pending: PendingMultiPick,
    selects: { amount?: number }[],
  ): boolean {
    const n = pending.picks.length;
    if (n < pending.min) return false;
    if (n > pending.max) return false;
    if (pending.promptType === 'SELECT_SUM' && pending.targetSum !== undefined) {
      let sum = 0;
      for (const i of pending.picks) sum += selects[i]?.amount ?? 0;
      if (sum !== pending.targetSum) return false;
    }
    return true;
  }

  /** Accessor for trace-assist UI — expose the current pending multi-pick
   *  state so the CLI can render "current picks: [i,j]" alongside the
   *  enumerated action list. Returns undefined when no multi-pick is in
   *  progress. */
  getPendingMultiPick(handle: DuelHandle): PendingMultiPick | undefined {
    const internal = this.resolveHandle(handle);
    return internal.pendingMultiPick;
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
          // Phase G-iv: iterate `preferred` in priority ORDER (not `selects`
          // in OCG index order). Multi-step combos need different SELECT_CARD
          // targets at each prompt (Gate → Doom Queen, Zero Contract SS →
          // Count Surveyor, Copernicus dump → Lance Soldier, Tell dump →
          // Necro Slime, etc.). Each preferred card is "consumed" naturally
          // by the game state as the combo advances, so priority order gives
          // per-prompt resolution without stateful tracking:
          //   - Gate's pool contains Doom Queen Mach → picked first (in
          //     preferred list) → combo step 1 unlocked.
          //   - Next prompt (Zero Contract's SS from deck): Doom Queen Mach
          //     already SS'd, not in pool → skip. Count Surveyor (next in
          //     preferred list) IS in pool → picked → step 3 unlocked.
          //   - ...and so on.
          // Backward compatible: single-card preferred lists (Branded Mululu)
          // behave identically to the old OCG-index-first logic.
          const preferredIdx: number[] = [];
          for (const prefCode of preferred) {
            if (preferredIdx.length >= min) break;
            for (let i = 0; i < selects.length; i++) {
              if (selects[i].code === prefCode && !preferredIdx.includes(i)) {
                preferredIdx.push(i);
                break;
              }
            }
          }
          // Top up with remaining OCG-order indices if we didn't find `min`
          // preferred matches.
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

  // ===========================================================================
  // Internal: Fork via WASM Memory Snapshot (LIFO)
  // ===========================================================================

  /** Save the current WASM memory state, register a child handle that shares
   *  the parent's nativeHandle, and push the snapshot onto the LIFO stack.
   *  The child modifies WASM in place; `destroyDuel(child)` pops the stack
   *  and restores the snapshot, which resurrects the parent's OCG state for
   *  its shared `nativeHandle` pointer.
   *
   *  REQUIRES strict LIFO usage — DFS / MCTS rollouts satisfy this naturally
   *  (fork → apply* → destroy in a finally). Non-LIFO `destroyDuel` routes
   *  through the regular native-destroy path and skips the restore. */
  private forkViaSnapshot(parent: InternalHandle): DuelHandle {
    const mem = this.wasmMemory;
    if (!mem) throw new Error('wasmMemory unavailable');

    const snap = mem.buffer.slice(0);

    const id = this.nextHandleId++;
    const child: InternalHandle = {
      id,
      nativeHandle: parent.nativeHandle, // shared: snapshot restore revives this OCG duel ID
      actionHistory: [...parent.actionHistory],
      responseHistory: [...parent.responseHistory],
      config: parent.config,
      isActive: true,
      turn: parent.turn,
      phase: parent.phase,
      activationLog: cloneActivationLog(parent.activationLog),
      isSnapshotChild: true,
    };

    this.activeHandles.set(id, child);
    this.snapshotStack.push({ childId: id, parentSnapshot: snap });
    return this.toPublicHandle(child);
  }

  /** Pop the top of the snapshot stack and restore the parent's WASM state.
   *  Called by `destroyDuel` when the released handle matches the top of the
   *  stack. */
  private restoreTopSnapshot(childId: number): void {
    const mem = this.wasmMemory;
    if (!mem) throw new Error('wasmMemory vanished during restore');
    const top = this.snapshotStack[this.snapshotStack.length - 1];
    if (!top || top.childId !== childId) {
      throw new Error(`[Solver] snapshot stack corrupted (top=${top?.childId} want=${childId})`);
    }
    const snap = top.parentSnapshot;
    const snapView = new Uint8Array(snap);
    const curBuf = mem.buffer;
    if (curBuf.byteLength < snap.byteLength) {
      throw new Error(`[Solver] WASM memory shrunk: ${curBuf.byteLength} < ${snap.byteLength}`);
    }
    new Uint8Array(curBuf, 0, snapView.byteLength).set(snapView);
    if (curBuf.byteLength > snap.byteLength) {
      // Zero any pages that grew while the child was alive — OCG's
      // allocator bookkeeping lives in the snapshot and post-restore it
      // doesn't know these pages exist, but zeroing them avoids surprises
      // if the allocator re-grows and re-claims the same pages later.
      new Uint8Array(curBuf, snap.byteLength).fill(0);
    }
    this.snapshotStack.pop();
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
    // Snapshot children share their nativeHandle with an ancestor — never
    // native-destroy one directly. This path is only reached if a child is
    // destroyed out of LIFO order, in which case we still tear down the
    // logical handle but leave the OCG duel for its owning ancestor.
    if (!internal.isSnapshotChild) {
      try {
        this.core.destroyDuel(internal.nativeHandle);
      } catch { /* best effort */ }
    }
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

      // Validate the snapshot roundtrip if Memory was captured. We don't do
      // this by toggling `_snapshotAvailable` (already set by `create()`),
      // but we exercise the buffer slice/set and confirm no detach happens.
      if (this._snapshotAvailable && this.wasmMemory) {
        const preSize = this.wasmMemory.buffer.byteLength;
        const snap = this.wasmMemory.buffer.slice(0);
        new Uint8Array(this.wasmMemory.buffer, 0, snap.byteLength).set(new Uint8Array(snap));
        const postSize = this.wasmMemory.buffer.byteLength;
        if (preSize !== postSize) {
          console.warn(`[Solver] WASM memory resized during smoke test (${preSize} → ${postSize}) — snapshot may still work but flag this as unexpected.`);
        }
      }
      console.log(`[Solver] WASM smoke test passed (snapshot: ${this._snapshotAvailable ? 'available' : 'not available — using replay fallback'}${this.useSnapshot ? ', ENABLED' : ''})`);

      this.core.destroyDuel(duel);
    } catch (err) {
      console.warn('[Solver] WASM smoke test FAILED:', err);
      this._snapshotAvailable = false;
    }
  }
}
