import { TestBed } from '@angular/core/testing';
import { FloatRegistryService } from './float-registry.service';

/** Build a controllable Animation mock: `finished` is a Promise we own. */
function makeAnimation(): {
  animation: Animation;
  finish: () => void;
  cancel: () => void;
} {
  let resolveFinished!: () => void;
  let rejectFinished!: () => void;
  const finished = new Promise<Animation>((res, rej) => {
    resolveFinished = () => res({} as Animation);
    rejectFinished = () => rej(new Error('cancelled'));
  });
  const animation = {
    finished,
    finish: () => resolveFinished(),
    cancel: () => rejectFinished(),
  } as unknown as Animation;
  return {
    animation,
    finish: () => resolveFinished(),
    cancel: () => rejectFinished(),
  };
}

function makeFloat(dstKey?: string, cardCode?: number): HTMLDivElement {
  const div = document.createElement('div');
  if (dstKey) div.dataset['dstKey'] = dstKey;
  if (cardCode !== undefined) div.dataset['cardCode'] = String(cardCode);
  document.body.appendChild(div);
  return div;
}

describe('FloatRegistryService', () => {
  let registry: FloatRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FloatRegistryService] });
    registry = TestBed.inject(FloatRegistryService);
  });

  // ---------------------------------------------------------------------------
  // register / lifecycle
  // ---------------------------------------------------------------------------

  describe('register', () => {
    it('inserts the float into _inFlight immediately, then transfers to _landed on finish', async () => {
      const el = makeFloat('GY-0');
      const { animation, finish } = makeAnimation();
      const promise = registry.register(el, animation);
      expect(registry.inFlightCount()).toBe(1);
      expect(registry.landedCount()).toBe(0);
      finish();
      await promise;
      expect(registry.inFlightCount()).toBe(0);
      expect(registry.landedCount()).toBe(1);
    });

    it('runs onLand BEFORE adding to _landed', async () => {
      const el = makeFloat('GY-0');
      const { animation, finish } = makeAnimation();
      let landedCountAtCallback = -1;
      const onLand = () => { landedCountAtCallback = registry.landedCount(); };
      const promise = registry.register(el, animation, onLand);
      finish();
      await promise;
      // onLand fired while landedCount was still 0 (only added after).
      expect(landedCountAtCallback).toBe(0);
      expect(registry.landedCount()).toBe(1);
    });

    it('on cancel: removes from _inFlight, does NOT add to _landed, resolves the promise', async () => {
      const el = makeFloat('GY-0');
      const { animation, cancel } = makeAnimation();
      const promise = registry.register(el, animation);
      cancel();
      await promise; // must resolve, never reject
      expect(registry.inFlightCount()).toBe(0);
      expect(registry.landedCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // popLandedFloat — LIFO with cardCode, FIFO without
  // ---------------------------------------------------------------------------

  describe('popLandedFloat', () => {
    async function landFloats(...specs: { dstKey?: string; cardCode?: number }[]): Promise<HTMLDivElement[]> {
      const els: HTMLDivElement[] = [];
      for (const spec of specs) {
        const el = makeFloat(spec.dstKey, spec.cardCode);
        const { animation, finish } = makeAnimation();
        const p = registry.register(el, animation);
        finish();
        await p;
        els.push(el);
      }
      return els;
    }

    it('returns null when nothing is landed', () => {
      expect(registry.popLandedFloat()).toBeNull();
    });

    it('FIFO without cardCode: returns the FIRST inserted matching float', async () => {
      const [first] = await landFloats(
        { dstKey: 'HAND-0' },
        { dstKey: 'HAND-0' },
      );
      expect(registry.popLandedFloat('HAND')).toBe(first);
      expect(registry.landedCount()).toBe(1);
    });

    it('LIFO with cardCode: returns the LAST inserted matching float', async () => {
      const [, second] = await landFloats(
        { dstKey: 'HAND-0', cardCode: 42 },
        { dstKey: 'HAND-0', cardCode: 42 },
      );
      expect(registry.popLandedFloat('HAND', 42)).toBe(second);
      expect(registry.landedCount()).toBe(1);
    });

    it('returns null when prefix matches nothing', async () => {
      await landFloats({ dstKey: 'GY-0' });
      expect(registry.popLandedFloat('HAND')).toBeNull();
      expect(registry.landedCount()).toBe(1);
    });

    it('skips floats without dstKey when prefix is provided', async () => {
      await landFloats({ /* no dstKey */ }, { dstKey: 'HAND-0' });
      const popped = registry.popLandedFloat('HAND');
      expect(popped?.dataset['dstKey']).toBe('HAND-0');
    });

    it('LIFO ignores floats matching prefix but NOT cardCode', async () => {
      const [, , third] = await landFloats(
        { dstKey: 'HAND-0', cardCode: 1 },
        { dstKey: 'HAND-0', cardCode: 99 },
        { dstKey: 'HAND-0', cardCode: 1 },
      );
      // cardCode=1 matches positions 0 and 2; LIFO → third.
      expect(registry.popLandedFloat('HAND', 1)).toBe(third);
    });
  });

  // ---------------------------------------------------------------------------
  // getLandedFloatsByDstPrefix
  // ---------------------------------------------------------------------------

  describe('getLandedFloatsByDstPrefix', () => {
    it('returns all matching floats without removing them', async () => {
      const el1 = makeFloat('HAND-0');
      const el2 = makeFloat('HAND-1');
      const el3 = makeFloat('GY-0');
      for (const el of [el1, el2, el3]) {
        const { animation, finish } = makeAnimation();
        const p = registry.register(el, animation);
        finish();
        await p;
      }
      const matches = registry.getLandedFloatsByDstPrefix('HAND');
      expect(matches).toEqual(jasmine.arrayWithExactContents([el1, el2]));
      expect(registry.landedCount()).toBe(3); // not removed
    });
  });

  // ---------------------------------------------------------------------------
  // returnToLanded
  // ---------------------------------------------------------------------------

  describe('returnToLanded', () => {
    it('re-adds a previously popped float so it can be popped again', async () => {
      const el = makeFloat('HAND-0', 42);
      const { animation, finish } = makeAnimation();
      const p = registry.register(el, animation);
      finish();
      await p;
      const popped = registry.popLandedFloat('HAND', 42)!;
      expect(registry.landedCount()).toBe(0);
      registry.returnToLanded(popped as HTMLDivElement);
      expect(registry.landedCount()).toBe(1);
      expect(registry.popLandedFloat('HAND', 42)).toBe(el);
    });
  });

  // ---------------------------------------------------------------------------
  // clearLandedByDstPrefix / clearLandedTravels
  // ---------------------------------------------------------------------------

  describe('clearLandedByDstPrefix', () => {
    it('removes only floats whose dstKey starts with the prefix', async () => {
      const el1 = makeFloat('HAND-0');
      const el2 = makeFloat('GY-0');
      for (const el of [el1, el2]) {
        const { animation, finish } = makeAnimation();
        const p = registry.register(el, animation);
        finish();
        await p;
      }
      registry.clearLandedByDstPrefix('HAND');
      expect(document.body.contains(el1)).toBeFalse();
      expect(document.body.contains(el2)).toBeTrue();
      expect(registry.landedCount()).toBe(1);
    });

    it('removes ALL landed floats when called without prefix', async () => {
      const el1 = makeFloat('HAND-0');
      const el2 = makeFloat('GY-0');
      for (const el of [el1, el2]) {
        const { animation, finish } = makeAnimation();
        const p = registry.register(el, animation);
        finish();
        await p;
      }
      registry.clearLandedByDstPrefix();
      expect(registry.landedCount()).toBe(0);
    });
  });

  describe('clearLandedTravels', () => {
    it('removes every landed float and clears the set', async () => {
      const el1 = makeFloat('A');
      const el2 = makeFloat('B');
      for (const el of [el1, el2]) {
        const { animation, finish } = makeAnimation();
        const p = registry.register(el, animation);
        finish();
        await p;
      }
      registry.clearLandedTravels();
      expect(registry.landedCount()).toBe(0);
      expect(document.body.contains(el1)).toBeFalse();
      expect(document.body.contains(el2)).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------------
  // inFlightByZone
  // ---------------------------------------------------------------------------

  describe('inFlightByZone', () => {
    it('groups in-flight travels by dstKey and skips entries without one', () => {
      const el1 = makeFloat('GY-0');
      const el2 = makeFloat('GY-0');
      const el3 = makeFloat('HAND-0');
      const elNoKey = makeFloat();
      for (const el of [el1, el2, el3, elNoKey]) {
        registry.register(el, makeAnimation().animation);
      }
      const map = registry.inFlightByZone();
      expect(map.get('GY-0')?.length).toBe(2);
      expect(map.get('HAND-0')?.length).toBe(1);
      expect(map.size).toBe(2); // no-key entry skipped
    });
  });

  // ---------------------------------------------------------------------------
  // cancelTravel
  // ---------------------------------------------------------------------------

  describe('cancelTravel', () => {
    it('cancels matching in-flight travel, removes its DOM node, resolves the promise', async () => {
      const el = makeFloat('GY-0');
      const { animation } = makeAnimation();
      const cancelSpy = spyOn(animation, 'cancel').and.callThrough();
      const promise = registry.register(el, animation);
      registry.cancelTravel('GY-0');
      await promise; // must resolve
      expect(cancelSpy).toHaveBeenCalled();
      expect(document.body.contains(el)).toBeFalse();
      expect(registry.inFlightCount()).toBe(0);
    });

    it('leaves unrelated in-flight travels alone', () => {
      const elA = makeFloat('GY-0');
      const elB = makeFloat('HAND-0');
      registry.register(elA, makeAnimation().animation);
      registry.register(elB, makeAnimation().animation);
      registry.cancelTravel('GY-0');
      expect(registry.inFlightCount()).toBe(1);
      expect(document.body.contains(elB)).toBeTrue();
    });
  });

  // ---------------------------------------------------------------------------
  // clearAllTravels
  // ---------------------------------------------------------------------------

  describe('clearAllTravels', () => {
    it('cancels every in-flight, resolves their promises, removes their DOM, then clears landed', async () => {
      const inFlightEl = makeFloat('A');
      const { animation: a1 } = makeAnimation();
      const cancelSpy = spyOn(a1, 'cancel').and.callThrough();
      const inFlightPromise = registry.register(inFlightEl, a1);

      const landedEl = makeFloat('B');
      const { animation: a2, finish: finish2 } = makeAnimation();
      const landedPromise = registry.register(landedEl, a2);
      finish2();
      await landedPromise;

      registry.clearAllTravels();
      await inFlightPromise; // must resolve
      expect(cancelSpy).toHaveBeenCalled();
      expect(registry.inFlightCount()).toBe(0);
      expect(registry.landedCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ngOnDestroy
  // ---------------------------------------------------------------------------

  describe('ngOnDestroy', () => {
    it('cancels in-flight, removes their DOM, resolves their promises', async () => {
      const el = makeFloat('GY-0');
      const { animation } = makeAnimation();
      const cancelSpy = spyOn(animation, 'cancel').and.callThrough();
      const promise = registry.register(el, animation);
      registry.ngOnDestroy();
      await promise; // must resolve, not reject
      expect(cancelSpy).toHaveBeenCalled();
      expect(document.body.contains(el)).toBeFalse();
      expect(registry.inFlightCount()).toBe(0);
    });

    it('clears landed travels too', async () => {
      const el = makeFloat('GY-0');
      const { animation, finish } = makeAnimation();
      const p = registry.register(el, animation);
      finish();
      await p;
      registry.ngOnDestroy();
      expect(registry.landedCount()).toBe(0);
      expect(document.body.contains(el)).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------------
  // getLastLandedFloat
  // ---------------------------------------------------------------------------

  describe('getLastLandedFloat', () => {
    it('returns null when no floats have landed', () => {
      expect(registry.getLastLandedFloat()).toBeNull();
    });

    it('returns the most recently landed float', async () => {
      const el1 = makeFloat();
      const el2 = makeFloat();
      for (const el of [el1, el2]) {
        const { animation, finish } = makeAnimation();
        const p = registry.register(el, animation);
        finish();
        await p;
      }
      expect(registry.getLastLandedFloat()).toBe(el2);
    });
  });

  // ---------------------------------------------------------------------------
  // stabilizeFloat — viewport→container-local conversion + z-index bump.
  //
  // Floats created by `CardTravelEngine` are `position: absolute` children
  // of `.board-host` (γ commit 6). Pre-fix `stabilizeFloat` wrote raw
  // viewport coords into `style.left/top`, which teleported the float by
  // `containerRect.left/top` against its rendered position whenever the
  // container had a non-zero origin (e.g. a navbar pushes `.board-host`
  // down → float jumps down by ~63px after stabilize → tutored card
  // disappears under the timeline-bar on the replay viewer).
  //
  // The z-index bump pins the landed float above the fan's `.hand-card`
  // (z=50 effective via `.hand-player` stacking context) AND below the
  // replay chrome (transport-bar / timeline-bar / topbar at
  // `$z-pvp-card-travel + 20` = 920) so the user can still drive
  // playback while a float sits on the hand.
  //
  // Regression history: docs/CLAUDE.md — `stabilizeFloat` viewport bug fix.
  // ---------------------------------------------------------------------------

  describe('stabilizeFloat', () => {
    /** Build a float with style.left/top tracked + a getBoundingClientRect
     *  stub so we can simulate any viewport coord regardless of layout. */
    function makeFloatWithRect(viewportLeft: number, viewportTop: number, w = 80, h = 120): HTMLDivElement {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      document.body.appendChild(el);
      spyOn(el, 'getBoundingClientRect').and.returnValue(new DOMRect(viewportLeft, viewportTop, w, h));
      // Tests only care about the cancellation contract; no real animations.
      spyOn(el, 'getAnimations').and.returnValue([]);
      return el;
    }

    it('subtracts containerRect.left/top so the float stays at the same visual position', () => {
      // Container offset 100 horizontally, 63 vertically (typical replay
      // layout with a navbar pushing the board down).
      const containerRect = new DOMRect(100, 63, 1600, 900);
      const el = makeFloatWithRect(500, 400);

      registry.stabilizeFloat(el, '', containerRect);

      // style.left/top are container-local: viewport coord minus container origin.
      expect(el.style.left).toBe(`${500 - 100}px`); // 400px
      expect(el.style.top).toBe(`${400 - 63}px`);   // 337px
    });

    it('falls back to (0,0) when containerRect is omitted (back-compat path)', () => {
      // The back-compat path is only correct when the container is at the
      // viewport origin (test environment, root-mounted previews). Real
      // callers MUST pass the rect — see CLAUDE.md.
      const el = makeFloatWithRect(500, 400);

      registry.stabilizeFloat(el, '');

      // No conversion applied → raw viewport coords written to style.
      expect(el.style.left).toBe('500px');
      expect(el.style.top).toBe('400px');
    });

    it('bumps style.zIndex to 800 so the float covers the hand below the replay chrome', () => {
      const el = makeFloatWithRect(0, 0);
      // Simulate the in-flight float's initial z-index (set by createFloatingElement).
      el.style.zIndex = '900';

      registry.stabilizeFloat(el, '', new DOMRect(0, 0, 100, 100));

      expect(el.style.zIndex).toBe('800');
    });

    it('preserves `baseRotateCSS` on style.transform (opponent cards face their owner)', () => {
      const el = makeFloatWithRect(0, 0);
      el.style.transform = 'translate(100px, 200px)'; // residual from the travel animation

      registry.stabilizeFloat(el, 'rotateZ(180deg)', new DOMRect(0, 0, 100, 100));

      expect(el.style.transform).toBe('rotateZ(180deg)');
    });

    it('returns the viewport rect captured before cancellation (caller uses it for slide-to-target math)', () => {
      const el = makeFloatWithRect(500, 400, 80, 120);

      const rect = registry.stabilizeFloat(el, '', new DOMRect(0, 0, 100, 100));

      // Caller (processShuffleEvent) reads this rect to compute the slide
      // vector from the stabilized position to the post-shuffle slot.
      expect(rect.left).toBe(500);
      expect(rect.top).toBe(400);
      expect(rect.width).toBe(80);
      expect(rect.height).toBe(120);
    });

    it('cancels every Web Animations API entry attached to the float', () => {
      const el = makeFloatWithRect(0, 0);
      const animA = jasmine.createSpyObj<Animation>('animA', ['cancel']);
      const animB = jasmine.createSpyObj<Animation>('animB', ['cancel']);
      (el.getAnimations as jasmine.Spy).and.returnValue([animA, animB]);

      registry.stabilizeFloat(el, '', new DOMRect(0, 0, 100, 100));

      expect(animA.cancel).toHaveBeenCalled();
      expect(animB.cancel).toHaveBeenCalled();
    });
  });
});
