import { AnimatingLpProjection } from './animating-lp.projection';
import type { FluxEvent } from './flux-event';

describe('AnimatingLpProjection', () => {
  let proj: AnimatingLpProjection;

  beforeEach(() => {
    proj = new AnimatingLpProjection();
  });

  function damage(player: number, amount: number, fromLp = 8000, toLp = fromLp - amount, durationMs = 500): FluxEvent {
    return {
      type: 'MSG_DAMAGE',
      player, amount,
      lpDelta: { fromLp, toLp, durationMs },
    } as unknown as FluxEvent;
  }

  function recover(player: number, amount: number, fromLp = 1000, toLp = fromLp + amount, durationMs = 500): FluxEvent {
    return {
      type: 'MSG_RECOVER',
      player, amount,
      lpDelta: { fromLp, toLp, durationMs },
    } as unknown as FluxEvent;
  }

  function payLp(player: number, amount: number, fromLp = 8000, toLp = fromLp - amount, durationMs = 500): FluxEvent {
    return {
      type: 'MSG_PAY_LPCOST',
      player, amount,
      lpDelta: { fromLp, toLp, durationMs },
    } as unknown as FluxEvent;
  }

  function animCompleted(msgType: string): FluxEvent {
    return { kind: 'animation', type: 'AnimationCompleted', ref: 1, msgType } as unknown as FluxEvent;
  }

  it('MSG_DAMAGE sets damage anim with fromLp/toLp from lpDelta', () => {
    proj.applyEvent(damage(0, 1000, 8000, 7000, 400));
    const v = proj.value();
    expect(v).not.toBeNull();
    expect(v!.player).toBe(0);
    expect(v!.fromLp).toBe(8000);
    expect(v!.toLp).toBe(7000);
    expect(v!.type).toBe('damage');
    expect(v!.durationMs).toBe(400);
  });

  it('MSG_RECOVER sets recover anim', () => {
    proj.applyEvent(recover(1, 500, 1000, 1500, 500));
    const v = proj.value();
    expect(v!.player).toBe(1);
    expect(v!.type).toBe('recover');
    expect(v!.toLp).toBe(1500);
  });

  it('MSG_PAY_LPCOST sets damage anim (cost is visually damage)', () => {
    proj.applyEvent(payLp(0, 2000, 8000, 6000));
    const v = proj.value();
    expect(v!.type).toBe('damage');
    expect(v!.toLp).toBe(6000);
  });

  it('AnimationCompleted(MSG_DAMAGE) clears', () => {
    proj.applyEvent(damage(0, 1000));
    expect(proj.value()).not.toBeNull();
    proj.applyEvent(animCompleted('MSG_DAMAGE'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted(MSG_RECOVER) clears', () => {
    proj.applyEvent(recover(0, 500));
    proj.applyEvent(animCompleted('MSG_RECOVER'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted(MSG_PAY_LPCOST) clears', () => {
    proj.applyEvent(payLp(0, 1000));
    proj.applyEvent(animCompleted('MSG_PAY_LPCOST'));
    expect(proj.value()).toBeNull();
  });

  it('AnimationCompleted(MSG_MOVE) does NOT clear an LP anim', () => {
    proj.applyEvent(damage(0, 1000));
    proj.applyEvent(animCompleted('MSG_MOVE'));
    expect(proj.value()).not.toBeNull();
  });

  it('defensive: MSG_DAMAGE WITHOUT lpDelta is ignored (no crash)', () => {
    const undecorated = { type: 'MSG_DAMAGE', player: 0, amount: 1000 } as unknown as FluxEvent;
    expect(() => proj.applyEvent(undecorated)).not.toThrow();
    expect(proj.value()).toBeNull();
  });

  it('ignores unrelated MSG_* events', () => {
    proj.applyEvent({ type: 'MSG_MOVE' } as unknown as FluxEvent);
    proj.applyEvent({ type: 'MSG_DRAW' } as unknown as FluxEvent);
    expect(proj.value()).toBeNull();
  });

  it('ignores boundary + deferred + transport events', () => {
    proj.applyEvent({ kind: 'boundary', type: 'ChainStarted', chainId: 0 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'deferred', type: 'EffectReady', name: 'x', triggerRef: 1 } as unknown as FluxEvent);
    proj.applyEvent({ kind: 'runner-started', at: 1 } as unknown as FluxEvent);
    expect(proj.value()).toBeNull();
  });

  it('back-to-back damage events overwrite the previous anim', () => {
    proj.applyEvent(damage(0, 1000, 8000, 7000));
    expect(proj.value()!.toLp).toBe(7000);
    proj.applyEvent(damage(1, 500, 8000, 7500));
    expect(proj.value()!.player).toBe(1);
    expect(proj.value()!.toLp).toBe(7500);
  });

  it('applyReset clears the anim', () => {
    proj.applyEvent(damage(0, 1000));
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value()).toBeNull();
  });
});
