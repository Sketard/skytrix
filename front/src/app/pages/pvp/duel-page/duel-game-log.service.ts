// =============================================================================
// duel-game-log.service.ts — the Game Log spine (PvP live + Replay)
// -----------------------------------------------------------------------------
// Taps the shared AnimationOrchestratorService (via `notifyGameLog`, wired in
// `processEvent` — see analysis §2.3), drives the shared `GameLogBuilder`, and
// exposes two reactive surfaces:
//   · `gameLogEntries`        — the accumulated journal (Surface 1, Lot 4).
//   · `lastOpponentActivation`— the latest opponent effect (Surface 2, Lot 3).
//
// Provided at the duel-page / replay-page component level (Lot 2d), NOT
// `providedIn: 'root'` — one instance per duel page, reset on rematch / seek.
// =============================================================================

import { effect, type EffectRef, inject, Injectable, Injector, isDevMode, signal, type Signal } from '@angular/core';
import type { Player, BoardStatePayload, ChainingMsg } from '../duel-ws.types';
import type { PreComputedState } from '../duel-ws-replay.types';
import type { DuelState, StreamEvent } from '../types';
import { GameLogBuilder } from '../game-log/game-log-builder';
import type { GameLogEntry } from '../game-log/game-log-types';
import { EMPTY_DUEL_STATE } from '../types';

/**
 * DEV ONLY — a synthetic `MSG_CHAINING` carries a `__dev` marker so the two
 * branches of `notifyGameLog` can diverge: the bubble-feeding branch honours
 * it, the builder-feeding branch skips it (no phantom journal row — analysis
 * §3.7 caveat 1). The marker lives on a LOCAL type, never on the shared
 * `ChainingMsg` (it is not a transport field).
 */
type DevChainingMsg = ChainingMsg & { __dev: true };

/** True when `event` is a dev-injected synthetic `MSG_CHAINING`. */
function isDevChaining(event: StreamEvent): event is DevChainingMsg {
  return (event as Partial<DevChainingMsg>).__dev === true;
}

/**
 * The data the opponent-effect bubble (Surface 2) needs — read straight off
 * the raw `MSG_CHAINING` event, NOT built through `GameLogBuilder` (the bubble
 * is a notification, not a journal row — analysis §3.5).
 */
export interface OpponentActivation {
  /** The activating card's code. */
  cardCode: number;
  /** The activating card's name (may be empty if the event carried none). */
  cardName: string;
  /** Resolved effect text for the activation. Empty when not yet resolved. */
  descriptionText: string;
}

/**
 * Drives the Game Log from the orchestrator's event stream. One hook, both
 * modes — the orchestrator is the single shared instance PvP and Replay both
 * feed, so the service inherits PvP↔Replay parity by construction.
 *
 * The service also owns the panel's OPEN STATE (`panelOpen` / `panelClosing`)
 * — Surface 1's chrome (Lot 4c). The state lives here, not on the panel
 * component, because the trigger button (Lot 4f, mounted in
 * `pvp-board-container`) and the panel (mounted in the page templates) are
 * sibling components: a shared service is the only handle both can reach.
 */
@Injectable()
export class DuelGameLogService {
  /** The accumulated journal — drives the panel (Surface 1). */
  readonly gameLogEntries: Signal<GameLogEntry[]>;
  /** The latest opponent activation — drives the bubble (Surface 2). */
  readonly lastOpponentActivation: Signal<OpponentActivation | null>;
  /** Panel open gate (Lot 4c). `false` = the panel renders no DOM (R5). */
  readonly panelOpen: Signal<boolean>;
  /** Panel close-in-progress flag — drives the exit transition (Lot 4c). */
  readonly panelClosing: Signal<boolean>;
  /**
   * Monotonic counter bumped each time the journal is wholesale REBUILT
   * (a replay seek — `rebuildUpTo`). The panel watches it to jump the
   * viewport to the bottom: after a seek to step N the user wants to see
   * the most recent entry, not the top of the history (Bug 5 follow-up).
   * Distinct from an incremental append, which only triggers the G3
   * follow-the-bottom behaviour.
   */
  readonly journalRebuiltTick: Signal<number>;

  private readonly _entries = signal<GameLogEntry[]>([]);
  private readonly _lastOpponentActivation = signal<OpponentActivation | null>(
    null,
  );
  private readonly _panelOpen = signal(false);
  private readonly _panelClosing = signal(false);
  private readonly _journalRebuiltTick = signal(0);

  /**
   * Absolute index of the viewer (the player the log is rendered FROM). The
   * builder needs it at construction to relativise the *event* player fields
   * (O5: it relativises only event `player` fields + drives the board, which
   * the orchestrator already hands over viewer-relative).
   *
   * PROVISION OF `perspective` (Lot 2.2): the service is NOT yet provided in
   * the pages at Lot 2 — `setPerspective()` is the explicit, decoupled entry
   * point the page components will call at Lot 2d, BEFORE the first event:
   *   · PvP    — `DuelContext.ownPlayerIndex()` (absolute).
   *   · Replay — `perspectiveIndex()` (absolute, replay convention).
   * A setter (rather than an injected dependency) keeps the service free of
   * `DuelContext` / replay-page coupling and trivially unit-testable. Default
   * `0` until the page sets it. In replay the user can flip perspective
   * mid-session — `setPerspective()` rebuilds the journal from the retained
   * raw events (R7), so calling it again is always safe.
   */
  private perspective: Player = 0;

  /** The shared incremental builder (Lot 0). Rebuilt on reset / perspective flip. */
  private builder = new GameLogBuilder(this.perspective);

  /**
   * Every event tapped, in dispatch order — retained so a replay perspective
   * flip can rebuild the journal from scratch (R7 / analysis §4.2). Kept
   * alongside the built entries, never derived from them. Holds `StreamEvent`
   * (Palier 0): wider than `GameEvent` to admit out-of-band feeds —
   * `MSG_CHAIN_NEGATED`, `MSG_WIN`, `SELECT_CARD`.
   */
  private readonly tappedEvents: StreamEvent[] = [];

  /** Palier 0 — index of last event consumed from the attached `eventStream`.
   *  Reset on `reset()` (and implicitly on `rebuildUpTo`, which clears
   *  `tappedEvents`). Drives the incremental drain in `attachEventStream`. */
  private _streamConsumedLength = 0;

  /** Palier 0 — the `effect()` ref installed by `attachEventStream`. Held
   *  so a subsequent `attachEventStream` call (or a manual `detachEventStream`)
   *  can tear down the previous subscription explicitly. The provider is
   *  component-scoped so Angular's `DestroyRef` handles cleanup on page
   *  destroy, but holding the ref defends against re-attach races and lets
   *  tests opt into explicit teardown. */
  private _streamEffect: EffectRef | null = null;

  private readonly injector = inject(Injector);

  constructor() {
    this.gameLogEntries = this._entries.asReadonly();
    this.lastOpponentActivation = this._lastOpponentActivation.asReadonly();
    this.panelOpen = this._panelOpen.asReadonly();
    this.panelClosing = this._panelClosing.asReadonly();
    this.journalRebuiltTick = this._journalRebuiltTick.asReadonly();
  }

  // ---------------------------------------------------------------------------
  // Panel open state (Lot 4c) — the trigger button toggles it, the panel
  // component drives the timed close. Kept here so the two sibling components
  // share one source of truth.
  // ---------------------------------------------------------------------------

  /** Toggle the panel — opens it, or starts a close if already open. The
   *  trigger button (Lot 4f) calls this. */
  togglePanel(): void {
    if (this._panelOpen() && !this._panelClosing()) {
      this.beginPanelClose();
      return;
    }
    this.openPanel();
  }

  /** Open the panel immediately, cancelling any in-progress close. */
  openPanel(): void {
    this._panelClosing.set(false);
    this._panelOpen.set(true);
  }

  /** Mark the panel as closing — the panel component plays the exit
   *  transition, then calls `finishPanelClose()`. */
  beginPanelClose(): void {
    if (!this._panelOpen() || this._panelClosing()) return;
    this._panelClosing.set(true);
  }

  /** Tear the panel DOM down — called by the panel after the exit transition. */
  finishPanelClose(): void {
    this._panelOpen.set(false);
    this._panelClosing.set(false);
  }

  /**
   * Set (or change) the viewer perspective. Rebuilds the journal from the
   * retained raw events so already-built entries — relativised for the old
   * viewer — are corrected. No-op when the perspective is unchanged.
   */
  setPerspective(absolute: Player): void {
    if (absolute === this.perspective) return;
    this.perspective = absolute;
    this.rebuild();
  }

  /**
   * REPLAY ONLY — rebuild the whole journal from the precomputed states
   * `[0..N]` after a seek (analysis: the journal is an *history*, not a
   * snapshot of step N).
   *
   * A replay seek runs `abortAndClean → resetForSwitch → reset()` which
   * empties the journal, then `jumpToState()` renders the board for step N
   * directly — the events BEFORE N never pass back through the
   * `notifyGameLog` tap, so the journal would restart empty at N. This
   * method re-feeds the builder with every event of states `[0..N]` so the
   * journal reflects the cumulative duel history up to N.
   *
   * It is a SILENT rebuild: each state is fed through the batch
   * `GameLogBuilder.ingestState` — that path drives ONLY the builder, never
   * `captureOpponentActivation`. So replaying a MSG_CHAINING here cannot
   * flash the opponent bubble (the bubble is fed exclusively from the
   * `notifyGameLog` event path). PvP never calls this (no seek in PvP — the
   * journal builds in the normal `notifyGameLog` flow).
   *
   * The retained `tappedEvents` are cleared: after a seek the live feed
   * resumes from N, and a subsequent perspective flip rebuilds from the
   * states (which `rebuildUpTo` is re-called with) — not from a stale
   * partial `tappedEvents` slice.
   */
  rebuildUpTo(states: readonly PreComputedState[]): void {
    this.builder = new GameLogBuilder(this.perspective);
    this.tappedEvents.length = 0;
    for (const state of states) this.builder.ingestState(state);
    this._entries.set([...this.builder.entries]);
    // Signal a wholesale rebuild (vs an incremental append) so the panel
    // jumps the viewport to the bottom — a seek lands the user on step N,
    // and step N's entry is the bottom of the rebuilt history.
    this._journalRebuiltTick.update(t => t + 1);
  }

  /**
   * Called by the orchestrator tap, once per genuinely-dispatched event
   * (analysis §2.3 — buffered chain events reach this only on re-dispatch,
   * in logical resolution order, exactly once).
   *
   * One branch, explicit (analysis §3.7 caveat 1): a dev-injected synthetic
   * `MSG_CHAINING` feeds ONLY the bubble — it is skipped by the builder (no
   * phantom journal row) and not retained for the perspective-flip rebuild.
   */
  notifyGameLog(event: StreamEvent): void {
    if (isDevChaining(event)) {
      this.captureOpponentActivation(event);
      return;
    }
    this.tappedEvents.push(event);
    this.ingest(event);
    this.captureOpponentActivation(event);
  }

  /**
   * Palier 0 — subscribe to the orchestrator's `EventStream`. Pose un
   * `effect()` that drains newly-pushed events through `notifyGameLog`
   * exactly once each, in arrival order. The `_streamConsumedLength`
   * index tracks the prefix already consumed so the effect is idempotent
   * across multiple recomputations (signal re-emits the same array when
   * an unrelated dependency changes — defensive in practice, and free).
   *
   * Replay seek path is honoured by construction: a seek triggers
   * `orchestrator.resetAllState()` → `_eventStream.set([])`, then this
   * service's `reset()` clears the consumed index; the subsequent
   * `rebuildUpTo` re-feeds the builder directly via `ingestState`. The
   * effect sees the cleared stream (length 0 == consumed length 0) and
   * stays idle until the next live push.
   */
  attachEventStream(stream: Signal<readonly StreamEvent[]>): void {
    this._streamEffect?.destroy();
    this._streamEffect = effect(() => {
      const events = stream();
      if (events.length < this._streamConsumedLength) {
        // Stream was cleared (orchestrator reset) — sync the cursor back.
        this._streamConsumedLength = events.length;
        return;
      }
      while (this._streamConsumedLength < events.length) {
        this.notifyGameLog(events[this._streamConsumedLength]);
        this._streamConsumedLength++;
      }
    }, { injector: this.injector });
  }

  /** Tear down the `attachEventStream` subscription. Angular's `DestroyRef`
   *  handles this implicitly on page destroy (provider is component-scoped),
   *  but tests and any future re-attach path can call this directly. */
  detachEventStream(): void {
    this._streamEffect?.destroy();
    this._streamEffect = null;
  }

  /**
   * DEV ONLY — feed a synthetic `MSG_CHAINING` (or a burst) into the bubble
   * feed for the dev-hub trigger (Lot 3d, analysis §3.7, mechanism D1). The
   * synthetic events travel the SAME `notifyGameLog` path a genuine event
   * does — so the opponent-only filter, last-wins replace and the bubble's
   * anti-flicker floor are all exercised end-to-end.
   *
   * Each event carries the `__dev` marker (added here, not by the fixture)
   * so the builder branch skips it — a dev trigger never pollutes the real
   * journal. No-op in production: `isDevMode()` is false and Angular's
   * tree-shaker drops the call site + the fixtures.
   */
  injectDevChaining(event: ChainingMsg | ChainingMsg[]): void {
    if (!isDevMode()) return;
    const events = Array.isArray(event) ? event : [event];
    for (const e of events) {
      this.notifyGameLog({ ...e, __dev: true } as DevChainingMsg);
    }
  }

  /**
   * Cleared on rematch / mode switch / state-sync / replay seek — wired
   * into the orchestrator's `resetAllState()` at Lot 2e. A rematch reuses
   * the page component (no `ngOnDestroy`), so a stale journal would
   * otherwise carry into the next duel (R8).
   *
   * Clears the journal CONTENT only — it deliberately does NOT close the
   * panel. The open state is a session-level user preference: a replay
   * seek runs through this path on every jump (Bug 1), and slamming the
   * panel shut on each seek would make the rebuilt journal invisible. A
   * rematch keeping the panel open is also the expected behaviour (the
   * user opened it). `togglePanel` / `beginPanelClose` remain the only
   * ways the panel closes.
   */
  reset(): void {
    this.builder = new GameLogBuilder(this.perspective);
    this.tappedEvents.length = 0;
    this._streamConsumedLength = 0;
    this._entries.set([]);
    this._lastOpponentActivation.set(null);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Feed one event through the builder and republish. The board is read from
   * `logicalState()` — the viewer-relative, metadata+zones-synchronised pair
   * (analysis §2.4); the orchestrator has already folded this event's
   * `boardStateAfter` into it before the tap fires.
   */
  private ingest(event: StreamEvent): void {
    const board = this.readBoard();
    // Ordering contract (§1.2): turn/phase sync precedes the event ingest.
    this.builder.syncTurnAndPhase(board);
    this.builder.ingestEvent(event, board);
    // `builder.entries` is a mutable array — publish a fresh reference so
    // OnPush consumers see the change.
    this._entries.set([...this.builder.entries]);
  }

  /**
   * Surface 2 feed. On a `MSG_CHAINING` whose relativised player is the
   * opponent, expose the raw activation for the bubble. A self activation
   * leaves the signal untouched (the bubble is opponent-only — analysis §3.3).
   * This does NOT go through the builder (analysis §3.5).
   */
  private captureOpponentActivation(event: StreamEvent): void {
    if (event.type !== 'MSG_CHAINING') return;
    const isOpponent = event.player !== this.perspective;
    if (!isOpponent) return;
    this._lastOpponentActivation.set({
      cardCode: event.cardCode,
      cardName: event.cardName,
      descriptionText: event.descriptionText ?? '',
    });
  }

  /** Rebuild the journal from the retained raw events under the current
   *  perspective. The builder is pure, so a full replay is cheap. */
  private rebuild(): void {
    this.builder = new GameLogBuilder(this.perspective);
    this._entries.set([]);
    for (const event of this.tappedEvents) this.ingest(event);
  }

  /** The current viewer-relative board snapshot — `DuelState` is structurally
   *  a `BoardStatePayload`, the shape the builder expects. */
  private readBoard(): BoardStatePayload {
    const state: DuelState = this.boardSource?.() ?? EMPTY_DUEL_STATE;
    return state;
  }

  /**
   * Board snapshot accessor. Set at Lot 2d to `() => rbs.logicalState()` from
   * the page. Kept as an injectable closure (not a hard `RenderedBoardState`
   * dependency) so the service is unit-testable in isolation and so the
   * orchestrator tap stays a passive side-effect with no new DI edge.
   */
  private boardSource: (() => DuelState) | null = null;

  /** Wire the board snapshot source — called by the page at Lot 2d. */
  attachBoardSource(source: () => DuelState): void {
    this.boardSource = source;
  }
}
