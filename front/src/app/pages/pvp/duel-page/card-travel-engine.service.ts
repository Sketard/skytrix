import { Injectable, Injector, OnDestroy, inject } from '@angular/core';
import { toCardRect, buildTravelKeyframes } from './card-travel-helpers';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import { DuelLogger } from './duel-logger';
import { ReducedMotionService } from '../../../services/reduced-motion.service';
import {
  TRAVEL_FLIP_MIDPOINT_FRACTION,
  TRAVEL_DEPARTURE_GLOW_FRACTION,
  TRAVEL_IMPACT_GLOW_ON_FRACTION,
  TRAVEL_IMPACT_GLOW_HOLD_FRACTION,
  TRAVEL_LANDING_IMPACT_FRACTION,
} from './animation-constants';

export interface TravelOptions {
  showBack?: boolean;
  flipDuringTravel?: boolean;
  duration?: number;
  departureGlowColor?: string;
  impactGlowColor?: string;
  /** Where to land inside a wide container: 'center' (default) or 'right'. */
  destAlign?: 'center' | 'right';
  /** Extra rotateZ (degrees) applied at landing — e.g. -90 for defense position. */
  destRotateZ?: number;
  /** Extra rotateZ (degrees) applied at departure and eased out — e.g. -90 for a card leaving defense position. */
  srcRotateZ?: number;
  /** Base rotateZ applied throughout the entire travel — e.g. 180 for opponent cards. */
  baseRotateZ?: number;
  /** Landing style: 'slam' for field summon, 'soft' for GY (absorption), 'banish' for banish zone (rift), 'default' for micro-bounce. */
  landingStyle?: 'default' | 'slam' | 'soft' | 'banish';
  /** Zone key tag stored on the float for later filtering (e.g. 'HAND-0', 'GY-1'). */
  dstZoneKey?: string;
  /**
   * Card code tag stored on the float. Used by `processShuffleEvent` to match
   * multiple HAND landed floats to their post-shuffle DOM positions.
   */
  cardCode?: number;
}

/**
 * Animates card travel from a source zone/element to a destination zone/element.
 *
 * Owns: zone resolver registry, container element, geometry computation,
 * keyframe generation (via card-travel-helpers), animation kickoff, departure
 * glow + impact filter timers, and the toAbsoluteUrl helper.
 *
 * Delegates: in-flight / landed float tracking → {@link FloatRegistryService};
 * autonomous board effects (zoneImpactEffect, slamDustParticles) → {@link BoardEffectsService}.
 *
 * Renamed from CardTravelService in M11 Phase 2 — the new name reflects that
 * this service is the travel ENGINE while the registry / effects live in
 * sibling services.
 */
@Injectable()
export class CardTravelEngine implements OnDestroy {
  private readonly injector = inject(Injector);
  private readonly floatRegistry = inject(FloatRegistryService);
  /** Optional logger — `null` outside the duel-page injection scope (e.g.
   *  preview miniatures, solo simulator). Resolved lazily so the engine
   *  stays usable in contexts that don't provide DuelLogger. */
  private readonly logger = inject(DuelLogger, { optional: true });
  private _boardEffects: BoardEffectsService | null = null;
  private _zoneResolver: ((zoneKey: string) => HTMLElement | null) | null = null;
  private _container: HTMLElement = document.body;
  private readonly _timers = new Set<number>();
  private readonly _reducedMotionSvc = inject(ReducedMotionService);

  /** Centralised reduced-motion state (Preferences toggle OR OS preference) —
   *  read live so a mid-session Preferences change takes effect immediately. */
  private get _reducedMotion(): boolean {
    return this._reducedMotionSvc.enabled();
  }

  private get boardEffects(): BoardEffectsService {
    if (!this._boardEffects) {
      this._boardEffects = this.injector.get(BoardEffectsService);
    }
    return this._boardEffects;
  }

  /** Register the container element for travel cards (defaults to document.body).
   *
   * γ commit 6 — `_container` MUST point at `.board-host` so floats sit
   * INSIDE the perspective-flipped subtree. With `_container = body`,
   * floats lived in the viewport coordinate system and their
   * `position:fixed; left:X; top:Y` was independent of any parent
   * `transform: rotate(180deg)` — the cards would fly the wrong way in
   * a flipped perspective. Now that floats are `position:absolute`
   * children of `_container` with container-local coords, the browser
   * naturally projects them through the container's transform.
   *
   * The container is REQUIRED to have `position: relative` (or any
   * non-static positioning) for `position:absolute` children to anchor.
   * `.board-host` already declares `position: relative` (cf.
   * `_duel-tokens.scss`); other containers (preview miniatures, solo
   * simulator) MUST mirror this.
   */
  registerContainer(el: HTMLElement): void {
    this._container = el;
  }

  /**
   * γ commit 6 — convert a viewport-coord `DOMRect` to container-local
   * coords by subtracting the container's `getBoundingClientRect()`
   * origin. Used by every site that places a float as a positioned
   * child of `_container` (createFloatingElement, createLineBetween,
   * and the BoardEffectsService overlays via `getLocalRect`).
   *
   * Safe even when `_container === document.body` (legacy default):
   * `body.getBoundingClientRect()` returns `{left:0, top:0, ...}` at
   * a non-scrolled top of page, so the subtraction is a no-op. When
   * the page is scrolled the body rect has negative top — the
   * subtraction would offset to the visible portion, but since legacy
   * call sites used `position:fixed` (viewport-anchored, scroll-independent)
   * the math worked. Now that we switch to `position:absolute`, the
   * subtraction MUST land relative to a positioned ancestor — the
   * `.board-host` registration guarantees this.
   */
  private toLocalRect(viewportRect: DOMRect): DOMRect {
    const containerRect = this._container.getBoundingClientRect();
    return new DOMRect(
      viewportRect.left - containerRect.left,
      viewportRect.top - containerRect.top,
      viewportRect.width,
      viewportRect.height,
    );
  }

  /** γ commit 6 — exposed for sibling services (BoardEffectsService,
   *  BattleAnimationTracker) that build their own overlays anchored to
   *  zones. Same semantics as `toLocalRect`, but public. */
  getLocalRect(viewportRect: DOMRect): DOMRect {
    return this.toLocalRect(viewportRect);
  }

  registerZoneResolver(fn: (zoneKey: string) => HTMLElement | null): void {
    this._zoneResolver = fn;
  }

  getZoneElement(zoneKey: string): HTMLElement | null {
    const el = this._zoneResolver?.(zoneKey) ?? null;
    this.logger?.resolve('getZoneElement', zoneKey, el,
      this._zoneResolver ? undefined : 'noResolver');
    return el;
  }

  /** The container element for floating overlays (attack lines, clash effects). */
  getContainer(): HTMLElement {
    return this._container;
  }

  /**
   * Create a positioned line element between two zone elements.
   * Returns null if either element is missing. Caller owns lifecycle (animation, removal).
   */
  createLineBetween(
    srcEl: HTMLElement | null,
    dstEl: HTMLElement | null,
    style: { color: string; height?: number; shadow?: string },
  ): HTMLDivElement | null {
    if (!srcEl || !dstEl) return null;
    // γ commit 6 — viewport rects converted to container-local before
    // computing endpoints. The line is a positioned child of
    // `_container` so its `position: absolute` references the
    // container's origin, and the parent transform flips the line
    // visually alongside the cards.
    const sRect = this.toLocalRect(srcEl.getBoundingClientRect());
    const dRect = this.toLocalRect(dstEl.getBoundingClientRect());
    const sx = sRect.left + sRect.width / 2;
    const sy = sRect.top + sRect.height / 2;
    const dx = dRect.left + dRect.width / 2;
    const dy = dRect.top + dRect.height / 2;
    const length = Math.sqrt((dx - sx) ** 2 + (dy - sy) ** 2);
    const angle = Math.atan2(dy - sy, dx - sx) * (180 / Math.PI);
    const h = style.height ?? 3;

    const line = document.createElement('div');
    line.style.cssText = `
      position: absolute; pointer-events: none; z-index: 50;
      left: ${sx}px; top: ${sy - h / 2}px;
      width: ${length}px; height: ${h}px;
      transform-origin: 0 50%; transform: rotate(${angle}deg);
      background: ${style.color}; border-radius: ${h / 2}px;
      ${style.shadow ? `box-shadow: ${style.shadow};` : ''}
    `;
    this._container.appendChild(line);
    return line;
  }

  travel(source: string | HTMLElement, destination: string | HTMLElement, cardImage: string, options: TravelOptions = {}): Promise<void> {
    if (this._reducedMotion || !this._zoneResolver) return Promise.resolve();

    const sourceEl = typeof source === 'string'
      ? this.getZoneElement(source)
      : source;
    const destEl = typeof destination === 'string'
      ? this.getZoneElement(destination)
      : destination;
    if (!sourceEl || !destEl) {
      // The resolver already warned at the precise input; add one combined
      // travel-side warn so the caller chain (commitAndClearFloat, srcLock
      // commit) is visible in the same log line. A missing element here
      // means the card visually "teleports" — silence is the worst signal.
      const srcLabel = typeof source === 'string' ? source : 'el';
      const dstLabel = typeof destination === 'string' ? destination : 'el';
      this.logger?.warn('travel skipped — src=%s(%s) dst=%s(%s) card=%d',
        srcLabel, sourceEl ? 'found' : 'null',
        dstLabel, destEl ? 'found' : 'null',
        options.cardCode ?? 0);
      return Promise.resolve();
    }

    // γ commit 6 — coords lecture : viewport via getBoundingClientRect.
    // Coords écriture : container-local via toLocalRect. La transition
    // entre les deux se fait UNE FOIS ici, après readRect et avant le
    // placement / calcul de keyframes — la suite du flux travaille en
    // container-local pur (position:absolute des floats).
    const srcRotateZ = options.srcRotateZ ?? 0;
    const rawSourceRectViewport = this.readRect(sourceEl, !!srcRotateZ);
    const rawSourceRect = this.toLocalRect(rawSourceRectViewport);
    const sourceRect = toCardRect(rawSourceRect);

    // Detect destination fan rotation BEFORE reading its rect.
    // When rotated, getBoundingClientRect() returns the AABB (axis-aligned bounding box)
    // whose center is offset from the card's true CSS center. Read the untransformed
    // rect instead so dx/dy targets the real position.
    let destRotateZ = options.destRotateZ ?? 0;
    let destTranslateY = 0;
    if (destEl instanceof HTMLElement && destEl.style.transform) {
      const matchR = destEl.style.transform.match(/rotate\(([-\d.]+)deg\)/);
      if (matchR) destRotateZ = parseFloat(matchR[1]);
      const matchTY = destEl.style.transform.match(/translateY\(([-\d.]+)px\)/);
      if (matchTY) destTranslateY = parseFloat(matchTY[1]);
    }

    const rawDestRectViewport = this.readRect(destEl, !!destRotateZ);
    const rawDestRect = this.toLocalRect(rawDestRectViewport);

    const cardDestRect = toCardRect(rawDestRect);

    const align = options.destAlign ?? 'center';
    const destRect = rawDestRect.width > sourceRect.width * 1.5
      ? new DOMRect(
          align === 'right'
            ? rawDestRect.right - sourceRect.width
            : rawDestRect.left + (rawDestRect.width - sourceRect.width) / 2,
          rawDestRect.top + (rawDestRect.height - sourceRect.height) / 2,
          sourceRect.width,
          sourceRect.height,
        )
      : cardDestRect;
    const duration = options.duration ?? 400;
    const floatingEl = this.createFloatingElement(sourceRect, cardImage, options);
    const dstKey = options.dstZoneKey ?? (typeof destination === 'string' ? destination : null);
    if (dstKey) floatingEl.dataset['dstKey'] = dstKey;
    if (options.cardCode) floatingEl.dataset['cardCode'] = String(options.cardCode);

    this._container.appendChild(floatingEl);

    // Flip: swap img src at the 90° midpoint (edge-on, visually invisible swap).
    // TRAVEL_FLIP_MIDPOINT_FRACTION must match the 90° rotateY point of the
    // keyframe rotation built in `buildTravelKeyframes`.
    if (options.flipDuringTravel) {
      const img = floatingEl.querySelector('img')!;
      const showingBack = options.showBack ?? false;
      const flipId = window.setTimeout(() => {
        this._timers.delete(flipId);
        img.src = showingBack
          ? this.toAbsoluteUrl(cardImage)
          : this.toAbsoluteUrl('assets/images/card_back.jpg');
      }, duration * TRAVEL_FLIP_MIDPOINT_FRACTION);
      this._timers.add(flipId);
    }

    // Copy transform-origin from destination as percentages so the pivot maps
    // correctly even though the floating element has different dimensions.
    let originYFraction = 0.5;
    const base = options.baseRotateZ ?? 0;
    if (destRotateZ && !base && destEl instanceof HTMLElement) {
      const raw = getComputedStyle(destEl).transformOrigin;
      const [oxPx, oyPx] = raw.split(' ').map(parseFloat);
      const oxPct = (oxPx / rawDestRect.width) * 100;
      const oyPct = (oyPx / rawDestRect.height) * 100;
      floatingEl.style.transformOrigin = `${oxPct}% ${oyPct}%`;
      originYFraction = oyPct / 100;
    }

    const keyframes = buildTravelKeyframes(sourceRect, destRect, options, destRotateZ, destTranslateY, originYFraction);
    const animation = floatingEl.animate(keyframes, {
      duration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });

    if (options.departureGlowColor) {
      this.applyGlow(sourceEl, options.departureGlowColor, duration * TRAVEL_DEPARTURE_GLOW_FRACTION);
    }
    if (options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      const filterOnId = window.setTimeout(() => {
        this._timers.delete(filterOnId);
        floatingEl.style.filter = `drop-shadow(0 0 8px ${glowColor})`;
        const filterOffId = window.setTimeout(() => {
          this._timers.delete(filterOffId);
          floatingEl.style.filter = '';
        }, duration * TRAVEL_IMPACT_GLOW_HOLD_FRACTION);
        this._timers.add(filterOffId);
      }, duration * TRAVEL_IMPACT_GLOW_ON_FRACTION);
      this._timers.add(filterOnId);
    }

    const isImpactLanding = options.landingStyle === 'soft' || options.landingStyle === 'banish';
    if (isImpactLanding && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      const id = window.setTimeout(() => {
        this._timers.delete(id);
        this.boardEffects.zoneImpactEffect(rawDestRect, glowColor, duration);
      }, duration * TRAVEL_LANDING_IMPACT_FRACTION);
      this._timers.add(id);
    }

    const onLand = options.landingStyle === 'slam'
      ? () => this.boardEffects.slamDustParticles(rawDestRect)
      : undefined;

    return this.floatRegistry.register(floatingEl, animation, onLand);
  }

  ngOnDestroy(): void {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
  }

  /**
   * Read an element's bounding rect, optionally stripping its inline transform
   * first so a rotated element returns its true un-rotated rect rather than
   * the AABB. Restores the transform synchronously after the measurement;
   * `void offsetHeight` forces a reflow so the restore takes effect before the
   * next frame paints (transition was nulled out so no visible flash).
   */
  private readRect(el: HTMLElement | Element, stripTransform: boolean): DOMRect {
    if (!stripTransform || !(el instanceof HTMLElement)) {
      return el.getBoundingClientRect();
    }
    const savedTransform = el.style.transform;
    const savedTransition = el.style.transition;
    el.style.transition = 'none';
    el.style.transform = 'none';
    const rect = el.getBoundingClientRect();
    el.style.transform = savedTransform;
    void el.offsetHeight;
    el.style.transition = savedTransition;
    return rect;
  }

  private createFloatingElement(sourceRect: DOMRect, cardImage: string, options: TravelOptions): HTMLDivElement {
    const div = document.createElement('div');
    // γ commit 6 — `position: absolute` + container-local coords. The
    // float is a positioned child of `_container` (`.board-host` in
    // production), so the browser projects it through any parent
    // transform (perspective flip in SOLO). `sourceRect` is already
    // container-local at this point (toLocalRect ran in `travel()`).
    div.style.cssText = `
      position: absolute;
      pointer-events: none;
      will-change: transform, opacity;
      z-index: 900; /* $z-pvp-card-travel — must stay below $z-pvp-chain-overlay (950) */
      width: ${sourceRect.width}px;
      height: ${sourceRect.height}px;
      left: ${sourceRect.left}px;
      top: ${sourceRect.top}px;
      overflow: hidden;
      border-radius: 4px;
      transform-origin: ${sourceRect.width / 2}px ${sourceRect.height / 2}px;
    `;

    const img = document.createElement('img');
    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
    img.src = options.showBack
      ? this.toAbsoluteUrl('assets/images/card_back.jpg')
      : this.toAbsoluteUrl(cardImage);
    img.alt = '';
    div.appendChild(img);

    return div;
  }

  private applyGlow(el: HTMLElement, color: string, duration: number): void {
    const target = el.querySelector<HTMLElement>('img') ?? el;
    target.style.boxShadow = `0 0 12px 4px ${color}`;
    const id = window.setTimeout(() => {
      this._timers.delete(id);
      target.style.boxShadow = '';
    }, duration);
    this._timers.add(id);
  }

  toAbsoluteUrl(relativePath: string): string {
    if (relativePath.startsWith('http') || relativePath.startsWith('//')) return relativePath;
    return `${window.location.origin}/${relativePath.replace(/^\//, '')}`;
  }
}
