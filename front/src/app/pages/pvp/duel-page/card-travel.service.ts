import { Injectable, OnDestroy } from '@angular/core';

export interface TravelOptions {
  showBack?: boolean;
  flipDuringTravel?: boolean;
  duration?: number;
  departureGlowColor?: string;
  impactGlowColor?: string;
  /** Where to land inside a wide container: 'center' (default) or 'right'. */
  destAlign?: 'center' | 'right';
  /** Extra rotateZ (degrees) applied at landing — e.g. 90 for defense position. */
  destRotateZ?: number;
  /** Base rotateZ applied throughout the entire travel — e.g. 180 for opponent cards. */
  baseRotateZ?: number;
}

@Injectable()
export class CardTravelService implements OnDestroy {
  private _zoneResolver: ((zoneKey: string) => HTMLElement | null) | null = null;
  private _container: HTMLElement = document.body;
  private readonly _inFlight = new Map<HTMLDivElement, { animation: Animation; resolve: () => void }>();
  private readonly _landed = new Set<HTMLDivElement>();
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

  travel(source: string | HTMLElement, destination: string | HTMLElement, cardImage: string, options: TravelOptions = {}): Promise<void> {
    if (this._reducedMotion || !this._zoneResolver) return Promise.resolve();

    const sourceEl = typeof source === 'string'
      ? this._zoneResolver(source)
      : source;
    const destEl = typeof destination === 'string'
      ? this._zoneResolver(destination)
      : destination;
    if (!sourceEl || !destEl) return Promise.resolve();

    const sourceRect = this.toCardRect(sourceEl.getBoundingClientRect());

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
      // Disable transition so the strip/restore doesn't trigger a CSS animation
      destEl.style.transition = 'none';
      destEl.style.transform = 'none';
      rawDestRect = destEl.getBoundingClientRect();
      destEl.style.transform = savedTransform;
      // Force reflow to commit the restored transform BEFORE re-enabling transition
      void destEl.offsetHeight;
      destEl.style.transition = savedTransition;
    } else {
      rawDestRect = destEl.getBoundingClientRect();
    }

    // Compute card-visible rect within the destination zone (same aspect ratio logic as source)
    const cardDestRect = this.toCardRect(rawDestRect);

    // If destination is a container (much wider than source, e.g. hand row),
    // target a card-sized rect within it to avoid stretching
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
    this._container.appendChild(floatingEl);

    // Flip: swap img src at the 90° midpoint (edge-on, visually invisible swap)
    if (options.flipDuringTravel) {
      const img = floatingEl.querySelector('img')!;
      const showingBack = options.showBack ?? false;
      this.addTimer(window.setTimeout(() => {
        img.src = showingBack
          ? this.toAbsoluteUrl(cardImage)
          : this.toAbsoluteUrl('assets/images/card_back.jpg');
      }, duration * 0.45));
    }

    // Copy transform-origin from destination as percentages so the pivot maps
    // correctly even though the floating element has different dimensions.
    if (destRotateZ && destEl instanceof HTMLElement) {
      const raw = getComputedStyle(destEl).transformOrigin;
      const [oxPx, oyPx] = raw.split(' ').map(parseFloat);
      const oxPct = (oxPx / rawDestRect.width) * 100;
      const oyPct = (oyPx / rawDestRect.height) * 100;
      floatingEl.style.transformOrigin = `${oxPct}% ${oyPct}%`;
    }

    const keyframes = this.buildKeyframes(sourceRect, destRect, options, destRotateZ, destTranslateY);
    const animation = floatingEl.animate(keyframes, {
      duration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });

    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this._inFlight.set(floatingEl, { animation, resolve });

    if (options.departureGlowColor) {
      this.applyGlow(sourceEl, options.departureGlowColor, duration * 0.15);
    }
    if (options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      this.addTimer(window.setTimeout(() => {
        floatingEl.style.filter = `drop-shadow(0 0 8px ${glowColor})`;
        this.addTimer(window.setTimeout(() => { floatingEl.style.filter = ''; }, duration * 0.25));
      }, duration * 0.75));
    }

    animation.finished.then(() => {
      this._inFlight.delete(floatingEl);
      this._landed.add(floatingEl);
      resolve();
    }).catch(() => {
      // animation.cancel() rejects — cleanup handled by ngOnDestroy
    });

    return promise;
  }

  /** Remove all travel elements whose animations have finished. */
  clearLandedTravels(): void {
    for (const el of this._landed) {
      el.remove();
    }
    this._landed.clear();
  }

  /** Finish all in-flight animations and remove all travel elements. */
  clearAllTravels(): void {
    for (const [el, { animation, resolve }] of this._inFlight) {
      animation.finish();
      el.remove();
      resolve();
    }
    this._inFlight.clear();
    this.clearLandedTravels();
  }

  ngOnDestroy(): void {
    for (const id of this._timers) {
      clearTimeout(id);
    }
    this._timers.clear();
    for (const [el, { animation, resolve }] of this._inFlight) {
      animation.cancel();
      el.remove();
      resolve();
    }
    this._inFlight.clear();
    this.clearLandedTravels();
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

  private buildKeyframes(fromRect: DOMRect, destRect: DOMRect, options: TravelOptions, destRotateZ = 0, destTranslateY = 0): Keyframe[] {
    const dx = destRect.left + (destRect.width - fromRect.width) / 2 - fromRect.left;
    const dy = destRect.top + (destRect.height - fromRect.height) / 2 - fromRect.top + destTranslateY;
    const flip = options.flipDuringTravel ?? false;
    const base = options.baseRotateZ ?? 0;

    // Lift (0% → 15%)
    // Travel (15% → 75%)
    // Land (75% → 100%)
    // Flip direction depends on which face must be non-mirrored:
    //   showBack (draw): start at 180 → 90 → 0  — the revealed front lands at 0deg (correct)
    //   !showBack (destroy): start at 0 → 90 → 180 — the visible front starts at 0deg (correct)
    // Card backs are symmetric so 180deg on the back is visually identical.
    const flipReverse = flip && (options.showBack ?? false);
    const startRY = flipReverse ? 180 : 0;
    const endRY = flipReverse ? 0 : (flip ? 180 : 0);

    // baseRotateZ is applied throughout (for opponent cards: constant 180°).
    // destRotateZ is applied on top at landing (for defense position: +90°).
    const rzBase = base ? ` rotateZ(${base}deg)` : '';
    const rz = (base + destRotateZ) ? ` rotateZ(${base + destRotateZ}deg)` : '';
    const rzHalf = (base + destRotateZ * 0.5) ? ` rotateZ(${base + destRotateZ * 0.5}deg)` : '';

    const keyframes: Keyframe[] = [
      // 0% — start
      {
        offset: 0,
        transform: `translate(0, 0) scale(1) rotateY(${startRY}deg)${rzBase}`,
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      },
      // 15% — lifted
      {
        offset: 0.15,
        transform: `translate(0, 0) scale(1.15) rotateY(${startRY}deg)${rzBase}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      },
    ];

    if (flip) {
      // Flip travel: through 90deg edge-on midpoint
      keyframes.push(
        {
          offset: 0.45,
          transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1) rotateY(90deg)${rzHalf}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        },
        {
          offset: 0.75,
          transform: `translate(${dx}px, ${dy}px) scale(1.15) rotateY(${endRY}deg)${rz}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        },
      );
    } else {
      // Subtle arc travel
      keyframes.push(
        {
          offset: 0.45,
          transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(1) rotateY(8deg)${rzHalf}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        },
        {
          offset: 0.75,
          transform: `translate(${dx}px, ${dy}px) scale(1.15) rotateY(0deg)${rz}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        },
      );
    }

    // Land with micro-bounce
    keyframes.push(
      {
        offset: 0.88,
        transform: `translate(${dx}px, ${dy}px) scale(1.05) rotateY(${endRY}deg)${rz}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      },
      {
        offset: 1,
        transform: `translate(${dx}px, ${dy}px) scale(1) rotateY(${endRY}deg)${rz}`,
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      },
    );

    return keyframes;
  }

  /** Compute the visible card area within a rect, accounting for card aspect ratio (59:86). */
  private toCardRect(rect: DOMRect): DOMRect {
    const CARD_ASPECT = 59 / 86;
    let w = rect.width;
    let h = rect.height;
    if (w / h > CARD_ASPECT) {
      w = h * CARD_ASPECT;
    } else {
      h = w / CARD_ASPECT;
    }
    return new DOMRect(
      rect.left + (rect.width - w) / 2,
      rect.top + (rect.height - h) / 2,
      w, h,
    );
  }

  private applyGlow(el: HTMLElement, color: string, duration: number): void {
    const target = el.querySelector<HTMLElement>('img') ?? el;
    target.style.boxShadow = `0 0 12px 4px ${color}`;
    this.addTimer(window.setTimeout(() => { target.style.boxShadow = ''; }, duration));
  }

  private addTimer(id: number): void {
    this._timers.add(id);
  }

  toAbsoluteUrl(relativePath: string): string {
    if (relativePath.startsWith('http') || relativePath.startsWith('//')) return relativePath;
    return `${window.location.origin}/${relativePath.replace(/^\//, '')}`;
  }
}
