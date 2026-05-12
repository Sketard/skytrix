import { Injectable, OnDestroy, inject } from '@angular/core';
import { CardTravelEngine } from './card-travel-engine.service';
import { toCardRect, buildCrackPaths } from './card-travel-helpers';

/**
 * Visual effects anchored to a board zone or DOM element. Split from
 * `CardTravelEngine` (M11 Phase 1) so the travel engine stays focused on
 * A→B card translation while autonomous effects (impacts, particles,
 * cracks, activation, target floats) live here.
 *
 * `CardTravelEngine` is the zone-resolver / container registry — this
 * service consumes its `getZoneElement`, `getContainer`, and
 * `toAbsoluteUrl` rather than duplicating them. `CardTravelEngine.travel`
 * also calls back into `zoneImpactEffect` / `slamDustParticles` for soft /
 * banish / slam landings (cross-injection accepted via lazy `inject()`).
 */
@Injectable()
export class BoardEffectsService implements OnDestroy {
  private readonly cardTravel = inject(CardTravelEngine);
  private readonly _overlayEls = new Set<HTMLElement>();
  private readonly _timers = new Set<number>();
  private readonly _reducedMotion: boolean;

  constructor() {
    this._reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Radial glow contraction + dark sink overlay — shared by GY absorption and banish rift. */
  zoneImpactEffect(rect: DOMRect, color: string, duration = 400): void {
    if (this._reducedMotion) return;
    const pad = 4;

    const glow = document.createElement('div');
    glow.style.cssText = `
      position:fixed; pointer-events:none; z-index:901;
      left:${rect.left - pad}px; top:${rect.top - pad}px;
      width:${rect.width + pad * 2}px; height:${rect.height + pad * 2}px;
      border-radius:4px;
      background:radial-gradient(circle, ${color} 0%, transparent 70%);
    `;
    const glowAnim = glow.animate([
      { opacity: 0, transform: 'scale(1.3)' },
      { opacity: 0.8, transform: 'scale(1)', offset: 0.4 },
      { opacity: 0, transform: 'scale(0.85)' },
    ], { duration: duration * 0.6, easing: 'ease-in-out', fill: 'forwards' });
    this.trackOverlay(glow, glowAnim);

    const sink = document.createElement('div');
    sink.style.cssText = `
      position:fixed; pointer-events:none; z-index:900;
      left:${rect.left}px; top:${rect.top}px;
      width:${rect.width}px; height:${rect.height}px;
      border-radius:4px;
      background:rgba(0,0,0,0.5);
    `;
    const sinkAnim = sink.animate([
      { opacity: 0 },
      { opacity: 1, offset: 0.35 },
      { opacity: 0 },
    ], { duration: duration * 0.55, easing: 'ease-in', fill: 'forwards' });
    this.trackOverlay(sink, sinkAnim);
  }

  /** Dust particles expelled from the zone edges on slam impact. */
  slamDustParticles(rect: DOMRect): void {
    if (this._reducedMotion) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
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
      const baseAngle = Math.atan2(y - cy, x - cx);
      const angle = baseAngle + (Math.random() - 0.5) * 0.6;
      const dist = 18 + Math.random() * 22;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;
      const delay = i * 18;

      const pAnim = p.animate([
        { opacity: 0.9, transform: 'translate(0,0) scale(1)' },
        { opacity: 0,   transform: `translate(${tx}px,${ty}px) scale(0.3)` },
      ], { duration: 340 + Math.random() * 120, delay, easing: 'ease-out', fill: 'forwards' });
      this.trackOverlay(p, pAnim);
    });
  }

  /**
   * Pre-destroy visual effect: cracks appear across the card. ~400ms total.
   * Creates a fixed-position overlay so the effect is independent of board-state changes
   * (the source card may be removed from the DOM mid-animation).
   */
  preDestroyEffect(srcEl: HTMLElement, cardImageUrl: string | null, duration = 400): Promise<void> {
    if (this._reducedMotion) return Promise.resolve();

    const rect = toCardRect(srcEl.getBoundingClientRect());
    if (rect.width === 0) return Promise.resolve();

    const w = rect.width;
    const h = rect.height;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; pointer-events:none; z-index:900;
      left:${rect.left}px; top:${rect.top}px;
      width:${w}px; height:${h}px;
      border-radius:4px; overflow:hidden;
    `;
    const img = document.createElement('img');
    const srcInner = srcEl.querySelector<HTMLElement>('.card-inner');
    const srcRotation = srcInner ? getComputedStyle(srcInner).transform : '';
    const imgTransform = (srcRotation && srcRotation !== 'none') ? `transform:${srcRotation};` : '';
    img.style.cssText = `width:100%;height:100%;object-fit:cover;display:block;${imgTransform}`;
    img.src = cardImageUrl ?? this.cardTravel.toAbsoluteUrl('assets/images/card_back.jpg');
    overlay.appendChild(img);

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';

    const cx = w * (0.4 + Math.random() * 0.2);
    const cy = h * (0.35 + Math.random() * 0.3);
    const cracks = buildCrackPaths(cx, cy, w, h);

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
    this.trackOverlayUntimed(overlay);

    const animations: Animation[] = [];
    for (let i = 0; i < paths.length; i++) {
      animations.push(paths[i].animate(
        [{ strokeDashoffset: paths[i].style.strokeDasharray }, { strokeDashoffset: '0' }],
        { duration: duration * 0.625, delay: i * (duration * 0.1), easing: 'ease-out', fill: 'forwards' },
      ));
    }

    const lastAnim = animations[animations.length - 1];
    return lastAnim.finished.then(() =>
      new Promise<void>(resolve => {
        const tid = setTimeout(() => {
          this._timers.delete(tid);
          this.removeOverlay(overlay);
          resolve();
        }, duration * 0.3) as unknown as number;
        this._timers.add(tid);
      })
    );
  }

  /** Activation burst: white flash explosion + golden spark particles radiating outward. ~500ms total. */
  activateEffect(target: string | HTMLElement, duration = 500): Promise<void> {
    if (this._reducedMotion) return Promise.resolve();
    const el = typeof target === 'string' ? this.cardTravel.getZoneElement(target) : target;
    if (!el) return Promise.resolve();

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const pad = 16;

    const flash = document.createElement('div');
    flash.style.cssText = `
      position:fixed; pointer-events:none; z-index:901;
      left:${rect.left - pad}px; top:${rect.top - pad}px;
      width:${rect.width + pad * 2}px; height:${rect.height + pad * 2}px;
      border-radius:8px;
      background:radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,220,100,0.6) 40%, transparent 70%);
    `;
    const flashAnim = flash.animate([
      { opacity: 0, transform: 'scale(0.3)' },
      { opacity: 1, transform: 'scale(1.2)', offset: 0.3 },
      { opacity: 0.8, transform: 'scale(1.4)', offset: 0.5 },
      { opacity: 0, transform: 'scale(1.8)' },
    ], { duration: duration * 0.8, easing: 'ease-out', fill: 'forwards' });
    this.trackOverlay(flash, flashAnim);

    const starSize = Math.max(rect.width, rect.height) * 1.4;
    const star = document.createElement('div');
    star.style.cssText = `
      position:fixed; pointer-events:none; z-index:901;
      left:${cx - starSize / 2}px; top:${cy - starSize / 2}px;
      width:${starSize}px; height:${starSize}px;
      clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
      background:radial-gradient(circle, rgba(255,255,220,0.95) 0%, rgba(255,200,60,0.7) 50%, transparent 100%);
    `;
    const starAnim = star.animate([
      { opacity: 0, transform: 'scale(0) rotate(0deg)' },
      { opacity: 1, transform: 'scale(0.8) rotate(20deg)', offset: 0.3 },
      { opacity: 0.7, transform: 'scale(1.2) rotate(35deg)', offset: 0.6 },
      { opacity: 0, transform: 'scale(1.6) rotate(50deg)' },
    ], { duration: duration * 0.9, easing: 'ease-out', fill: 'forwards' });
    this.trackOverlay(star, starAnim);

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
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const dist = 25 + Math.random() * 35;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;

      const pAnim = p.animate([
        { opacity: 1, transform: 'translate(0,0) scale(1)' },
        { opacity: 0.8, transform: `translate(${tx * 0.5}px,${ty * 0.5}px) scale(1.2)`, offset: 0.3 },
        { opacity: 0, transform: `translate(${tx}px,${ty}px) scale(0.2)` },
      ], { duration: duration * 0.7 + Math.random() * duration * 0.3, delay: duration * 0.1 + i * (duration * 0.024), easing: 'ease-out', fill: 'forwards' });
      this.trackOverlay(p, pAnim);
    }

    return flashAnim.finished.then(() => undefined, () => undefined);
  }

  /**
   * Deck-top reveal (MSG_CONFIRM_CARDS with `location === DECK`): lifts a
   * face-up card float from the deck, runs a caller-supplied highlight, holds
   * briefly, then fades out. The float is tracked in `_overlayEls` so reset /
   * disconnect / ngOnDestroy clears it like any other overlay — no DOM leak
   * even if the duel page is destroyed mid-animation.
   *
   * Reduced-motion / missing zone → no-op (`Promise.resolve()`). All durations
   * are passed scaled by the caller (DuelContext.scaledDuration).
   */
  async revealCardOnDeck(
    zoneKey: string,
    cardImageUrl: string,
    liftY: number,
    durations: { lift: number; hold: number; fade: number },
    onHighlight: (el: HTMLDivElement) => Promise<void>,
  ): Promise<void> {
    if (this._reducedMotion) return;
    const zoneEl = this.cardTravel.getZoneElement(zoneKey);
    if (!zoneEl) return;
    const rect = toCardRect(zoneEl.getBoundingClientRect());
    if (rect.width === 0) return;

    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed; pointer-events: none;
      z-index: 900;
      left: ${rect.left}px; top: ${rect.top}px;
      width: ${rect.width}px; height: ${rect.height}px;
      border-radius: 4px; overflow: hidden;
      will-change: transform, opacity;
    `;
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.src = cardImageUrl;
    div.appendChild(img);
    this.cardTravel.getContainer().appendChild(div);
    this._overlayEls.add(div);

    const liftAnim = div.animate([
      { transform: 'translateY(0px) scale(1)', opacity: '0' },
      { transform: `translateY(${liftY}px) scale(1.3)`, opacity: '1' },
    ], { duration: durations.lift, easing: 'ease-out', fill: 'forwards' });

    try {
      await liftAnim.finished;
      await onHighlight(div);
      await new Promise<void>(resolve => {
        const tid = window.setTimeout(() => {
          this._timers.delete(tid);
          resolve();
        }, durations.hold);
        this._timers.add(tid);
      });
      await div.animate(
        [{ opacity: '1' }, { opacity: '0' }],
        { duration: durations.fade, fill: 'forwards' },
      ).finished;
    } catch {
      // Animation cancelled (reset / destroy) — `ngOnDestroy` / future bulk
      // cleanup removes the element; just stop awaiting.
      return;
    } finally {
      if (this._overlayEls.has(div)) {
        div.remove();
        this._overlayEls.delete(div);
      }
    }
  }

  /**
   * Create a card-shaped float positioned above the given pile zone (GY, BANISHED, EXTRA),
   * sized to match the zone and offset by a cascade index. Used by `TargetIndicatorManager`
   * to surface MSG_BECOME_TARGET feedback when targets are inside a pile (the pile only
   * renders the top card so the existing `.zone-card--targeted` reticle would point at
   * the wrong card).
   *
   * Returns null if the zone element cannot be resolved (also under reduced motion).
   * The caller owns lifecycle: call `removeTargetFloat(el)` to remove + untrack.
   */
  createTargetFloat(zoneKey: string, cardImage: string, cascadeIndex: number, cascadeYPx: number, cascadeXPx: number, enterMs: number): HTMLDivElement | null {
    if (this._reducedMotion) return null;
    const zoneEl = this.cardTravel.getZoneElement(zoneKey);
    if (!zoneEl) return null;
    const rect = zoneEl.getBoundingClientRect();
    const liftY = rect.height * 0.5 + cascadeIndex * cascadeYPx;
    const shiftX = cascadeIndex * cascadeXPx;

    const div = document.createElement('div');
    div.dataset['targetFloat'] = 'true';
    div.dataset['zoneKey'] = zoneKey;
    div.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 900;
      left: ${rect.left + shiftX}px;
      top: ${rect.top - liftY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border-radius: 4px;
      background-image: url('${cardImage}');
      background-size: cover;
      background-position: center;
      opacity: 0;
      transform: translateY(8px) scale(0.92);
      transition: opacity ${enterMs}ms ease-out, transform ${enterMs}ms ease-out;
    `;
    this.cardTravel.getContainer().appendChild(div);
    this._overlayEls.add(div);
    requestAnimationFrame(() => {
      div.style.opacity = '1';
      div.style.transform = 'translateY(0) scale(1)';
    });
    return div;
  }

  /** Remove a target float element and untrack it. Safe to call multiple times. */
  removeTargetFloat(el: HTMLDivElement): void {
    el.remove();
    this._overlayEls.delete(el);
  }

  /** Fade-out helper for target floats — resolves after `durationMs` then removes the element. */
  fadeOutAndRemoveTargetFloat(el: HTMLDivElement, durationMs: number): void {
    el.style.transition = `opacity ${durationMs}ms ease-in`;
    el.style.opacity = '0';
    const id = window.setTimeout(() => {
      this._timers.delete(id);
      this.removeTargetFloat(el);
    }, durationMs);
    this._timers.add(id);
  }

  ngOnDestroy(): void {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    for (const el of this._overlayEls) el.remove();
    this._overlayEls.clear();
  }

  private trackOverlay(el: HTMLElement, animation: Animation): void {
    this.cardTravel.getContainer().appendChild(el);
    this._overlayEls.add(el);
    const cleanup = () => {
      el.remove();
      this._overlayEls.delete(el);
    };
    animation.finished.then(cleanup, cleanup);
  }

  private trackOverlayUntimed(el: HTMLElement): void {
    this.cardTravel.getContainer().appendChild(el);
    this._overlayEls.add(el);
  }

  private removeOverlay(el: HTMLElement): void {
    el.remove();
    this._overlayEls.delete(el);
  }
}
