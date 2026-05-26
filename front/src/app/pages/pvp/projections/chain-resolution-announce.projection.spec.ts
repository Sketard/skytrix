import type { FluxEvent } from './flux-event';
import { ChainResolutionAnnounceProjection } from './chain-resolution-announce.projection';

describe('ChainResolutionAnnounceProjection', () => {
  let proj: ChainResolutionAnnounceProjection;

  beforeEach(() => {
    proj = new ChainResolutionAnnounceProjection();
  });

  function bannerAnnounced(msgType = 'MSG_CHAIN_SOLVING'): FluxEvent {
    return {
      kind: 'animation', type: 'AnimationPhaseCompleted',
      phase: 'banner-announce', msgType, ref: 1,
    } as unknown as FluxEvent;
  }

  function chainEnd(): FluxEvent {
    return { type: 'MSG_CHAIN_END' } as unknown as FluxEvent;
  }

  it('starts as false', () => {
    expect(proj.value()).toBeFalse();
  });

  it('AnimationPhaseCompleted(banner-announce, MSG_CHAIN_SOLVING) sets true', () => {
    proj.applyEvent(bannerAnnounced());
    expect(proj.value()).toBeTrue();
  });

  it('AnimationPhaseCompleted for a DIFFERENT msgType does NOT set', () => {
    proj.applyEvent(bannerAnnounced('MSG_MOVE'));
    expect(proj.value()).toBeFalse();
  });

  it('AnimationPhaseCompleted with phase != "banner-announce" does NOT set', () => {
    proj.applyEvent({
      kind: 'animation', type: 'AnimationPhaseCompleted',
      phase: 'glow', msgType: 'MSG_CHAIN_SOLVING', ref: 1,
    } as unknown as FluxEvent);
    expect(proj.value()).toBeFalse();
  });

  it('MSG_CHAIN_END clears the announce flag', () => {
    proj.applyEvent(bannerAnnounced());
    expect(proj.value()).toBeTrue();
    proj.applyEvent(chainEnd());
    expect(proj.value()).toBeFalse();
  });

  it('AnimationCompleted (overall) does NOT change the state', () => {
    proj.applyEvent(bannerAnnounced());
    proj.applyEvent({
      kind: 'animation', type: 'AnimationCompleted',
      msgType: 'MSG_CHAIN_SOLVING', ref: 1,
    } as unknown as FluxEvent);
    expect(proj.value()).toBeTrue();
  });

  it('ignores unrelated MSG_* events', () => {
    proj.applyEvent({ type: 'MSG_MOVE' } as unknown as FluxEvent);
    proj.applyEvent({ type: 'MSG_DRAW' } as unknown as FluxEvent);
    proj.applyEvent({ type: 'MSG_CHAINING' } as unknown as FluxEvent);
    expect(proj.value()).toBeFalse();
  });

  it('ignores boundary + deferred events', () => {
    proj.applyEvent({ kind: 'boundary', type: 'ChainStarted', chainId: 0 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'boundary', type: 'ChainEnded', chainId: 0 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'deferred', type: 'EffectReady', name: 'overlay-show:chain-1', triggerRef: 1 } as unknown as FluxEvent);
    expect(proj.value()).toBeFalse();
  });

  it('applyReset clears the state', () => {
    proj.applyEvent(bannerAnnounced());
    expect(proj.value()).toBeTrue();
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value()).toBeFalse();
  });

  it('after clear, a new banner-announce sets true again', () => {
    proj.applyEvent(bannerAnnounced());
    proj.applyEvent(chainEnd());
    expect(proj.value()).toBeFalse();
    proj.applyEvent(bannerAnnounced());
    expect(proj.value()).toBeTrue();
  });

  it('MSG_CHAIN_END without a prior set is a no-op (still false)', () => {
    proj.applyEvent(chainEnd());
    expect(proj.value()).toBeFalse();
  });
});
