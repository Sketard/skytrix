import { TestBed } from '@angular/core/testing';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import {
  TRAVEL_FLIP_MIDPOINT_FRACTION,
  TRAVEL_DEPARTURE_GLOW_FRACTION,
  TRAVEL_IMPACT_GLOW_ON_FRACTION,
  TRAVEL_IMPACT_GLOW_HOLD_FRACTION,
  TRAVEL_LANDING_IMPACT_FRACTION,
} from './animation-constants';

/**
 * Override `Element.animate` so `.finished` resolves immediately and the
 * service's `then`/`finally` paths run synchronously under await. Matches the
 * pattern used in `board-effects.service.spec.ts`.
 */
function patchAnimateOnElementProto(): { restore: () => void } {
  const origDiv = HTMLDivElement.prototype.animate;
  const origElem = Element.prototype.animate;
  const stub = ((): Animation => ({
    finished: Promise.resolve() as unknown as Promise<Animation>,
    cancel: () => undefined,
  } as unknown as Animation)) as typeof Element.prototype.animate;
  HTMLDivElement.prototype.animate = stub as typeof HTMLDivElement.prototype.animate;
  Element.prototype.animate = stub;
  return {
    restore: () => {
      HTMLDivElement.prototype.animate = origDiv;
      Element.prototype.animate = origElem;
    },
  };
}

/** Build a zone-like div with a deterministic bounding rect. */
function makeZoneEl(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => new DOMRect(rect.left, rect.top, rect.width, rect.height),
  });
  return el;
}

describe('CardTravelEngine', () => {
  let engine: CardTravelEngine;
  let mockBoardEffects: jasmine.SpyObj<BoardEffectsService>;
  let floatRegistry: FloatRegistryService;
  let container: HTMLElement;
  let restoreAnimate: () => void;
  let origMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Force prefers-reduced-motion: no-preference so the constructor captures
    // _reducedMotion=false. The constant is read once at construction, so the
    // patch must be installed BEFORE TestBed.inject(CardTravelEngine).
    origMatchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    ({ restore: restoreAnimate } = patchAnimateOnElementProto());

    mockBoardEffects = jasmine.createSpyObj<BoardEffectsService>('BoardEffectsService', [
      'zoneImpactEffect', 'slamDustParticles',
    ]);

    TestBed.configureTestingModule({
      providers: [
        CardTravelEngine,
        FloatRegistryService,
        { provide: BoardEffectsService, useValue: mockBoardEffects },
      ],
    });

    engine = TestBed.inject(CardTravelEngine);
    floatRegistry = TestBed.inject(FloatRegistryService);
    engine.registerContainer(container);
    // Provide a resolver so the early-return on missing resolver doesn't fire.
    engine.registerZoneResolver(() => null);
  });

  afterEach(() => {
    restoreAnimate();
    window.matchMedia = origMatchMedia;
    container.remove();
    jasmine.clock().uninstall?.();
  });

  describe('toAbsoluteUrl', () => {
    it('passes through absolute http(s) URLs', () => {
      expect(engine.toAbsoluteUrl('https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png');
      expect(engine.toAbsoluteUrl('http://cdn.example.com/x.png')).toBe('http://cdn.example.com/x.png');
    });

    it('passes through protocol-relative URLs', () => {
      expect(engine.toAbsoluteUrl('//cdn.example.com/x.png')).toBe('//cdn.example.com/x.png');
    });

    it('prefixes relative paths with the current origin', () => {
      const out = engine.toAbsoluteUrl('assets/images/card_back.jpg');
      expect(out).toBe(`${window.location.origin}/assets/images/card_back.jpg`);
    });

    it('strips a leading slash before prefixing the origin (avoids double slash)', () => {
      const out = engine.toAbsoluteUrl('/api/cards/42');
      expect(out).toBe(`${window.location.origin}/api/cards/42`);
    });
  });

  describe('getContainer / registerContainer', () => {
    it('returns the registered container', () => {
      expect(engine.getContainer()).toBe(container);
    });
  });

  describe('getZoneElement / registerZoneResolver', () => {
    it('delegates to the registered resolver function', () => {
      const zone = makeZoneEl({ left: 0, top: 0, width: 10, height: 10 });
      engine.registerZoneResolver(k => (k === 'HAND-0' ? zone : null));
      expect(engine.getZoneElement('HAND-0')).toBe(zone);
      expect(engine.getZoneElement('GY-1')).toBeNull();
    });

    it('returns null when the resolver itself returns null', () => {
      engine.registerZoneResolver(() => null);
      expect(engine.getZoneElement('whatever')).toBeNull();
    });
  });

  describe('createLineBetween', () => {
    it('returns null when either element is missing', () => {
      const el = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      expect(engine.createLineBetween(null, el, { color: 'red' })).toBeNull();
      expect(engine.createLineBetween(el, null, { color: 'red' })).toBeNull();
      expect(engine.createLineBetween(null, null, { color: 'red' })).toBeNull();
    });

    it('creates a div with rotation matching the angle between centers', () => {
      // src at (0,0)→(10,10), dst at (110,10)→(120,20) — horizontal line, angle = 0deg.
      const src = makeZoneEl({ left: 0, top: 0, width: 10, height: 10 });
      const dst = makeZoneEl({ left: 110, top: 0, width: 10, height: 10 });
      const line = engine.createLineBetween(src, dst, { color: 'red' });
      expect(line).not.toBeNull();
      expect(line!.parentElement).toBe(container);
      expect(line!.style.transform).toContain('rotate(0deg)');
      expect(line!.style.background).toContain('red');
    });

    it('applies optional shadow when provided', () => {
      const src = makeZoneEl({ left: 0, top: 0, width: 10, height: 10 });
      const dst = makeZoneEl({ left: 100, top: 0, width: 10, height: 10 });
      const line = engine.createLineBetween(src, dst, { color: 'red', shadow: '0 0 4px red' });
      expect(line!.style.boxShadow).toContain('red');
    });

    it('defaults height to 3px when not specified', () => {
      const src = makeZoneEl({ left: 0, top: 0, width: 10, height: 10 });
      const dst = makeZoneEl({ left: 100, top: 0, width: 10, height: 10 });
      const line = engine.createLineBetween(src, dst, { color: 'red' });
      expect(line!.style.height).toBe('3px');
    });
  });

  describe('travel — guard clauses', () => {
    it('resolves immediately when source zone cannot be resolved', async () => {
      const dst = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'DST' ? dst : null));
      const before = container.children.length;
      await engine.travel('SRC', 'DST', 'card.png');
      expect(container.children.length).toBe(before);
    });

    it('resolves immediately when destination zone cannot be resolved', async () => {
      const src = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'SRC' ? src : null));
      const before = container.children.length;
      await engine.travel('SRC', 'DST', 'card.png');
      expect(container.children.length).toBe(before);
    });
  });

  describe('travel — float construction', () => {
    let src: HTMLElement;
    let dst: HTMLElement;

    beforeEach(() => {
      src = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      dst = makeZoneEl({ left: 200, top: 200, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'SRC' ? src : k === 'DST' ? dst : null));
    });

    it('appends a floating div to the registered container', async () => {
      const before = container.children.length;
      const p = engine.travel('SRC', 'DST', 'card.png');
      expect(container.children.length).toBe(before + 1);
      await p;
    });

    it('tags the float with dstKey from a string destination', async () => {
      const p = engine.travel('SRC', 'DST', 'card.png');
      const floatEl = container.querySelector<HTMLDivElement>('div[style*="pointer-events"]')!;
      expect(floatEl.dataset['dstKey']).toBe('DST');
      await p;
    });

    it('uses an explicit dstZoneKey option over the destination string', async () => {
      const p = engine.travel('SRC', 'DST', 'card.png', { dstZoneKey: 'OVERRIDE' });
      const floatEl = container.querySelector<HTMLDivElement>('div[data-dst-key]')!;
      expect(floatEl.dataset['dstKey']).toBe('OVERRIDE');
      await p;
    });

    it('tags the float with cardCode when provided', async () => {
      const p = engine.travel('SRC', 'DST', 'card.png', { cardCode: 12345 });
      const floatEl = container.querySelector<HTMLDivElement>('div[data-card-code]')!;
      expect(floatEl.dataset['cardCode']).toBe('12345');
      await p;
    });

    it('registers the float with FloatRegistryService (synchronously visible before microtasks flush)', () => {
      expect(floatRegistry.inFlightCount()).toBe(0);
      engine.travel('SRC', 'DST', 'card.png');
      // Stubbed animation.finished is a resolved promise — register() inserts
      // into _inFlight synchronously, the removal happens in the .then() microtask.
      expect(floatRegistry.inFlightCount()).toBe(1);
    });

    it('moves the float into _landed after the animation.finished microtask flushes', async () => {
      engine.travel('SRC', 'DST', 'card.png');
      await Promise.resolve(); await Promise.resolve();
      expect(floatRegistry.inFlightCount()).toBe(0);
      expect(floatRegistry.landedCount()).toBe(1);
    });
  });

  describe('travel — landing style routing', () => {
    let src: HTMLElement;
    let dst: HTMLElement;

    beforeEach(() => {
      src = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      dst = makeZoneEl({ left: 200, top: 200, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'SRC' ? src : k === 'DST' ? dst : null));
      jasmine.clock().install();
    });

    it("'slam' landing triggers slamDustParticles via FloatRegistry onLand", async () => {
      engine.travel('SRC', 'DST', 'card.png', { landingStyle: 'slam' });
      // FloatRegistry resolves on animation.finished — flush the microtask.
      await Promise.resolve(); await Promise.resolve();
      expect(mockBoardEffects.slamDustParticles).toHaveBeenCalledTimes(1);
      const callArg = mockBoardEffects.slamDustParticles.calls.mostRecent().args[0] as DOMRect;
      expect(callArg.left).toBe(200);
      expect(callArg.top).toBe(200);
    });

    it("'soft' landing schedules zoneImpactEffect at TRAVEL_LANDING_IMPACT_FRACTION × duration", () => {
      const duration = 400;
      engine.travel('SRC', 'DST', 'card.png', {
        landingStyle: 'soft',
        impactGlowColor: 'rgba(120,200,255,0.7)',
        duration,
      });
      // Before the scheduled time → not called yet.
      jasmine.clock().tick(duration * TRAVEL_LANDING_IMPACT_FRACTION - 1);
      expect(mockBoardEffects.zoneImpactEffect).not.toHaveBeenCalled();
      jasmine.clock().tick(2);
      expect(mockBoardEffects.zoneImpactEffect).toHaveBeenCalledTimes(1);
    });

    it("'banish' landing also routes to zoneImpactEffect (same code path as 'soft')", () => {
      const duration = 400;
      engine.travel('SRC', 'DST', 'card.png', {
        landingStyle: 'banish',
        impactGlowColor: 'rgba(150,100,255,0.7)',
        duration,
      });
      jasmine.clock().tick(duration * TRAVEL_LANDING_IMPACT_FRACTION + 1);
      expect(mockBoardEffects.zoneImpactEffect).toHaveBeenCalledTimes(1);
    });

    it("'soft' without impactGlowColor does NOT schedule zoneImpactEffect", () => {
      engine.travel('SRC', 'DST', 'card.png', { landingStyle: 'soft' });
      jasmine.clock().tick(1000);
      expect(mockBoardEffects.zoneImpactEffect).not.toHaveBeenCalled();
    });

    it("'default' landing triggers no impact effect and no onLand callback", async () => {
      engine.travel('SRC', 'DST', 'card.png', {
        landingStyle: 'default',
        impactGlowColor: 'red',
      });
      jasmine.clock().tick(1000);
      await Promise.resolve(); await Promise.resolve();
      expect(mockBoardEffects.zoneImpactEffect).not.toHaveBeenCalled();
      expect(mockBoardEffects.slamDustParticles).not.toHaveBeenCalled();
    });
  });

  describe('travel — flip and glow timers', () => {
    let src: HTMLElement;
    let dst: HTMLElement;

    beforeEach(() => {
      src = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      dst = makeZoneEl({ left: 200, top: 200, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'SRC' ? src : k === 'DST' ? dst : null));
      jasmine.clock().install();
    });

    it('flipDuringTravel with showBack=false: starts on the face, flips to the back at midpoint', () => {
      const duration = 400;
      engine.travel('SRC', 'DST', 'card.png', {
        flipDuringTravel: true,
        showBack: false,
        duration,
      });
      const floatEl = container.querySelector<HTMLDivElement>('div[style*="pointer-events"]')!;
      const img = floatEl.querySelector('img')!;
      expect(img.src).toContain('card.png');
      jasmine.clock().tick(duration * TRAVEL_FLIP_MIDPOINT_FRACTION + 1);
      expect(img.src).toContain('card_back');
    });

    it('flipDuringTravel with showBack=true: starts on the back, flips to the face at midpoint', () => {
      const duration = 400;
      engine.travel('SRC', 'DST', 'card.png', {
        flipDuringTravel: true,
        showBack: true,
        duration,
      });
      const floatEl = container.querySelector<HTMLDivElement>('div[style*="pointer-events"]')!;
      const img = floatEl.querySelector('img')!;
      expect(img.src).toContain('card_back');
      jasmine.clock().tick(duration * TRAVEL_FLIP_MIDPOINT_FRACTION + 1);
      expect(img.src).toContain('card.png');
    });

    it('departureGlowColor applies box-shadow on the source img then clears it after TRAVEL_DEPARTURE_GLOW_FRACTION × duration', () => {
      const duration = 400;
      // Provide an img inside the source so the glow targets the img (not the wrapper).
      const img = document.createElement('img');
      src.appendChild(img);
      engine.travel('SRC', 'DST', 'card.png', {
        departureGlowColor: 'rgba(255,200,0,0.9)',
        duration,
      });
      expect(img.style.boxShadow).toContain('rgba(255, 200, 0, 0.9)');
      jasmine.clock().tick(duration * TRAVEL_DEPARTURE_GLOW_FRACTION + 1);
      expect(img.style.boxShadow).toBe('');
    });

    it('impactGlowColor applies + clears drop-shadow filter on the float at the expected fractions', () => {
      const duration = 400;
      engine.travel('SRC', 'DST', 'card.png', {
        impactGlowColor: 'rgba(0,255,0,0.8)',
        duration,
      });
      const floatEl = container.querySelector<HTMLDivElement>('div[style*="pointer-events"]')!;
      // Before TRAVEL_IMPACT_GLOW_ON_FRACTION → no filter.
      jasmine.clock().tick(duration * TRAVEL_IMPACT_GLOW_ON_FRACTION - 1);
      expect(floatEl.style.filter).toBe('');
      // After ON fraction → filter applied.
      jasmine.clock().tick(2);
      expect(floatEl.style.filter).toContain('drop-shadow');
      // After ON+HOLD → cleared.
      jasmine.clock().tick(duration * TRAVEL_IMPACT_GLOW_HOLD_FRACTION + 1);
      expect(floatEl.style.filter).toBe('');
    });
  });

  describe('readRect (via travel) — transform strip-and-restore', () => {
    it('restores the source transform after measuring when srcRotateZ is set', () => {
      const src = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      src.style.transform = 'rotate(-90deg)';
      const dst = makeZoneEl({ left: 200, top: 200, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'SRC' ? src : k === 'DST' ? dst : null));

      engine.travel('SRC', 'DST', 'card.png', { srcRotateZ: -90 });

      expect(src.style.transform).toBe('rotate(-90deg)');
    });

    it('leaves source transform untouched when srcRotateZ is 0', () => {
      const src = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      const dst = makeZoneEl({ left: 200, top: 200, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'SRC' ? src : k === 'DST' ? dst : null));

      engine.travel('SRC', 'DST', 'card.png');

      // No transform was set on src — confirm we didn't mutate it.
      expect(src.style.transform).toBe('');
    });
  });

  describe('ngOnDestroy', () => {
    it('clears all pending setTimeout timers when destroyed', () => {
      jasmine.clock().install();
      const src = makeZoneEl({ left: 0, top: 0, width: 50, height: 70 });
      const dst = makeZoneEl({ left: 200, top: 200, width: 50, height: 70 });
      engine.registerZoneResolver(k => (k === 'SRC' ? src : k === 'DST' ? dst : null));
      const img = document.createElement('img');
      src.appendChild(img);

      // Schedule timers: departure glow + impact glow on/off + landing impact.
      engine.travel('SRC', 'DST', 'card.png', {
        departureGlowColor: 'red',
        impactGlowColor: 'green',
        landingStyle: 'soft',
        duration: 400,
      });

      engine.ngOnDestroy();

      // After destroy, no scheduled callback should fire even if we tick past their deadlines.
      jasmine.clock().tick(10_000);
      // The destroy guarantees: no zoneImpactEffect call (landing impact was scheduled but cleared).
      expect(mockBoardEffects.zoneImpactEffect).not.toHaveBeenCalled();
    });
  });
});
