import { Injectable, OnDestroy, inject } from '@angular/core';
import { toCardRect, buildTravelKeyframes } from './card-travel-helpers';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';

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
  private readonly boardEffects = inject(BoardEffectsService);
  private readonly floatRegistry = inject(FloatRegistryService);
  private _zoneResolver: ((zoneKey: string) => HTMLElement | null) | null = null;
  private _container: HTMLElement = document.body;
  private readonly _timers = new Set<number>();
  private readonly _reducedMotion: boolean;

  constructor() {
    this._reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Register the container element for travel cards (defaults to document.body). */
  registerContainer(el: HTMLElement): void {
    this._container = el;
  }

  registerZoneResolver(fn: (zoneKey: string) => HTMLElement | null): void {
    this._zoneResolver = fn;
  }

  getZoneElement(zoneKey: string): HTMLElement | null {
    return this._zoneResolver?.(zoneKey) ?? null;
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
    const sRect = srcEl.getBoundingClientRect();
    const dRect = dstEl.getBoundingClientRect();
    const sx = sRect.left + sRect.width / 2;
    const sy = sRect.top + sRect.height / 2;
    const dx = dRect.left + dRect.width / 2;
    const dy = dRect.top + dRect.height / 2;
    const length = Math.sqrt((dx - sx) ** 2 + (dy - sy) ** 2);
    const angle = Math.atan2(dy - sy, dx - sx) * (180 / Math.PI);
    const h = style.height ?? 3;

    const line = document.createElement('div');
    line.style.cssText = `
      position: fixed; pointer-events: none; z-index: 50;
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
      ? this._zoneResolver(source)
      : source;
    const destEl = typeof destination === 'string'
      ? this._zoneResolver(destination)
      : destination;
    if (!sourceEl || !destEl) return Promise.resolve();

    // When srcRotateZ is set the source card is visually rotated (e.g. defense position).
    // getBoundingClientRect() returns the AABB which has swapped width/height.
    // Strip the transform momentarily to read the true un-rotated rect.
    const srcRotateZ = options.srcRotateZ ?? 0;
    let rawSourceRect: DOMRect;
    if (srcRotateZ && sourceEl instanceof HTMLElement) {
      const savedTransform = sourceEl.style.transform;
      const savedTransition = sourceEl.style.transition;
      sourceEl.style.transition = 'none';
      sourceEl.style.transform = 'none';
      rawSourceRect = sourceEl.getBoundingClientRect();
      sourceEl.style.transform = savedTransform;
      void sourceEl.offsetHeight;
      sourceEl.style.transition = savedTransition;
    } else {
      rawSourceRect = sourceEl.getBoundingClientRect();
    }
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

    let rawDestRect: DOMRect;
    if (destRotateZ && destEl instanceof HTMLElement) {
      const savedTransform = destEl.style.transform;
      const savedTransition = destEl.style.transition;
      destEl.style.transition = 'none';
      destEl.style.transform = 'none';
      rawDestRect = destEl.getBoundingClientRect();
      destEl.style.transform = savedTransform;
      void destEl.offsetHeight;
      destEl.style.transition = savedTransition;
    } else {
      rawDestRect = destEl.getBoundingClientRect();
    }

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

    // Flip: swap img src at the 90° midpoint (edge-on, visually invisible swap)
    if (options.flipDuringTravel) {
      const img = floatingEl.querySelector('img')!;
      const showingBack = options.showBack ?? false;
      const flipId = window.setTimeout(() => {
        this._timers.delete(flipId);
        img.src = showingBack
          ? this.toAbsoluteUrl(cardImage)
          : this.toAbsoluteUrl('assets/images/card_back.jpg');
      }, duration * 0.45);
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
      this.applyGlow(sourceEl, options.departureGlowColor, duration * 0.15);
    }
    if (options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      const filterOnId = window.setTimeout(() => {
        this._timers.delete(filterOnId);
        floatingEl.style.filter = `drop-shadow(0 0 8px ${glowColor})`;
        const filterOffId = window.setTimeout(() => {
          this._timers.delete(filterOffId);
          floatingEl.style.filter = '';
        }, duration * 0.25);
        this._timers.add(filterOffId);
      }, duration * 0.75);
      this._timers.add(filterOnId);
    }

    if (options.landingStyle === 'soft' && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      const id = window.setTimeout(() => {
        this._timers.delete(id);
        this.boardEffects.zoneImpactEffect(rawDestRect, glowColor, duration);
      }, duration * 0.70);
      this._timers.add(id);
    }
    if (options.landingStyle === 'banish' && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      const id = window.setTimeout(() => {
        this._timers.delete(id);
        this.boardEffects.zoneImpactEffect(rawDestRect, glowColor, duration);
      }, duration * 0.70);
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

  private createFloatingElement(sourceRect: DOMRect, cardImage: string, options: TravelOptions): HTMLDivElement {
    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
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
