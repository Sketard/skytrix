// =============================================================================
// phase-gamma-victory.spec.ts — γ Option C PR2 c7b (2026-05-29)
// -----------------------------------------------------------------------------
// Structural invariants of γ Option C, asserted through the REAL multiplex
// pipeline (DuelConnection + DuelWebSocketService + SoloDuelOrchestratorService
// + AnimationOrchestratorService) wired against a `MockWebSocket` server.
//
// Replaces the c7-era spec which asserted γ invariants against a mocked
// `AnimationOrchestratorService.processor` (vacuous post-c8 : the processor
// is no longer wired via `bindSharedProcessor` — the SOLO multiplex
// `DuelConnection` owns its processor outright). The scenarios that used a
// stub `notifyPerspectiveSwitch` (T0 / T2 of the legacy file) are dropped ;
// the surviving observation surfaces (T1 perspective flip, T9 debounce, R10
// game log re-relativisation, PIPELINE log on prompt-active skip) keep their
// stub-based shape because their assertions never touched the dropped
// `processor` plumbing.
//
// The newcomer T-F6 (chain SOLO multiplex) exercises the cardinal γ invariant
// in unit : the chain state survives a switchPerspective performed mid-chain,
// because there is now ONE processor on ONE connection — not two processors
// + a routing race. See `_bmad-output/planning-artifacts/phase-gamma-option-c-multiplex-spec.md §7.2`.
//
// The Playwright Scenarios A-E + the SOLO reconnect × 2 e2e (T-S13) stay in
// debt → tracked at `_bmad-output/planning-artifacts/gamma-c-playwright-c9-deferred.md`.
// =============================================================================

import { TestBed } from '@angular/core/testing';
import { effect, Injector, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { SoloDuelOrchestratorService } from './solo-duel-orchestrator.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DebugLogService } from './debug-log.service';
import { DuelLogger, DuelLogCategory } from './duel-logger';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelContext } from './duel-context';
import { DuelGameLogService } from './duel-game-log.service';
import { ReducedMotionService } from '../../../services/reduced-motion.service';
import { WebSocketFactoryService } from './websocket-factory.service';
import { createMockWebSocketFactory } from './_test-utils/mock-websocket';
import { SOLO_SWITCH_PLAYER_MS } from './ui-timing-constants';
import { LOCATION, type ChainingMsg, type ChainSolvingMsg, type ChainSolvedMsg, type ChainEndMsg, type SessionTokenMsg, type Player } from '../duel-ws.types';

// ─────────────────────────────────────────────────────────────────────────────
// Stub harness (T1 / T9 / R10 / prompt-guard) — minimal DI, mocks the
// AnimationOrchestratorService + DuelWebSocketService surfaces
// SoloDuelOrchestratorService consumes. Vacuous γ scenarios (T0 / T2) that
// asserted against a stubbed processor are NOT reproduced — see the file
// header banner for why.
// ─────────────────────────────────────────────────────────────────────────────

interface AnimServiceMock {
  notifyPerspectiveSwitch: jasmine.Spy & ((from: 0 | 1, to: 0 | 1) => void);
  // F3 — surfaces read by `canSwitchPerspective`.
  drawManager: { hasDrawsInFlight: boolean };
  isBoardStableForSwitch: boolean;
}

interface WsServiceMock {
  /** c8 — `bindSharedProcessor + bindTransports` collapsed into a single
   *  `bindSoloConnection(conn)` API. */
  bindSoloConnection: jasmine.Spy;
  /** c6a — A21 pair flip from `SoloDuelOrchestratorService.init()`. */
  setSoloMode: jasmine.Spy;
  pendingPrompt: () => unknown;
}

function setupStubHarness(opts: {
  promptActive?: boolean;
  notifyImpl?: (from: 0 | 1, to: 0 | 1) => void;
} = {}): {
  service: SoloDuelOrchestratorService;
  duelCtx: DuelContext;
  animService: AnimServiceMock;
  wsService: WsServiceMock;
  setPrompt: (value: unknown) => void;
  setDrawsInFlight: (value: boolean) => void;
  setBoardStable: (value: boolean) => void;
} {
  // why: spec-local mock signal — feeds wsService.pendingPrompt() stub.
  // Not part of the pipeline state surface; α.1 lint tagging is for prod
  // signals under front/src/app/pages/pvp/, not jasmine mocks.
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  const pendingPromptSignal = signal<unknown>(opts.promptActive ? { type: 'SELECT_CARD' } : null);

  const animService: AnimServiceMock = {
    notifyPerspectiveSwitch: jasmine.createSpy('notifyPerspectiveSwitch')
      .and.callFake(opts.notifyImpl ?? (() => undefined)) as AnimServiceMock['notifyPerspectiveSwitch'],
    // F3 — default: no draw in flight + board stable, so canSwitchPerspective
    // depends only on the prompt guard unless a test sets otherwise.
    drawManager: { hasDrawsInFlight: false },
    isBoardStableForSwitch: true,
  };
  const wsService: WsServiceMock = {
    bindSoloConnection: jasmine.createSpy('bindSoloConnection'),
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
      // why: spec-local stub of ReducedMotionService — Source-tagged in prod.
      // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
      { provide: ReducedMotionService, useValue: { enabled: signal(false) } },
      { provide: AnimationOrchestratorService, useValue: animService },
      { provide: DuelWebSocketService, useValue: wsService },
    ],
  });

  const service = TestBed.inject(SoloDuelOrchestratorService);
  const duelCtx = TestBed.inject(DuelContext);
  // c6a — SOLO multiplex mono-connection. The orchestrator now holds a
  // single `_transport_connection`. The stub is minimal — switch logic
  // no longer touches `setBoardActive` on the incoming connection
  // (A14 removed it ; see solo-duel-orchestrator.service.ts).
  (service as unknown as { _transport_connection: { set: (v: unknown) => void } })
    ._transport_connection.set(makeStubConnection());

  return {
    service,
    duelCtx,
    animService,
    wsService,
    setPrompt: (v: unknown) => pendingPromptSignal.set(v),
    setDrawsInFlight: (v: boolean) => { animService.drawManager.hasDrawsInFlight = v; },
    setBoardStable: (v: boolean) => { animService.isBoardStableForSwitch = v; },
  };
}

function makeStubConnection(): {
  connectionStatus: () => 'connected';
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

// Canonical fixture builders — minimal payload shapes mirroring duel-ws.types
// without dragging the full server module into tests.
function chainingMsg(chainIndex: number, player: 0 | 1, cardCode = 1001): ChainingMsg {
  return {
    type: 'MSG_CHAINING',
    chainIndex,
    player,
    cardCode,
    cardName: `card-${cardCode}`,
    location: LOCATION.MZONE,
    sequence: chainIndex - 1,
    description: 0,
    descriptionText: '',
  } as unknown as ChainingMsg;
}

function chainSolvingMsg(chainIndex: number): ChainSolvingMsg {
  return { type: 'MSG_CHAIN_SOLVING', chainIndex } as unknown as ChainSolvingMsg;
}

function chainSolvedMsg(chainIndex: number): ChainSolvedMsg {
  return { type: 'MSG_CHAIN_SOLVED', chainIndex } as unknown as ChainSolvedMsg;
}

function chainEndMsg(): ChainEndMsg {
  return { type: 'MSG_CHAIN_END' } as unknown as ChainEndMsg;
}

// F18 (2026-05-31) — the localStorage `solo-duel-perspective` cleanup
// that lived here is retired with the underlying mechanism. The
// orchestrator no longer reads or writes that key; persistence is now
// owned by `SoloModeEffectsService` via sessionStorage. The describes
// below do not write sessionStorage either (no `initSolo` running on
// the stub harness), so no per-spec cleanup is needed.

// ─────────────────────────────────────────────────────────────────────────────
// T1 — Switch sans chain : PerspectiveSwitched emitted + DuelContext flipped
// ─────────────────────────────────────────────────────────────────────────────

describe('γ T1 — switch sans chain', () => {
  it('switchPerspective emits PerspectiveSwitched (0 → 1) and flips DuelContext', () => {
    const { service, duelCtx, animService } = setupStubHarness();
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledOnceWith(0, 1);
    expect(duelCtx.perspective()()).toBe(1);
  });

  it('switching 0→1 then 1→0 emits two distinct PerspectiveSwitched events', () => {
    jasmine.clock().install();
    try {
      const { service, duelCtx, animService } = setupStubHarness();
      service.switchPerspective();
      // SOLO_SWITCH_PLAYER_MS debounce — must wait for `_switching` to flip
      // back (F17, 2026-05-31 : was hand-written 300ms aligned on a `.board-host`
      // transform that was never implemented ; now uses the constant).
      jasmine.clock().tick(SWITCH_DEBOUNCE_MS + 1);
      service.switchPerspective();
      expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledTimes(2);
      expect(animService.notifyPerspectiveSwitch.calls.argsFor(0)).toEqual([0, 1]);
      expect(animService.notifyPerspectiveSwitch.calls.argsFor(1)).toEqual([1, 0]);
      expect(duelCtx.perspective()()).toBe(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 — Replay non-regression : moved to the static check script
// `scripts/check-perspective-isolation.mjs`, wired in duel-server's prebuild.
//
// γ post-review M10 (2026-05-28) — the previous Karma-side T7 only asserted
// `expect(adapterModule.ReplayDuelAdapter).toBeDefined()` which proves
// nothing about the actual invariant ("SoloDuelOrchestratorService is the
// SOLE caller of notifyPerspectiveSwitch"). Karma cannot grep the FS ; the
// real check now lives as a Node script grepping every .ts under front/src
// and failing CI fast on a violation.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// T9 — Debounce confirmation : after 300ms, switch re-enabled
// ─────────────────────────────────────────────────────────────────────────────

describe('γ T9 — debounce', () => {
  it('three rapid switchPerspective() calls produce exactly one PerspectiveSwitched', () => {
    const { service, duelCtx, animService } = setupStubHarness();
    service.switchPerspective();
    service.switchPerspective();
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledTimes(1);
    expect(duelCtx.perspective()()).toBe(1);
  });

  it('after the SOLO_SWITCH_PLAYER_MS debounce window, switchPerspective is re-enabled', () => {
    jasmine.clock().install();
    try {
      const { service, animService } = setupStubHarness();
      service.switchPerspective();
      expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledTimes(1);

      // Within debounce — no new emission.
      jasmine.clock().tick(SWITCH_DEBOUNCE_MS - 1);
      service.switchPerspective();
      expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledTimes(1);

      // Cross the boundary.
      jasmine.clock().tick(2);
      service.switchPerspective();
      expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledTimes(2);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R10 — Game Log re-relativises at switch via the duel-page effect
// ─────────────────────────────────────────────────────────────────────────────

describe('γ R10 — DuelGameLogService re-relativises journal on perspective flip', () => {
  it('gameLog.setPerspective(absolute) rebuilds entries from retained events', () => {
    // The duel-page wires this via `effect(() => this.gameLog.setPerspective(this.ownPlayerIndex()))`
    // at duel-page.component.ts:575. `ownPlayerIndex` in SOLO is the SOLO
    // orchestrator's `perspectiveIndex` which is a computed over
    // DuelContext.perspective(). Switching flips perspective → ownPlayerIndex
    // re-evaluates → effect calls setPerspective → builder rebuilds.
    //
    // Here we drive the wiring directly: an effect on a Signal-driven
    // ownPlayerIndex, the same shape the duel-page code uses.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DuelGameLogService,
        DuelLogger,
        DuelContext,
        DuelCardArtService,
        // why: ReducedMotionService stub — DuelContext injects it lazily.
        // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
        { provide: ReducedMotionService, useValue: { enabled: signal(false) } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    const gameLog = TestBed.inject(DuelGameLogService);
    const injector = TestBed.inject(Injector);

    // Seed perspective-aware effect, mirroring duel-page.component.ts:575.
    // why: simulates the duel-page's effect; not pipeline state, exempt.
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    const ownIdx = signal<Player>(0);
    let lastSetTo: number | undefined;
    const setPerspectiveSpy = spyOn(gameLog, 'setPerspective').and.callFake((p: number) => {
      lastSetTo = p;
    });
    effect(() => gameLog.setPerspective(ownIdx()), { injector });

    // First effect tick — initial perspective applied.
    TestBed.tick();
    expect(setPerspectiveSpy).toHaveBeenCalledWith(0);
    expect(lastSetTo).toBe(0);

    // Simulate a γ switch: perspective flips 0 → 1.
    ownIdx.set(1);
    TestBed.tick();
    expect(setPerspectiveSpy).toHaveBeenCalledWith(1);
    expect(lastSetTo).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logging hygiene — switchPerspective skipped + active prompt emits a PIPELINE
// trace, useful to flag in the manual T10 checklist. Asserted here to keep the
// log surface stable.
// ─────────────────────────────────────────────────────────────────────────────

describe('γ — prompt-active guard logs a PIPELINE trace', () => {
  it('switchPerspective with a modal pendingPrompt logs PIPELINE "skipped: prompt active"', () => {
    const { service, animService, setPrompt } = setupStubHarness();
    const logger = TestBed.inject(DuelLogger);
    const logSpy = spyOn(logger, 'log').and.callThrough();

    // SELECT_CARD is a multi-step modal prompt — must block the switch.
    setPrompt({ type: 'SELECT_CARD' });
    service.switchPerspective();

    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
    // The exact format string isn't load-bearing; what matters is a
    // PIPELINE-category log line surfaces. T10 checklist refers to this
    // trace to confirm the no-op was deliberate. A5 (2026-05-31) collapsed
    // the diagnostic into a single reason string carrying ONLY the real
    // blocking causes — here only the modal prompt is the cause.
    expect(logSpy).toHaveBeenCalledWith(
      DuelLogCategory.PIPELINE,
      jasmine.stringContaining('switchPerspective skipped:'),
      'prompt=SELECT_CARD',
    );
  });

  // γ-c c10 (2026-05-29) — whitelist révisée §5.2 POC. SELECT_IDLECMD et
  // SELECT_BATTLECMD sont l'état stable d'attente du joueur actif et ne
  // doivent PAS bloquer le switch, sinon il est interdit tout au long du
  // tour. Pin par test pour éviter une régression silencieuse.
  it('switchPerspective with SELECT_IDLECMD pending IS allowed (whitelist c10)', () => {
    const { service, animService, duelCtx, setPrompt } = setupStubHarness();
    setPrompt({ type: 'SELECT_IDLECMD' });
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledOnceWith(0, 1);
    expect(duelCtx.perspective()()).toBe(1);
  });

  it('switchPerspective with SELECT_BATTLECMD pending IS allowed (whitelist c10)', () => {
    const { service, animService, duelCtx, setPrompt } = setupStubHarness();
    setPrompt({ type: 'SELECT_BATTLECMD' });
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledOnceWith(0, 1);
    expect(duelCtx.perspective()()).toBe(1);
  });

  // (2026-06-02) — SELECT_CHAIN added to whitelist. The chain-building wait
  // state IS the moment a SOLO viewer must be able to switch to answer for
  // the other side (e.g. activate Ash Blossom on opponent's NS-trigger).
  // Bug reproduced: NS Lukias → SELECT_CHAIN(P1) with Ash → button disabled.
  it('switchPerspective with SELECT_CHAIN pending IS allowed (2026-06-02 SOLO chain answer fix)', () => {
    const { service, animService, duelCtx, setPrompt } = setupStubHarness();
    setPrompt({ type: 'SELECT_CHAIN' });
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledOnceWith(0, 1);
    expect(duelCtx.perspective()()).toBe(1);
  });

  // Defence in depth — other prompts NOT in the whitelist still block.
  it('switchPerspective with SELECT_PLACE pending is still blocked', () => {
    const { service, animService, setPrompt } = setupStubHarness();
    setPrompt({ type: 'SELECT_PLACE' });
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// F3 (2026-05-30) — board-stability guard on switchPerspective.
// A switch performed while the animation board is unstable (chain resolving /
// runner animating / draw in flight) orphans the CONNECTION_LIFETIME locks +
// chain state against the swapped board → LOCK_SAFETY_TIMEOUT + POLL-DROP
// (pvp-solo-chain-state-hygiene). `canSwitchPerspective` is the single gate
// shared with the toolbar [disabled]+glow.
// =============================================================================
describe('γ F3 — board-stability guard', () => {
  it('blocks the switch while the board is NOT stable (chain/animation)', () => {
    const { service, animService, setBoardStable } = setupStubHarness();
    setBoardStable(false);
    expect(service.canSwitchPerspective).toBeFalse();
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
  });

  it('blocks the switch while a draw is in flight', () => {
    const { service, animService, setDrawsInFlight } = setupStubHarness();
    setDrawsInFlight(true);
    expect(service.canSwitchPerspective).toBeFalse();
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();
  });

  it('allows the switch once the board is stable again', () => {
    const { service, animService, duelCtx, setBoardStable } = setupStubHarness();
    setBoardStable(false);
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).not.toHaveBeenCalled();

    setBoardStable(true);
    service.switchPerspective();
    expect(animService.notifyPerspectiveSwitch).toHaveBeenCalledOnceWith(0, 1);
    expect(duelCtx.perspective()()).toBe(1);
  });

  it('canSwitchPerspective is false when a modal prompt is active even on a stable board', () => {
    const { service, setPrompt } = setupStubHarness();
    setPrompt({ type: 'SELECT_CARD' });
    expect(service.canSwitchPerspective).toBeFalse();
  });

  it('canSwitchPerspective is true on a stable board with no blocking prompt', () => {
    const { service } = setupStubHarness();
    expect(service.canSwitchPerspective).toBeTrue();
  });
});

// =============================================================================
// T-F6 — chain SOLO multiplex (REAL pipeline)
// -----------------------------------------------------------------------------
// Cardinal γ invariant : a `switchPerspective` performed mid-chain leaves the
// chain state intact, because there is ONE processor on ONE connection. The
// bug-solo-sequence.md "chain orpheline" scenario is now structurally
// impossible : the future WS messages can't end up on a different processor
// (there isn't one). This test feeds the canonical chain frames through a
// `MockWebSocket` plugged into `DuelConnection.openConnection` via the c7a
// `WebSocketFactoryService` override, and asserts :
//   · The chain state is observable on the `DuelConnection.processor` and is
//     consistent across the switch (MSG_CHAINING accumulates ; MSG_CHAIN_END
//     drains).
//   · The `SoloDuelOrchestratorService.switchPerspective` flips `DuelContext`
//     mid-chain without disturbing the active chain links.
// =============================================================================

/** Switch debounce window — pinned to `SOLO_SWITCH_PLAYER_MS` (the constant
 *  used by both `SoloDuelOrchestratorService.switchPerspective`'s setTimeout
 *  and the duel-page component's `switchPlayerWithTransition`). Local alias
 *  kept so a future debounce tweak still fails the test loudly via the
 *  source-of-truth import (cf. EdgeCase F5 c7b BMad review).
 *  F17 (2026-05-31) : was hand-written `300` aligned on a `.board-host`
 *  transform that was never implemented ; now derived from the canonical
 *  constant. */
const SWITCH_DEBOUNCE_MS = SOLO_SWITCH_PLAYER_MS;

describe('γ T-F6 — chain SOLO multiplex (real pipeline)', () => {
  // The SoloDuelOrchestratorService wires the real DuelWebSocketService +
  // real DuelConnection (the system under test) but the AnimationOrchestratorService
  // is mocked — T-F6 observes the chain state via `connection().processor`
  // directly, NOT the animation queue. The orchestrator's only call into the
  // anim service is `notifyPerspectiveSwitch(from, to)` from switchPerspective,
  // so a 2-method stub suffices and avoids dragging in the manager
  // sub-dependencies (LpAnimationTracker, ChainResolutionManager, ...).

  /** Captured for `afterEach` teardown — survives even when an `expect`
   *  throws mid-it, eliminating cross-spec socket leaks (Auditor P2 c7b). */
  let activeOrchestrator: SoloDuelOrchestratorService | null = null;
  let activeSocket: import('./_test-utils/mock-websocket').MockWebSocket | null = null;
  afterEach(() => {
    activeSocket?.fireClose(1000);
    activeOrchestrator?.cleanup();
    activeOrchestrator = null;
    activeSocket = null;
  });

  function configureT_F6TestBed(): { factory: ReturnType<typeof createMockWebSocketFactory> } {
    const factory = createMockWebSocketFactory();
    const animMock = {
      notifyPerspectiveSwitch: jasmine.createSpy('notifyPerspectiveSwitch'),
      // F3 — T-F6 deliberately drives a switch MID-CHAIN to prove the cardinal
      // γ invariant (one processor survives the switch — transport robustness).
      // The F3 user-facing guard (`canSwitchPerspective`) would normally block
      // a mid-chain switch, but T-F6 tests the lower transport layer, so we
      // stub the board as stable + no draw to let the switch through. The two
      // are complementary: the guard stops the USER triggering this, the
      // invariant guarantees nothing desyncs if a switch reaches the processor
      // anyway (reconnect / future edge case).
      drawManager: { hasDrawsInFlight: false },
      isBoardStableForSwitch: true,
    };
    TestBed.configureTestingModule({
      providers: [
        SoloDuelOrchestratorService,
        DuelWebSocketService,
        DuelContext,
        DebugLogService,
        DuelLogger,
        DuelCardArtService,
        DuelGameLogService,
        { provide: AnimationOrchestratorService, useValue: animMock },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
        // why: ReducedMotionService stub — Source-tagged in prod.
        // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
        { provide: ReducedMotionService, useValue: { enabled: signal(false) } },
        { provide: WebSocketFactoryService, useValue: factory },
      ],
    });
    return { factory };
  }

  /** Bootstrap helper — single source of truth for the 3 T-F6 scenarios.
   *  Configures the TestBed, drives `init()` + socket open + SESSION_TOKEN
   *  feed, and stores the orchestrator + socket in `afterEach` slots for
   *  guaranteed teardown even when an `expect` throws (Auditor P2 c7b). */
  function bootstrapSoloPipeline(): {
    orchestrator: SoloDuelOrchestratorService;
    duelCtx: DuelContext;
    wsService: DuelWebSocketService;
    factory: ReturnType<typeof createMockWebSocketFactory>;
    socket: import('./_test-utils/mock-websocket').MockWebSocket;
    conn: NonNullable<ReturnType<SoloDuelOrchestratorService['connection']>>;
    processor: NonNullable<ReturnType<SoloDuelOrchestratorService['connection']>>['processor'];
  } {
    const { factory } = configureT_F6TestBed();
    const orchestrator = TestBed.inject(SoloDuelOrchestratorService);
    const duelCtx = TestBed.inject(DuelContext);
    const wsService = TestBed.inject(DuelWebSocketService);
    orchestrator.init('fake-token-solo');
    const socket = factory.socket!;
    socket.fireOpen();
    socket.feed({ type: 'SESSION_TOKEN', token: 'reconnect-tok' } as SessionTokenMsg);
    const conn = orchestrator.connection()!;
    activeOrchestrator = orchestrator;
    activeSocket = socket;
    return { orchestrator, duelCtx, wsService, factory, socket, conn, processor: conn.processor };
  }

  it('chain accumulates, survives switch, drains on CHAIN_END — single processor', () => {
    const { orchestrator, duelCtx, wsService, factory, socket, conn, processor } = bootstrapSoloPipeline();
    expect(factory.createCount).toBe(1);
    expect(wsService.soloModeSource()).toBeTrue();
    expect(conn.soloMode).toBeTrue();
    expect(conn.connectionStatus()).toBe('connected');

    // 4. Drive the chain through the mock — these are SERVER → CLIENT frames.
    //    Sequence : MSG_CHAINING(chain-1, P0) → switchPerspective() →
    //    MSG_CHAINING(chain-2, P1) → MSG_CHAIN_SOLVING(chain-1) →
    //    MSG_CHAIN_SOLVING(chain-2) → MSG_CHAIN_SOLVED × 2 → MSG_CHAIN_END.

    // -- Chain link 1 : P0 activates a card.
    socket.feed(chainingMsg(1, 0, 5001));
    expect(processor.chainPhase()).toBe('building');
    expect(processor.pendingChainEntry()?.chainIndex).toBe(1);
    expect(processor.activeChainLinks().length).toBe(0);

    // -- Mid-chain switchPerspective — THE cardinal γ moment.
    //    Pre-γ : a switch routed future WS messages to a different processor,
    //    which had never seen chain-1 → MSG_CHAIN_SOLVING(1) emitted a
    //    "chain N not in active links []" warn and the overlay desynced.
    //    Post-γ : there is one processor on one connection ; the switch is
    //    visual-only.
    orchestrator.switchPerspective();
    expect(duelCtx.perspective()()).toBe(1);
    expect(processor.chainPhase()).toBe('building');
    expect(processor.pendingChainEntry()?.chainIndex).toBe(1);

    // -- Chain link 2 : the 2nd MSG_CHAINING commits chain-1 from pending
    //    and sets chain-2 as the new pending.
    socket.feed(chainingMsg(2, 1, 5002));
    expect(processor.activeChainLinks().length).toBe(1);
    expect(processor.activeChainLinks()[0].chainIndex).toBe(1);
    expect(processor.pendingChainEntry()?.chainIndex).toBe(2);

    // -- CHAIN_SOLVING & CHAIN_SOLVED frames advance the resolve state.
    //    MSG_CHAIN_SOLVING(1) commits chain-2 from pending (the
    //    chain transitions from building to first-solve) so both links are
    //    now in activeChainLinks.
    //    NB: `processor.processMessage(MSG_CHAIN_SOLVING)` ENQUEUES the event
    //    but does NOT call `applyChainSolving` — that's the orchestrator's
    //    job (drained from the animation queue). T-F6 mocks the
    //    AnimationOrchestratorService, so the queue is never drained and
    //    `chainPhase` stays at `'building'`. What matters here is that the
    //    links are committed to `activeChainLinks` by `commitPendingChainEntry()`,
    //    which IS synchronous on MSG_CHAIN_SOLVING — that's what proves the
    //    multiplex preserves the chain state across the switch.
    socket.feed(chainSolvingMsg(1));
    expect(processor.activeChainLinks().length).toBe(2);
    expect(processor.activeChainLinks()[0].chainIndex).toBe(1);
    expect(processor.activeChainLinks()[1].chainIndex).toBe(2);
    expect(processor.pendingChainEntry()).toBeNull();

    // -- The remaining MSG_CHAIN_SOLVING/SOLVED/END frames go through the
    //    processor's enqueue path (the orchestrator would normally call
    //    `applyChainSolved` + `applyChainEnd` when dequeuing them ; here we
    //    simulate the dequeue manually since the AnimationOrchestratorService
    //    is mocked).
    socket.feed(chainSolvingMsg(2));
    socket.feed(chainSolvedMsg(1));
    socket.feed(chainSolvedMsg(2));
    socket.feed(chainEndMsg());

    // -- Manually drain the chain state — equivalent to what the
    //    AnimationOrchestratorService runner does when consuming these
    //    events from the animation queue.
    processor.applyChainSolved(1);
    processor.applyChainSolved(2);
    processor.applyChainEnd();
    expect(processor.chainPhase()).toBe('idle');
    expect(processor.activeChainLinks()).toEqual([]);
    expect(processor.pendingChainEntry()).toBeNull();

    // 5. Network-discipline assertions (BMad c7b — Auditor + EdgeCase F2) :
    //    The switchPerspective contract is "visual-only" — γ-c's `init()`
    //    must NOT trigger any client → server frame at the switch boundary,
    //    nor close the live socket. A regression that sends a
    //    PERSPECTIVE_SWITCH frame or invokes `connection.cleanup()` mid-duel
    //    would be caught here without needing the Playwright path.
    expect(socket.sent).toEqual([]);
    expect(socket.closedByProduction).toBeFalse();
  });

  it('a fresh chain in perspective=1 reuses the same processor — proof of single instance', () => {
    // Variant scenario : after the switch, a chain ENTIRELY started in the
    // new perspective still lives on the same processor. Demonstrates the
    // "no second processor exists" property concretely (otherwise the new
    // chain's events would silently desync from the structural state we
    // observe via `connection().processor`).
    const { orchestrator, wsService, socket, processor: processorRefBeforeSwitch } = bootstrapSoloPipeline();

    // Switch with no chain in flight — perspective flips, processor must
    // stay identical-by-reference.
    orchestrator.switchPerspective();
    const processorRefAfterSwitch = orchestrator.connection()!.processor;
    expect(processorRefAfterSwitch).toBe(processorRefBeforeSwitch);
    // BlindHunter P2 c7b — cross-check the wsService projection. If γ-c
    // regresses such that wsService points at a different conn than the
    // orchestrator after the switch, the chain state on the orchestrator
    // side would diverge silently from what wsService projects. `active`
    // is a private wsService accessor (intentional, the source-of-truth
    // is the single signal `_transport_connection`) ; we reach it via
    // bracket access here as a structural defence, not as a contract.
    type WsInternals = { active(): { processor: typeof processorRefBeforeSwitch } };
    const wsInternal = wsService as unknown as WsInternals;
    expect(wsInternal.active().processor).toBe(processorRefBeforeSwitch);

    // Drive a chain in perspective=1.
    socket.feed(chainingMsg(1, 1, 6001));
    expect(processorRefAfterSwitch.chainPhase()).toBe('building');
    expect(processorRefAfterSwitch.pendingChainEntry()?.chainIndex).toBe(1);

    // The CHAIN_END handler is the AnimationOrchestratorService's job
    // (drained from the queue). T-F6 mocks the orchestrator, so we
    // simulate the drain manually to verify the processor state.
    socket.feed(chainEndMsg());
    processorRefAfterSwitch.applyChainEnd();
    expect(processorRefAfterSwitch.chainPhase()).toBe('idle');
  });

  it('MockWebSocket factory is called exactly once during init() (single connection)', () => {
    // T-F5 corollary — pin that γ-c c6a's mono-connection invariant holds
    // observably via the factory call count. If a refactor reintroduces a
    // 2nd `new DuelConnection(...)` in init(), this asserts catches it.
    // The default DuelConnection built in the DuelWebSocketService ctor is
    // CONSTRUCTED (it receives the factory) but its `openConnection()` is
    // NEVER called in SOLO — it's the orphan default that c8 documents,
    // cleaned up by `bindSoloConnection`. Only the SOLO `init()` conn calls
    // `connect()` → `openConnection()` → `factory.create(url)`.
    const { factory, socket } = bootstrapSoloPipeline();
    expect(factory.createCount).toBe(1);
    // BlindHunter P2 c7b — also pin that the default conn (which never
    // ran connect()) hasn't touched the live socket. A future cleanup()
    // refactor that idempotently triggers openConnection() would bump
    // createCount AND mark closedByProduction true on a phantom socket.
    expect(socket.closedByProduction).toBeFalse();
  });

  it('switch in chain `resolving` phase keeps active links + same processor (BlindHunter P1 c7b)', () => {
    // BlindHunter P1 c7b — the cardinal pre-γ bug surfaced when the
    // chainPhase was `'resolving'` (cf. bug-solo-sequence.md). The first
    // T-F6 scenario only exercises `'building'`. This scenario manually
    // drives `applyChainSolving` to push the processor into `'resolving'`,
    // then switches, and asserts the links + phase survive.
    const { orchestrator, socket, processor } = bootstrapSoloPipeline();

    // Build the chain: 2 links committed, then mark chain-1 as resolving.
    socket.feed(chainingMsg(1, 0, 7001));
    socket.feed(chainingMsg(2, 1, 7002));
    socket.feed(chainSolvingMsg(1));
    processor.applyChainSolving(1);  // simulates the orchestrator's queue drain
    expect(processor.chainPhase()).toBe('resolving');
    expect(processor.activeChainLinks().length).toBe(2);
    expect(processor.activeChainLinks()[0].resolving).toBeTrue();

    // The cardinal switch — pre-γ this routed future frames to a different
    // processor whose `chainPhase` was still `'idle'`.
    orchestrator.switchPerspective();
    expect(processor.chainPhase()).toBe('resolving');
    expect(processor.activeChainLinks().length).toBe(2);
    expect(processor.activeChainLinks()[0].resolving).toBeTrue();
    expect(orchestrator.connection()!.processor).toBe(processor);

    // Drain to idle — clean teardown precondition.
    processor.applyChainSolved(1);
    processor.applyChainSolved(2);
    processor.applyChainEnd();
    expect(processor.chainPhase()).toBe('idle');
  });

  it('double switch (0→1→0) mid-chain leaves processor intact (EdgeCase F1 c7b)', () => {
    // EdgeCase F1 c7b — the cardinal γ invariant must hold across MULTIPLE
    // switches within a single chain, not just one. Pre-γ : each switch
    // would have re-routed to a fresh processor ; here all 2 flips land on
    // the same processor and the chain accumulates as expected.
    jasmine.clock().install();
    try {
      const { orchestrator, duelCtx, socket, processor } = bootstrapSoloPipeline();
      socket.feed(chainingMsg(1, 0, 8001));
      expect(processor.pendingChainEntry()?.chainIndex).toBe(1);

      // First switch — guarded by the 300ms debounce.
      orchestrator.switchPerspective();
      expect(duelCtx.perspective()()).toBe(1);
      // Cross the debounce window before flipping back.
      jasmine.clock().tick(SWITCH_DEBOUNCE_MS + 1);
      orchestrator.switchPerspective();
      expect(duelCtx.perspective()()).toBe(0);

      // The processor state survived both flips — link 1 is still pending.
      expect(processor.pendingChainEntry()?.chainIndex).toBe(1);
      expect(processor.chainPhase()).toBe('building');

      // Drain.
      socket.feed(chainEndMsg());
      processor.applyChainEnd();
      expect(processor.chainPhase()).toBe('idle');
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
