import { TestBed } from '@angular/core/testing';
import { BoardEffectsService } from './board-effects.service';
import { CardTravelService } from './card-travel.service';

/**
 * Override `Element.animate` so `.finished` resolves immediately and the
 * service's `then`/`finally` paths run synchronously under await.
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

describe('BoardEffectsService', () => {
  let service: BoardEffectsService;
  let mockCardTravel: jasmine.SpyObj<CardTravelService>;
  let container: HTMLElement;
  let zoneEl: HTMLElement;
  let restoreAnimate: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);

    zoneEl = document.createElement('div');
    Object.defineProperty(zoneEl, 'getBoundingClientRect', {
      value: () => new DOMRect(100, 100, 50, 70),
    });

    ({ restore: restoreAnimate } = patchAnimateOnElementProto());

    mockCardTravel = jasmine.createSpyObj<CardTravelService>('CardTravelService', [
      'getZoneElement', 'getContainer', 'toAbsoluteUrl',
    ]);
    mockCardTravel.getContainer.and.returnValue(container);
    mockCardTravel.getZoneElement.and.returnValue(zoneEl);
    mockCardTravel.toAbsoluteUrl.and.callFake((s: string) => s);

    TestBed.configureTestingModule({
      providers: [
        BoardEffectsService,
        { provide: CardTravelService, useValue: mockCardTravel },
      ],
    });
    service = TestBed.inject(BoardEffectsService);
    // Headless browser may report reduced-motion = true depending on env.
    // Force false so the visual paths actually run (otherwise every method
    // early-returns and the specs become trivially green).
    (service as unknown as { _reducedMotion: boolean })._reducedMotion = false;
  });

  afterEach(() => {
    restoreAnimate();
    container.remove();
  });

  // -------------------------------------------------------------------------
  // zoneImpactEffect
  // -------------------------------------------------------------------------

  describe('zoneImpactEffect', () => {
    it('appends two overlay elements (glow + sink) to the container', () => {
      const before = container.children.length;
      service.zoneImpactEffect(new DOMRect(0, 0, 50, 70), 'red', 400);
      expect(container.children.length).toBe(before + 2);
    });

    it('passes the configured color into the glow gradient style', () => {
      service.zoneImpactEffect(new DOMRect(0, 0, 50, 70), 'rgb(123,45,67)', 400);
      const glow = container.children[0] as HTMLElement;
      // Browsers normalize rgb() spacing in cssText, so strip all whitespace before matching.
      expect(glow.style.cssText.replace(/\s/g, '')).toContain('rgb(123,45,67)');
    });
  });

  // -------------------------------------------------------------------------
  // slamDustParticles
  // -------------------------------------------------------------------------

  describe('slamDustParticles', () => {
    it('spawns exactly 7 particle elements', () => {
      const before = container.children.length;
      service.slamDustParticles(new DOMRect(0, 0, 50, 70));
      expect(container.children.length).toBe(before + 7);
    });
  });

  // -------------------------------------------------------------------------
  // preDestroyEffect
  // -------------------------------------------------------------------------

  describe('preDestroyEffect', () => {
    it('returns immediately when source rect width is 0 (no overlay appended)', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'getBoundingClientRect', {
        value: () => new DOMRect(0, 0, 0, 0),
      });
      void service.preDestroyEffect(el, null, 100);
      // Synchronously: the early-return path must short-circuit before the
      // overlay is appended. If the guard is removed, an overlay div is
      // appended right after `trackOverlayUntimed`.
      expect(container.children.length).toBe(0);
    });

    it('appends a crack overlay containing an img and an svg', async () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'getBoundingClientRect', {
        value: () => new DOMRect(0, 0, 50, 70),
      });
      // Don't await — animate() is mocked but setTimeout in the .then path
      // would still run. We just need to assert the synchronous DOM append.
      void service.preDestroyEffect(el, '/img/foo.jpg', 100);
      expect(container.children.length).toBe(1);
      const overlay = container.children[0] as HTMLElement;
      expect(overlay.querySelector('img')).not.toBeNull();
      expect(overlay.querySelector('svg')).not.toBeNull();
    });

    it('falls back to card_back via cardTravel.toAbsoluteUrl when imageUrl is null', () => {
      const el = document.createElement('div');
      Object.defineProperty(el, 'getBoundingClientRect', {
        value: () => new DOMRect(0, 0, 50, 70),
      });
      void service.preDestroyEffect(el, null, 100);
      expect(mockCardTravel.toAbsoluteUrl).toHaveBeenCalledWith('assets/images/card_back.jpg');
    });
  });

  // -------------------------------------------------------------------------
  // activateEffect
  // -------------------------------------------------------------------------

  describe('activateEffect', () => {
    it('returns immediately when target zone resolves to null', async () => {
      mockCardTravel.getZoneElement.and.returnValue(null);
      await expectAsync(service.activateEffect('FAKE-0', 100)).toBeResolved();
      expect(container.children.length).toBe(0);
    });

    it('appends flash + star + 10 particles (12 elements) when target resolves', () => {
      void service.activateEffect('GY-0', 100);
      expect(container.children.length).toBe(12);
    });

    it('accepts an HTMLElement target directly (bypassing zone resolver)', () => {
      mockCardTravel.getZoneElement.and.returnValue(null);
      void service.activateEffect(zoneEl, 100);
      expect(container.children.length).toBe(12);
      expect(mockCardTravel.getZoneElement).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // createTargetFloat
  // -------------------------------------------------------------------------

  describe('createTargetFloat', () => {
    it('returns null when zone element does not resolve', () => {
      mockCardTravel.getZoneElement.and.returnValue(null);
      const out = service.createTargetFloat('GY-0', '/img/x.jpg', 0, 4, 2, 250);
      expect(out).toBeNull();
      expect(container.children.length).toBe(0);
    });

    it('creates a float with dataset tags and appends to container', () => {
      const el = service.createTargetFloat('GY-0', '/img/x.jpg', 0, 4, 2, 250);
      expect(el).not.toBeNull();
      expect(el!.dataset['targetFloat']).toBe('true');
      expect(el!.dataset['zoneKey']).toBe('GY-0');
      expect(container.contains(el!)).toBeTrue();
    });

    it('shifts position by cascadeIndex * cascadeXPx / cascadeYPx', () => {
      // Zone rect = (100, 100, 50, 70) → liftY at index 0 = 70*0.5 = 35 → top = 100 - 35 = 65
      const e0 = service.createTargetFloat('GY-0', '/img/x.jpg', 0, 4, 2, 250)!;
      // index=1 → liftY = 35 + 4 = 39 → top = 100 - 39 = 61; shiftX = 1*2 = 2 → left = 102
      const e1 = service.createTargetFloat('GY-0', '/img/x.jpg', 1, 4, 2, 250)!;
      expect(e0.style.left).toBe('100px');
      expect(e0.style.top).toBe('65px');
      expect(e1.style.left).toBe('102px');
      expect(e1.style.top).toBe('61px');
    });
  });

  // -------------------------------------------------------------------------
  // removeTargetFloat
  // -------------------------------------------------------------------------

  describe('removeTargetFloat', () => {
    it('removes the element from the DOM and stops tracking it', () => {
      const el = service.createTargetFloat('GY-0', '/img/x.jpg', 0, 4, 2, 250)!;
      expect(container.contains(el)).toBeTrue();
      service.removeTargetFloat(el);
      expect(container.contains(el)).toBeFalse();
      // ngOnDestroy must not double-remove (no error)
      service.ngOnDestroy();
    });
  });

  // -------------------------------------------------------------------------
  // fadeOutAndRemoveTargetFloat
  // -------------------------------------------------------------------------

  describe('fadeOutAndRemoveTargetFloat', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('sets opacity to 0 then removes the element after the configured delay', () => {
      const el = service.createTargetFloat('GY-0', '/img/x.jpg', 0, 4, 2, 250)!;
      service.fadeOutAndRemoveTargetFloat(el, 300);
      expect(el.style.opacity).toBe('0');
      expect(container.contains(el)).toBeTrue();
      jasmine.clock().tick(299);
      expect(container.contains(el)).toBeTrue();
      jasmine.clock().tick(2);
      expect(container.contains(el)).toBeFalse();
    });
  });

  // -------------------------------------------------------------------------
  // ngOnDestroy
  // -------------------------------------------------------------------------

  describe('ngOnDestroy', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('clears pending timers so a fade scheduled before destroy does not fire', () => {
      const el = service.createTargetFloat('GY-0', '/img/x.jpg', 0, 4, 2, 250)!;
      service.fadeOutAndRemoveTargetFloat(el, 300);
      const removeSpy = spyOn(service, 'removeTargetFloat').and.callThrough();
      service.ngOnDestroy();
      expect(container.contains(el)).toBeFalse(); // removed by ngOnDestroy
      // Ticking past the original fade timer: if the timer was NOT cleared, it
      // would fire and call removeTargetFloat. Asserting 0 calls catches a
      // missing `_timers.add(id)` mutation in fadeOutAndRemoveTargetFloat.
      jasmine.clock().tick(500);
      expect(removeSpy).not.toHaveBeenCalled();
      expect(container.contains(el)).toBeFalse();
    });

    it('removes any tracked overlay elements (e.g., a target float never explicitly cleaned)', () => {
      const el = service.createTargetFloat('GY-0', '/img/x.jpg', 0, 4, 2, 250)!;
      service.ngOnDestroy();
      expect(container.contains(el)).toBeFalse();
    });
  });
});
