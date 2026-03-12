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
        this.absorptionEffect(rawDestRect, glowColor, duration);
      }, duration * 0.70));
    }
    if (options.landingStyle === 'banish' && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      this.addTimer(window.setTimeout(() => {
        this.dimensionalRiftEffect(rawDestRect, glowColor, duration);
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

    const land = `translate(${dx}px, ${dy}px)`;
    const landEnd: Keyframe = {
      offset: 1,
      transform: `${land} scale(1) rotateY(${endRY}deg)${rz}`,
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    };

    if (options.landingStyle === 'soft' || options.landingStyle === 'banish') {
      // Card shrinks and fades as it enters the destination pile
      keyframes.push(
        { offset: 0.80, transform: `${land} scale(1.02) rotateY(${endRY}deg)${rz}`, opacity: 1, easing: 'ease-in' },
        { offset: 1,    transform: `${land} scale(0.82) rotateY(${endRY}deg)${rz}`, opacity: 0.5, boxShadow: 'none' },
      );
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

  /** Dimensional rift: vertical slash tears open with purple/white light + electric arcs, then snaps shut. */
  private dimensionalRiftEffect(rect: DOMRect, color: string, duration = 400): void {
    if (this._reducedMotion) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // 1. Main rift — thin vertical slash that tears open then snaps shut
    const riftW = 6;
    const riftH = rect.height * 1.6;
    const rift = document.createElement('div');
    rift.style.cssText = `
      position:fixed; pointer-events:none; z-index:902;
      left:${cx - riftW / 2}px; top:${cy - riftH / 2}px;
      width:${riftW}px; height:${riftH}px;
      background:linear-gradient(to bottom,
        transparent 0%, ${color} 15%,
        rgba(255,255,255,0.95) 40%, rgba(255,255,255,1) 50%,
        rgba(255,255,255,0.95) 60%, ${color} 85%, transparent 100%);
      box-shadow:0 0 12px 4px ${color}, 0 0 24px 8px rgba(255,255,255,0.3);
    `;
    this._container.appendChild(rift);
    rift.animate([
      { opacity: 0, transform: 'scaleX(0) scaleY(0.1)',   easing: 'cubic-bezier(0.1,0,0.9,1)' },
      { opacity: 1, transform: 'scaleX(1) scaleY(1)',     offset: 0.30, easing: 'ease-in-out' },
      { opacity: 0.9, transform: 'scaleX(0.85) scaleY(1)', offset: 0.60, easing: 'ease-in' },
      { opacity: 0, transform: 'scaleX(0) scaleY(0.3)' },
    ], { duration: duration * 0.72, fill: 'forwards' })
      .finished.then(() => rift.remove());

    // 2. Electric arcs — sparks shoot horizontally from rift edges
    const arcCount = 10;
    for (let i = 0; i < arcCount; i++) {
      const isLeft = i % 2 === 0;
      const yFrac = (i / arcCount) - 0.5;
      const sx = cx;
      const sy = cy + yFrac * riftH * 0.8;
      const size = 1.5 + Math.random() * 2;
      const arc = document.createElement('div');
      arc.style.cssText = `
        position:fixed; pointer-events:none; z-index:901;
        left:${sx - size / 2}px; top:${sy - size / 2}px;
        width:${size}px; height:${size}px;
        border-radius:50%;
        background:rgba(255,255,255,0.95);
        box-shadow:0 0 4px rgba(255,255,255,0.9), 0 0 8px ${color};
      `;
      this._container.appendChild(arc);
      const dist = 12 + Math.random() * 22;
      const tx = isLeft ? -dist : dist;
      const ty = (Math.random() - 0.5) * 6;
      arc.animate([
        { opacity: 0, transform: 'translate(0,0)',                                   easing: 'ease-out' },
        { opacity: 1, transform: `translate(${tx * 0.4}px,${ty * 0.4}px)`,          offset: 0.25 },
        { opacity: 0, transform: `translate(${tx}px,${ty}px) scale(0.2)` },
      ], { duration: duration * 0.30 + Math.random() * duration * 0.08, delay: duration * 0.05 + i * duration * 0.010, easing: 'ease-out', fill: 'forwards' })
        .finished.then(() => arc.remove());
    }

    // 3. Zone flash — brief radial burst at destination
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:fixed; pointer-events:none; z-index:900;
      left:${rect.left}px; top:${rect.top}px;
      width:${rect.width}px; height:${rect.height}px;
      background:radial-gradient(ellipse, rgba(255,255,255,0.7) 0%, ${color} 45%, transparent 75%);
      border-radius:4px;
    `;
    this._container.appendChild(flash);
    flash.animate([
      { opacity: 0, transform: 'scaleX(0.05)', easing: 'ease-out' },
      { opacity: 1, transform: 'scaleX(1)',    offset: 0.25, easing: 'ease-in' },
      { opacity: 0, transform: 'scaleX(0.15)' },
    ], { duration: duration * 0.55, fill: 'forwards' })
      .finished.then(() => flash.remove());
  }

  /** Black-hole absorption: dark vortex core + swirling contracting rings + spiraling particles. */
  private absorptionEffect(rect: DOMRect, color: string, duration = 400): void {
    if (this._reducedMotion) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = Math.max(rect.width, rect.height) / 2;

    // Durations proportional to travel — effect starts at 80% of travel, should finish ~40% after landing
    const vortexDur  = duration * 0.65;
    const ringDur    = duration * 0.50;
    const ringDelays = [0, duration * 0.08, duration * 0.15];

    // 1. Dark vortex core — expands then collapses into a singularity
    const vortex = document.createElement('div');
    vortex.style.cssText = `
      position:fixed; pointer-events:none; z-index:902;
      left:${cx - r * 1.2}px; top:${cy - r * 1.2}px;
      width:${r * 2.4}px; height:${r * 2.4}px;
      border-radius:50%;
      background:radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 45%, transparent 72%);
    `;
    this._container.appendChild(vortex);
    vortex.animate([
      { opacity: 0,   transform: 'scale(0.2) rotate(0deg)',    easing: 'ease-out' },
      { opacity: 1,   transform: 'scale(1)   rotate(120deg)',  offset: 0.35, easing: 'ease-in' },
      { opacity: 0,   transform: 'scale(0.05) rotate(240deg)' },
    ], { duration: vortexDur, fill: 'forwards' })
      .finished.then(() => vortex.remove());

    // 2. Three rings that swirl (rotate) as they collapse
    [
      { scale: 1.4, delay: ringDelays[0], rot:  60 },
      { scale: 1.2, delay: ringDelays[1], rot: -45 },
      { scale: 1.0, delay: ringDelays[2], rot:  30 },
    ].forEach(({ scale, delay, rot }) => {
      const ring = document.createElement('div');
      ring.style.cssText = `
        position:fixed; pointer-events:none; z-index:901;
        left:${cx - r}px; top:${cy - r}px;
        width:${r * 2}px; height:${r * 2}px;
        border-radius:50%; box-sizing:border-box;
        border:2px solid ${color};
        box-shadow:0 0 6px ${color}, inset 0 0 12px rgba(0,0,0,0.9);
      `;
      this._container.appendChild(ring);
      ring.animate([
        { opacity: 0.9, transform: `scale(${scale}) rotate(0deg)`,    easing: 'ease-in' },
        { opacity: 0,   transform: `scale(0.08) rotate(${rot}deg)` },
      ], { duration: ringDur, delay, fill: 'forwards' })
        .finished.then(() => ring.remove());
    });

    // 3. Particles that spiral inward (perpendicular offset creates a curl arc)
    const count = 12;
    const spawnRadius = Math.max(rect.width, rect.height) * 0.8;
    for (let i = 0; i < count; i++) {
      const rad = (Math.PI * 2 * i) / count;
      const sx = cx + Math.cos(rad) * spawnRadius;
      const sy = cy + Math.sin(rad) * spawnRadius;
      const size = 2 + Math.random() * 3.5;
      const p = document.createElement('div');
      p.style.cssText = `
        position:fixed; pointer-events:none; z-index:900;
        left:${sx - size / 2}px; top:${sy - size / 2}px;
        width:${size}px; height:${size}px;
        border-radius:50%;
        background:${color};
        box-shadow:0 0 3px ${color};
      `;
      this._container.appendChild(p);

      const perpRad = rad + Math.PI / 2;
      const curl = 12 + Math.random() * 10;
      const tx = (cx - sx) * 0.88 + Math.cos(perpRad) * curl;
      const ty = (cy - sy) * 0.88 + Math.sin(perpRad) * curl;
      p.animate([
        { opacity: 0.95, transform: 'translate(0,0) scale(1)' },
        { opacity: 0,    transform: `translate(${tx}px,${ty}px) scale(0.1)` },
      ], { duration: duration * 0.50 + Math.random() * duration * 0.10, delay: i * duration * 0.012, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => p.remove());
    }
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

  /** Pre-destroy visual effect: shake → white flash + red burst. ~590ms total. */
  preDestroyEffect(srcEl: HTMLElement): Promise<void> {
    if (this._reducedMotion) return Promise.resolve();

    const shake = srcEl.animate([
      { transform: 'translateX(0) rotate(0deg)' },
      { transform: 'translateX(-4px) rotate(-1.5deg)', offset: 0.2 },
      { transform: 'translateX(4px) rotate(1.5deg)', offset: 0.4 },
      { transform: 'translateX(-3px) rotate(-1deg)', offset: 0.6 },
      { transform: 'translateX(3px) rotate(1deg)', offset: 0.8 },
      { transform: 'translateX(0) rotate(0deg)' },
    ], { duration: 240, easing: 'ease-in-out' });

    return shake.finished.then(() => {
      const rect = srcEl.getBoundingClientRect();
      const flashEl = document.createElement('div');
      flashEl.style.cssText = `
        position:fixed; pointer-events:none; z-index:901;
        left:${rect.left - 8}px; top:${rect.top - 8}px;
        width:${rect.width + 16}px; height:${rect.height + 16}px;
        border-radius:6px;
        background:radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 70%);
      `;
      this._container.appendChild(flashEl);

      const flashAnim = flashEl.animate([
        { opacity: 0, transform: 'scale(0.4)' },
        { opacity: 1, transform: 'scale(1.1)', offset: 0.35 },
        { opacity: 0, transform: 'scale(1.5)' },
      ], { duration: 200, easing: 'ease-out', fill: 'forwards' });

      srcEl.animate([
        { boxShadow: '0 0 4px 2px rgba(255,60,60,0.5)' },
        { boxShadow: '0 0 50px 25px rgba(255,80,40,0.9), 0 0 90px 50px rgba(255,60,60,0.3)', offset: 0.5 },
        { boxShadow: '0 0 0 0 transparent' },
      ], { duration: 350, easing: 'ease-out' });

      return flashAnim.finished.then(() => { flashEl.remove(); });
    });
  }

  /** Activation burst: white flash explosion + golden spark particles radiating outward. ~500ms total. */
  activateEffect(target: string | HTMLElement): Promise<void> {
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
    ], { duration: 400, easing: 'ease-out', fill: 'forwards' });

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
    ], { duration: 450, easing: 'ease-out', fill: 'forwards' })
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
      ], { duration: 350 + Math.random() * 150, delay: 50 + i * 12, easing: 'ease-out', fill: 'forwards' })
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
