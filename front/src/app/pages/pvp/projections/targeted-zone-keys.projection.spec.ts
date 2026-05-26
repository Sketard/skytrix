import type { FluxEvent } from './flux-event';
import { TargetedZoneKeysProjection } from './targeted-zone-keys.projection';

describe('TargetedZoneKeysProjection', () => {
  let proj: TargetedZoneKeysProjection;

  beforeEach(() => {
    // Map: absolute 0 → relative 0 (viewer); absolute 1 → relative 1 (opponent)
    proj = new TargetedZoneKeysProjection({
      relativePlayer: (abs: number) => (abs === 0 ? 0 : 1) as 0 | 1,
    });
  });

  function becomeTarget(cards: Array<{ player: number; location: number; sequence: number }>): FluxEvent {
    return { type: 'MSG_BECOME_TARGET', cards } as unknown as FluxEvent;
  }

  function pulseEnded(msgType = 'MSG_BECOME_TARGET'): FluxEvent {
    return {
      kind: 'animation', type: 'AnimationPhaseCompleted',
      phase: 'reticle-pulse', msgType, ref: 1,
    } as unknown as FluxEvent;
  }

  it('starts with an empty set', () => {
    expect(proj.value().size).toBe(0);
  });

  it('MSG_BECOME_TARGET on MZONE adds the zone key', () => {
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04 /* MZONE */, sequence: 1 }]));
    const v = proj.value();
    expect(v.has('M2-0')).toBeTrue(); // sequence 1 → M2, viewer is rel 0
    expect(v.size).toBe(1);
  });

  it('MSG_BECOME_TARGET on SZONE adds the zone key', () => {
    proj.applyEvent(becomeTarget([{ player: 1, location: 0x08 /* SZONE */, sequence: 2 }]));
    const v = proj.value();
    expect(v.has('S3-1')).toBeTrue();
    expect(v.size).toBe(1);
  });

  it('accumulates (union) across back-to-back MSG_BECOME_TARGET', () => {
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 0 }]));
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 1 }]));
    proj.applyEvent(becomeTarget([{ player: 1, location: 0x08, sequence: 0 }]));
    const v = proj.value();
    expect(v.has('M1-0')).toBeTrue();
    expect(v.has('M2-0')).toBeTrue();
    expect(v.has('S1-1')).toBeTrue();
    expect(v.size).toBe(3);
  });

  it('IGNORES pile locations (HAND, GRAVE, BANISHED, EXTRA, DECK, OVERLAY)', () => {
    proj.applyEvent(becomeTarget([
      { player: 0, location: 0x01 /* DECK */, sequence: 0 },
      { player: 0, location: 0x02 /* HAND */, sequence: 1 },
      { player: 0, location: 0x10 /* GRAVE */, sequence: 0 },
      { player: 0, location: 0x20 /* BANISHED */, sequence: 0 },
      { player: 0, location: 0x40 /* EXTRA */, sequence: 0 },
      { player: 0, location: 0x80 /* OVERLAY */, sequence: 0 },
    ]));
    expect(proj.value().size).toBe(0);
  });

  it('mixed field + pile in same MSG: only field keys added', () => {
    proj.applyEvent(becomeTarget([
      { player: 0, location: 0x04, sequence: 2 },
      { player: 0, location: 0x10 /* GRAVE */, sequence: 0 },
      { player: 1, location: 0x08, sequence: 4 },
    ]));
    const v = proj.value();
    expect(v.has('M3-0')).toBeTrue();
    expect(v.has('S5-1')).toBeTrue();
    expect(v.size).toBe(2);
  });

  it('AnimationPhaseCompleted(reticle-pulse, MSG_BECOME_TARGET) clears the keys', () => {
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 0 }]));
    expect(proj.value().size).toBe(1);
    proj.applyEvent(pulseEnded());
    expect(proj.value().size).toBe(0);
  });

  it('AnimationPhaseCompleted for a DIFFERENT msgType does NOT clear', () => {
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 0 }]));
    proj.applyEvent(pulseEnded('MSG_MOVE'));
    expect(proj.value().size).toBe(1);
  });

  it('AnimationPhaseCompleted with phase != "reticle-pulse" does NOT clear', () => {
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 0 }]));
    proj.applyEvent({
      kind: 'animation', type: 'AnimationPhaseCompleted',
      phase: 'glow', msgType: 'MSG_BECOME_TARGET', ref: 1,
    } as unknown as FluxEvent);
    expect(proj.value().size).toBe(1);
  });

  it('AnimationCompleted (overall) does NOT clear (only AnimationPhaseCompleted does)', () => {
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 0 }]));
    proj.applyEvent({
      kind: 'animation', type: 'AnimationCompleted',
      msgType: 'MSG_BECOME_TARGET', ref: 1,
    } as unknown as FluxEvent);
    expect(proj.value().size).toBe(1);
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
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 0 }]));
    expect(proj.value().size).toBe(1);
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value().size).toBe(0);
  });

  it('after clear, a new MSG_BECOME_TARGET starts a fresh accumulation', () => {
    proj.applyEvent(becomeTarget([{ player: 0, location: 0x04, sequence: 0 }]));
    proj.applyEvent(pulseEnded());
    expect(proj.value().size).toBe(0);
    proj.applyEvent(becomeTarget([{ player: 1, location: 0x08, sequence: 3 }]));
    const v = proj.value();
    expect(v.has('S4-1')).toBeTrue();
    expect(v.size).toBe(1);
  });
});
