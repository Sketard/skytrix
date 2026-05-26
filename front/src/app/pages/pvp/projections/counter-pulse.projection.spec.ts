import { LOCATION } from '../duel-ws.types';

import { CounterPulseProjection } from './counter-pulse.projection';
import type { FluxEvent } from './flux-event';

describe('CounterPulseProjection', () => {
  let proj: CounterPulseProjection;
  let reducedMotion = false;

  beforeEach(() => {
    reducedMotion = false;
    proj = new CounterPulseProjection({
      relativePlayer: (abs: number) => (abs === 0 ? 0 : 1) as 0 | 1,
      reducedMotion: () => reducedMotion,
    });
  });

  function addCounter(player: number, location: number, sequence: number, kind = 1, amount = 1): FluxEvent {
    return {
      type: 'MSG_ADD_COUNTER',
      player, location, sequence, kind, amount,
    } as unknown as FluxEvent;
  }

  function removeCounter(player: number, location: number, sequence: number, kind = 1, amount = 1): FluxEvent {
    return {
      type: 'MSG_REMOVE_COUNTER',
      player, location, sequence, kind, amount,
    } as unknown as FluxEvent;
  }

  function animCompleted(msgType: string, ref = 1): FluxEvent {
    return { kind: 'animation', type: 'AnimationCompleted', ref, msgType } as unknown as FluxEvent;
  }

  it('MSG_ADD_COUNTER for player 0 (viewer) computes a key with relative 0', () => {
    proj.applyEvent(addCounter(0, LOCATION.MZONE, 2));
    // locationToZoneKey(MZONE=4, seq=2, rel=0) → 'M3-0' (zone "M3" is sequence 2 + 1)
    expect(proj.value()).toMatch(/^M\d+-0$/);
  });

  it('MSG_ADD_COUNTER for player 1 (opponent) computes a key with relative 1', () => {
    proj.applyEvent(addCounter(1, LOCATION.MZONE, 0));
    expect(proj.value()).toMatch(/^M\d+-1$/);
  });

  it('MSG_REMOVE_COUNTER also sets the key', () => {
    proj.applyEvent(removeCounter(0, LOCATION.SZONE, 1));
    expect(proj.value()).not.toBeNull();
  });

  it('AnimationCompleted with msgType=MSG_ADD_COUNTER clears the key', () => {
    proj.applyEvent(addCounter(0, LOCATION.MZONE, 0));
    expect(proj.value()).not.toBeNull();
    proj.applyEvent(animCompleted('MSG_ADD_COUNTER'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted with msgType=MSG_REMOVE_COUNTER also clears', () => {
    proj.applyEvent(addCounter(0, LOCATION.MZONE, 0));
    proj.applyEvent(animCompleted('MSG_REMOVE_COUNTER'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted for an UNRELATED msgType (MSG_MOVE) does NOT clear', () => {
    proj.applyEvent(addCounter(0, LOCATION.MZONE, 0));
    proj.applyEvent(animCompleted('MSG_MOVE'));
    expect(proj.value()).not.toBeNull();
  });

  it('reduced motion: MSG_ADD_COUNTER is ignored (key stays null)', () => {
    reducedMotion = true;
    proj.applyEvent(addCounter(0, LOCATION.MZONE, 0));
    expect(proj.value()).toBeNull();
  });

  it('reduced motion: MSG_REMOVE_COUNTER is ignored', () => {
    reducedMotion = true;
    proj.applyEvent(removeCounter(0, LOCATION.MZONE, 0));
    expect(proj.value()).toBeNull();
  });

  it('ignores unrelated MSG_* events', () => {
    proj.applyEvent({ type: 'MSG_MOVE' } as unknown as FluxEvent);
    proj.applyEvent({ type: 'MSG_DRAW' } as unknown as FluxEvent);
    expect(proj.value()).toBeNull();
  });

  it('ignores boundary + deferred events', () => {
    proj.applyEvent({ kind: 'boundary', type: 'ChainStarted', chainId: 0 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'deferred', type: 'EffectReady', name: 'overlay-show:chain-1', triggerRef: 1 } as unknown as FluxEvent);
    expect(proj.value()).toBeNull();
  });

  it('two consecutive ADD_COUNTER on the SAME zone re-emit (force CSS animation restart)', () => {
    // Object.is dedup would silently swallow the second set if the
    // projection wrote `set(key)` twice in a row. The double-set
    // null→key trick guarantees a re-emit. We assert it by spying on
    // the internal writer signal's `set` and counting calls.
    let setCount = 0;
    const writer = proj['_key'] as { set: (v: string | null) => void };
    const origSet = writer.set.bind(writer);
    writer.set = (v: string | null) => { setCount++; origSet(v); };

    proj.applyEvent(addCounter(0, LOCATION.MZONE, 0));
    const firstKey = proj.value();
    proj.applyEvent(addCounter(0, LOCATION.MZONE, 0));
    const secondKey = proj.value();

    expect(firstKey).not.toBeNull();
    expect(secondKey).toBe(firstKey);
    // 2 events × 2 sets each (null + key) = 4 set calls total.
    expect(setCount).toBe(4);
  });

  it('applyReset clears the key', () => {
    proj.applyEvent(addCounter(0, LOCATION.MZONE, 0));
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value()).toBeNull();
  });

  it('applyReset is idempotent when already null', () => {
    expect(() => proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']))).not.toThrow();
    expect(proj.value()).toBeNull();
  });
});
