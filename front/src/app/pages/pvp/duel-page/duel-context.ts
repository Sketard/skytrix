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
   * γ commit 3 — perspective visuelle du board. Source unique de
   * vérité pour la projection (POC §1 décision S3 + §4 algorithme).
   *   - `0` = own player at bottom (default).
   *   - `1` = flipped (own at top — appliqué via `rotate(180deg)` sur
   *     `.board-host` au commit 6).
   *
   * Tag α.1 `perspectiveSource` (suffix `Source`) : du POV du pipeline
   * animation, cette valeur est un INPUT contextuel (cf. CLAUDE.md
   * "Pipeline Signal Tagging Convention"). Le pipeline LIT — il dérive
   * `cardBaseRotation` (commit 6) et les projections perspective-aware
   * Mode B. L'écriture provient d'EN DEHORS du pipeline :
   * `SoloDuelOrchestratorService.switchPerspective()` et le rematch
   * effect (qui reset à 0). En PvP normal / replay, le signal reste à
   * 0 — la perspective y est figée à l'identité serveur du viewer.
   *
   * Le signal est CONNECTION_LIFETIME (cf. spec §3.5) : il survit à
   * un switch (par définition c'est lui qui PORTE le switch), mais un
   * STATE_SYNC / RematchStarted le reset à 0 via le setupRematchEffects
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
   * γ commit 6 — perspective-aware (option B.1 POC §2). Composition
   * mathématique post-flip parent à 180° :
   *   - perspective=0 (default, own at bottom) :
   *       own  (relPlayer=0) art à 0°  × 0° board     = 0°   → upright pour le viewer
   *       opp  (relPlayer=1) art à 180° × 0° board    = 180° → upright pour l'opp
   *   - perspective=1 (flipped, own au top après transform 180° du `.board-host`) :
   *       own  (relPlayer=0) art à 180° × 180° board  = 360° = 0° → upright pour le viewer
   *       opp  (relPlayer=1) art à 0°   × 180° board  = 180° → upright pour l'opp
   *
   * Sans cette logique, Option A (suppression) recrée le bug actuel inversé
   * (opp art à l'endroit pour le viewer côté joueur, illisible) en
   * perspective=0 ; ou (post-flip) joueur art upside-down après le switch.
   * Cf. POC `decision.md` §2.
   *
   * Returns undefined when 0 so callers can use
   * `baseRotateZ: ctx.cardBaseRotation(rel)` (option type:
   * `number | undefined`).
   */
  cardBaseRotation(relPlayer: number): number | undefined {
    const flipped = this.perspectiveSource() === 1;
    const isOwn = relPlayer === 0;
    if (flipped) return isOwn ? 180 : undefined;
    return isOwn ? undefined : 180;
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
