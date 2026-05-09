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
});
