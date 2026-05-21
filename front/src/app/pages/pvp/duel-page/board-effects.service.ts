import { Injectable, OnDestroy, inject } from '@angular/core';
import { CardTravelEngine } from './card-travel-engine.service';
import { toCardRect, buildCrackPaths } from './card-travel-helpers';
import { ReducedMotionService } from '../../../services/reduced-motion.service';

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
  private readonly _reducedMotionSvc = inject(ReducedMotionService);

  /** Centralised reduced-motion state (Preferences toggle OR OS preference) —
   *  read live so a mid-session Preferences change takes effect immediately. */
  private get _reducedMotion(): boolean {
    return this._reducedMotionSvc.enabled();
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
    // Mirror the board card's orientation onto the pre-destroy overlay.
    // `.card-inner` carries the opponent-side flip via the INDIVIDUAL
    // `rotate` CSS property (`.opponent-field .card-inner { rotate: 180deg }`),
    // NOT `transform` — so reading only `transform` here returned `none` and
    // the overlay rendered un-flipped (card faced the wrong player while the
    // destruction effect played). Read both and combine them.
    const cs = srcInner ? getComputedStyle(srcInner) : null;
    const srcTransform = cs && cs.transform !== 'none' ? cs.transform : '';
    const srcRotate = cs && cs.rotate !== 'none' ? cs.rotate : '';
    const transformParts = [
      srcTransform,
      srcRotate ? `rotate(${srcRotate})` : '',
    ].filter(Boolean);
    const imgTransform = transformParts.length ? `transform:${transformParts.join(' ')};` : '';
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
   * Field-confirm reveal (MSG_CONFIRM_CARDS for a card just Set face-down on
   * a field zone from the deck — public info shown to both players). The card
   * is already on the board face-down; this overlays a card-shaped float on
   * the zone and plays: rise → flip face-up → glow ×2 → flip face-down →
   * settle + fade. The real board card underneath is untouched.
   *
   * Reduced-motion / missing zone → no-op. Durations are passed pre-scaled.
   */
  async revealCardOnField(
    zoneKey: string,
    cardImageUrl: string,
    cardBackUrl: string,
    durations: { flip: number; lift: number; glow: number; hold: number },
  ): Promise<void> {
    if (this._reducedMotion) return;
    const zoneEl = this.cardTravel.getZoneElement(zoneKey);
    if (!zoneEl) return;
    const rect = toCardRect(zoneEl.getBoundingClientRect());
    if (rect.width === 0) return;

    // Hide the real board card for the whole reveal so the flipping overlay
    // doesn't double up with the card sitting underneath. `.zone-card` is the
    // card element inside the zone container — hiding it (not the container)
    // keeps the empty zone frame visible. Restored in the `finally` block.
    const boardCard = zoneEl.querySelector<HTMLElement>('.zone-card');
    const prevVisibility = boardCard?.style.visibility ?? '';
    if (boardCard) boardCard.style.visibility = 'hidden';

    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed; pointer-events: none;
      z-index: 900;
      left: ${rect.left}px; top: ${rect.top}px;
      width: ${rect.width}px; height: ${rect.height}px;
      border-radius: 4px; overflow: hidden;
      will-change: transform, opacity;
    `;
    // Single face — the rotateY flip swaps `img.src` at the 90° edge-on
    // midpoint (visually invisible). This avoids relying on a 3D
    // `perspective` context for backface-visibility, which the float
    // container does not provide (both faces would otherwise show at once).
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.src = cardBackUrl;
    div.appendChild(img);
    this.cardTravel.getContainer().appendChild(div);
    this._overlayEls.add(div);

    const glowEl = document.createElement('div');
    glowEl.style.cssText = `
      position: fixed; pointer-events: none; z-index: 899;
      left: ${rect.left - 8}px; top: ${rect.top - 8}px;
      width: ${rect.width + 16}px; height: ${rect.height + 16}px;
      border-radius: 8px; opacity: 0;
      box-shadow: 0 0 18px 6px var(--gold, rgba(255,200,80,0.85));
    `;
    this.cardTravel.getContainer().appendChild(glowEl);
    this._overlayEls.add(glowEl);

    const wait = (ms: number) => new Promise<void>(resolve => {
      const tid = window.setTimeout(() => { this._timers.delete(tid); resolve(); }, ms);
      this._timers.add(tid);
    });
    const swapSrcAt = (delay: number, src: string) => {
      const tid = window.setTimeout(() => { this._timers.delete(tid); img.src = src; }, delay);
      this._timers.add(tid);
    };

    try {
      // 1. Rise from the board, face-down. The overlay sits at rotateY(180deg)
      //    showing the card back — the back art is ~symmetric so the mirror at
      //    180° is imperceptible. Starting here lets the reveal flip land at
      //    rotateY(0deg) where the face is NOT mirrored (readable).
      await div.animate([
        { transform: 'translateY(0) scale(1) rotateY(180deg)' },
        { transform: 'translateY(-14px) scale(1.12) rotateY(180deg)' },
      ], { duration: durations.lift, easing: 'ease-out', fill: 'forwards' }).finished;

      // 2. Flip face-up: rotateY 180 → 0 lands the card readable. Swap
      //    back→face at the 90° edge-on midpoint (visually invisible).
      swapSrcAt(durations.flip * 0.5, cardImageUrl);
      await div.animate([
        { transform: 'translateY(-14px) scale(1.12) rotateY(180deg)' },
        { transform: 'translateY(-14px) scale(1.12) rotateY(0deg)' },
      ], { duration: durations.flip, easing: 'ease-in-out', fill: 'forwards' }).finished;

      // 3. Glow twice while the card is readable.
      for (let i = 0; i < 2; i++) {
        await glowEl.animate([
          { opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 },
        ], { duration: durations.glow, easing: 'ease-in-out' }).finished;
      }
      await wait(durations.hold);

      // 4. Flip back face-down (rotateY 0 → 180) and settle onto the board.
      swapSrcAt(durations.flip * 0.5, cardBackUrl);
      await div.animate([
        { transform: 'translateY(-14px) scale(1.12) rotateY(0deg)' },
        { transform: 'translateY(-14px) scale(1.12) rotateY(180deg)' },
      ], { duration: durations.flip, easing: 'ease-in-out', fill: 'forwards' }).finished;
      await div.animate([
        { transform: 'translateY(-14px) scale(1.12) rotateY(180deg)', opacity: 1 },
        { transform: 'translateY(0) scale(1) rotateY(180deg)', opacity: 0 },
      ], { duration: durations.lift, easing: 'ease-in', fill: 'forwards' }).finished;
    } catch {
      // Animation cancelled (reset / destroy) — cleanup below still runs.
      return;
    } finally {
      for (const el of [div, glowEl]) {
        if (this._overlayEls.has(el)) { el.remove(); this._overlayEls.delete(el); }
      }
      // Restore the real board card — even on cancel, so a reset / seek mid
      // reveal never leaves the card permanently hidden.
      if (boardCard) boardCard.style.visibility = prevVisibility;
    }
  }

  /**
   * Opponent hand-card reveal (MSG_CHAINING for a card the opponent activates
   * from their hand). An overlay flips face-up while easing slightly toward
   * the viewer to detach the card from the fan, the activation flash plays on
   * it, then it eases back. The real `.hand-card` is hidden for the whole
   * reveal so the two never double up — once the reveal ends, the hand row
   * itself shows the card face-up (the chain-link reveal signal) so the
   * overlay can simply fade.
   *
   * `detachMs` is the (pre-scaled) flip + ease-out / ease-in duration.
   * Reduced-motion / missing element → no-op.
   */
  async revealOpponentHandCard(handEl: HTMLElement, cardImageUrl: string, detachMs: number): Promise<void> {
    if (this._reducedMotion) return;
    const rect = toCardRect(handEl.getBoundingClientRect());
    if (rect.width === 0) return;

    // Hide the real hand card for the whole reveal so the flipping overlay
    // doesn't double up with the card behind it.
    const prevVisibility = handEl.style.visibility;
    handEl.style.visibility = 'hidden';

    // Detach toward the viewer: the opponent fan is at the top, so a small
    // downward nudge pulls the card clear of its neighbours without a big
    // travel ("petit décalage de détachement").
    const detachY = rect.height * 0.5;

    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed; pointer-events: none;
      z-index: 1100;
      left: ${rect.left}px; top: ${rect.top}px;
      width: ${rect.width}px; height: ${rect.height}px;
      border-radius: 4px; overflow: hidden;
      will-change: transform, opacity;
    `;
    // Single face — the rotateY flip swaps `img.src` at the 90° edge-on
    // midpoint. Starts on the card back (the opponent's hand is hidden),
    // lands on the face, readable for the viewer (rotateY 0, not mirrored).
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.src = this.cardTravel.toAbsoluteUrl('assets/images/card_back.jpg');
    div.appendChild(img);
    this.cardTravel.getContainer().appendChild(div);
    this._overlayEls.add(div);

    const swapSrcAt = (delay: number, src: string) => {
      const tid = window.setTimeout(() => { this._timers.delete(tid); img.src = src; }, delay);
      this._timers.add(tid);
    };

    try {
      // 1. Flip face-up + ease out of the fan, simultaneously.
      swapSrcAt(detachMs * 0.5, cardImageUrl);
      await div.animate([
        { transform: 'translateY(0) scale(1) rotateY(180deg)' },
        { transform: `translateY(${detachY}px) scale(1.15) rotateY(0deg)` },
      ], { duration: detachMs, easing: 'ease-out', fill: 'forwards' }).finished;

      // 2. Activation flash on the detached, readable card (same effect as
      //    the player's own activation).
      await this.activateEffect(div);

      // 3. Ease back to the fan position. Stays face-up — the hand row shows
      //    the card face-up after the chain link is registered, so the
      //    overlay just needs to return and fade.
      await div.animate([
        { transform: `translateY(${detachY}px) scale(1.15) rotateY(0deg)`, opacity: 1 },
        { transform: 'translateY(0) scale(1) rotateY(0deg)', opacity: 0 },
      ], { duration: detachMs, easing: 'ease-in', fill: 'forwards' }).finished;
    } catch {
      // Animation cancelled (reset / destroy) — cleanup below still runs.
      return;
    } finally {
      if (this._overlayEls.has(div)) { div.remove(); this._overlayEls.delete(div); }
      // Restore the real hand card even on cancel.
      handEl.style.visibility = prevVisibility;
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
