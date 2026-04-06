import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { duelAssert } from './duel-assert';

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

  readonly reducedMotion = signal(matchMedia('(prefers-reduced-motion: reduce)').matches);

  constructor() {
    const mql = matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => this.reducedMotion.set(e.matches);
    mql.addEventListener('change', handler);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', handler));
  }

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
   * Base rotation (degrees) for floating card elements (travel floats, overlays).
   * Cards face their owner: 180° for opponent cards, 0° for own.
   * Returns undefined when 0 so callers can use `baseRotateZ: ctx.cardBaseRotation(rel)`.
   */
  cardBaseRotation(relPlayer: number): number | undefined {
    return relPlayer === 1 ? 180 : undefined;
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
  zoneCardRotation(_relPlayer: number, isDefense: boolean): number {
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
