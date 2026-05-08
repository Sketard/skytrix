import { inject, Injectable, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { LpAnimData } from './pvp-lp-badge/pvp-lp-badge.component';
import type { GameEvent } from '../types';
import type { DamageMsg, PayLpCostMsg, Player, RecoverMsg } from '../duel-ws.types';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { DuelContext } from './duel-context';

/**
 * Tracks LP changes, animates the counter, and commits LP to rendered state.
 * Provided at component level (NOT root).
 */
@Injectable()
export class LpAnimationTracker {
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly ctx = inject(DuelContext);

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

  reset(): void {
    this.trackedLp = [8000, 8000];
    this._pendingLpCommits.clear();
    this.animatingLpPlayer.set(null);
  }
}
