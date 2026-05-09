import {
  CARD_ASPECT,
  CRACK_ANGLES_DEG,
  buildCrackPaths,
  buildTravelKeyframes,
  toCardRect,
} from './card-travel-helpers';

// ─── Helpers ───────────────────────────────────────────────────────────────

const r = (x: number, y: number, w: number, h: number) => new DOMRect(x, y, w, h);

function approx(actual: number, expected: number, eps = 0.01): boolean {
  return Math.abs(actual - expected) < eps;
}

function pickKeyframe(keyframes: Keyframe[], offset: number): Keyframe {
  const k = keyframes.find(kf => kf.offset === offset);
  if (!k) throw new Error(`No keyframe at offset ${offset}; got ${keyframes.map(x => x.offset).join(',')}`);
  return k;
}

function transformOf(k: Keyframe): string {
  return String(k['transform']);
}

// ─── toCardRect ────────────────────────────────────────────────────────────

describe('toCardRect', () => {
  it('returns the same dimensions when input matches the card aspect ratio', () => {
    const input = r(0, 0, 59, 86);
    const out = toCardRect(input);
    expect(approx(out.width, 59)).toBe(true);
    expect(approx(out.height, 86)).toBe(true);
    expect(out.left).toBe(0);
    expect(out.top).toBe(0);
  });

  it('shrinks width when input is wider than the card aspect', () => {
    // 200×200 (square) → height-bound: w = 200 * (59/86) ≈ 137.21
    const out = toCardRect(r(0, 0, 200, 200));
    expect(approx(out.width, 200 * CARD_ASPECT)).toBe(true);
    expect(out.height).toBe(200);
    // Centered horizontally
    expect(approx(out.left, (200 - 200 * CARD_ASPECT) / 2)).toBe(true);
    expect(out.top).toBe(0);
  });

  it('shrinks height when input is taller than the card aspect', () => {
    // 50×200 → w-bound: h = 50 / (59/86) ≈ 72.88
    const out = toCardRect(r(0, 0, 50, 200));
    expect(out.width).toBe(50);
    expect(approx(out.height, 50 / CARD_ASPECT)).toBe(true);
    // Centered vertically
    expect(out.left).toBe(0);
    expect(approx(out.top, (200 - 50 / CARD_ASPECT) / 2)).toBe(true);
  });

  it('preserves offset (not just origin-based)', () => {
    const out = toCardRect(r(100, 50, 200, 200));
    // Centered inside the offset rect: left = 100 + (200 - cardW) / 2
    expect(approx(out.left, 100 + (200 - 200 * CARD_ASPECT) / 2)).toBe(true);
    expect(out.top).toBe(50);
  });

  it('does not mutate the input rect', () => {
    const input = r(10, 20, 200, 100);
    const before = { x: input.x, y: input.y, w: input.width, h: input.height };
    toCardRect(input);
    expect({ x: input.x, y: input.y, w: input.width, h: input.height }).toEqual(before);
  });
});

// ─── buildTravelKeyframes ──────────────────────────────────────────────────

describe('buildTravelKeyframes', () => {
  const from = r(0, 0, 100, 145); // ≈ card-aspect
  const to = r(500, 300, 100, 145);

  it('starts at offset 0 with translate(0, 0) scale(1)', () => {
    const kfs = buildTravelKeyframes(from, to, {});
    const k0 = pickKeyframe(kfs, 0);
    expect(transformOf(k0)).toContain('translate(0, 0)');
    expect(transformOf(k0)).toContain('scale(1)');
  });

  it('lands at offset 1 with the full destination translate (default landing has bounce frame)', () => {
    const kfs = buildTravelKeyframes(from, to, {});
    const k1 = pickKeyframe(kfs, 1);
    // Center-to-center: dx = 500, dy = 300
    expect(transformOf(k1)).toContain('translate(500px, 300px)');
    // Default landing has a 0.88 micro-bounce frame
    expect(kfs.some(k => k.offset === 0.88)).toBe(true);
  });

  it('omits the 0.88 bounce frame for slam landing', () => {
    const kfs = buildTravelKeyframes(from, to, { landingStyle: 'slam' });
    expect(kfs.some(k => k.offset === 0.88)).toBe(false);
  });

  it('omits the 0.88 bounce frame for soft and banish landings', () => {
    const soft = buildTravelKeyframes(from, to, { landingStyle: 'soft' });
    const banish = buildTravelKeyframes(from, to, { landingStyle: 'banish' });
    expect(soft.some(k => k.offset === 0.88)).toBe(false);
    expect(banish.some(k => k.offset === 0.88)).toBe(false);
  });

  it('flipDuringTravel routes 0° → 180° rotateY when showBack is false (e.g. send-to-GY)', () => {
    const kfs = buildTravelKeyframes(from, to, { flipDuringTravel: true });
    expect(transformOf(pickKeyframe(kfs, 0))).toContain('rotateY(0deg)');
    expect(transformOf(pickKeyframe(kfs, 1))).toContain('rotateY(180deg)');
  });

  it('flipDuringTravel + showBack routes 180° → 0° rotateY (e.g. draw revealing the front)', () => {
    const kfs = buildTravelKeyframes(from, to, { flipDuringTravel: true, showBack: true });
    expect(transformOf(pickKeyframe(kfs, 0))).toContain('rotateY(180deg)');
    expect(transformOf(pickKeyframe(kfs, 1))).toContain('rotateY(0deg)');
  });

  it('non-flip travel passes through 8deg rotateY at 0.45 (subtle arc)', () => {
    const kfs = buildTravelKeyframes(from, to, {});
    const k45 = pickKeyframe(kfs, 0.45);
    expect(transformOf(k45)).toContain('rotateY(8deg)');
  });

  it('flip travel passes through 90deg rotateY at 0.45 (edge-on midpoint)', () => {
    const kfs = buildTravelKeyframes(from, to, { flipDuringTravel: true });
    const k45 = pickKeyframe(kfs, 0.45);
    expect(transformOf(k45)).toContain('rotateY(90deg)');
  });

  it('baseRotateZ is applied at start, end, and through the travel', () => {
    const kfs = buildTravelKeyframes(from, to, { baseRotateZ: 180 });
    expect(transformOf(pickKeyframe(kfs, 0))).toContain('rotateZ(180deg)');
    expect(transformOf(pickKeyframe(kfs, 1))).toContain('rotateZ(180deg)');
  });

  it('destRotateZ is applied at landing (0.75 + 1) but NOT at start (0)', () => {
    const kfs = buildTravelKeyframes(from, to, {}, -90);
    expect(transformOf(pickKeyframe(kfs, 1))).toContain('rotateZ(-90deg)');
    // No rotateZ at start when src=0 and base=0
    expect(transformOf(pickKeyframe(kfs, 0))).not.toContain('rotateZ');
  });

  it('srcRotateZ is applied at start (0 + 0.15) and eased out by landing', () => {
    const kfs = buildTravelKeyframes(from, to, { srcRotateZ: -90 });
    expect(transformOf(pickKeyframe(kfs, 0))).toContain('rotateZ(-90deg)');
    expect(transformOf(pickKeyframe(kfs, 0.15))).toContain('rotateZ(-90deg)');
    // No rotateZ at landing when dest=0 and base=0
    expect(transformOf(pickKeyframe(kfs, 1))).not.toContain('rotateZ');
  });

  it('scale fs is destRect.width / fromRect.width', () => {
    const small = r(0, 0, 50, 72);
    const big = r(0, 0, 200, 290);
    const kfs = buildTravelKeyframes(small, big, { landingStyle: 'slam' });
    // fs = 200/50 = 4, landing scale = 4
    expect(transformOf(pickKeyframe(kfs, 1))).toContain('scale(4)');
  });

  it('scale fallbacks to 1 when fromRect.width is 0 (defensive — e.g. detached element)', () => {
    const zero = r(0, 0, 0, 0);
    const kfs = buildTravelKeyframes(zero, to, { landingStyle: 'slam' });
    // fs = 1 (fallback), landing scale = 1
    expect(transformOf(pickKeyframe(kfs, 1))).toContain('scale(1)');
  });
});

// ─── buildCrackPaths ───────────────────────────────────────────────────────

describe('buildCrackPaths', () => {
  it('emits exactly one path per crack angle', () => {
    const paths = buildCrackPaths(50, 50, 100, 100);
    expect(paths.length).toBe(CRACK_ANGLES_DEG.length);
  });

  it('every path starts with M(cx, cy)', () => {
    const paths = buildCrackPaths(42.5, 33.5, 100, 100);
    for (const d of paths) {
      // toFixed(1) → "M42.5,33.5"
      expect(d.startsWith('M42.5,33.5')).toBe(true);
    }
  });

  it('every path is M followed by at least one L segment', () => {
    const paths = buildCrackPaths(50, 50, 100, 100);
    for (const d of paths) {
      // Pattern: Mx,y Lx,y [Lx,y…]
      expect(/^M[-\d.]+,[-\d.]+( L[-\d.]+,[-\d.]+)+$/.test(d)).toBe(true);
    }
  });

  it('all coordinates stay within the card bounds [0..w] × [0..h]', () => {
    const w = 100, h = 150;
    const paths = buildCrackPaths(50, 75, w, h);
    for (const d of paths) {
      const matches = Array.from(d.matchAll(/([-\d.]+),([-\d.]+)/g));
      for (const [, sx, sy] of matches) {
        const x = parseFloat(sx);
        const y = parseFloat(sy);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(h);
      }
    }
  });

  it('handles a corner impact point (cx=0, cy=0) by clamping early segments', () => {
    const paths = buildCrackPaths(0, 0, 100, 100);
    // No path should crash, all should still start at "M0.0,0.0"
    for (const d of paths) {
      expect(d.startsWith('M0.0,0.0')).toBe(true);
    }
    expect(paths.length).toBe(CRACK_ANGLES_DEG.length);
  });
});
