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

import { Injectable, signal, type Signal } from '@angular/core';
import type { Player, BoardStatePayload } from '../duel-ws.types';
import type { DuelState, GameEvent } from '../types';
import { GameLogBuilder } from '../game-log/game-log-builder';
import type { GameLogEntry } from '../game-log/game-log-types';
import { EMPTY_DUEL_STATE } from '../types';

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
 */
@Injectable()
export class DuelGameLogService {
  /** The accumulated journal — drives the panel (Surface 1). */
  readonly gameLogEntries: Signal<GameLogEntry[]>;
  /** The latest opponent activation — drives the bubble (Surface 2). */
  readonly lastOpponentActivation: Signal<OpponentActivation | null>;

  private readonly _entries = signal<GameLogEntry[]>([]);
  private readonly _lastOpponentActivation = signal<OpponentActivation | null>(
    null,
  );

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
   * alongside the built entries, never derived from them.
   */
  private readonly tappedEvents: GameEvent[] = [];

  constructor() {
    this.gameLogEntries = this._entries.asReadonly();
    this.lastOpponentActivation = this._lastOpponentActivation.asReadonly();
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
   * Called by the orchestrator tap, once per genuinely-dispatched event
   * (analysis §2.3 — buffered chain events reach this only on re-dispatch,
   * in logical resolution order, exactly once).
   */
  notifyGameLog(event: GameEvent): void {
    this.tappedEvents.push(event);
    this.ingest(event);
    this.captureOpponentActivation(event);
  }

  /**
   * Cleared on rematch / mode switch / state-sync — wired into the
   * orchestrator's `resetAllState()` at Lot 2e. A rematch reuses the page
   * component (no `ngOnDestroy`), so a stale journal would otherwise carry
   * into the next duel (R8).
   */
  reset(): void {
    this.builder = new GameLogBuilder(this.perspective);
    this.tappedEvents.length = 0;
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
  private ingest(event: GameEvent): void {
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
  private captureOpponentActivation(event: GameEvent): void {
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
