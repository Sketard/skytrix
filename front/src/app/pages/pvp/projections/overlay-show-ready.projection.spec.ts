import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { FluxEvent } from './flux-event';
import { OverlayShowReadyProjection } from './overlay-show-ready.projection';

describe('OverlayShowReadyProjection', () => {
  let proj: OverlayShowReadyProjection;

  beforeEach(() => {
    proj = new OverlayShowReadyProjection();
  });

  function effectReady(chainId: number): FluxEvent {
    return {
      kind: 'deferred', type: 'EffectReady',
      name: `overlay-show:chain-${chainId}`, triggerRef: 1,
    } as unknown as FluxEvent;
  }

  function effectAbandoned(chainId: number, reason: 'timeout' | 'checkpoint'): FluxEvent {
    return {
      kind: 'deferred', type: 'EffectAbandoned',
      name: `overlay-show:chain-${chainId}`, triggerRef: 1, reason,
    } as unknown as FluxEvent;
  }

  function chainEnded(chainId: number): FluxEvent {
    return { kind: 'boundary', type: 'ChainEnded', chainId } as unknown as FluxEvent;
  }

  it('EffectReady("overlay-show:chain-N") → chainId N added to ready set', () => {
    proj.applyEvent(effectReady(1));
    expect(proj.isReady(1)).toBeTrue();
    expect(proj.value().has(1)).toBeTrue();
  });

  it('EffectAbandoned (timeout fallback) ALSO marks the chain as ready', () => {
    // Graceful degradation: a deferred timeout means "stop waiting,
    // just show the overlay" — better UX than a never-showing overlay.
    proj.applyEvent(effectAbandoned(2, 'timeout'));
    expect(proj.isReady(2)).toBeTrue();
  });

  it('EffectAbandoned (checkpoint) ALSO marks the chain as ready', () => {
    proj.applyEvent(effectAbandoned(3, 'checkpoint'));
    expect(proj.isReady(3)).toBeTrue();
  });

  it('ChainEnded(N) removes N from the ready set', () => {
    proj.applyEvent(effectReady(1));
    proj.applyEvent(chainEnded(1));
    expect(proj.isReady(1)).toBeFalse();
  });

  it('ignores deferred events for OTHER families (trigger-show, lp-cost, ...)', () => {
    const otherFamily = {
      kind: 'deferred', type: 'EffectReady',
      name: 'trigger-show:1234:5', triggerRef: 5,
    } as unknown as FluxEvent;
    proj.applyEvent(otherFamily);
    expect(proj.value().size).toBe(0);
  });

  it('ignores MSG_* events (only deferred + boundary families matter)', () => {
    proj.applyEvent({ type: 'MSG_MOVE' } as unknown as FluxEvent);
    proj.applyEvent({ type: 'MSG_DRAW' } as unknown as FluxEvent);
    expect(proj.value().size).toBe(0);
  });

  it('ignores boundary events other than ChainEnded', () => {
    proj.applyEvent({
      kind: 'boundary', type: 'ChainStarted', chainId: 1,
    } as unknown as FluxEvent);
    expect(proj.value().size).toBe(0);
  });

  it('isReady is idempotent — multiple EffectReady on same chainId is a no-op', () => {
    proj.applyEvent(effectReady(1));
    const set1 = proj.value();
    proj.applyEvent(effectReady(1));
    const set2 = proj.value();
    // Identity reuse — the projection should not allocate a new Set if
    // the entry already exists (defensive against excessive signal
    // re-emits in the effect-watcher pattern).
    expect(set2).toBe(set1);
  });

  it('applyReset clears the entire ready set', () => {
    proj.applyEvent(effectReady(1));
    proj.applyEvent(effectReady(2));
    proj.applyReset(new Set(['PERSPECTIVE_LIFETIME']));
    expect(proj.value().size).toBe(0);
  });

  it('survives a malformed name (parseFloat NaN) by ignoring it', () => {
    const malformed = {
      kind: 'deferred', type: 'EffectReady',
      name: 'overlay-show:chain-NOT_A_NUMBER', triggerRef: 1,
    } as unknown as FluxEvent;
    expect(() => proj.applyEvent(malformed)).not.toThrow();
    expect(proj.value().size).toBe(0);
  });

  describe('attachEventStream — full BaseProjection integration', () => {
    let injector: Injector;

    beforeEach(() => {
      TestBed.configureTestingModule({});
      injector = TestBed.inject(Injector);
    });

    it('drains events from an attached stream in order', () => {
      const _transport_stream = signal<readonly FluxEvent[]>([]);
      runInInjectionContext(injector, () => {
        proj.attachEventStream(_transport_stream, injector);
      });

      _transport_stream.set([effectReady(1), effectReady(2)]);
      // Effect runs synchronously on signal write in test context.
      TestBed.flushEffects();

      expect(proj.value().has(1)).toBeTrue();
      expect(proj.value().has(2)).toBeTrue();
    });

    it('handles stream-wipe (length regression) by syncing cursor back', () => {
      const _transport_stream = signal<readonly FluxEvent[]>([]);
      proj.attachEventStream(_transport_stream, injector);

      _transport_stream.set([effectReady(1), effectReady(2)]);
      TestBed.flushEffects();
      expect(proj.value().size).toBe(2);

      // Stream wipe (orchestrator's `_eventStream.set([])` on reset).
      _transport_stream.set([]);
      TestBed.flushEffects();
      // The projection's own applyReset isn't called by the wipe (the
      // dispatcher fires it separately); but the cursor must sync back
      // so the next push restarts from index 0 without skipping events.
      _transport_stream.set([effectReady(3)]);
      TestBed.flushEffects();
      expect(proj.value().has(3)).toBeTrue();
    });

    it('detachEventStream stops draining', () => {
      const _transport_stream = signal<readonly FluxEvent[]>([]);
      proj.attachEventStream(_transport_stream, injector);
      proj.detachEventStream();
      _transport_stream.set([effectReady(1)]);
      TestBed.flushEffects();
      expect(proj.value().size).toBe(0);
    });
  });
});
