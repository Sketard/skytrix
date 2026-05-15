import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';

import { DuelLoadingEffectsService } from './duel-loading-effects.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { RoomStateMachineService } from './room-state-machine.service';
import { DuelCardArtService } from './duel-card-art.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { NotificationService } from '../../../core/services/notification.service';
import type { RoomState } from './room-state-machine.service';

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

class StubHttp {
  get = jasmine.createSpy('get').and.returnValue({ pipe: () => ({ subscribe: () => undefined }) });
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
      { provide: HttpClient, useClass: StubHttp },
      { provide: NotificationService, useClass: StubNotify },
    ],
  });
  const svc = TestBed.inject(DuelLoadingEffectsService);
  const ws = TestBed.inject(DuelWebSocketService) as unknown as StubWs;
  const orch = TestBed.inject(AnimationOrchestratorService) as unknown as StubOrchestrator;
  const room = TestBed.inject(RoomStateMachineService) as unknown as StubRoomService;
  return { svc, ws, orch, room };
}

describe('DuelLoadingEffectsService — duel-loading → active wiring', () => {
  it('drains the pre-activation buffer when duel-loading flips to active', () => {
    const { svc, ws, orch } = setup();
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
  });

  it('orders the side effects: setBoardActive BEFORE drainPreActivationBuffer', () => {
    // The order is load-bearing — the orchestrator's drain re-injects events
    // through `_handleEntry`, which gates on `isBoardActive()`. If the drain
    // ran first, the parked events would be re-parked instantly.
    const { svc, ws, orch } = setup();
    const roomState = signal<RoomState>('duel-loading');
    const boardReady = signal(true);
    const duelLoadingReady = signal(false);
    const thumbnailsReady = signal(false);

    const callOrder: string[] = [];
    ws.setBoardActive.and.callFake(() => callOrder.push('setBoardActive'));
    orch.drainPreActivationBuffer.and.callFake(() => callOrder.push('drain'));

    const injector = TestBed.inject(Injector);
    runInInjectionContext(injector, () => {
      svc.initEffects({ boardReady, duelLoadingReady, roomState, thumbnailsReady });
    });
    TestBed.flushEffects();

    duelLoadingReady.set(true);
    TestBed.flushEffects();

    expect(callOrder).toEqual(['setBoardActive', 'drain']);
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
