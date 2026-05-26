import { inject, Injectable, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { LpAnimData } from './pvp-lp-badge/pvp-lp-badge.component';
import type { GameEvent } from '../types';
import type { DamageMsg, PayLpCostMsg, Player, RecoverMsg } from '../duel-ws.types';
import {
  ScopeResetDispatcher,
  type CheckpointPayload,
  type ResetTarget,
  type ScopeCategory,
} from '../projections';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { DuelContext } from './duel-context';

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

  private trackedLp: [number, number] = [8000, 8000];
  private _pendingLpCommits = new Set<Player>();
  private _cachedBaseLpDuration: number | null = null;

  readonly animatingLpPlayer = signal<LpAnimData | null>(null);

  get baseLpDuration(): number {
    if (this._cachedBaseLpDuration === null) {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--pvp-transition-lp-counter').trim();
      this._cachedBaseLpDuration = parseFloat(raw) || 0;
    }
    return this._cachedBaseLpDuration;
  }

  processLpEvent(player: number, amount: number, type: 'damage' | 'recover'): number {
    const relativeIdx = this.ctx.relativePlayer(player);
    const fromLp = this.trackedLp[relativeIdx] ?? 8000;
    const toLp = type === 'damage' ? Math.max(0, fromLp - amount) : fromLp + amount;
    this.trackedLp[relativeIdx] = toLp;

    const speedMultiplier = this.ctx.speedMultiplier();
    const durationMs = Math.round(this.baseLpDuration * speedMultiplier);
    this.animatingLpPlayer.set({ player, fromLp, toLp, type, durationMs });
    this._pendingLpCommits.add(relativeIdx as Player);

    const isOwn = player === this.ctx.ownPlayerIndex();
    const label = isOwn ? 'Your' : 'Opponent';
    this.liveAnnouncer.announce(`${label} LP: ${toLp}`);

    return this.baseLpDuration;
  }

  /**
   * Commit pending LP to rendered state and clear the animating signal.
   * Called by the queue loop after an LP event's animation duration elapses.
   * No-op if nothing is pending.
   */
  commitIfPending(): void {
    if (this._pendingLpCommits.size === 0) return;
    for (const p of this._pendingLpCommits) {
      this.rbs.commitLp(p);
    }
    this._pendingLpCommits.clear();
    this.animatingLpPlayer.set(null);
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
   * when this tracker's scope (or any wider one) is invalidated. The
   * dispatcher passes the **expanded** scope set, so we can distinguish
   * the two slices declaratively:
   *   - DUEL_LIFETIME present → clear trackedLp + pending commits
   *   - PERSPECTIVE_LIFETIME present → clear the in-flight animation
   *
   * The declared `scope = DUEL_LIFETIME` means a PerspectiveSwitched
   * (PERSPECTIVE only) does NOT reach this `applyReset` at all — the
   * dispatcher only fans out to targets whose scope is in the *expanded*
   * invalidated set, and PERSPECTIVE expansion = {PERSPECTIVE} alone
   * (PERSPECTIVE is the most volatile rung, nothing strictly below).
   * The PERSPECTIVE branch below thus fires only as defense-in-depth
   * when a wider reset (DUEL_LIFETIME) cascades through this target —
   * DUEL expansion = {DUEL, CONNECTION, PERSPECTIVE}, so both branches
   * run, which is equivalent to the legacy `reset()`.
   *
   * **Known dette (party-mode 2026-05-26, Murat finding #3).** With LP
   * declared DUEL_LIFETIME, an `animatingLpPlayer` in flight at the
   * moment of a SOLO `switchPlayer` is NOT cleared by the dispatcher
   * (the PERSPECTIVE branch is unreached). In practice this is benign
   * because SOLO switches happen at prompt boundaries with the queue
   * already drained — but the invariant is unguarded. Proper fix
   * deferred to β when `BoundaryProcessor` emits typed switch events
   * and the orchestrator can clear `animatingLpPlayer` explicitly at
   * `resetForSwitch`, rather than relying on scope semantics.
   *
   * `checkpointPayload` is currently unused (LP state will re-seed
   * from the BOARD_STATE payload directly via `syncFromBoardState`
   * after a STATE_SYNC; that path stays as is at α.4b).
   */
  applyReset(
    scopes: ReadonlySet<ScopeCategory>,
    _checkpointPayload?: CheckpointPayload,
  ): void {
    if (scopes.has('DUEL_LIFETIME')) {
      this.trackedLp = [8000, 8000];
      this._pendingLpCommits.clear();
    }
    if (scopes.has('PERSPECTIVE_LIFETIME')) {
      this.animatingLpPlayer.set(null);
    }
  }

  reset(): void {
    this.trackedLp = [8000, 8000];
    this._pendingLpCommits.clear();
    this.animatingLpPlayer.set(null);
  }
}
