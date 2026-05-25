import { signal, type Signal } from '@angular/core';

import { BaseProjection } from './base-projection';
import type { CheckpointPayload } from './checkpoint-payload';
import type { FluxEvent } from './flux-event';
import type { ResetTarget } from './reset-target';
import { ScopeResetDispatcher } from './scope-reset-dispatcher';
import type { ScopeCategory } from './scope';

class TestProjection extends BaseProjection<number> {
  override readonly scope: ScopeCategory;
  readonly resets: Array<{
    scopes: ReadonlySet<ScopeCategory>;
    payload: CheckpointPayload | undefined;
  }> = [];
  private readonly _backing = signal(0);
  override readonly value: Signal<number> = this._backing.asReadonly();

  constructor(scope: ScopeCategory) {
    super();
    this.scope = scope;
  }

  override applyEvent(_event: FluxEvent): void {
    // no-op for these tests
  }

  override applyReset(
    invalidatedScopes: ReadonlySet<ScopeCategory>,
    checkpointPayload?: CheckpointPayload,
  ): void {
    this.resets.push({ scopes: invalidatedScopes, payload: checkpointPayload });
    this._backing.set(0);
  }
}

describe('ScopeResetDispatcher', () => {
  let dispatcher: ScopeResetDispatcher;

  beforeEach(() => {
    dispatcher = new ScopeResetDispatcher();
  });

  it('refuses to register a projection with invalid scope', () => {
    const bad = new TestProjection('NOT_A_SCOPE' as ScopeCategory);
    expect(() => dispatcher.register(bad)).toThrowError(
      /DUEL-ASSERT.*ScopeResetDispatcher.register/,
    );
  });

  it('register is idempotent (set semantics)', () => {
    const p = new TestProjection('PERSPECTIVE_LIFETIME');
    dispatcher.register(p);
    dispatcher.register(p);
    expect(dispatcher.size).toBe(1);
  });

  it('unregister drops the projection (no future dispatch)', () => {
    const p = new TestProjection('PERSPECTIVE_LIFETIME');
    dispatcher.register(p);
    dispatcher.unregister(p);
    dispatcher.dispatch(new Set(['PERSPECTIVE_LIFETIME']));
    expect(p.resets.length).toBe(0);
  });

  it('PERSPECTIVE_LIFETIME reset hits only perspective projections', () => {
    const persp = new TestProjection('PERSPECTIVE_LIFETIME');
    const conn = new TestProjection('CONNECTION_LIFETIME');
    const duel = new TestProjection('DUEL_LIFETIME');
    dispatcher.register(persp);
    dispatcher.register(conn);
    dispatcher.register(duel);

    dispatcher.dispatch(new Set(['PERSPECTIVE_LIFETIME']));

    expect(persp.resets.length).toBe(1);
    expect(conn.resets.length).toBe(0);
    expect(duel.resets.length).toBe(0);
  });

  it('DUEL_LIFETIME reset cascades to CONNECTION + PERSPECTIVE (hierarchy)', () => {
    const persp = new TestProjection('PERSPECTIVE_LIFETIME');
    const conn = new TestProjection('CONNECTION_LIFETIME');
    const duel = new TestProjection('DUEL_LIFETIME');
    const session = new TestProjection('SESSION_LIFETIME');
    dispatcher.register(persp);
    dispatcher.register(conn);
    dispatcher.register(duel);
    dispatcher.register(session);

    dispatcher.dispatch(new Set(['DUEL_LIFETIME']));

    expect(persp.resets.length).toBe(1);
    expect(conn.resets.length).toBe(1);
    expect(duel.resets.length).toBe(1);
    expect(session.resets.length).toBe(0);
  });

  it('passes the expanded scope set to applyReset', () => {
    const p = new TestProjection('PERSPECTIVE_LIFETIME');
    dispatcher.register(p);
    dispatcher.dispatch(new Set(['DUEL_LIFETIME']));
    const passed = p.resets[0].scopes;
    expect(passed.has('DUEL_LIFETIME')).toBeTrue();
    expect(passed.has('CONNECTION_LIFETIME')).toBeTrue();
    expect(passed.has('PERSPECTIVE_LIFETIME')).toBeTrue();
  });

  it('forwards the checkpoint payload', () => {
    const p = new TestProjection('DUEL_LIFETIME');
    dispatcher.register(p);
    const payload: CheckpointPayload = {
      source: 'STATE_SYNC',
      body: { stub: true },
    };
    dispatcher.dispatch(new Set(['DUEL_LIFETIME']), payload);
    expect(p.resets[0].payload).toBe(payload);
  });

  it('omits payload for non-checkpoint resets', () => {
    const p = new TestProjection('PERSPECTIVE_LIFETIME');
    dispatcher.register(p);
    dispatcher.dispatch(new Set(['PERSPECTIVE_LIFETIME']));
    expect(p.resets[0].payload).toBeUndefined();
  });

  it('empty scope set is a no-op (no fan-out)', () => {
    const p = new TestProjection('PERSPECTIVE_LIFETIME');
    dispatcher.register(p);
    dispatcher.dispatch(new Set());
    expect(p.resets.length).toBe(0);
  });

  describe('ResetTarget compatibility (α.4a)', () => {
    // A plain ResetTarget — only `scope` + `applyReset`. No `value`,
    // no `applyEvent`. Models the managers requalified by α.4b.
    class LiteResetTarget implements ResetTarget {
      readonly resets: Array<ReadonlySet<ScopeCategory>> = [];
      constructor(readonly scope: ScopeCategory) {}
      applyReset(scopes: ReadonlySet<ScopeCategory>): void {
        this.resets.push(scopes);
      }
    }

    it('accepts a slim ResetTarget (no value, no applyEvent)', () => {
      const lite = new LiteResetTarget('CONNECTION_LIFETIME');
      dispatcher.register(lite);
      expect(dispatcher.size).toBe(1);
      dispatcher.dispatch(new Set(['DUEL_LIFETIME']));
      expect(lite.resets.length).toBe(1);
    });

    it('still rejects a slim ResetTarget with invalid scope', () => {
      const bad = new LiteResetTarget('NOT_A_SCOPE' as ScopeCategory);
      expect(() => dispatcher.register(bad)).toThrowError(
        /DUEL-ASSERT.*ScopeResetDispatcher.register/,
      );
    });

    it('fans out the same reset to a BaseProjection AND a ResetTarget', () => {
      const proj = new TestProjection('PERSPECTIVE_LIFETIME');
      const lite = new LiteResetTarget('PERSPECTIVE_LIFETIME');
      dispatcher.register(proj);
      dispatcher.register(lite);
      dispatcher.dispatch(new Set(['PERSPECTIVE_LIFETIME']));
      expect(proj.resets.length).toBe(1);
      expect(lite.resets.length).toBe(1);
    });
  });
});
