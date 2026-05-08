import { Injectable, signal } from '@angular/core';
import { DuelState, EMPTY_DUEL_STATE } from '../types';
import { Player, PlayerBoardState, BoardZone } from '../duel-ws.types';
import { LOCK_SAFETY_TIMEOUT_MS } from './animation-constants';
import { duelAssert } from '../../../core/utilities/duel-assert';
import type { CardTravelService } from './card-travel.service';
import type { DuelLogger } from './duel-logger';

export interface ZoneLock {
  commit(): void;
  release(): void;
}

@Injectable()
export class RenderedBoardStateService {
  logger?: DuelLogger;
  /** Optional — set by orchestrator for [LOCK-ASSERT] runtime assertion in dev mode. */
  cardTravelService?: CardTravelService;
  /**
   * Returns the current lock safety-timeout (ms). Orchestrator overrides this
   * with `ctx.safetyTimeout(LOCK_SAFETY_TIMEOUT_MS)` so the timeout scales
   * with `speedMultiplier` (slow playback doesn't cut travels short).
   * Default returns the raw constant for direct RBS consumers that don't
   * have access to DuelContext (replay adapter, tests).
   */
  getSafetyTimeoutMs: () => number = () => LOCK_SAFETY_TIMEOUT_MS;

  private _logical = signal<DuelState>(EMPTY_DUEL_STATE);
  private _rendered = signal<DuelState>(EMPTY_DUEL_STATE);
  private _locks = new Map<string, number>();
  private _hasLockedZones = signal(false);
  private _safetyTimeouts = new Set<ReturnType<typeof setTimeout>>();

  readonly logicalState = this._logical.asReadonly();
  readonly renderedState = this._rendered.asReadonly();
  readonly hasLockedZones = this._hasLockedZones.asReadonly();

  // ── Helpers ──────────────────────────────────────────────────────────

  private parseZoneKey(zoneKey: string): { zoneId: string; playerIndex: Player } {
    const sep = zoneKey.lastIndexOf('-');
    const playerIndex = sep === -1 ? NaN : Number(zoneKey.substring(sep + 1));
    duelAssert(
      sep !== -1 && (playerIndex === 0 || playerIndex === 1),
      'parseZoneKey',
      `Invalid zoneKey: ${zoneKey} (expected "ZONE-0" or "ZONE-1")`,
    );
    return { zoneId: zoneKey.substring(0, sep), playerIndex: playerIndex as Player };
  }

  private cloneStateWithPlayer(playerIndex: Player, playerPatch: Partial<PlayerBoardState>): DuelState {
    const current = this._rendered();
    return {
      ...current,
      players: current.players.map((p, i) =>
        i === playerIndex ? { ...p, ...playerPatch } : p,
      ) as [PlayerBoardState, PlayerBoardState],
    };
  }

  // ── updateLogical ────────────────────────────────────────────────────
  //
  // Fast-path (no locks): rendered is synced immediately.
  // When locks are active, only unlocked zones are synced — locked zones
  // retain their rendered state until explicitly committed.

  updateLogical(state: DuelState): void {
    this._logical.set(state);
  }

  /** Sync rendered state from logical, respecting active locks. */
  syncRendered(): void {
    if (this._locks.size === 0) {
      this._rendered.set(this._logical());
      return;
    }
    this._rendered.set(this.mergeUnlockedZones(this._logical()));
  }

  private mergeUnlockedZones(logical: DuelState): DuelState {
    const rendered = this._rendered();
    const players = [0, 1].map(i => {
      const rp = rendered.players[i];
      const lpl = logical.players[i];

      const renderedMap = new Map<string, BoardZone>(rp.zones.map(z => [z.zoneId, z]));
      const logicalMap = new Map<string, BoardZone>(lpl.zones.map(z => [z.zoneId, z]));

      const allZoneIds = new Set<string>(logicalMap.keys());
      for (const zId of renderedMap.keys()) {
        if (this._locks.has(`${zId}-${i}`)) allZoneIds.add(zId);
      }

      const zones: BoardZone[] = [];
      for (const zoneId of allZoneIds) {
        const key = `${zoneId}-${i}`;
        // Locked zone may not exist in rendered yet (new destination) — skip to keep it hidden until commit
        const zone = this._locks.has(key) ? renderedMap.get(zoneId) : logicalMap.get(zoneId);
        if (zone) zones.push(zone);
      }

      return {
        // LP: always from rendered — committed explicitly via commitLp() (see architecture §12.2)
        lp: rp.lp,
        deckCount: this._locks.has(`DECK-${i}`) ? rp.deckCount : lpl.deckCount,
        extraCount: this._locks.has(`EXTRA-${i}`) ? rp.extraCount : lpl.extraCount,
        zones,
      } satisfies PlayerBoardState;
    }) as [PlayerBoardState, PlayerBoardState];

    return { turnPlayer: logical.turnPlayer, turnCount: logical.turnCount, phase: logical.phase, players };
  }

  /**
   * Sync only DECK/EXTRA counts and global metadata (turn, phase) from logical.
   * Used when the animation queue has events whose zones may not be pre-locked
   * yet — full syncRendered() would expose those zones prematurely.
   */
  syncPileCounts(): void {
    const logical = this._logical();
    const rendered = this._rendered();
    const players = rendered.players.map((rp, i) => ({
      ...rp,
      deckCount: logical.players[i].deckCount,
      extraCount: this._locks.has(`EXTRA-${i}`) ? rp.extraCount : logical.players[i].extraCount,
    })) as [PlayerBoardState, PlayerBoardState];
    this._rendered.set({
      turnPlayer: logical.turnPlayer, turnCount: logical.turnCount, phase: logical.phase,
      players,
    });
  }

  // ── lockZone ─────────────────────────────────────────────────────────

  lockZone(zoneKey: string, source?: string): ZoneLock {
    this._locks.set(zoneKey, (this._locks.get(zoneKey) ?? 0) + 1);
    this._hasLockedZones.set(true);

    let released = false;
    const lockedAt = performance.now();

    const timeoutId = setTimeout(() => {
      this._safetyTimeouts.delete(timeoutId);
      if (released) return;
      released = true;
      if (!this._locks.has(zoneKey)) return;
      const rc = this._locks.get(zoneKey)! - 1;
      if (rc <= 0) this._locks.delete(zoneKey);
      else this._locks.set(zoneKey, rc);
      this._hasLockedZones.set(this._locks.size > 0);
      // Release WITHOUT commit — zone stays at old rendered state until next commitAll() (see §12.3)
      const msg = `Lock safety timeout for ${zoneKey} after ${Math.round(performance.now() - lockedAt)}ms (source: ${source ?? 'unknown'}, remaining locks: ${[...this._locks.keys()].join(', ') || 'none'})`;
      duelAssert(false, 'lockZone', msg);
    }, this.getSafetyTimeoutMs());
    this._safetyTimeouts.add(timeoutId);

    return {
      commit: () => {
        if (released) return;
        released = true;
        clearTimeout(timeoutId);
        this._safetyTimeouts.delete(timeoutId);
        if (!this._locks.has(zoneKey)) return;
        const rc = this._locks.get(zoneKey)! - 1;
        if (rc <= 0) {
          this._locks.delete(zoneKey);
          this.commitZone(zoneKey);
        } else {
          this._locks.set(zoneKey, rc);
        }
        this._hasLockedZones.set(this._locks.size > 0);
      },
      release: () => {
        if (released) return;
        released = true;
        clearTimeout(timeoutId);
        this._safetyTimeouts.delete(timeoutId);
        if (!this._locks.has(zoneKey)) return;
        const rc = this._locks.get(zoneKey)! - 1;
        if (rc <= 0) this._locks.delete(zoneKey);
        else this._locks.set(zoneKey, rc);
        this._hasLockedZones.set(this._locks.size > 0);
      },
    };
  }

  /** Expose locked zone keys for structured tracing ([ANIM-TRACE]). */
  lockedZoneKeys(): string[] {
    return Array.from(this._locks.keys());
  }

  /** Warn if locks exist at a point where state should be clean. Throws in dev, warns in prod. */
  assertNoLocks(site: string): void {
    duelAssert(this._locks.size === 0, site,
      `${this._locks.size} locks still active: ${[...this._locks.keys()].join(', ')}`);
  }

  // ── commitZone ───────────────────────────────────────────────────────

  commitZone(zoneKey: string): void {
    const { zoneId, playerIndex: pi } = this.parseZoneKey(zoneKey);
    const logical = this._logical();

    if (zoneId === 'DECK') {
      this._rendered.set(this.cloneStateWithPlayer(pi, { deckCount: logical.players[pi].deckCount }));
      return;
    }

    const logicalZone = logical.players[pi].zones.find(z => z.zoneId === zoneId);
    if (!logicalZone) return;

    if (zoneId === 'EXTRA') {
      const updatedZones = this._rendered().players[pi].zones.map(z => (z.zoneId === zoneId ? logicalZone : z));
      if (!updatedZones.some(z => z.zoneId === zoneId)) updatedZones.push(logicalZone);
      this._rendered.set(this.cloneStateWithPlayer(pi, { zones: updatedZones, extraCount: logical.players[pi].extraCount }));
      return;
    }

    const renderedZones = this._rendered().players[pi].zones;
    const idx = renderedZones.findIndex(z => z.zoneId === zoneId);
    const updatedZones = [...renderedZones];
    if (idx >= 0) updatedZones[idx] = logicalZone;
    else updatedZones.push(logicalZone);
    this._rendered.set(this.cloneStateWithPlayer(pi, { zones: updatedZones }));
  }

  // ── commitUnlocked ─────────────────────────────────────────────────
  // Sync rendered state for unlocked zones only — active locks are preserved.
  // Used by the per-event queue loop so in-flight travel locks survive.

  commitUnlocked(): void {
    if (this.cardTravelService) {
      for (const [zoneKey, travels] of this.cardTravelService.inFlightByZone()) {
        if (travels.length > 0 && !this._locks.has(zoneKey)) {
          duelAssert(false, 'commitUnlocked',
            `Zone ${zoneKey} has ${travels.length} in-flight travels but is NOT locked — handler likely missed a synchronous lockZone() before await`);
        }
      }
    }
    if (this._locks.size === 0) {
      this._rendered.set(this._logical());
      return;
    }
    this._rendered.set(this.mergeUnlockedZones(this._logical()));
  }

  // ── commitAll ────────────────────────────────────────────────────────

  commitAll(): void {
    for (const tid of this._safetyTimeouts) clearTimeout(tid);
    this._safetyTimeouts.clear();
    this._locks.clear();
    this._rendered.set(this._logical());
    this._hasLockedZones.set(false);
  }

  // ── commitLp ─────────────────────────────────────────────────────────

  commitLp(playerIndex: Player): void {
    const lp = this._logical().players[playerIndex].lp;
    this._rendered.set(this.cloneStateWithPlayer(playerIndex, { lp }));
  }

  // ── destroy ──────────────────────────────────────────────────────────

  destroy(): void {
    this.commitAll();
  }
}
