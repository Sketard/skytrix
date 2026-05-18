import { Injectable, isDevMode, inject } from '@angular/core';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { FloatRegistryService } from './float-registry.service';
import { DuelContext } from './duel-context';
import { DuelLogger, DuelLogCategory } from './duel-logger';

/**
 * Shape of a debug snapshot. Designed to be JSON-serialisable so a user
 * can paste `JSON.stringify(__skytrixDebug.snapshot())` into a bug report
 * and have everything needed to reconstruct the moment.
 *
 * `domZones` is lazy — call it only when investigating DOM layout, since it
 * forces ~50 `getBoundingClientRect` reads. The rest is cheap signal reads.
 */
export interface DebugSnapshot {
  timestamp: number;
  perspective: 0 | 1;
  /** Logical state: post-event, ahead of locks. Read this when diagnosing
   *  whether an event was *received* even if its visual change hasn't landed. */
  logicalState: unknown;
  /** Rendered state: post-lock, what the user actually sees. */
  renderedState: unknown;
  /** Pending animation queue (events + directives). */
  animationQueue: ReadonlyArray<{ kind: string; preview: string }>;
  /** Chain machine state. */
  chain: {
    phase: 'idle' | 'building' | 'resolving';
    activeLinks: unknown;
  };
  /** Active zone locks — keys still ref-counted > 0. */
  locks: string[];
  /** Floats currently in flight (not yet landed). */
  inFlightFloats: ReadonlyArray<{ dstKey: string; cardCode: string }>;
  /** Floats landed but not yet committed (overlay still visible). */
  landedFloats: ReadonlyArray<{ dstKey: string; cardCode: string }>;
  /** Lazy DOM zone rect lookup. Resolve only when needed. */
  domZones: () => Record<string, { x: number; y: number; w: number; h: number }>;
  /** Replay-only: events parked between BOARD_STATE landing and roomState
   *  active (the breathe-beat buffer). Empty in PvP after dice arena. */
  preActivationBuffer: ReadonlyArray<{ type: string }>;
}

/**
 * Dev-only debug surface for the duel page. Provided at the page component
 * level (NOT root) so it inherits the orchestrator's data source + managers.
 *
 * Two ways to consume:
 *   1. From DevTools console: `__skytrixDebug.snapshot()` — sync read, returns
 *      a JSON-serialisable object. Useful at any moment during a stalled
 *      animation: "what's the state right now?".
 *   2. From a Playwright test: `await page.evaluate(() => __skytrixDebug.snapshot())`
 *      after each step. Combined with screenshots, you get a paired
 *      state + visual record per frame of interest.
 *
 * Both bindings are NO-OP in production (`isDevMode() === false`) so the
 * service is dead code in prod bundles. Tree-shaken if not injected.
 */
@Injectable()
export class DuelDebugService {
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly floatRegistry = inject(FloatRegistryService);
  private readonly ctx = inject(DuelContext);
  private readonly logger = inject(DuelLogger, { optional: true });

  /** Optional buffer accessor — set by AnimationOrchestratorService at construction
   *  so the snapshot can include the pre-activation buffer without coupling the
   *  service to the orchestrator's internals. */
  preActivationBufferAccessor: (() => ReadonlyArray<{ type: string }>) | null = null;

  /** Build a snapshot of the current state. Cheap (signal reads); call as
   *  often as needed. The `domZones` field is a getter — calling it forces
   *  ~50 layout reads, so don't invoke it on every animation tick. */
  snapshot(): DebugSnapshot {
    const rbs = this.dataSource.renderedBoardState;
    const queue = this.dataSource.animationQueue();
    return {
      timestamp: Date.now(),
      perspective: this.ctx.ownPlayerIndex() as 0 | 1,
      logicalState: rbs.logicalState(),
      renderedState: rbs.renderedState(),
      animationQueue: queue.map(entry => 'kind' in entry
        ? { kind: entry.kind, preview: this.previewDirective(entry) }
        : { kind: 'event', preview: `${entry.type}` }),
      chain: {
        phase: this.dataSource.chainPhase(),
        activeLinks: this.dataSource.activeChainLinks(),
      },
      locks: rbs.lockedZoneKeys(),
      inFlightFloats: this.floatRegistryDump('inFlight'),
      landedFloats: this.floatRegistryDump('landed'),
      domZones: () => this.dumpDomZones(),
      preActivationBuffer: this.preActivationBufferAccessor?.() ?? [],
    };
  }

  /** Convenience: snapshot + log to console as a single grouped block. */
  dump(): DebugSnapshot {
    const snap = this.snapshot();
    /* eslint-disable no-console */
    console.groupCollapsed(`[skytrix-debug] snapshot @ ${new Date(snap.timestamp).toISOString()} | perspective=${snap.perspective} | qLen=${snap.animationQueue.length} | phase=${snap.chain.phase}`);
    console.log('locks:', snap.locks);
    console.log('queue:', snap.animationQueue);
    console.log('chain:', snap.chain);
    console.log('floats inFlight:', snap.inFlightFloats);
    console.log('floats landed:', snap.landedFloats);
    console.log('preActivationBuffer:', snap.preActivationBuffer);
    console.log('logicalState:', snap.logicalState);
    console.log('renderedState:', snap.renderedState);
    console.groupEnd();
    /* eslint-enable no-console */
    return snap;
  }

  /** Bind the service to `window.__skytrixDebug` so DevTools / Playwright can
   *  reach it. No-op in production. Called once by the duel/replay page at
   *  initialisation. Idempotent — repeated calls overwrite the previous
   *  binding, which is the desired behaviour when navigating between duels. */
  bindToWindow(): void {
    if (!isDevMode()) return;
    const w = window as unknown as { __skytrixDebug?: unknown };
    w.__skytrixDebug = {
      snapshot: () => this.snapshot(),
      dump: () => this.dump(),
      setLogCategories: (cats: DuelLogCategory[]) => this.logger?.setCategories(cats),
      enableAll: () => this.logger?.setCategories([
        DuelLogCategory.QUEUE, DuelLogCategory.MOVE, DuelLogCategory.DRAW,
        DuelLogCategory.CHAIN, DuelLogCategory.SHUFFLE, DuelLogCategory.REPLAY,
        DuelLogCategory.LP, DuelLogCategory.PROC,
        DuelLogCategory.RESOLVE, DuelLogCategory.PIPELINE,
      ]),
      // Useful one-liners for the console:
      help: () => {
        /* eslint-disable no-console */
        console.log([
          'skytrix debug surface:',
          '  __skytrixDebug.snapshot()     — JSON-serialisable state dump',
          '  __skytrixDebug.dump()         — same + grouped console output',
          '  __skytrixDebug.enableAll()    — turn on every log category (incl. RESOLVE + PIPELINE)',
          '  __skytrixDebug.setLogCategories([...]) — fine-grained category set',
        ].join('\n'));
        /* eslint-enable no-console */
      },
    };
  }

  /** Tear down the global binding. Called by the page component's
   *  `ngOnDestroy`. Safe to call without a prior `bindToWindow()`. */
  unbindFromWindow(): void {
    if (!isDevMode()) return;
    const w = window as unknown as { __skytrixDebug?: unknown };
    delete w.__skytrixDebug;
  }

  private previewDirective(entry: { kind: string; events?: unknown[] }): string {
    if (entry.kind === 'group' && Array.isArray(entry.events)) {
      return `group(${entry.events.length})`;
    }
    return entry.kind;
  }

  private floatRegistryDump(which: 'inFlight' | 'landed'): ReadonlyArray<{ dstKey: string; cardCode: string }> {
    if (which === 'inFlight') {
      const byZone = this.floatRegistry.inFlightByZone();
      const out: { dstKey: string; cardCode: string }[] = [];
      for (const [dstKey, els] of byZone) {
        for (const el of els) {
          out.push({ dstKey, cardCode: el.dataset['cardCode'] ?? '?' });
        }
      }
      return out;
    }
    return this.floatRegistry.allLandedFloats().map(el => ({
      dstKey: el.dataset['dstKey'] ?? '?',
      cardCode: el.dataset['cardCode'] ?? '?',
    }));
  }

  private dumpDomZones(): Record<string, { x: number; y: number; w: number; h: number }> {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    document.querySelectorAll<HTMLElement>('[data-zone]').forEach(el => {
      const key = el.getAttribute('data-zone');
      if (!key) return;
      const r = el.getBoundingClientRect();
      // Cards may share a data-zone key under the EMZ master-rule-5 fallback.
      // First-wins by default — readers can re-query DOM directly for full
      // duplicate handling.
      if (!(key in out)) {
        out[key] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      }
    });
    return out;
  }
}
