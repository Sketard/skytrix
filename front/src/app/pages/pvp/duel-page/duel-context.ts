import { inject, Injectable, signal, type Signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { duelAssert } from '../../../core/utilities/duel-assert';
import { ReducedMotionService } from '../../../services/reduced-motion.service';

/**
 * Component-level context for the animation pipeline.
 * Holds closures that read component-owned signals (player index, speed, board active).
 * Provided at component level — the host component calls configure() in its constructor.
 *
 * configure() MUST be called before any animation processing begins.
 * In dev mode, unconfigured reads throw to catch two-phase init violations early.
 */
@Injectable()
export class DuelContext {
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  private _configured = false;
  private _ownPlayerIndex: () => number = () => { this.assertConfigured(); return 0; };
  private _speedMultiplier: () => number = () => { this.assertConfigured(); return 1; };
  private _isBoardActive: () => boolean = () => { this.assertConfigured(); return false; };

  /**
   * Resolved reduced-motion state — the user Preferences toggle OR the OS
   * `prefers-reduced-motion` media query. Centralised in `ReducedMotionService`
   * so PvP, Replay and the Preferences page all share one source of truth.
   */
  readonly reducedMotion = inject(ReducedMotionService).enabled;

  /**
   * γ commit 3 — index de perspective SOLO. Source unique de vérité.
   *   - `0` = own player at bottom (default).
   *   - `1` = viewer regarde P1 (P1 en bas).
   *
   * F-bugA (2026-05-31) — c'est un index de DONNÉES, PAS un déclencheur de
   * flip CSS. Le flip CSS `.board-host` (γ commit 6) a été retiré : la
   * perspective pilote uniquement la relativisation des DONNÉES (swap
   * `players[]` via `DuelConnection._shouldSwapForSolo`, routing des
   * `_slots[]`, `ownPlayerIndex`, journal). C'est le pendant SOLO du
   * `perspectiveIndex` du replay. `cardBaseRotation` NE le lit plus (forme
   * statique, comme replay).
   *
   * Tag α.1 `perspectiveSource` (suffix `Source`) : du POV du pipeline
   * animation, cette valeur est un INPUT contextuel (cf. CLAUDE.md
   * "Signal tagging convention (α.1)" sub-section under
   * "Animation Pipeline v2"). L'écriture provient d'EN DEHORS
   * du pipeline : `SoloDuelOrchestratorService.switchPerspective()` et le
   * rematch effect (qui reset à 0). En PvP normal / replay, le signal reste
   * à 0 — la perspective y est figée à l'identité serveur du viewer.
   *
   * Le signal est CONNECTION_LIFETIME (cf. spec §3.5) : il survit à
   * un switch (par définition c'est lui qui PORTE le switch), mais un
   * STATE_SYNC / RematchStarted le reset à 0 via le setupRematchEffect
   * de SoloDuelOrchestratorService.
   *
   * Surface API (post-review M8, 2026-05-28) : le `WritableSignal` reste
   * interne. Les lecteurs passent par `perspective(): Signal<0|1>`
   * (read-only) ; les écrivains (SOLO orchestrator uniquement) par
   * `setPerspective(0|1)`. Cela ferme structurellement le leak qui
   * permettait à n'importe quel consommateur d'appeler `.set()` sur
   * la signal exposé en lecture.
   */
  readonly perspectiveSource = signal<0 | 1>(0);
  perspective(): Signal<0 | 1> { return this.perspectiveSource; }
  setPerspective(value: 0 | 1): void { this.perspectiveSource.set(value); }

  ownPlayerIndex(): number { return this._ownPlayerIndex(); }
  speedMultiplier(): number { return this._speedMultiplier(); }
  isBoardActive(): boolean { return this._isBoardActive(); }

  configure(config: {
    ownPlayerIndex: () => number;
    speedMultiplier: () => number;
    isBoardActive: () => boolean;
  }): void {
    this._configured = true;
    this._ownPlayerIndex = config.ownPlayerIndex;
    this._speedMultiplier = config.speedMultiplier;
    this._isBoardActive = config.isBoardActive;
  }

  // --- Shared helpers (DRY: used by orchestrator + all extracted managers) ---

  relativePlayer(absolutePlayer: number): 0 | 1 {
    return absolutePlayer === this._ownPlayerIndex() ? 0 : 1;
  }

  scaledDuration(base: number, min = 0): number {
    return Math.max(min, Math.round(base * this._speedMultiplier()));
  }

  /**
   * Safety-timeout scaling for guards that wrap async animation work
   * (LOCK_SAFETY_TIMEOUT_MS, REPLAY_BUFFER_SAFETY_TIMEOUT_MS, etc.).
   * Divides by `speedMultiplier` so slow-playback modes don't clip ongoing
   * animations, then adds a 50% margin to absorb GC / layout hiccups on
   * loaded hardware. A device running fast at 1x keeps a comfortable guard
   * (+50%); slow playback at 0.5x doubles the guard.
   */
  safetyTimeout(baseMs: number): number {
    const mult = this._speedMultiplier() || 1;
    return Math.round((baseMs / mult) * 1.5);
  }

  /**
   * Base rotation (degrees) for floating card elements (travel floats, overlays).
   * Cards face their owner: rendered upright on the owner's side of the board.
   *
   * F-bugA (2026-05-31) — STATIC (replay form). Own cards (relPlayer=0, bottom
   * half) render upright (undefined/0°); opponent cards (relPlayer=1, top half)
   * flip 180° so the art faces the opponent — matching the static top/bottom
   * board layout (Mechanism A).
   *
   * Was "perspective-aware" (γ commit 6) to compose with the SOLO `.board-host`
   * 180° CSS flip. That flip is gone: SOLO now relativizes orientation by DATA
   * (swap `players[]` + `ownPlayerIndex = perspectiveIndex`) exactly like replay,
   * where this function is NOT perspective-aware and floats are already correct.
   * By the time it's read the data has put the viewer's cards in the bottom half
   * (rel 0) and the opponent's in the top (rel 1), so `relPlayer` alone decides.
   *
   * Returns undefined when 0 so callers can use
   * `baseRotateZ: ctx.cardBaseRotation(rel)` (option type:
   * `number | undefined`).
   */
  cardBaseRotation(relPlayer: number): number | undefined {
    return relPlayer === 0 ? undefined : 180;
  }

  /** CSS rotateZ fragment for float stabilization (e.g. 'rotateZ(180deg)'). Empty string when 0. */
  cardBaseRotateCSS(relPlayer: number): string {
    const deg = this.cardBaseRotation(relPlayer);
    return deg ? `rotateZ(${deg}deg)` : '';
  }

  /**
   * Animation target rotation (degrees) for zone-card position changes.
   * Always -90° for defense because extractRotationDeg (atan2-based) reads
   * the CSS 270° as -90° — using -90° here ensures the Web Animation API
   * interpolates the shortest path (90° CCW) instead of going 270° CW.
   * ATK is always 0° (card-art handles the 180° flip for opponents separately).
   */
  zoneCardRotation(isDefense: boolean): number {
    if (!isDefense) return 0;
    return -90;
  }

  announceEvent(text: string, player: number): void {
    const isOwn = player === this._ownPlayerIndex();
    const prefix = isOwn ? '' : 'Opponent: ';
    this.liveAnnouncer.announce(`${prefix}${text}`);
  }

  private assertConfigured(): void {
    duelAssert(this._configured, 'DuelContext', 'configure() was not called before first read — check component constructor order');
  }
}
