import type { FluxEvent } from './flux-event';
import { IsAnimatingProjection } from './is-animating.projection';

describe('IsAnimatingProjection', () => {
  let proj: IsAnimatingProjection;

  beforeEach(() => {
    proj = new IsAnimatingProjection();
  });

  function runnerStarted(at = Date.now()): FluxEvent {
    return { kind: 'runner-started', at } as unknown as FluxEvent;
  }

  function runnerStopped(at = Date.now()): FluxEvent {
    return { kind: 'runner-stopped', at } as unknown as FluxEvent;
  }

  it('initial value is false (no runner cycle yet)', () => {
    expect(proj.value()).toBeFalse();
  });

  it('runner-started → value true', () => {
    proj.applyEvent(runnerStarted());
    expect(proj.value()).toBeTrue();
  });

  it('runner-stopped → value false', () => {
    proj.applyEvent(runnerStarted());
    proj.applyEvent(runnerStopped());
    expect(proj.value()).toBeFalse();
  });

  it('multiple started→stopped cycles toggle correctly', () => {
    proj.applyEvent(runnerStarted());
    expect(proj.value()).toBeTrue();
    proj.applyEvent(runnerStopped());
    expect(proj.value()).toBeFalse();
    proj.applyEvent(runnerStarted());
    expect(proj.value()).toBeTrue();
  });

  it('ignores unrelated InternalTransportEvent (rescue-fired, watchdog-armed)', () => {
    proj.applyEvent(runnerStarted());
    proj.applyEvent({ kind: 'rescue-fired', queueLen: 3, noProgressCount: 0, at: 1 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'watchdog-armed', at: 1 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'rescue-abandoned', queueLen: 3, at: 1 } as unknown as FluxEvent);
    expect(proj.value()).toBeTrue();
  });

  it('ignores MSG_* events', () => {
    proj.applyEvent(runnerStarted());
    proj.applyEvent({ type: 'MSG_MOVE' } as unknown as FluxEvent);
    proj.applyEvent({ type: 'MSG_DRAW' } as unknown as FluxEvent);
    expect(proj.value()).toBeTrue();
  });

  it('ignores boundary + deferred + animation events', () => {
    proj.applyEvent(runnerStarted());
    proj.applyEvent({ kind: 'boundary', type: 'ChainStarted', chainId: 0 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'deferred', type: 'EffectReady', name: 'x', triggerRef: 1 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'animation', type: 'AnimationCompleted', ref: 1, msgType: 'MSG_MOVE' } as unknown as FluxEvent);
    expect(proj.value()).toBeTrue();
  });

  it('applyReset forces value to false', () => {
    proj.applyEvent(runnerStarted());
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value()).toBeFalse();
  });

  it('applyReset is idempotent when already false', () => {
    expect(() => proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']))).not.toThrow();
    expect(proj.value()).toBeFalse();
  });

  it('a fresh runner-started after applyReset flips back to true', () => {
    proj.applyEvent(runnerStarted());
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value()).toBeFalse();
    proj.applyEvent(runnerStarted());
    expect(proj.value()).toBeTrue();
  });
});
