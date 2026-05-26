import type { FluxEvent } from './flux-event';
import { SwapGraveDeckProjection } from './swap-grave-deck.projection';

describe('SwapGraveDeckProjection', () => {
  let proj: SwapGraveDeckProjection;
  let reducedMotion = false;

  beforeEach(() => {
    reducedMotion = false;
    proj = new SwapGraveDeckProjection({
      relativePlayer: (abs: number) => (abs === 0 ? 0 : 1) as 0 | 1,
      reducedMotion: () => reducedMotion,
    });
  });

  function swap(player: number): FluxEvent {
    return { type: 'MSG_SWAP_GRAVE_DECK', player } as unknown as FluxEvent;
  }

  function glowEnded(msgType = 'MSG_SWAP_GRAVE_DECK'): FluxEvent {
    return {
      kind: 'animation', type: 'AnimationPhaseCompleted',
      phase: 'glow', msgType, ref: 1,
    } as unknown as FluxEvent;
  }

  it('MSG_SWAP_GRAVE_DECK for player 0 sets {GY-0, DECK-0}', () => {
    proj.applyEvent(swap(0));
    const v = proj.value();
    expect(v.has('GY-0')).toBeTrue();
    expect(v.has('DECK-0')).toBeTrue();
    expect(v.size).toBe(2);
  });

  it('MSG_SWAP_GRAVE_DECK for player 1 sets {GY-1, DECK-1}', () => {
    proj.applyEvent(swap(1));
    const v = proj.value();
    expect(v.has('GY-1')).toBeTrue();
    expect(v.has('DECK-1')).toBeTrue();
  });

  it('AnimationPhaseCompleted(glow, MSG_SWAP_GRAVE_DECK) clears the keys', () => {
    proj.applyEvent(swap(0));
    expect(proj.value().size).toBe(2);
    proj.applyEvent(glowEnded());
    expect(proj.value().size).toBe(0);
  });

  it('AnimationPhaseCompleted for a DIFFERENT msgType does NOT clear', () => {
    proj.applyEvent(swap(0));
    proj.applyEvent(glowEnded('MSG_MOVE'));
    expect(proj.value().size).toBe(2);
  });

  it('AnimationPhaseCompleted with phase != "glow" does NOT clear', () => {
    proj.applyEvent(swap(0));
    proj.applyEvent({
      kind: 'animation', type: 'AnimationPhaseCompleted',
      phase: 'travel', msgType: 'MSG_SWAP_GRAVE_DECK', ref: 1,
    } as unknown as FluxEvent);
    expect(proj.value().size).toBe(2);
  });

  it('AnimationCompleted (overall) does NOT clear (only AnimationPhaseCompleted does)', () => {
    proj.applyEvent(swap(0));
    proj.applyEvent({
      kind: 'animation', type: 'AnimationCompleted',
      msgType: 'MSG_SWAP_GRAVE_DECK', ref: 1,
    } as unknown as FluxEvent);
    expect(proj.value().size).toBe(2);
  });

  it('reduced motion: MSG_SWAP_GRAVE_DECK is ignored', () => {
    reducedMotion = true;
    proj.applyEvent(swap(0));
    expect(proj.value().size).toBe(0);
  });

  it('ignores unrelated MSG_* events', () => {
    proj.applyEvent({ type: 'MSG_MOVE' } as unknown as FluxEvent);
    proj.applyEvent({ type: 'MSG_DRAW' } as unknown as FluxEvent);
    expect(proj.value().size).toBe(0);
  });

  it('ignores boundary + deferred events', () => {
    proj.applyEvent({ kind: 'boundary', type: 'ChainStarted', chainId: 0 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'deferred', type: 'EffectReady', name: 'overlay-show:chain-1', triggerRef: 1 } as unknown as FluxEvent);
    expect(proj.value().size).toBe(0);
  });

  it('applyReset clears the keys', () => {
    proj.applyEvent(swap(0));
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value().size).toBe(0);
  });

  it('back-to-back swap events overwrite the previous keys', () => {
    proj.applyEvent(swap(0));
    expect(proj.value().has('GY-0')).toBeTrue();
    proj.applyEvent(swap(1));
    expect(proj.value().has('GY-1')).toBeTrue();
    expect(proj.value().has('GY-0')).toBeFalse();
  });
});
