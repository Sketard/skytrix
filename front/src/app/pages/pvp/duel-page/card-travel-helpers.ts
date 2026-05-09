/**
 * Pure helpers extracted from `card-travel.service.ts` for unit testing.
 * Audit finding M11 (Phase 0): pin the geometry/keyframe/crack-path contract
 * with specs BEFORE splitting the service into CardTravelEngine +
 * BoardEffectsService. Each function is a pure transform of plain values —
 * no DOM, no Angular, no service state.
 */

/**
 * Card art aspect ratio (width / height). YGO card images are 59:86 — the
 * inner art panel including border. Used to fit a card-shaped rect inside
 * an arbitrary container rect (e.g. wide hand row, square zone).
 */
export const CARD_ASPECT = 59 / 86;

/**
 * Compute the visible card area within a rect, accounting for the YGO card
 * aspect ratio (59:86). If the input rect is wider than the card aspect
 * ratio, shrink width to match; otherwise shrink height. The result is
 * centered horizontally and vertically inside the input rect.
 *
 * Used by `travel()` to derive a card-sized landing rect inside a wider
 * container (hand row, board container) so the float doesn't stretch.
 */
export function toCardRect(rect: DOMRect): DOMRect {
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

/** Options consumed by `buildTravelKeyframes`. Mirror of the relevant subset
 *  of `TravelOptions` — kept narrow so the helper stays pure. */
export interface KeyframeOptions {
  flipDuringTravel?: boolean;
  showBack?: boolean;
  baseRotateZ?: number;
  destRotateZ?: number;
  srcRotateZ?: number;
  landingStyle?: 'default' | 'slam' | 'soft' | 'banish';
}

/**
 * Build the WAAPI keyframe array for a card travel animation.
 *
 * Phases:
 *   - 0%   start (source rect, source rotation)
 *   - 15%  lifted (slight overshoot scale)
 *   - 45%  midpoint (half-translation, edge-on if flipping)
 *   - 75%  near destination (overshoot scale)
 *   - 88%  micro-bounce (default landing only)
 *   - 100% landed (destination rect, destination rotation)
 *
 * Rotation handling:
 *   - `baseRotateZ`: applied throughout (e.g. 180° for opponent cards)
 *   - `destRotateZ`: applied at landing on top of base (e.g. -90° for defense)
 *   - `srcRotateZ`: applied at departure (e.g. -90° leaving defense), eased out
 *   - `flipDuringTravel`: rotateY pivot through 90° edge-on midpoint to swap
 *      face/back. `showBack=true` reverses (start at 180° → 0°) so the
 *      revealed front lands at 0° (e.g. draw); `showBack=false` goes 0° → 180°
 *      (e.g. send-to-GY where the back becomes visible mid-travel).
 *
 * Landing styles:
 *   - 'default': adds a 88% micro-bounce frame for visual weight
 *   - 'slam' / 'soft' / 'banish': skip the bounce — the impact effect
 *      (slamDustParticles / zoneImpactEffect) carries the visual weight
 *
 * `originYFraction` (default 0.5 = center) shifts the dy compensation when
 * the float uses a non-center transform-origin. Only matters for
 * destinations with a custom transform-origin (defense rotation).
 */
export function buildTravelKeyframes(
  fromRect: DOMRect,
  destRect: DOMRect,
  options: KeyframeOptions,
  destRotateZ = 0,
  destTranslateY = 0,
  originYFraction = 0.5,
): Keyframe[] {
  const fs = destRect.width > 0 && fromRect.width > 0 ? destRect.width / fromRect.width : 1;
  const dx = (destRect.left + destRect.width / 2) - (fromRect.left + fromRect.width / 2);
  const originOffsetY = (originYFraction - 0.5) * fromRect.height;
  const dy = (destRect.top + destRect.height / 2) - (fromRect.top + fromRect.height / 2) + destTranslateY - originOffsetY * (1 - fs);
  const flip = options.flipDuringTravel ?? false;
  const base = options.baseRotateZ ?? 0;

  const flipReverse = flip && (options.showBack ?? false);
  const startRY = flipReverse ? 180 : 0;
  const endRY = flipReverse ? 0 : (flip ? 180 : 0);

  const src = options.srcRotateZ ?? 0;
  const rzStart = (base + src) ? ` rotateZ(${base + src}deg)` : '';
  const rz = (base + destRotateZ) ? ` rotateZ(${base + destRotateZ}deg)` : '';
  const rzHalf = (base + (src + destRotateZ) * 0.5) ? ` rotateZ(${base + (src + destRotateZ) * 0.5}deg)` : '';

  const midS = (1 + fs) / 2;
  const liftS = 1.15;
  const preS = fs * 1.15;

  const keyframes: Keyframe[] = [
    {
      offset: 0,
      transform: `translate(0, 0) scale(1) rotateY(${startRY}deg)${rzStart}`,
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    },
    {
      offset: 0.15,
      transform: `translate(0, 0) scale(${liftS}) rotateY(${startRY}deg)${rzStart}`,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    },
  ];

  if (flip) {
    keyframes.push(
      {
        offset: 0.45,
        transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${midS}) rotateY(90deg)${rzHalf}`,
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      },
      {
        offset: 0.75,
        transform: `translate(${dx}px, ${dy}px) scale(${preS}) rotateY(${endRY}deg)${rz}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      },
    );
  } else {
    keyframes.push(
      {
        offset: 0.45,
        transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${midS}) rotateY(8deg)${rzHalf}`,
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      },
      {
        offset: 0.75,
        transform: `translate(${dx}px, ${dy}px) scale(${preS}) rotateY(0deg)${rz}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      },
    );
  }

  const land = `translate(${dx}px, ${dy}px)`;
  const landEnd: Keyframe = {
    offset: 1,
    transform: `${land} scale(${fs}) rotateY(${endRY}deg)${rz}`,
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
  };

  if (options.landingStyle === 'soft' || options.landingStyle === 'banish') {
    keyframes.push(landEnd);
  } else if (options.landingStyle === 'slam') {
    keyframes.push(landEnd);
  } else {
    keyframes.push(
      { offset: 0.88, transform: `${land} scale(${fs * 1.05}) rotateY(${endRY}deg)${rz}`, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' },
      landEnd,
    );
  }

  return keyframes;
}

/**
 * Build jagged SVG path data for crack lines radiating from an impact point.
 * Used by `preDestroyEffect` to draw cracks across a card before destruction.
 *
 * Generates one path per angle in `CRACK_ANGLES_DEG`. Each path is a series
 * of ~4-7 line segments stepping outward from `(cx, cy)` with random jitter
 * (length and direction). Segments are clamped to the card bounds `[0..w] ×
 * [0..h]`; the path terminates as soon as it hits an edge.
 *
 * Pure deterministic-shape function — uses `Math.random()` for jitter so
 * specs check structural invariants (path count, M-L pattern, bounds), not
 * exact coordinates.
 */
export const CRACK_ANGLES_DEG = [-150, -100, -40, 20, 80, 140] as const;

export function buildCrackPaths(cx: number, cy: number, w: number, h: number): string[] {
  const paths: string[] = [];
  for (const baseDeg of CRACK_ANGLES_DEG) {
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
      x = Math.max(0, Math.min(w, x));
      y = Math.max(0, Math.min(h, y));
      d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
      if (x <= 0 || x >= w || y <= 0 || y >= h) break;
    }
    paths.push(d);
  }
  return paths;
}
