import { Injectable, OnDestroy } from '@angular/core';

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
  /** Base rotateZ applied throughout the entire travel — e.g. 180 for opponent cards. */
  baseRotateZ?: number;
  /** Landing style: 'slam' for field summon, 'soft' for GY (absorption), 'banish' for banish zone (rift), 'default' for micro-bounce. */
  landingStyle?: 'default' | 'slam' | 'soft' | 'banish';
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

    if (options.landingStyle === 'soft' && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      this.addTimer(window.setTimeout(() => {
        this.zoneImpactEffect(rawDestRect, glowColor, duration);
      }, duration * 0.70));
    }
    if (options.landingStyle === 'banish' && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      this.addTimer(window.setTimeout(() => {
        this.zoneImpactEffect(rawDestRect, glowColor, duration);
      }, duration * 0.70));
    }

    const onLanded = () => { this._landed.add(floatingEl); resolve(); };

    animation.finished.then(() => {
      this._inFlight.delete(floatingEl);
      if (options.landingStyle === 'slam') {
        this.slamDustParticles(rawDestRect);
      }
      onLanded();
    }).catch(() => {
      // animation.cancel() rejects — cleanup handled by ngOnDestroy
    });

    return promise;
  }

  /** Return the most recently landed float element (if any). */
  getLastLandedFloat(): HTMLElement | null {
    let last: HTMLElement | null = null;
    for (const el of this._landed) last = el;
    return last;
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
    // destRotateZ is applied on top at landing (for defense position: -90°).
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

    const land = `translate(${dx}px, ${dy}px)`;
    const landEnd: Keyframe = {
      offset: 1,
      transform: `${land} scale(1) rotateY(${endRY}deg)${rz}`,
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    };

    if (options.landingStyle === 'soft') {
      // GY: standard landing (zoneImpactEffect handles the visual)
      keyframes.push(landEnd);
    } else if (options.landingStyle === 'banish') {
      // Banish: standard landing (zoneImpactEffect handles the visual)
      keyframes.push(landEnd);
    } else if (options.landingStyle === 'slam') {
      // Card grows during travel and lands at final size — no post-travel scale
      keyframes.push(landEnd);
    } else {
      // Default: micro-bounce
      keyframes.push(
        { offset: 0.88, transform: `${land} scale(1.05) rotateY(${endRY}deg)${rz}`, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' },
        landEnd,
      );
    }

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

  /** Radial glow contraction + dark sink overlay — shared by GY absorption and banish rift. */
  private zoneImpactEffect(rect: DOMRect, color: string, duration = 400): void {
    if (this._reducedMotion) return;
    const pad = 4;

    // 1. Radial glow that contracts into the zone center
    const glow = document.createElement('div');
    glow.style.cssText = `
      position:fixed; pointer-events:none; z-index:901;
      left:${rect.left - pad}px; top:${rect.top - pad}px;
      width:${rect.width + pad * 2}px; height:${rect.height + pad * 2}px;
      border-radius:4px;
      background:radial-gradient(circle, ${color} 0%, transparent 70%);
    `;
    this._container.appendChild(glow);
    glow.animate([
      { opacity: 0, transform: 'scale(1.3)' },
      { opacity: 0.8, transform: 'scale(1)', offset: 0.4 },
      { opacity: 0, transform: 'scale(0.85)' },
    ], { duration: duration * 0.6, easing: 'ease-in-out', fill: 'forwards' })
      .finished.then(() => glow.remove());

    // 2. Brief dark overlay simulating the card sinking in
    const sink = document.createElement('div');
    sink.style.cssText = `
      position:fixed; pointer-events:none; z-index:900;
      left:${rect.left}px; top:${rect.top}px;
      width:${rect.width}px; height:${rect.height}px;
      border-radius:4px;
      background:rgba(0,0,0,0.5);
    `;
    this._container.appendChild(sink);
    sink.animate([
      { opacity: 0 },
      { opacity: 1, offset: 0.35 },
      { opacity: 0 },
    ], { duration: duration * 0.55, easing: 'ease-in', fill: 'forwards' })
      .finished.then(() => sink.remove());
  }

  /** Dust particles expelled from the zone edges on slam impact. */
  private slamDustParticles(rect: DOMRect): void {
    if (this._reducedMotion) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Spawn points along the bottom and sides of the zone
    const spawnPoints = [
      { x: cx - rect.width * 0.35, y: rect.bottom },
      { x: cx - rect.width * 0.15, y: rect.bottom },
      { x: cx,                      y: rect.bottom },
      { x: cx + rect.width * 0.15, y: rect.bottom },
      { x: cx + rect.width * 0.35, y: rect.bottom },
      { x: rect.left,               y: cy + rect.height * 0.2 },
      { x: rect.right,              y: cy + rect.height * 0.2 },
    ];

    spawnPoints.forEach(({ x, y }, i) => {
      const size = 4 + Math.random() * 5;
      const p = document.createElement('div');
      p.style.cssText = `
        position:fixed; pointer-events:none; z-index:900;
        left:${x - size / 2}px; top:${y - size / 2}px;
        width:${size}px; height:${size}px;
        border-radius:50%;
        background:rgba(200,190,170,0.75);
      `;
      this._container.appendChild(p);

      // Direction: outward from center, slightly randomised
      const baseAngle = Math.atan2(y - cy, x - cx);
      const angle = baseAngle + (Math.random() - 0.5) * 0.6;
      const dist = 18 + Math.random() * 22;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;
      const delay = i * 18;

      p.animate([
        { opacity: 0.9, transform: 'translate(0,0) scale(1)' },
        { opacity: 0,   transform: `translate(${tx}px,${ty}px) scale(0.3)` },
      ], { duration: 340 + Math.random() * 120, delay, easing: 'ease-out', fill: 'forwards' })
        .finished.then(() => p.remove());
    });
  }

  /**
   * Pre-destroy visual effect: cracks appear across the card. ~400ms total.
   * Creates a fixed-position overlay so the effect is independent of board-state changes
   * (the source card may be removed from the DOM mid-animation).
   */
  preDestroyEffect(srcEl: HTMLElement, cardImageUrl: string | null, duration = 400): Promise<void> {
    if (this._reducedMotion) return Promise.resolve();

    const rect = this.toCardRect(srcEl.getBoundingClientRect());
    if (rect.width === 0) return Promise.resolve();

    const w = rect.width;
    const h = rect.height;

    // Overlay with the card image
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; pointer-events:none; z-index:900;
      left:${rect.left}px; top:${rect.top}px;
      width:${w}px; height:${h}px;
      border-radius:4px; overflow:hidden;
    `;
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.src = cardImageUrl ?? this.toAbsoluteUrl('assets/images/card_back.jpg');
    overlay.appendChild(img);

    // SVG crack lines overlaid on the card
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';

    // Generate jagged crack paths radiating from a central impact point
    const cx = w * (0.4 + Math.random() * 0.2);
    const cy = h * (0.35 + Math.random() * 0.3);
    const cracks = CardTravelService.buildCrackPaths(cx, cy, w, h);

    const paths: SVGPathElement[] = [];
    for (const d of cracks) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(255,255,255,0.85)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      const len = path.getTotalLength?.() || 200;
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      svg.appendChild(path);
      paths.push(path);
    }

    overlay.appendChild(svg);
    this._container.appendChild(overlay);

    // Animate cracks drawing in with staggered starts
    const animations: Animation[] = [];
    for (let i = 0; i < paths.length; i++) {
      animations.push(paths[i].animate(
        [{ strokeDashoffset: paths[i].style.strokeDasharray }, { strokeDashoffset: '0' }],
        { duration: duration * 0.625, delay: i * (duration * 0.1), easing: 'ease-out', fill: 'forwards' },
      ));
    }

    const lastAnim = animations[animations.length - 1];
    return lastAnim.finished.then(() =>
      // Brief hold so the cracks are visible before the travel starts
      new Promise<void>(resolve => {
        const tid = setTimeout(() => {
          overlay.remove();
          resolve();
        }, duration * 0.3) as unknown as number;
        this._timers.add(tid);
      })
    );
  }

  /** Build jagged SVG path data for crack lines radiating from an impact point. */
  private static buildCrackPaths(cx: number, cy: number, w: number, h: number): string[] {
    const angles = [-150, -100, -40, 20, 80, 140];
    const paths: string[] = [];
    for (const baseDeg of angles) {
      const rad = (baseDeg * Math.PI) / 180;
      const reach = Math.max(w, h) * 0.8;
      let x = cx;
      let y = cy;
      const segments = 4 + Math.floor(Math.random() * 3);
      let d = `M${x.toFixed(1)},${y.toFixed(1)}`;
      for (let s = 0; s < segments; s++) {
        const stepLen = reach / segments * (0.7 + Math.random() * 0.6);
        const jitter = (Math.random() - 0.5) * 0.6;
        const angle = rad + jitter;
        x += Math.cos(angle) * stepLen;
        y += Math.sin(angle) * stepLen;
        // Clamp to card bounds
        x = Math.max(0, Math.min(w, x));
        y = Math.max(0, Math.min(h, y));
        d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        if (x <= 0 || x >= w || y <= 0 || y >= h) break;
      }
      paths.push(d);
    }
    return paths;
  }

  /** Activation burst: white flash explosion + golden spark particles radiating outward. ~500ms total. */
  activateEffect(target: string | HTMLElement, duration = 500): Promise<void> {
    if (this._reducedMotion) return Promise.resolve();
    const el = typeof target === 'string' ? this.getZoneElement(target) : target;
    if (!el) return Promise.resolve();

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const pad = 16;

    // --- 1. White flash burst (expanding radial gradient) ---
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:fixed; pointer-events:none; z-index:901;
      left:${rect.left - pad}px; top:${rect.top - pad}px;
      width:${rect.width + pad * 2}px; height:${rect.height + pad * 2}px;
      border-radius:8px;
      background:radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,220,100,0.6) 40%, transparent 70%);
    `;
    this._container.appendChild(flash);

    const flashAnim = flash.animate([
      { opacity: 0, transform: 'scale(0.3)' },
      { opacity: 1, transform: 'scale(1.2)', offset: 0.3 },
      { opacity: 0.8, transform: 'scale(1.4)', offset: 0.5 },
      { opacity: 0, transform: 'scale(1.8)' },
    ], { duration: duration * 0.8, easing: 'ease-out', fill: 'forwards' });

    // --- 2. Growing star burst ---
    const starSize = Math.max(rect.width, rect.height) * 1.4;
    const star = document.createElement('div');
    star.style.cssText = `
      position:fixed; pointer-events:none; z-index:901;
      left:${cx - starSize / 2}px; top:${cy - starSize / 2}px;
      width:${starSize}px; height:${starSize}px;
      clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
      background:radial-gradient(circle, rgba(255,255,220,0.95) 0%, rgba(255,200,60,0.7) 50%, transparent 100%);
    `;
    this._container.appendChild(star);
    star.animate([
      { opacity: 0, transform: 'scale(0) rotate(0deg)' },
      { opacity: 1, transform: 'scale(0.8) rotate(20deg)', offset: 0.3 },
      { opacity: 0.7, transform: 'scale(1.2) rotate(35deg)', offset: 0.6 },
      { opacity: 0, transform: 'scale(1.6) rotate(50deg)' },
    ], { duration: duration * 0.9, easing: 'ease-out', fill: 'forwards' })
      .finished.then(() => star.remove());

    // --- 3. Spark particles (golden/cyan, radiating outward) ---
    const particleCount = 10;
    for (let i = 0; i < particleCount; i++) {
      const size = 3 + Math.random() * 4;
      const p = document.createElement('div');
      const isGold = Math.random() > 0.3;
      const color = isGold
        ? `rgba(255,${180 + Math.random() * 60},${50 + Math.random() * 50},0.9)`
        : `rgba(100,${200 + Math.random() * 55},255,0.9)`;
      p.style.cssText = `
        position:fixed; pointer-events:none; z-index:902;
        left:${cx - size / 2}px; top:${cy - size / 2}px;
        width:${size}px; height:${size}px;
        border-radius:50%;
        background:${color};
        box-shadow:0 0 ${size}px ${color};
      `;
      this._container.appendChild(p);

      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const dist = 25 + Math.random() * 35;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;

      p.animate([
        { opacity: 1, transform: 'translate(0,0) scale(1)' },
        { opacity: 0.8, transform: `translate(${tx * 0.5}px,${ty * 0.5}px) scale(1.2)`, offset: 0.3 },
        { opacity: 0, transform: `translate(${tx}px,${ty}px) scale(0.2)` },
      ], { duration: duration * 0.7 + Math.random() * duration * 0.3, delay: duration * 0.1 + i * (duration * 0.024), easing: 'ease-out', fill: 'forwards' })
        .finished.then(() => p.remove());
    }

    return flashAnim.finished.then(() => flash.remove());
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
