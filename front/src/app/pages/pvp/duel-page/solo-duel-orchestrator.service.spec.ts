import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { SoloDuelOrchestratorService } from './solo-duel-orchestrator.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DebugLogService } from './debug-log.service';
import { DuelLogger, DuelLogCategory } from './duel-logger';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelContext } from './duel-context';
import { DuelEventProcessor } from './duel-event-processor';
import { ReducedMotionService } from '../../../services/reduced-motion.service';

/**
 * γ commit 3 — `SoloDuelOrchestratorService` refondu : 5 invariants
 * ciblés. La suite complète T0-T10 arrive en commit 7. Ici on garde
 * le périmètre du commit : structure d'init avec sharedProcessor,
 * sémantique switch (perspective-only, pas de processor mutation),
 * gardes (prompt actif, debounce), rematch reset.
 */
describe('SoloDuelOrchestratorService (γ commit 3)', () => {
  let service: SoloDuelOrchestratorService;
  let animService: { processor: DuelEventProcessor; resetForSwitch: jasmine.Spy; notifyPerspectiveSwitch: jasmine.Spy };
  let wsService: {
    bindSharedProcessor: jasmine.Spy;
    bindTransports: jasmine.Spy;
    pendingPrompt: () => unknown;
  };
  let duelCtx: DuelContext;
  let pendingPromptSignal: ReturnType<typeof signal<unknown>>;

  beforeEach(() => {
    // why: spec-local mock signal — feeds wsService.pendingPrompt() stub.
    // Not part of the pipeline state surface; α.1 lint tagging is for prod
    // signals under front/src/app/pages/pvp/, not jasmine mocks.
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    pendingPromptSignal = signal<unknown>(null);
    animService = {
      processor: new DuelEventProcessor(),
      resetForSwitch: jasmine.createSpy('resetForSwitch'),
      notifyPerspectiveSwitch: jasmine.createSpy('notifyPerspectiveSwitch'),
    };
    wsService = {
      // γ commit 4 — `setActiveConnection` removed. SOLO calls
      // `bindSharedProcessor` + `bindTransports` once at init.
      bindSharedProcessor: jasmine.createSpy('bindSharedProcessor'),
      bindTransports: jasmine.createSpy('bindTransports'),
      pendingPrompt: () => pendingPromptSignal(),
    };

    TestBed.configureTestingModule({
      providers: [
        SoloDuelOrchestratorService,
        DuelContext,
        DebugLogService,
        DuelLogger,
        DuelCardArtService,
        { provide: LiveAnnouncer, useValue: { announce: jasmine.createSpy('announce') } },
        // why: spec-local stub of ReducedMotionService. `enabled` is a
        // module-scope Signal in the real service (Source-tagged there);
        // here it's a value-cast stub, exempt from α.1 tagging.
        // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
        { provide: ReducedMotionService, useValue: { enabled: signal(false) } },
        { provide: AnimationOrchestratorService, useValue: animService },
        { provide: DuelWebSocketService, useValue: wsService },
      ],
    });

    service = TestBed.inject(SoloDuelOrchestratorService);
    duelCtx = TestBed.inject(DuelContext);
  });

  it('exposes perspectiveIndex / activePlayerIndex aliases reading DuelContext.perspective', () => {
    expect(service.perspectiveIndex()).toBe(0);
    expect(service.activePlayerIndex()).toBe(0);
    duelCtx.perspective().set(1);
    expect(service.perspectiveIndex()).toBe(1);
    expect(service.activePlayerIndex()).toBe(1);
  });

  it('switchPerspective is no-op when no connections initialised', () => {
    // `init` not called yet — `_connections` signal is `null`.
    service.switchPerspective();
    expect(duelCtx.perspective()()).toBe(0);
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
  });

  it('switchPerspective is no-op while a prompt is active (convention §5.2 POC)', () => {
    pendingPromptSignal.set({ type: 'SELECT_CARD' });
    duelCtx.perspective().set(0);
    // Simulate that init has run by manually seating the connections
    // signal with a stub. We can't call init() here because it would
    // open real WebSockets — the spec verifies the guard logic.
    (service as unknown as { _connections: { set: (v: unknown) => void } })._connections.set([
      makeStubConnection(), makeStubConnection(),
    ]);
    service.switchPerspective();
    expect(duelCtx.perspective()()).toBe(0);
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
  });

  it('switchPerspective flips perspective 0 → 1 and notifies orchestrator', () => {
    (service as unknown as { _connections: { set: (v: unknown) => void } })._connections.set([
      makeStubConnection(), makeStubConnection(),
    ]);
    expect(duelCtx.perspective()()).toBe(0);
    service.switchPerspective();
    expect(duelCtx.perspective()()).toBe(1);
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledOnceWith(0, 1);
  });

  it('switchPerspective leaves processor state UNTOUCHED — single source of truth', () => {
    // The cardinal invariant of γ: the processor's chain state survives
    // the switch. Seed a non-trivial state, switch, assert pristine.
    const proc = animService.processor;
    // Simulate an in-flight chain link state — direct mutation of the
    // internal signal is sufficient for the spec (DuelEventProcessor
    // doesn't expose a public seeder, the chain-state migration of
    // `bug-solo-sequence.md` happens via the WS adapter pipeline).
    (proc as unknown as { _activeChainLinks: { set: (v: unknown) => void } })
      ._activeChainLinks.set([{ chainIndex: 1, cardCode: 12345, cardName: 'fake', player: 0, zoneId: 'mz1', location: 0, sequence: 0, resolving: false, negated: false }]);
    (proc as unknown as { _chainPhase: { set: (v: 'building') => void } })
      ._chainPhase.set('building');

    (service as unknown as { _connections: { set: (v: unknown) => void } })._connections.set([
      makeStubConnection(), makeStubConnection(),
    ]);
    service.switchPerspective();

    expect(proc.activeChainLinks().length).toBe(1);
    expect(proc.activeChainLinks()[0].chainIndex).toBe(1);
    expect(proc.chainPhase()).toBe('building');
  });

  it('switchPerspective debounces consecutive calls (T9 anticipated)', () => {
    (service as unknown as { _connections: { set: (v: unknown) => void } })._connections.set([
      makeStubConnection(), makeStubConnection(),
    ]);
    service.switchPerspective(); // 0 → 1
    service.switchPerspective(); // guarded — _switching still true
    service.switchPerspective(); // guarded too
    expect(duelCtx.perspective()()).toBe(1);
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledTimes(1);
  });

  it('switchPlayer is a back-compat alias of switchPerspective', () => {
    (service as unknown as { _connections: { set: (v: unknown) => void } })._connections.set([
      makeStubConnection(), makeStubConnection(),
    ]);
    service.switchPlayer();
    expect(duelCtx.perspective()()).toBe(1);
  });
});

describe('PerspectiveEvent type guard (γ commit 5)', () => {
  it('isPerspectiveEvent narrows on `kind === "perspective"`', async () => {
    const { isPerspectiveEvent } = await import('../types/perspective-event.types');
    const event = { kind: 'perspective', type: 'PerspectiveSwitched', from: 0, to: 1 } as const;
    expect(isPerspectiveEvent(event)).toBeTrue();
    expect(isPerspectiveEvent({ kind: 'boundary', type: 'ChainStarted', chainId: 1 })).toBeFalse();
    expect(isPerspectiveEvent({ type: 'MSG_MOVE' })).toBeFalse();
    expect(isPerspectiveEvent(null)).toBeFalse();
    expect(isPerspectiveEvent(undefined)).toBeFalse();
  });
});

/** Minimal connection stub for switchPerspective + cleanup wiring. */
function makeStubConnection(): {
  connectionStatus: () => 'connected';
  setBoardActive: jasmine.Spy;
  clearStorageToken: jasmine.Spy;
  cleanup: jasmine.Spy;
} {
  return {
    connectionStatus: () => 'connected',
    setBoardActive: jasmine.createSpy('setBoardActive'),
    // destroyRef.onDestroy → service.cleanup() walks the connections.
    clearStorageToken: jasmine.createSpy('clearStorageToken'),
    cleanup: jasmine.createSpy('cleanup'),
  };
}
