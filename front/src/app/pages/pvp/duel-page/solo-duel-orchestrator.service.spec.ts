import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { SoloDuelOrchestratorService } from './solo-duel-orchestrator.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DebugLogService } from './debug-log.service';
import { DuelLogger } from './duel-logger';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelContext } from './duel-context';
import { DuelConnection } from './duel-connection';
import { DuelEventProcessor } from './duel-event-processor';
import { ReducedMotionService } from '../../../services/reduced-motion.service';

/**
 * γ Option C — PR2 c6a (2026-05-29) — SOLO multiplex mono-connection.
 *
 * Refactor du spec γ commit 3 : la paire `_connections` disparaît au
 * profit d'une `_transport_connection` singular. Les seedings de
 * connections de test évoluent en conséquence.
 *
 * c6a ajoute aussi 3 invariants spécifiques :
 *   1. Une seule `DuelConnection` créée par `init()`.
 *   2. `wsService.setSoloMode(true)` appelé avant `connect()`.
 *   3. `conn.soloMode = true` flippé en paire avec (2).
 *
 * Les invariants de switch (perspective-only, debounce, prompt-active)
 * restent inchangés et continuent d'être validés ici.
 */
describe('SoloDuelOrchestratorService (γ Option C c6a)', () => {
  let service: SoloDuelOrchestratorService;
  let animService: { processor: DuelEventProcessor; resetForSwitch: jasmine.Spy; notifyPerspectiveSwitch: jasmine.Spy };
  let wsService: {
    bindSharedProcessor: jasmine.Spy;
    bindTransports: jasmine.Spy;
    setSoloMode: jasmine.Spy;
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
      bindSharedProcessor: jasmine.createSpy('bindSharedProcessor'),
      bindTransports: jasmine.createSpy('bindTransports'),
      // c6a A21 — pair flip of soloMode flags from init().
      setSoloMode: jasmine.createSpy('setSoloMode'),
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

  it('exposes perspectiveIndex reading DuelContext.perspective', () => {
    expect(service.perspectiveIndex()).toBe(0);
    duelCtx.setPerspective(1);
    expect(service.perspectiveIndex()).toBe(1);
  });

  it('switchPerspective is no-op when no connection initialised', () => {
    // `init` not called yet — `_transport_connection` signal is `null`.
    service.switchPerspective();
    expect(duelCtx.perspective()()).toBe(0);
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
  });

  it('switchPerspective is no-op while a prompt is active (convention §5.2 POC)', () => {
    pendingPromptSignal.set({ type: 'SELECT_CARD' });
    duelCtx.setPerspective(0);
    seedConnection(service);
    service.switchPerspective();
    expect(duelCtx.perspective()()).toBe(0);
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
  });

  it('switchPerspective flips perspective 0 → 1 and notifies orchestrator', () => {
    seedConnection(service);
    expect(duelCtx.perspective()()).toBe(0);
    service.switchPerspective();
    expect(duelCtx.perspective()()).toBe(1);
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledOnceWith(0, 1);
  });

  it('switchPerspective leaves processor state UNTOUCHED — single source of truth', () => {
    // The cardinal invariant of γ: the processor's chain state survives
    // the switch. Seed a non-trivial state, switch, assert pristine.
    const proc = animService.processor;
    (proc as unknown as { _activeChainLinks: { set: (v: unknown) => void } })
      ._activeChainLinks.set([{ chainIndex: 1, cardCode: 12345, cardName: 'fake', player: 0, zoneId: 'mz1', location: 0, sequence: 0, resolving: false, negated: false }]);
    (proc as unknown as { _chainPhase: { set: (v: 'building') => void } })
      ._chainPhase.set('building');

    seedConnection(service);
    service.switchPerspective();

    expect(proc.activeChainLinks().length).toBe(1);
    expect(proc.activeChainLinks()[0].chainIndex).toBe(1);
    expect(proc.chainPhase()).toBe('building');
  });

  it('switchPerspective debounces consecutive calls (T9 anticipated)', () => {
    seedConnection(service);
    service.switchPerspective(); // 0 → 1
    service.switchPerspective(); // guarded — _switching still true
    service.switchPerspective(); // guarded too
    expect(duelCtx.perspective()()).toBe(1);
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledTimes(1);
  });

  it('connectionLost reads the singular connection (c6a)', () => {
    // No init: signal null → connectionLost false.
    expect(service.connectionLost()).toBeFalse();

    // The stub's `connectionStatus` must be a signal for the orchestrator's
    // `computed(() => conn.connectionStatus() === 'lost')` to invalidate when
    // we flip it. Plain getter would leave the computed stale.
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    const status = signal<'connected' | 'lost'>('connected');
    const stub = { ...makeStubConnection(), connectionStatus: status };
    seedConnection(service, stub as unknown as ReturnType<typeof makeStubConnection>);
    expect(service.connectionLost()).toBeFalse();

    status.set('lost');
    expect(service.connectionLost()).toBeTrue();
  });

  // c6a — Pair-flip invariant (F-BH4 from c5c review).
  // Both flags MUST be set before the WS connect() call so the very first
  // BOARD_STATE arriving in perspective=1 goes through the SOLO swap branch.
  describe('init() — A21 pair flip', () => {
    it('flips wsService.soloMode + conn.soloMode and routes wsService to the conn (c6a)', () => {
      service.init('fake-token-solo');

      expect(wsService.setSoloMode).toHaveBeenCalledOnceWith(true);
      expect(wsService.bindSharedProcessor).toHaveBeenCalledTimes(1);
      expect(wsService.bindTransports).toHaveBeenCalledTimes(1);

      // The two transports passed to bindTransports MUST be the SAME
      // DuelConnection reference (the SOLO mono-connection routed to
      // both perspective slots).
      const [t0, t1] = wsService.bindTransports.calls.mostRecent().args as [unknown, unknown];
      expect(t0).toBe(t1);

      // The connection signal exposes the conn just created ; assert
      // conn.soloMode flipped in the same init() prefix.
      const conn = service.connection();
      expect(conn).toBeTruthy();
      expect(conn!.soloMode).toBeTrue();

      // The shared processor passed to wsService is the same as the
      // conn's own processor (A21 — no separate sharedProcessor).
      expect(wsService.bindSharedProcessor).toHaveBeenCalledOnceWith(conn!.processor);

      // Tear down the open WebSocket the conn spun up (avoid leaks
      // across specs). cleanup() is idempotent.
      service.cleanup();
    });

    // c6a P1 patch (BlindHunter review) — strictement asserter l'ordre
    // pair-flip AVANT connect(). Sans cette assertion, une refacto qui
    // déplace `setSoloMode` après `connect()` passe vert mais ré-introduit
    // le bug visuel "1 frame board non-swappé en perspective=1".
    it('A21 pair flip happens BEFORE conn.connect() — order invariant (c6a)', () => {
      const connectSpy = spyOn(DuelConnection.prototype, 'connect');
      let connSoloModeAtConnectTime: boolean | undefined;
      // Capture `conn.soloMode` value at the moment connect() is called.
      connectSpy.and.callFake(function (this: DuelConnection) {
        connSoloModeAtConnectTime = this.soloMode;
      });

      service.init('fake-token-solo');

      // jasmine `toHaveBeenCalledBefore` — both pair-flip ops must
      // precede connect.
      expect(wsService.setSoloMode).toHaveBeenCalledBefore(connectSpy);
      expect(wsService.bindTransports).toHaveBeenCalledBefore(connectSpy);
      expect(wsService.bindSharedProcessor).toHaveBeenCalledBefore(connectSpy);

      // Snapshot at connect-time of the DuelConnection.soloMode boolean
      // field — must be `true` already (set before connect).
      expect(connSoloModeAtConnectTime).toBeTrue();

      service.cleanup();
    });
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

/** Minimal connection stub for switchPerspective + cleanup wiring (c6a). */
function makeStubConnection(): {
  connectionStatus: () => 'connected' | 'lost';
  setBoardActive: jasmine.Spy;
  clearStorageToken: jasmine.Spy;
  cleanup: jasmine.Spy;
} {
  return {
    connectionStatus: () => 'connected',
    setBoardActive: jasmine.createSpy('setBoardActive'),
    clearStorageToken: jasmine.createSpy('clearStorageToken'),
    cleanup: jasmine.createSpy('cleanup'),
  };
}

/** Inject a stub connection into the singular `_transport_connection`
 *  field — bypasses init() so specs don't open a real WS. c6a refactor:
 *  `_connections` paire → `_transport_connection` singular. */
function seedConnection(
  service: SoloDuelOrchestratorService,
  stub: ReturnType<typeof makeStubConnection> = makeStubConnection(),
): void {
  (service as unknown as { _transport_connection: { set: (v: unknown) => void } })
    ._transport_connection.set(stub);
}
