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
  // F3 (audit, abcc259f) added `canSwitchPerspective` which reads
  // `drawManager.hasDrawsInFlight` + `isBoardStableForSwitch` on the
  // injected AnimationOrchestratorService. The stub must expose both for
  // any test that calls `switchPerspective` — without them, the guard
  // throws TypeError (`Cannot read property 'hasDrawsInFlight' of
  // undefined`) before the perspective flips and every assertion downstream
  // misses. Defaults mirror `phase-gamma-victory.spec.ts:setupStubHarness`.
  let animService: {
    processor: DuelEventProcessor;
    resetForSwitch: jasmine.Spy;
    notifyPerspectiveSwitch: jasmine.Spy;
    drawManager: { hasDrawsInFlight: boolean };
    isBoardStableForSwitch: boolean;
  };
  let wsService: {
    bindSoloConnection: jasmine.Spy;
    setSoloMode: jasmine.Spy;
    soloModeSource: ReturnType<typeof signal<boolean>>;
    duelResult: ReturnType<typeof signal<unknown>>;
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
      // F3 — default: no draw in flight + board stable, so canSwitchPerspective
      // depends only on the prompt guard unless a test sets otherwise.
      drawManager: { hasDrawsInFlight: false },
      isBoardStableForSwitch: true,
    };
    // c6b A27 — auto-accept rematch guard reads soloModeSource(). Mock
    // stub-signal so tests can drive the SOLO branch on/off without
    // booting the full DuelWebSocketService.
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    const soloModeSourceMock = signal<boolean>(false);
    wsService = {
      // c8 — `bindSharedProcessor` + `bindTransports` collapsed into
      // a single `bindSoloConnection(conn)` call from init().
      bindSoloConnection: jasmine.createSpy('bindSoloConnection'),
      // c6a A21 — pair flip of soloMode flags from init().
      // γ-c cleanup F-2.3 (audit) — the spy must also flip the signal so
      // the prod runtime behavior is mirrored : `wsService.setSoloMode(true)`
      // flips `soloModeSource` which propagates to the `DuelConnection.soloMode`
      // getter (derived from the same signal). Pre-cleanup the spy was a no-op
      // — that was OK then because conn.soloMode was a separate boolean
      // field flipped manually. Post-cleanup the signal IS the single source
      // of truth, so the mock must mirror it.
      setSoloMode: jasmine.createSpy('setSoloMode').and.callFake((value: boolean) => {
        soloModeSourceMock.set(value);
      }),
      soloModeSource: soloModeSourceMock,
      // c6d — DUEL_END clear effect reads duelResult(). Mock stub-signal.
      // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
      duelResult: signal<unknown>(null),
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
    it('flips wsService.soloMode + conn.soloMode and routes wsService to the conn (c6a, c8)', () => {
      service.init('fake-token-solo');

      expect(wsService.setSoloMode).toHaveBeenCalledOnceWith(true);
      // c8 — single `bindSoloConnection(conn)` replaces the legacy
      // `bindSharedProcessor + bindTransports` pair.
      expect(wsService.bindSoloConnection).toHaveBeenCalledTimes(1);

      // The conn passed to bindSoloConnection MUST be the same DuelConnection
      // exposed by `service.connection()` — the wsService swaps its single
      // `_transport_connection` signal to this very ref.
      const conn = service.connection();
      expect(conn).toBeTruthy();
      expect(conn!.soloMode).toBeTrue();
      expect(wsService.bindSoloConnection).toHaveBeenCalledOnceWith(conn!);

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

      // jasmine `toHaveBeenCalledBefore` — pair-flip + wsService bind must
      // precede connect. c8 collapsed bind pair into bindSoloConnection.
      expect(wsService.setSoloMode).toHaveBeenCalledBefore(connectSpy);
      expect(wsService.bindSoloConnection).toHaveBeenCalledBefore(connectSpy);

      // Snapshot at connect-time of the DuelConnection.soloMode boolean
      // field — must be `true` already (set before connect).
      expect(connSoloModeAtConnectTime).toBeTrue();

      service.cleanup();
    });
  });

  // c6b — A27 garde : auto-accept rematch côté front skip en SOLO car
  // le serveur court-circuite la gate "both requested" et n'émet plus
  // d'invitation REMATCH_INVITATION (=> conn.rematchState() ne passe
  // jamais à 'invited' en SOLO). La garde matérialise l'invariant
  // côté front au cas où une régression serveur émettrait à tort.
  describe('setupRematchEffect — A27 auto-accept guard (c6b)', () => {
    it('does NOT call sendRematchRequest when rematchState=invited and SOLO mode is on', async () => {
      spyOn(DuelConnection.prototype, 'connect');
      service.init('fake-token-solo');

      // SOLO multiplex enabled by init() — invariant snapshot.
      expect(wsService.setSoloMode).toHaveBeenCalledOnceWith(true);
      // Mirror the prod runtime: the SOLO orchestrator flips the
      // signal that `setSoloMode` writes to. We flip it directly here
      // because the wsService is mocked and its `setSoloMode` is just
      // a spy — `soloModeSource` stays at its mock default of `false`
      // unless we step in.
      wsService.soloModeSource.set(true);

      const conn = service.connection()!;
      const sendSpy = spyOn(conn, 'sendRematchRequest');

      // Drive rematchState() to 'invited' on the real DuelConnection.
      // The signal is private but we mutate it through its writable
      // backing field for the spec — same pattern as the chain state
      // seeding above.
      (conn as unknown as { _rematchState: { set: (v: 'invited') => void } })
        ._rematchState.set('invited');

      // Flush effect microtask.
      await Promise.resolve();
      TestBed.tick();

      expect(sendSpy).not.toHaveBeenCalled();
      service.cleanup();
    });

    it('DOES call sendRematchRequest when rematchState=invited and SOLO mode is off (PvP normal path safety)', async () => {
      spyOn(DuelConnection.prototype, 'connect');
      service.init('fake-token-solo');

      // Force the soloModeSource off so the guard branch lets the
      // auto-accept through. PvP normal never instantiates this
      // orchestrator (it lives in `SoloDuelOrchestratorService` only),
      // but the guard is a defensive matter-of-fact assertion : when
      // soloModeSource is false, the legacy auto-accept must still fire.
      wsService.soloModeSource.set(false);

      const conn = service.connection()!;
      const sendSpy = spyOn(conn, 'sendRematchRequest');

      (conn as unknown as { _rematchState: { set: (v: 'invited') => void } })
        ._rematchState.set('invited');

      await Promise.resolve();
      TestBed.tick();

      expect(sendSpy).toHaveBeenCalledTimes(1);
      service.cleanup();
    });
  });

  // c6c — A5 perspective persist + restore via localStorage.
  describe('A5 perspective localStorage (c6c + c6d)', () => {
    const KEY = 'solo-duel-perspective';

    beforeEach(() => { try { localStorage.removeItem(KEY); } catch { /* */ } });
    afterEach(() => { try { localStorage.removeItem(KEY); } catch { /* */ } });

    it('switchPerspective persists the NEW perspective value to localStorage', () => {
      seedConnection(service);
      expect(localStorage.getItem(KEY)).toBeNull();

      service.switchPerspective(); // 0 → 1

      expect(localStorage.getItem(KEY)).toBe('1');
    });

    it('init() restores perspective=1 from localStorage when present', () => {
      localStorage.setItem(KEY, '1');
      spyOn(DuelConnection.prototype, 'connect');

      service.init('fake-token-solo');

      expect(duelCtx.perspective()()).toBe(1);
      service.cleanup();
    });

    it('init() ignores invalid stored values (no perspective flip)', () => {
      localStorage.setItem(KEY, 'garbage');
      spyOn(DuelConnection.prototype, 'connect');

      service.init('fake-token-solo');

      expect(duelCtx.perspective()()).toBe(0);
      service.cleanup();
    });

    // c6d — DUEL_END clears the persisted perspective so a new lobby starts fresh.
    it('clears localStorage when wsService.duelResult() flips to non-null (c6d)', async () => {
      localStorage.setItem(KEY, '1');
      spyOn(DuelConnection.prototype, 'connect');

      service.init('fake-token-solo');
      // Re-set after the init's restore consumed it — we want to observe
      // the EFFECT clearing the key, not the restore that read it.
      localStorage.setItem(KEY, '1');
      wsService.duelResult.set({ winner: 0, reason: 'normal' });

      await Promise.resolve();
      TestBed.tick();

      expect(localStorage.getItem(KEY)).toBeNull();
      service.cleanup();
    });

    it('does NOT clear localStorage while duelResult stays null (effect not yet fired)', async () => {
      localStorage.setItem(KEY, '1');
      spyOn(DuelConnection.prototype, 'connect');

      service.init('fake-token-solo');
      localStorage.setItem(KEY, '1');
      // duelResult stays at the default null — effect should NOT clear.
      await Promise.resolve();
      TestBed.tick();

      expect(localStorage.getItem(KEY)).toBe('1');
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
  onPerspectiveSwitched: jasmine.Spy;
} {
  return {
    connectionStatus: () => 'connected',
    setBoardActive: jasmine.createSpy('setBoardActive'),
    clearStorageToken: jasmine.createSpy('clearStorageToken'),
    cleanup: jasmine.createSpy('cleanup'),
    onPerspectiveSwitched: jasmine.createSpy('onPerspectiveSwitched'),
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
