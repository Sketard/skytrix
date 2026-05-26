import { LOCATION, POSITION } from '../duel-ws.types';

import { AnimatingZoneProjection } from './animating-zone.projection';
import type { FluxEvent } from './flux-event';

describe('AnimatingZoneProjection', () => {
  let proj: AnimatingZoneProjection;

  beforeEach(() => {
    proj = new AnimatingZoneProjection({
      relativePlayer: (abs: number) => (abs === 0 ? 0 : 1) as 0 | 1,
    });
  });

  function flipSummoning(player: number, location: number, sequence: number): FluxEvent {
    return { type: 'MSG_FLIP_SUMMONING', player, location, sequence } as unknown as FluxEvent;
  }

  function changePos(
    player: number, location: number, sequence: number,
    previousPosition: number, currentPosition: number,
  ): FluxEvent {
    return {
      type: 'MSG_CHANGE_POS', player, location, sequence,
      previousPosition, currentPosition,
    } as unknown as FluxEvent;
  }

  function chaining(player: number, location: number, sequence: number): FluxEvent {
    return { type: 'MSG_CHAINING', player, location, sequence } as unknown as FluxEvent;
  }

  function animCompleted(msgType: string): FluxEvent {
    return { kind: 'animation', type: 'AnimationCompleted', ref: 1, msgType } as unknown as FluxEvent;
  }

  it('MSG_FLIP_SUMMONING sets flip animation on the zone', () => {
    proj.applyEvent(flipSummoning(0, LOCATION.MZONE, 2));
    const v = proj.value();
    expect(v).not.toBeNull();
    expect(v!.animationType).toBe('flip');
    expect(v!.relativePlayerIndex).toBe(0);
    expect(v!.zoneId).toMatch(/^M\d+$/);
  });

  it('MSG_CHAINING (with zoneId) sets activate animation', () => {
    proj.applyEvent(chaining(1, LOCATION.SZONE, 0));
    const v = proj.value();
    expect(v).not.toBeNull();
    expect(v!.animationType).toBe('activate');
    expect(v!.relativePlayerIndex).toBe(1);
  });

  it('MSG_CHANGE_POS face-down → face-up triggers flip', () => {
    proj.applyEvent(changePos(0, LOCATION.MZONE, 0,
      POSITION.FACEDOWN_DEFENSE, POSITION.FACEUP_ATTACK));
    const v = proj.value();
    expect(v).not.toBeNull();
    expect(v!.animationType).toBe('flip');
  });

  it('MSG_CHANGE_POS attack → defense (both face-up) is ignored', () => {
    proj.applyEvent(changePos(0, LOCATION.MZONE, 0,
      POSITION.FACEUP_ATTACK, POSITION.FACEUP_DEFENSE));
    expect(proj.value()).toBeNull();
  });

  it('MSG_CHANGE_POS face-down attack → face-down defense (no reveal) is ignored', () => {
    proj.applyEvent(changePos(0, LOCATION.MZONE, 0,
      POSITION.FACEDOWN_ATTACK, POSITION.FACEDOWN_DEFENSE));
    expect(proj.value()).toBeNull();
  });

  it('MSG_CHAINING with no zoneId (locationToZoneId returns null) is ignored', () => {
    // HAND-activated cards: locationToZoneId(HAND, ...) returns '' or null.
    // The projection skips the set; activate effect handled by hand element directly.
    proj.applyEvent(chaining(0, LOCATION.HAND, 0));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted(MSG_FLIP_SUMMONING) clears the zone', () => {
    proj.applyEvent(flipSummoning(0, LOCATION.MZONE, 0));
    expect(proj.value()).not.toBeNull();
    proj.applyEvent(animCompleted('MSG_FLIP_SUMMONING'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted(MSG_CHAINING) clears the zone', () => {
    proj.applyEvent(chaining(0, LOCATION.SZONE, 0));
    proj.applyEvent(animCompleted('MSG_CHAINING'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted(MSG_CHANGE_POS) clears the zone', () => {
    proj.applyEvent(changePos(0, LOCATION.MZONE, 0,
      POSITION.FACEDOWN_DEFENSE, POSITION.FACEUP_ATTACK));
    proj.applyEvent(animCompleted('MSG_CHANGE_POS'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted(MSG_MOVE) does NOT clear an active flip', () => {
    proj.applyEvent(flipSummoning(0, LOCATION.MZONE, 0));
    proj.applyEvent(animCompleted('MSG_MOVE'));
    expect(proj.value()).not.toBeNull();
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

  it('player 1 (opponent) maps to relativePlayerIndex 1', () => {
    proj.applyEvent(flipSummoning(1, LOCATION.MZONE, 0));
    expect(proj.value()!.relativePlayerIndex).toBe(1);
  });

  it('applyReset clears the zone', () => {
    proj.applyEvent(flipSummoning(0, LOCATION.MZONE, 0));
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value()).toBeNull();
  });

  it('overwrites previous zone on a new event (back-to-back flips)', () => {
    proj.applyEvent(flipSummoning(0, LOCATION.MZONE, 0));
    const first = proj.value()!.zoneId;
    proj.applyEvent(flipSummoning(0, LOCATION.MZONE, 2));
    const second = proj.value()!.zoneId;
    expect(second).not.toBe(first);
  });
});
