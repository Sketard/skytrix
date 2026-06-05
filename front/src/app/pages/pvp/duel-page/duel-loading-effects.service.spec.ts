/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. (α.7b.1, 2026-05-25) */

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';

import { DuelLoadingEffectsService } from './duel-loading-effects.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { RoomStateMachineService } from './room-state-machine.service';
import { DuelCardArtService } from './duel-card-art.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { PhaseAnnouncementService } from './phase-announcement.service';
import { NotificationService } from '../../../core/services/notification.service';
import type { RoomState } from './room-state-machine.service';
import { EMPTY_DUEL_STATE } from '../types';

/**
 * Spec for the `duel-loading → active` transition wiring in
 * DuelLoadingEffectsService. The transition is the seam where the
 * pre-activation buffer drains: regressing the order (or omitting the
 * drain entirely) re-introduces the "cartes déjà en main" bug observed
 * 2026-05-15.
 *
 * The other 4 effects in `initEffects` (countdown, expired, →duel-loading,
 * thumbnail prefetch) are not pinned here — their behaviour is already
 * covered by `duel-page.component.spec.ts` C1.1 and downstream specs.
 */

class StubWs {
  setBoardActive = jasmine.createSpy('setBoardActive');
  cardCodes = signal<readonly number[]>([]);
  // F2 review — prefetch trigger uses `earlyDeckPrefetchReceived` so a
  // degraded `cardCodes: []` payload still unblocks the protocol gate.
  earlyDeckPrefetchReceived = signal(false);
  // β.3 cas #13 — DuelLoadingEffects reads logicalState to build the
  // opening DRAW announce (turnPlayer / turnCount). Minimal stub.
  readonly boardStateView = { logicalState: signal(EMPTY_DUEL_STATE) };
  // animations-ready-protocol-2026-06-05 (Direction B) — the service
  // gates ANIMATIONS_READY emission on `thumbnailsReady=true` AND
  // `connectionStatus === 'connected'`. Default 'connected' so the
  // existing tests that don't care about the gate still pass.
  readonly connectionStatus = signal<'connected' | 'reconnecting' | 'lost'>('connected');
  // Rematch trigger — defaults false so existing duel-loading tests
  // are unaffected. The rematch test below flips it.
  readonly rematchStarting = signal(false);
  // F4 review — returns true by default (simulates successful safeSend).
  // Individual tests can override via `.and.returnValue(false)` to model
  // a closed-WS race.
  sendAnimationsReady = jasmine.createSpy('sendAnimationsReady').and.returnValue(true);
}

class StubRoomService {
  readonly countdown = signal<{ expired?: boolean } | null>(null);
  startCountdown = jasmine.createSpy('startCountdown');
  stopCountdown = jasmine.createSpy('stopCountdown');
  leaveRoom = jasmine.createSpy('leaveRoom');
}

class StubArt {
  prefetchCards = jasmine.createSpy('prefetchCards');
  setArtMap = jasmine.createSpy('setArtMap');
}

class StubOrchestrator {
  drainPreActivationBuffer = jasmine.createSpy('drainPreActivationBuffer');
}

class StubPhaseAnnouncement {
  phaseDisplayName = (phase: string): string => `phase:${phase}`;
  show = jasmine.createSpy('show');
}

class StubHttp {
  // The service calls `firstValueFrom(http.get<DeckDTO>(...))` which subscribes
  // and awaits the first emission. A bare `{ subscribe: noop }` would hang.
  // Real Observable.of-like shape: subscribe immediately emits + completes.
  // Tests that set decklistId to null bypass this path entirely (buildArtMap
  // returns new Map() before the http call), but a usable stub keeps the
  // assertion crisp if a future test enables decklistId.
  get = jasmine.createSpy('get').and.returnValue({
    subscribe: (observer: { next: (v: unknown) => void; complete?: () => void } | ((v: unknown) => void)) => {
      const next = typeof observer === 'function' ? observer : observer.next;
      const complete = typeof observer === 'function' ? undefined : observer.complete;
      next({ mainDeck: [], extraDeck: [], sideDeck: [] });
      complete?.();
      return { unsubscribe: () => undefined };
    },
  });
}

class StubNotify {
  error = jasmine.createSpy('error');
  success = jasmine.createSpy('success');
}

function setup() {
  TestBed.configureTestingModule({
    providers: [
      DuelLoadingEffectsService,
      { provide: DuelWebSocketService, useClass: StubWs },
      { provide: RoomStateMachineService, useClass: StubRoomService },
      { provide: DuelCardArtService, useClass: StubArt },
      { provide: AnimationOrchestratorService, useClass: StubOrchestrator },
      { provide: PhaseAnnouncementService, useClass: StubPhaseAnnouncement },
      { provide: HttpClient, useClass: StubHttp },
      { provide: NotificationService, useClass: StubNotify },
    ],
  });
  const svc = TestBed.inject(DuelLoadingEffectsService);
  const ws = TestBed.inject(DuelWebSocketService) as unknown as StubWs;
  const orch = TestBed.inject(AnimationOrchestratorService) as unknown as StubOrchestrator;
  const room = TestBed.inject(RoomStateMachineService) as unknown as StubRoomService;
  const phase = TestBed.inject(PhaseAnnouncementService) as unknown as StubPhaseAnnouncement;
  return { svc, ws, orch, room, phase };
}

describe('DuelLoadingEffectsService — duel-loading → active wiring', () => {
  it('drains the pre-activation buffer when duel-loading flips to active', () => {
    const { svc, ws, orch, phase } = setup();
    const roomState = signal<RoomState>('duel-loading');
    const boardReady = signal(true);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    // Pre-trigger sanity: orchestrator has not been called yet (no flip).
    expect(orch.drainPreActivationBuffer).not.toHaveBeenCalled();

    // Flip the readiness signal — the effect should fire setBoardActive +
    // roomState=active + drainPreActivationBuffer in that order.
    duelLoadingReady.set(true);
    TestBed.flushEffects();

    expect(ws.setBoardActive).toHaveBeenCalledOnceWith(true);
    expect(roomState()).toBe('active');
    expect(orch.drainPreActivationBuffer).toHaveBeenCalledTimes(1);
    // β.3 cas #13 — opening DRAW announce enqueued at the transition.
    expect(phase.show).toHaveBeenCalledTimes(1);
    expect(phase.show.calls.mostRecent().args[2]).toBe('DRAW');
  });

  it('orders the side effects: setBoardActive BEFORE phaseService.show(DRAW) BEFORE drainPreActivationBuffer', () => {
    // The order is load-bearing — the orchestrator's drain re-injects events
    // through `_dispatchEvent`, which gates on `isBoardActive()`. If the drain
    // ran first, the parked events would be re-parked instantly.
    // β.3 cas #13 — the DRAW announce is enqueued BETWEEN setBoardActive
    // (gate open) and the drain (so the directive sits ahead of the MSG_DRAW
    // batch in the animation queue).
    const { svc, ws, orch, phase } = setup();
    const roomState = signal<RoomState>('duel-loading');
    const boardReady = signal(true);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);

    const callOrder: string[] = [];
    ws.setBoardActive.and.callFake(() => callOrder.push('setBoardActive'));
    phase.show.and.callFake(() => callOrder.push('show'));
    orch.drainPreActivationBuffer.and.callFake(() => callOrder.push('drain'));

    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    duelLoadingReady.set(true);
    TestBed.flushEffects();

    expect(callOrder).toEqual(['setBoardActive', 'show', 'drain']);
  });

  it('does not drain when duelLoadingReady=true but roomState !== duel-loading', () => {
    // Defensive: a stale roomState (already active, or jumped back to error)
    // must not re-trigger the drain. The effect guards on both conditions.
    const { svc, orch } = setup();
    const roomState = signal<RoomState>('active');
    const boardReady = signal(true);
    const duelLoadingReady = signal(true);
    const thumbnailsReady = signal(true);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();
    expect(orch.drainPreActivationBuffer).not.toHaveBeenCalled();
  });
});

// =============================================================================
// animations-ready-protocol-2026-06-05 (Direction B) — ANIMATIONS_READY
// emission ownership returned to this service after the Direction A pivot
// was reversed. The service emits when (a) thumbnailsReady=true AND
// (b) connectionStatus === 'connected'. EARLY_DECK_PREFETCH (server-side,
// emitted post-SESSION_PHASE) populates cardCodes early enough to break
// the original deadlock — see service file header comments.
// =============================================================================

describe('DuelLoadingEffectsService — ANIMATIONS_READY emission (Direction B)', () => {
  it('does NOT emit while thumbnailsReady is false', () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();
    expect(ws.sendAnimationsReady).not.toHaveBeenCalled();
  });

  it('does NOT emit while connectionStatus !== "connected" (race against WS handshake)', () => {
    const { svc, ws } = setup();
    ws.connectionStatus.set('reconnecting');
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(true);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();
    expect(ws.sendAnimationsReady).not.toHaveBeenCalled();
  });

  it('emits ANIMATIONS_READY once thumbnailsReady AND connectionStatus="connected"', () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();
    expect(ws.sendAnimationsReady).not.toHaveBeenCalled();

    thumbnailsReady.set(true);
    TestBed.flushEffects();
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a thumbnailsReady oscillation true→false→true does NOT re-emit', () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    thumbnailsReady.set(true);
    TestBed.flushEffects();
    thumbnailsReady.set(false);
    TestBed.flushEffects();
    thumbnailsReady.set(true);
    TestBed.flushEffects();

    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// animations-ready-protocol-2026-06-05 (Direction B) — prefetch trigger
// moved from `roomState === 'duel-loading'` to `cardCodes.length > 0`. The
// previous gate was the circular deadlock root — see service file header.
// =============================================================================

describe('DuelLoadingEffectsService — prefetch trigger (Direction B)', () => {
  it('does NOT start prefetch while cardCodes is empty', () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    // thumbnailsReady has not been set — proof the prefetch never ran.
    expect(thumbnailsReady()).toBeFalse();
    expect(ws.sendAnimationsReady).not.toHaveBeenCalled();
  });

  it('triggers prefetch as soon as EARLY_DECK_PREFETCH is received (NOT gated on roomState)', async () => {
    const { svc, ws } = setup();
    // Critical: roomState stays in 'waiting' the whole time. The pre-
    // Direction-B gate would have blocked the prefetch indefinitely here.
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    // Server sends EARLY_DECK_PREFETCH → cardCodes populates AND the
    // receipt flag flips. We pass a sentinel non-empty list (-1 means no
    // real Image() load — keeps the preFetchCardImages promise
    // lightweight in karma).
    ws.cardCodes.set([-1]);
    ws.earlyDeckPrefetchReceived.set(true);
    TestBed.flushEffects();

    // preFetchCardImages is async — buildArtMap returns Map() (decklistId
    // is null), preloadCardImages with cardCode=-1 immediately settles via
    // onerror. Drain microtasks until `thumbnailsReady.set(true)`.
    await new Promise(resolve => setTimeout(resolve, 50));
    TestBed.flushEffects();

    expect(thumbnailsReady()).toBeTrue();
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);
  });

  it('does not double-trigger prefetch if cardCodes is re-set (idempotent via prefetchStarted)', async () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    ws.cardCodes.set([-1]);
    ws.earlyDeckPrefetchReceived.set(true);
    TestBed.flushEffects();
    ws.cardCodes.set([-1, -2]); // DECK_PREFETCH later in PvP flow
    TestBed.flushEffects();

    await new Promise(resolve => setTimeout(resolve, 50));
    TestBed.flushEffects();

    // Only ONE ANIMATIONS_READY frame even after the re-set.
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);
  });

  // F2 review — degraded EARLY_DECK_PREFETCH with empty cardCodes must
  // NOT wedge the gate. The prefetch effect fires on the receipt flag,
  // preFetchCardImages skips Image preloads (length 0), and
  // thumbnailsReady flips true → ANIMATIONS_READY emits.
  it('still unblocks the gate when EARLY_DECK_PREFETCH ships an empty cardCodes payload', async () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    // Degraded payload : cardCodes stays empty, but the receipt flag
    // still flips.
    ws.earlyDeckPrefetchReceived.set(true);
    TestBed.flushEffects();

    await new Promise(resolve => setTimeout(resolve, 50));
    TestBed.flushEffects();

    expect(thumbnailsReady()).toBeTrue();
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// animations-ready-protocol-2026-06-05 (Direction B) — rematch flow
// =============================================================================

describe('DuelLoadingEffectsService — rematch resets ANIMATIONS_READY (Direction B)', () => {
  it('re-emits ANIMATIONS_READY after REMATCH_STARTING + next thumbnailsReady flip', () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    // First duel: thumbnails flip → ANIMATIONS_READY emitted once.
    thumbnailsReady.set(true);
    TestBed.flushEffects();
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);

    // Rematch fires.
    ws.rematchStarting.set(true);
    TestBed.flushEffects();

    // thumbnailsReady has been reset to false by the rematch effect.
    expect(thumbnailsReady()).toBeFalse();

    // Server re-flips animationsReady=[false,false] + the rematch worker
    // is gated on a fresh ANIMATIONS_READY. The client re-emits as soon
    // as thumbnails are ready again.
    ws.rematchStarting.set(false);
    thumbnailsReady.set(true);
    TestBed.flushEffects();

    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(2);
  });

  // F-rematch fix (harness 2026-06-05) — the prefetch effect tracks
  // `earlyDeckPrefetchReceived` which STAYS true after the first duel.
  // Resetting `prefetchStarted` (a plain field, not a signal) does NOT
  // cause the Angular effect to re-fire. The rematch effect must
  // directly invoke `preFetchCardImages` to flip `thumbnailsReady`
  // back to true, OR the SOLO rematch will deadlock on the "Starting
  // new duel..." overlay forever.
  it('drives prefetch directly at rematch (does NOT rely on earlyDeckPrefetchReceived signal change)', async () => {
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('active');
    const boardReady = signal(true);
    const duelLoadingReady = signal(true);
    const thumbnailsReady = signal(true); // first duel completed — flag is true
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    // Simulate the first duel's prefetch trigger having already run :
    // earlyDeckPrefetchReceived is true (sticky) and ANIMATIONS_READY
    // was sent.
    ws.earlyDeckPrefetchReceived.set(true);
    TestBed.flushEffects();
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);
    expect(thumbnailsReady()).toBeTrue();

    // Rematch — earlyDeckPrefetchReceived STAYS true (server doesn't
    // re-emit EARLY_DECK_PREFETCH on rematch since the WS isn't
    // reconnected). The rematch effect must drive prefetch directly.
    ws.rematchStarting.set(true);
    TestBed.flushEffects();

    // thumbnailsReady reset to false immediately
    expect(thumbnailsReady()).toBeFalse();

    // Drain the prefetch microtasks — preFetchCardImages was called
    // directly by the rematch effect, so thumbnailsReady should flip
    // back to true and ANIMATIONS_READY should re-emit.
    await new Promise(resolve => setTimeout(resolve, 50));
    TestBed.flushEffects();

    expect(thumbnailsReady()).toBeTrue();
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// F4 review — race protection : safeSend drop + reconnect recovery
// =============================================================================

describe('DuelLoadingEffectsService — F4 race protection on emission', () => {
  it('does NOT flag ANIMATIONS_READY as sent if `sendAnimationsReady` returned false (WS dropped between gate check and send)', () => {
    const { svc, ws } = setup();
    // Simulate a WS that closes between the effect's gate check and the
    // actual safeSend call : `sendAnimationsReady` returns false.
    ws.sendAnimationsReady.and.returnValue(false);
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    thumbnailsReady.set(true);
    TestBed.flushEffects();

    // First attempt — drop.
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);

    // Reconnect : the connectionStatus reset effect clears the
    // idempotence flag.
    ws.connectionStatus.set('reconnecting');
    TestBed.flushEffects();
    ws.connectionStatus.set('connected');
    TestBed.flushEffects();

    // Now succeeds.
    ws.sendAnimationsReady.and.returnValue(true);
    // Bump thumbnailsReady to retrigger the emission effect (the gate
    // check doesn't fire unless one of its tracked signals changes —
    // `connectionStatus` flipping is sufficient on its own, but a
    // belt-and-braces nudge keeps the test independent of micro-timing).
    thumbnailsReady.set(false);
    thumbnailsReady.set(true);
    TestBed.flushEffects();

    expect(ws.sendAnimationsReady.calls.count()).toBeGreaterThanOrEqual(2);
  });

  it('resets `_animationsReadySent` when connectionStatus drops to "reconnecting"', () => {
    // Even on a successful first send, a subsequent ws drop should
    // clear the flag so the recovery path can re-emit. Server
    // idempotence absorbs the duplicate.
    const { svc, ws } = setup();
    const roomState = signal<RoomState>('waiting');
    const boardReady = signal(false);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);
    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    thumbnailsReady.set(true);
    TestBed.flushEffects();
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(1);

    // Drop → reconnect.
    ws.connectionStatus.set('reconnecting');
    TestBed.flushEffects();
    ws.connectionStatus.set('connected');
    TestBed.flushEffects();
    // Re-trigger the effect's tracked signal.
    thumbnailsReady.set(false);
    thumbnailsReady.set(true);
    TestBed.flushEffects();

    // The reset+re-emit produces a second send.
    expect(ws.sendAnimationsReady).toHaveBeenCalledTimes(2);
  });
});
