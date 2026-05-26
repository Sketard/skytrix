import { inject, Injectable } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { GameEvent } from '../types';
import type { DamageMsg, PayLpCostMsg, Player, RecoverMsg } from '../duel-ws.types';
import {
  AnimatingLpProjection,
  ScopeResetDispatcher,
  type CheckpointPayload,
  type ResetTarget,
  type ScopeCategory,
} from '../projections';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { DuelContext } from './duel-context';

const STARTING_LP: readonly [number, number] = [8000, 8000];

/**
 * Tracks LP changes, animates the counter, and commits LP to rendered state.
 * Provided at component level (NOT root).
 *
 * α.4b — implements `ResetTarget`. The tracker carries state in **two
 * scopes** (cf. duel-session-chantier.md §3.5):
 *   - `_pendingLpCommits` + `trackedLp` are `DUEL_LIFETIME` (survive
 *     a `PerspectiveSwitched`).
 *   - `animatingLpPlayer` is `PERSPECTIVE_LIFETIME` (cleared at switch).
 * The declared `scope` is the most durable (DUEL_LIFETIME); `applyReset`
 * distinguishes via `scopes.has(...)` thanks to α.2's hierarchical
 * cascade — a DUEL reset implicitly invalidates PERSPECTIVE too.
 *
 * The legacy `reset()` method stays in place. α.5 will replace its
 * call-sites with `dispatcher.dispatch(...)`.
 */
@Injectable()
export class LpAnimationTracker implements ResetTarget {
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly ctx = inject(DuelContext);
  // `optional: true` so isolated unit specs (which test the manager without
  // a DuelPageComponent host) don't need to provide the dispatcher. In
  // production every DuelPageComponent providers list includes
  // ScopeResetDispatcher so the register call fires.
  private readonly dispatcher = inject(ScopeResetDispatcher, { optional: true });

  readonly scope: ScopeCategory = 'DUEL_LIFETIME';

  constructor() {
    this.dispatcher?.register(this);
  }

  private get rbs() { return this.dataSource.renderedBoardState; }

  private trackedLp: [number, number] = [...STARTING_LP] as [number, number];
  private _pendingLpCommits = new Set<Player>();
  private _cachedBaseLpDuration: number | null = null;

  /**
   * β.3 Lot 2.2-REDO — the LP animation projection lives here so the
   * orchestrator can call `animatingLpPlayerProjection` to wire the
   * scope dispatcher + event stream once. Exposed as the `value`
   * signal via the `animatingLpPlayer` alias below so PvP + replay
   * templates keep their `()` call syntax.
   */
  readonly animatingLpPlayerProjection = new AnimatingLpProjection();

  /** β.3 Lot 2.2-REDO — back-compat alias matching the legacy
   *  `animatingLpPlayer = signal<LpAnimData | null>(null)` shape.
   *  `pvp-lp-badge` + the orchestrator's defensive `set(null)` sites
   *  used the writable signal directly; with the projection these are
   *  gone (the projection self-clears via `AnimationCompleted`). */
  readonly animatingLpPlayer = this.animatingLpPlayerProjection.value;

  get baseLpDuration(): number {
    if (this._cachedBaseLpDuration === null) {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--pvp-transition-lp-counter').trim();
      this._cachedBaseLpDuration = parseFloat(raw) || 0;
    }
    return this._cachedBaseLpDuration;
  }

  /**
   * β.3 Standardisation 2 (2026-05-26) — pure read of the LP delta a
   * MSG_DAMAGE/RECOVER/PAY_LPCOST is about to produce. Does NOT mutate
   * `trackedLp`. Called by the orchestrator AT PUSH TIME (before
   * `processLpEvent` mutates) to decorate the event clone with
   * `lpDelta` so the projection can consume it without duplicating
   * the tracker's state.
   *
   * `processLpEvent` is the mutating sibling — it re-uses the same
   * `_computeLpArithmetic` helper and applies the mutation. Both
   * methods agree by construction (single source of arithmetic, single
   * `relativePlayer` mapping). β.3 checkpoint R1 mitigation
   * (2026-05-26): extracted from two duplicated 3-line blocks that
   * existed in this file before — a regression there would have
   * silently desynchronised the projection from the tracker.
   */
  peekLpDelta(player: number, amount: number, type: 'damage' | 'recover'): { fromLp: number; toLp: number; durationMs: number } {
    const { fromLp, toLp } = this._computeLpArithmetic(player, amount, type);
    const speedMultiplier = this.ctx.speedMultiplier();
    const durationMs = Math.round(this.baseLpDuration * speedMultiplier);
    return { fromLp, toLp, durationMs };
  }

  processLpEvent(player: number, amount: number, type: 'damage' | 'recover'): number {
    // β.3 Lot 2.2-REDO — the visual signal (fromLp/toLp/durationMs) is
    // owned by `animatingLpPlayerProjection`, which self-sets when the
    // orchestrator pushes the decorated MSG_DAMAGE/RECOVER/PAY_LPCOST
    // on the stream (cf. `decorateLpEventForStream` + `peekLpDelta`).
    // This method keeps its mutating role: advance `trackedLp`,
    // register the pending commit, fire the a11y announce, return the
    // runner's hold duration.
    const { relativeIdx, toLp } = this._computeLpArithmetic(player, amount, type);
    this.trackedLp[relativeIdx] = toLp;

    this._pendingLpCommits.add(relativeIdx as Player);

    const isOwn = player === this.ctx.ownPlayerIndex();
    const label = isOwn ? 'Your' : 'Opponent';
    this.liveAnnouncer.announce(`${label} LP: ${toLp}`);

    return this.baseLpDuration;
  }

  /**
   * β.3 checkpoint R1 mitigation (2026-05-26) — single source of LP
   * arithmetic shared by `peekLpDelta` (pure, called at push time by
   * the orchestrator's `decorateLpEventForStream`) and
   * `processLpEvent` (mutating, called from the dispatch switch).
   *
   * Returns the relative player index AND the from/to LP values
   * computed against the CURRENT `trackedLp` state. Does NOT mutate.
   * Callers responsible for any subsequent mutation /
   * pending-commit / announce.
   *
   * Keeping this as a private method (not a free function) so it can
   * read `this.trackedLp` and `this.ctx.relativePlayer` without
   * threading them through arguments.
   */
  private _computeLpArithmetic(
    player: number,
    amount: number,
    type: 'damage' | 'recover',
  ): { relativeIdx: 0 | 1; fromLp: number; toLp: number } {
    const relativeIdx = this.ctx.relativePlayer(player);
    const fromLp = this.trackedLp[relativeIdx] ?? 8000;
    const toLp = type === 'damage' ? Math.max(0, fromLp - amount) : fromLp + amount;
    return { relativeIdx, fromLp, toLp };
  }

  /**
   * Commit pending LP to rendered state.
   * Called by the queue loop after an LP event's animation duration elapses.
   * No-op if nothing is pending.
   *
   * β.3 Lot 2.2-REDO — the projection's `value` is cleared by its own
   * `AnimationCompleted` observation (emitted by `onStepSettled` for
   * the LP message), not here.
   *
   * **β.3 checkpoint R5 mitigation (2026-05-26)** — contract change
   * vs pre-β.3: `commitIfPending` USED TO clear `animatingLpPlayer`
   * synchronously. Now it does NOT. Audit at Lot 2.2-REDO landing
   * confirmed `animatingLpPlayer` has ZERO observer outside
   * `pvp-lp-badge.component` (the LP badge UI). If a future feature
   * subscribes to `animatingLpPlayer` to detect "LP commit done",
   * it would be DESYNC'd: the animation surface stays set until
   * `AnimationCompleted` fires (one tick after `commitIfPending`).
   * Use `hasPendingCommit` for "is there pending commit work" or
   * `AnimationCompleted({msgType: 'MSG_DAMAGE'|...})` on the stream
   * for "the LP animation finished".
   */
  commitIfPending(): void {
    if (this._pendingLpCommits.size === 0) return;
    for (const p of this._pendingLpCommits) {
      this.rbs.commitLp(p);
    }
    this._pendingLpCommits.clear();
  }

  get hasPendingCommit(): boolean {
    return this._pendingLpCommits.size > 0;
  }

  /**
   * Discard the pending commit set without committing — used when an upcoming
   * `commitUnlocked()`/`commitAll()` will sync state through a different path
   * (e.g. zone-only commit during chain idle/building, full reset on hard sync).
   * Does NOT clear `animatingLpPlayer` because the visual animation may still
   * be running while pending is discarded.
   */
  discardPending(): void {
    this._pendingLpCommits.clear();
  }

  /** Apply LP changes instantly (no animation) for collapsed queue events. */
  applyInstant(event: GameEvent): void {
    if (event.type === 'MSG_DAMAGE' || event.type === 'MSG_PAY_LPCOST') {
      const msg = event as DamageMsg | PayLpCostMsg;
      const idx = this.ctx.relativePlayer(msg.player);
      this.trackedLp[idx] = Math.max(0, (this.trackedLp[idx] ?? 8000) - msg.amount);
    } else if (event.type === 'MSG_RECOVER') {
      const msg = event as RecoverMsg;
      const idx = this.ctx.relativePlayer(msg.player);
      this.trackedLp[idx] = (this.trackedLp[idx] ?? 8000) + msg.amount;
    }
  }

  /** Dispatch a buffered LP event during chain replay. */
  fireLpReplayEvent(event: GameEvent): void {
    if (event.type === 'MSG_DAMAGE') {
      this.processLpEvent((event as DamageMsg).player, (event as DamageMsg).amount, 'damage');
    } else if (event.type === 'MSG_RECOVER') {
      this.processLpEvent((event as RecoverMsg).player, (event as RecoverMsg).amount, 'recover');
    } else if (event.type === 'MSG_PAY_LPCOST') {
      this.processLpEvent((event as PayLpCostMsg).player, (event as PayLpCostMsg).amount, 'damage');
    }
  }

  /** Sync tracked LP to authoritative board state (called when not animating). */
  syncFromBoardState(playerLp: number, opponentLp: number): void {
    this.trackedLp = [playerLp, opponentLp];
  }

  getTrackedLp(): [number, number] {
    return [...this.trackedLp] as [number, number];
  }

  /**
   * α.4b — `ResetTarget` entry point. Driven by `ScopeResetDispatcher`
   * when this tracker's scope (or any wider one) is invalidated. Layout:
   *   - DUEL_LIFETIME present → clear trackedLp + pending commits
   *   - PERSPECTIVE_LIFETIME present → clear the in-flight animation
   *
   * **Reachability** — declared `scope = DUEL_LIFETIME` means the
   * dispatcher only routes here when DUEL (or above) is invalidated.
   * Expansion is downward-only (cf. §3.5): DUEL → {DUEL, CONNECTION,
   * PERSPECTIVE}, so any DUEL-or-above dispatch hits BOTH branches.
   * A PERSPECTIVE-only dispatch never reaches this `applyReset` at all
   * (target.scope=DUEL is not in the expanded set {PERSPECTIVE}). The
   * two-branch shape is therefore equivalent to a single body — kept
   * separate so β can split the scopes properly once typed reset events
   * land. Until then, the PERSPECTIVE branch fires only as a co-effect
   * of a DUEL cascade, never on its own.
   *
   * **Known dette (party-mode 2026-05-26, Murat finding #3).** A
   * SOLO `switchPlayer` dispatches PERSPECTIVE_LIFETIME only, so an
   * `animatingLpPlayer` in flight at switch time is NOT cleared here.
   * Benign in practice (SOLO switches happen at prompt boundaries with
   * the queue already drained). Proper fix deferred to β: once
   * `BoundaryProcessor` emits typed switch events, the orchestrator
   * clears `animatingLpPlayer` explicitly at `resetForSwitch` rather
   * than via scope semantics.
   *
   * `checkpointPayload` is unused at α.4b — LP state re-seeds from the
   * BOARD_STATE payload directly via `syncFromBoardState` after a
   * STATE_SYNC.
   */
  applyReset(
    scopes: ReadonlySet<ScopeCategory>,
    _checkpointPayload?: CheckpointPayload,
  ): void {
    if (scopes.has('DUEL_LIFETIME')) {
      this.trackedLp = [...STARTING_LP] as [number, number];
      this._pendingLpCommits.clear();
    }
    // β.3 Lot 2.2-REDO — the `animatingLpPlayer` slice
    // (PERSPECTIVE_LIFETIME) is now owned by
    // `animatingLpPlayerProjection`, which is registered as its own
    // `ResetTarget` with the dispatcher (PERSPECTIVE scope) and
    // clears itself via its `applyReset`. The tracker's `applyReset`
    // no longer touches the animation slice.
  }

  reset(): void {
    this.trackedLp = [...STARTING_LP] as [number, number];
    this._pendingLpCommits.clear();
  }
}
