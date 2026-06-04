import { Injectable, signal, type Signal } from '@angular/core';
import { DuelState, EMPTY_DUEL_STATE } from '../types';
import { Player, PlayerBoardState, BoardZone } from '../duel-ws.types';
import { LOCK_SAFETY_TIMEOUT_MS } from './animation-constants';
import { duelAssert } from '../../../core/utilities/duel-assert';
import type { FloatRegistryService } from './float-registry.service';
import type { DuelLogger } from './duel-logger';

export interface ZoneLock {
  commit(): void;
  release(): void;
}

/**
 * Read-only contract surface of {@link RenderedBoardStateService}, exposed to
 * the component layer (template + component-level computeds) and to any
 * non-orchestrator consumer that only needs to observe board state.
 *
 * The full RBS class still owns the write/control surface (lock/commit/sync
 * for the animation orchestrator + managers via `AnimationDataSource`).
 * Splitting the contract via this interface keeps templates from accidentally
 * calling `commitAll()` or `lockZone()` — see audit L25.
 */
export interface BoardStateView {
  readonly logicalState: Signal<DuelState>;
  readonly renderedState: Signal<DuelState>;
  readonly hasLockedZones: boolean;
}

@Injectable()
export class RenderedBoardStateService implements BoardStateView {
  logger?: DuelLogger;

  /**
   * Optional in-flight-travel observer used by `commitUnlocked` to assert in
   * dev mode that no zone has active travels without a lock. Replay adapter
   * runs without FloatRegistry — the assertion is silently skipped there.
   * Wired via {@link attachFloatRegistry} (audit L22 — was a public
   * mutable field, the method makes the contract explicit).
   */
  private _floatRegistry?: FloatRegistryService;

  attachFloatRegistry(svc: FloatRegistryService): void {
    this._floatRegistry = svc;
  }
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
  private _safetyTimeouts = new Set<ReturnType<typeof setTimeout>>();

  /**
   * F5 (2026-06-04) — cumulative count of locks dropped via `commitAll(site)`
   * skip paths (replay seek, abort, jumpToState, collapseRemainingSteps,
   * resetForReplaySeek). Pure observational counter; exposed via
   * `__skytrixDebug.snapshot()` so a future regression that strands 100+
   * locks per seek becomes visible without a Datadog hook. Reset only at
   * service destroy.
   */
  private _tolerateLocksDroppedCount = 0;
  /** Public read of the tolerateLocks drop counter (F5 — debug snapshot). */
  get tolerateLocksDroppedCount(): number { return this._tolerateLocksDroppedCount; }

  /**
   * v3 Phase 1 (2026-06-04) — instrumentation, no behavior change.
   *
   * `QueueRunner.requestStop()` opens this window BEFORE `setRunning(false)`
   * and the next legitimate `notifyEnqueue` / `processEvent` closes it. Any
   * `lockZone(...)` call made while the window is open is an IIFE bailout —
   * an async handler that bailed past its `await` after the runner was
   * stopped and is now posting a lock nobody will release. Drives the
   * Phase 2 audit (do we need `AbortSignal` here?) without changing today's
   * runtime behavior.
   *
   * The counter is monotonic-cumulative across a session ; exposed via the
   * debug snapshot. Healthy steady-state should be 0. Bumps surface the
   * IIFE paths that need `AbortSignal` wiring in Phase 2.
   */
  private _postRequestStopWindow = false;
  private _postRequestStopLockCount = 0;
  /** Public read of the post-requestStop lock count (v3 Phase 1). */
  get postRequestStopLockCount(): number { return this._postRequestStopLockCount; }
  /** Toggle the post-requestStop instrumentation window (called by
   *  `QueueRunner.requestStop` + closed on the next legitimate enqueue). */
  setPostRequestStopWindow(open: boolean): void {
    this._postRequestStopWindow = open;
  }

  readonly logicalState = this._logical.asReadonly();
  readonly renderedState = this._rendered.asReadonly();
  /**
   * β.3 Lot 4 cleanup — derived getter (was a manually-synced `signal` until
   * 2026-05-26). Pure derivation of `_locks.size > 0`; no reactive Angular
   * propagation needed since no production consumer reads it inside a
   * template / effect / computed (only the spec suite + 2 stubs).
   */
  get hasLockedZones(): boolean { return this._locks.size > 0; }

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
   * Sync DECK/EXTRA counts, the EXTRA zone array, and global metadata
   * (turn, phase) from logical. Used when the animation queue has events
   * whose zones may not be pre-locked yet — full syncRendered() would
   * expose those zones (HAND in particular) prematurely.
   *
   * The EXTRA zone array itself is sync'd alongside its scalar count
   * because EXTRA is NEVER part of the boot animation pipeline (initial
   * draws come from DECK, not EXTRA). Without this, the rendered EXTRA
   * pile stays empty at rematch bootstrap until the first
   * `commitUnlocked` post-initial-draw fires (~600ms after DECK becomes
   * visible) — observed 2026-06-02 as "EXTRA appears later than DECK".
   * Lock-aware (defensive: production never locks EXTRA but specs do).
   */
  syncPileCounts(): void {
    const logical = this._logical();
    const rendered = this._rendered();
    const players = rendered.players.map((rp, i) => {
      const extraLocked = this._locks.has(`EXTRA-${i}`);
      const logicalExtraZone = logical.players[i].zones.find(z => z.zoneId === 'EXTRA');
      // F22 (2026-06-04) — split the conflated branches:
      //   · `!logicalExtraZone` (logical state missing EXTRA) on a board
      //     that ALREADY has other zones is a real bug upstream — assert
      //     in dev, fall back to rendered in prod so we don't crash a
      //     duel for a missing pile array.
      //   · `extraLocked` is the intentional skip — silent.
      //   · Bootstrap (`logical.players[i].zones.length === 0`, e.g.
      //     EMPTY_DUEL_STATE before the 1st BOARD_STATE) is not a bug —
      //     no zones at all, EXTRA legitimately absent.
      // Pre-F22: `extraLocked || !logicalExtraZone` conflated all three
      // into a silent "use rp.zones" branch, masking the upstream bug.
      const logicalHasZones = logical.players[i].zones.length > 0;
      duelAssert(
        !logicalHasZones || !!logicalExtraZone,
        'syncPileCounts',
        `EXTRA zone missing in logical state for player ${i} (logical has ${logical.players[i].zones.length} other zones)`,
      );
      const renderedZonesWithoutExtra = rp.zones.filter(z => z.zoneId !== 'EXTRA');
      const zones = extraLocked || !logicalExtraZone
        ? rp.zones
        : [...renderedZonesWithoutExtra, logicalExtraZone];
      return {
        ...rp,
        deckCount: logical.players[i].deckCount,
        extraCount: extraLocked ? rp.extraCount : logical.players[i].extraCount,
        zones,
      };
    }) as [PlayerBoardState, PlayerBoardState];
    this._rendered.set({
      turnPlayer: logical.turnPlayer, turnCount: logical.turnCount, phase: logical.phase,
      players,
    });
  }

  // ── lockZone ─────────────────────────────────────────────────────────

  lockZone(zoneKey: string, source?: string): ZoneLock {
    // v3 Phase 1 — instrumentation: count locks taken while the runner is
    // in its post-requestStop window. A bump here = an async handler that
    // bailed past its `await` post-abort and is now posting a lock nobody
    // will release. Phase 2 fixes via AbortSignal propagation.
    if (this._postRequestStopWindow) {
      this._postRequestStopLockCount++;
      this.logger?.warn(
        `[v3-instr][RUNNER] lockZone('%s', source=%s) inside post-requestStop window — count=%d`,
        zoneKey, source ?? 'unknown', this._postRequestStopLockCount);
    }

    this._locks.set(zoneKey, (this._locks.get(zoneKey) ?? 0) + 1);

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
        // 2026-06-04 — zombie-lock-safe path. A prior `commitAll()` (typically
        // from `processShuffleEvent` mid-chain) wipes `_locks` map without
        // notifying outstanding ZoneLock closures. If we arrive here without
        // our key in the map, our caller still wants the zone synced from
        // the current logical state — `commitZone` is idempotent vs an
        // already-synced rendered, so the call is a no-op when logical
        // hasn't been modified since `commitAll()`, and a proper sync when
        // it has (e.g. a subsequent `updateLogical(boardStateAfter)`).
        // Bug repro: Radiant Typhoon discard scenario, replay 18a55f97,
        // see `_bmad-output/planning-artifacts/bug-post-chain-solved-buffer-drain-2026-06-04.md`.
        if (!this._locks.has(zoneKey)) {
          this.commitZone(zoneKey);
          return;
        }
        const rc = this._locks.get(zoneKey)! - 1;
        if (rc <= 0) {
          this._locks.delete(zoneKey);
          this.commitZone(zoneKey);
        } else {
          this._locks.set(zoneKey, rc);
        }
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
        },
    };
  }

  /** Expose locked zone keys for structured tracing ([ANIM-TRACE]). */
  lockedZoneKeys(): string[] {
    return Array.from(this._locks.keys());
  }

  /**
   * Warn if locks exist at a point where state should be clean. Throws in dev,
   * console.error in prod (via duelAssert).
   *
   * **F19 anchor (audit C6, 2026-06-01) — Lock-assert sites manifest** :
   *
   * Asserted (7 prod sites) — transition boundaries that MUST be clean :
   *   1. duel-connection.ts:825 — cleanup
   *   2. duel-connection.ts:1393 — REMATCH_STARTING
   *   3. duel-connection.ts:1649 — STATE_SYNC (onStateSync)
   *   4. animation-orchestrator.service.ts:996 — resetAllState
   *   5. replay-duel-adapter.ts:154 — feedTransition
   *   6. replay-duel-adapter.ts:191 — feedTransitionPhased
   *   7. replay-duel-adapter.ts:246 — advanceStep:done
   *
   * Intentionally NOT asserted (3 skip sites, voluntary skip/abort paths) :
   *   - replay-duel-adapter.ts:collapseRemainingSteps — user skip-to-end
   *   - replay-duel-adapter.ts:abort — replay tear-down
   *   - replay-duel-adapter.ts:jumpToState — user-triggered seek
   *
   * Full doctrine : CLAUDE.md "Replay Board State Parity Rule".
   * Adding an 8th asserted site → update this list + CLAUDE.md.
   */
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
    if (this._floatRegistry) {
      for (const [zoneKey, travels] of this._floatRegistry.inFlightByZone()) {
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

  /**
   * Drop every active lock + commit logical state to rendered. Two flavours
   * of caller exist, differentiated by intent rather than by code path :
   *
   *   - **Reset boundaries** (orchestrator destroy, STATE_SYNC, REMATCH_STARTING).
   *     Call `rbs.assertNoLocks(site)` BEFORE this — if locks survive, the
   *     pipeline upstream forgot to release them (real bug). F19 sites enforce
   *     the cleanliness invariant.
   *   - **Voluntary-skip paths** (replay `collapseRemainingSteps`, `abort`,
   *     `jumpToState`). Locks from the interrupted mid-step are expected ;
   *     dropping them silently is the intended cleanup. Pass `site` so the
   *     U13 warn surfaces regressions where the dropped count creeps up
   *     (e.g. a new handler that fails to release on every step, masked
   *     today by `commitAll` clearing the leak on the next user skip).
   *
   * The `site` param is observational only — `commitAll` always succeeds.
   * U13 (2026-06-01) — added the warn so silent leaks at skip paths become
   * detectable without throwing.
   *
   * **⚠️ DANGER (2026-06-04) — DO NOT call `commitAll()` mid-batch to "just
   * sync one zone".** Calling sites like `processShuffleEvent` previously did
   * this and zombified every other actor's `ZoneLock` closures : the lock
   * holder's subsequent `commit()` becomes a silent no-op because `_locks.has(key)`
   * is false, so its rendered zone never syncs. Symptoms : a card stays in
   * its source zone DOM during the travel animation, even though the logical
   * state has updated.
   *
   * Mitigation : `ZoneLock.commit()` now has a zombie-safe path that fires
   * `commitZone(key)` even when `_locks.has(key)` is false (Option G,
   * 2026-06-04). Defense-in-depth — the lock holder still gets its sync.
   *
   * **For partial syncs, prefer `commitZone(key)`** — surgical, leaves other
   * actors' locks alive, no zombie. `commitAll()` is for terminal teardowns
   * only.
   *
   * Spec : `_bmad-output/planning-artifacts/bug-post-chain-solved-buffer-drain-2026-06-04.md`.
   */
  commitAll(site?: string): void {
    if (site && this._locks.size > 0) {
      this.logger?.warn(
        'commitAll dropped %d active lock(s) at %s: %s',
        this._locks.size,
        site,
        [...this._locks.keys()].join(', '),
      );
      // F5 (2026-06-04) — accumulate so __skytrixDebug.snapshot() shows the
      // trend. A regression that strands locks at every skip path bumps the
      // counter visibly. The warn covers the per-call signal ; the counter
      // covers the session-aggregate signal.
      this._tolerateLocksDroppedCount += this._locks.size;
    }
    for (const tid of this._safetyTimeouts) clearTimeout(tid);
    this._safetyTimeouts.clear();
    this._locks.clear();
    this._rendered.set(this._logical());
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
