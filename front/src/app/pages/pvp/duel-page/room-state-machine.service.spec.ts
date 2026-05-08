import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import { signal } from '@angular/core';

import { RoomStateMachineService } from './room-state-machine.service';
import { RoomApiService } from '../room-api.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import type { RoomDTO } from '../room.types';

function makeRoom(overrides: Partial<RoomDTO> = {}): RoomDTO {
  return {
    id: 1,
    roomCode: 'ABC123',
    status: 'WAITING',
    player1: { id: 100, pseudo: 'p1' },
    player2: null,
    duelId: null,
    wsToken: null,
    decklistId: 10,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('RoomStateMachineService', () => {
  let service: RoomStateMachineService;
  let router: jasmine.SpyObj<Router>;
  let notify: jasmine.SpyObj<NotificationService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let roomApi: jasmine.SpyObj<RoomApiService>;
  let auth: { user: ReturnType<typeof signal<{ id: number } | null>> };
  let wsService: jasmine.SpyObj<DuelWebSocketService>;
  let tabGuard: jasmine.SpyObj<DuelTabGuardService>;
  let sseSubject: Subject<RoomDTO>;

  beforeEach(() => {
    sseSubject = new Subject<RoomDTO>();
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    notify = jasmine.createSpyObj<NotificationService>('NotificationService', ['error', 'success']);
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    roomApi = jasmine.createSpyObj<RoomApiService>('RoomApiService', ['getRoom', 'joinRoom', 'subscribeToRoomEvents']);
    roomApi.subscribeToRoomEvents.and.returnValue(sseSubject.asObservable());
    auth = { user: signal<{ id: number } | null>({ id: 100 }) };
    wsService = jasmine.createSpyObj<DuelWebSocketService>('DuelWebSocketService', ['connect']);
    tabGuard = jasmine.createSpyObj<DuelTabGuardService>('DuelTabGuardService', ['init', 'broadcast']);

    TestBed.configureTestingModule({
      providers: [
        RoomStateMachineService,
        { provide: Router, useValue: router },
        { provide: NotificationService, useValue: notify },
        { provide: MatDialog, useValue: dialog },
        { provide: Clipboard, useValue: { copy: () => true } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: RoomApiService, useValue: roomApi },
        { provide: AuthService, useValue: auth },
      ],
    });

    service = TestBed.inject(RoomStateMachineService);
    service.init({ wsService, tabGuard });
  });

  afterEach(() => {
    service.destroy();
  });

  describe('forceState', () => {
    it('sets the requested state without guards (allows duel-loading-effects + solo-mode-effects callers)', () => {
      service.forceState('connecting');
      expect(service.roomState()).toBe('connecting');
      service.forceState('active');
      expect(service.roomState()).toBe('active');
      service.forceState('duel-loading');
      expect(service.roomState()).toBe('duel-loading');
    });
  });

  describe('fetchRoom — happy paths', () => {
    it('WAITING + participant → state=waiting + opens SSE subscription', () => {
      const room = makeRoom({ status: 'WAITING' });
      roomApi.getRoom.and.returnValue(of(room));

      service.fetchRoom('ABC123');

      expect(service.roomState()).toBe('waiting');
      expect(roomApi.subscribeToRoomEvents).toHaveBeenCalledWith('ABC123');
      expect(service.roomId).toBe(1);
      expect(service.decklistId).toBe(10);
    });

    it('CREATING_DUEL → state=creating-duel + opens SSE subscription', () => {
      const room = makeRoom({ status: 'CREATING_DUEL' });
      roomApi.getRoom.and.returnValue(of(room));

      service.fetchRoom('ABC123');

      expect(service.roomState()).toBe('creating-duel');
      expect(roomApi.subscribeToRoomEvents).toHaveBeenCalled();
    });

    it('ACTIVE + wsToken → state=connecting + wsService.connect + tabGuard init', () => {
      const room = makeRoom({ status: 'ACTIVE', wsToken: 'tok-123' });
      roomApi.getRoom.and.returnValue(of(room));

      service.fetchRoom('ABC123');

      expect(service.roomState()).toBe('connecting');
      expect(tabGuard.init).toHaveBeenCalledWith('ABC123');
      expect(tabGuard.broadcast).toHaveBeenCalled();
      expect(wsService.connect).toHaveBeenCalledWith('tok-123');
    });
  });

  describe('fetchRoom — error paths (shared cleanup invariant)', () => {
    it('404 from getRoom → notify ROOM_NOT_FOUND + navigate /pvp', () => {
      roomApi.getRoom.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

      service.fetchRoom('NOT_FOUND');

      expect(notify.error).toHaveBeenCalledWith('error.ROOM_NOT_FOUND');
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
    });

    it('500 from getRoom → notify DUEL_CONNECT_FAILED + navigate /pvp', () => {
      roomApi.getRoom.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      service.fetchRoom('ABC123');

      expect(notify.error).toHaveBeenCalledWith('error.DUEL_CONNECT_FAILED');
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
    });

    it('ENDED status → notify ROOM_NOT_FOUND + navigate /pvp', () => {
      const room = makeRoom({ status: 'ENDED' });
      roomApi.getRoom.and.returnValue(of(room));

      service.fetchRoom('ABC123');

      expect(notify.error).toHaveBeenCalledWith('error.ROOM_NOT_FOUND');
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
    });

    it('CLOSED status → notify ROOM_CLOSED + navigate /pvp', () => {
      const room = makeRoom({ status: 'CLOSED' });
      roomApi.getRoom.and.returnValue(of(room));

      service.fetchRoom('ABC123');

      expect(notify.error).toHaveBeenCalledWith('error.ROOM_CLOSED');
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
    });

    it('ACTIVE without wsToken → notify DUEL_CONNECT_FAILED + navigate /pvp + arrête la SSE active (M17 bug fix)', () => {
      // Simulate the failure scenario: SSE delivers ACTIVE but wsToken is null.
      const initialRoom = makeRoom({ status: 'CREATING_DUEL' });
      roomApi.getRoom.and.returnValue(of(initialRoom));
      service.fetchRoom('ABC123');
      expect(service.roomState()).toBe('creating-duel');

      // SSE pushes ACTIVE with no wsToken
      const activeRoom = makeRoom({ status: 'ACTIVE', wsToken: null });
      sseSubject.next(activeRoom);

      expect(notify.error).toHaveBeenCalledWith('error.DUEL_CONNECT_FAILED');
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
      expect(wsService.connect).not.toHaveBeenCalled();

      // Bug fix: SSE must be stopped — pushing again must not re-trigger anything
      const ignored = makeRoom({ status: 'ACTIVE', wsToken: 'late-tok' });
      sseSubject.next(ignored);
      expect(wsService.connect).not.toHaveBeenCalled();
    });
  });

  describe('handleRoomStatus — non-participant joining', () => {
    it('WAITING + non-participant → opens deck picker dialog', () => {
      auth.user.set({ id: 999 });
      const room = makeRoom({ status: 'WAITING', player1: { id: 100, pseudo: 'p1' }, player2: null });
      const afterClosed = new Subject<number | null>();
      dialog.open.and.returnValue({ afterClosed: () => afterClosed.asObservable() } as never);
      roomApi.getRoom.and.returnValue(of(room));

      service.fetchRoom('ABC123');

      expect(dialog.open).toHaveBeenCalled();
      // User cancels the dialog
      afterClosed.next(null);
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
    });

    it('non-participant accepts deck → joinRoom → re-runs handleRoomStatus', () => {
      auth.user.set({ id: 999 });
      const initialRoom = makeRoom({ status: 'WAITING', player2: null });
      const joinedRoom = makeRoom({ status: 'CREATING_DUEL', player2: { id: 999, pseudo: 'p2' } });

      const afterClosed = new Subject<number>();
      dialog.open.and.returnValue({ afterClosed: () => afterClosed.asObservable() } as never);
      roomApi.getRoom.and.returnValue(of(initialRoom));
      roomApi.joinRoom.and.returnValue(of(joinedRoom));

      service.fetchRoom('ABC123');
      afterClosed.next(20);

      expect(roomApi.joinRoom).toHaveBeenCalledWith('ABC123', 20);
      expect(service.roomState()).toBe('creating-duel');
      expect(service.decklistId).toBe(20);
    });

    it('joinRoom 409 (full) → notify ROOM_FULL + navigate', () => {
      auth.user.set({ id: 999 });
      const initialRoom = makeRoom({ status: 'WAITING', player2: null });
      const afterClosed = new Subject<number>();
      dialog.open.and.returnValue({ afterClosed: () => afterClosed.asObservable() } as never);
      roomApi.getRoom.and.returnValue(of(initialRoom));
      roomApi.joinRoom.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

      service.fetchRoom('ABC123');
      afterClosed.next(20);

      expect(notify.error).toHaveBeenCalledWith('error.ROOM_FULL');
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
    });
  });

  describe('SSE — ACTIVE delivery transitions to connecting', () => {
    it('ACTIVE event with wsToken → connects', () => {
      const initialRoom = makeRoom({ status: 'WAITING' });
      roomApi.getRoom.and.returnValue(of(initialRoom));
      service.fetchRoom('ABC123');
      expect(service.roomState()).toBe('waiting');

      const activeRoom = makeRoom({ status: 'ACTIVE', wsToken: 'tok-xyz' });
      sseSubject.next(activeRoom);

      expect(service.roomState()).toBe('connecting');
      expect(wsService.connect).toHaveBeenCalledWith('tok-xyz');
    });

    it('SSE error → falls back to GET — error in fallback sets state=error', () => {
      const initialRoom = makeRoom({ status: 'WAITING' });
      roomApi.getRoom.and.returnValue(of(initialRoom));
      service.fetchRoom('ABC123');

      // Now make the fallback GET fail too
      roomApi.getRoom.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      sseSubject.error(new Error('SSE failed'));

      expect(service.roomState()).toBe('error');
    });
  });

  describe('countdown', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('startCountdown is idempotent', () => {
      jasmine.clock().mockDate(new Date(0));
      service.startCountdown();
      jasmine.clock().tick(1500);
      const tick2 = service.countdownTick();
      expect(tick2).toBe(1000);

      // Calling start again should not double the interval (no compounding ticks)
      service.startCountdown();
      jasmine.clock().tick(1000);
      // A second interval would jump from 2000 to 3000 in one tick; idempotent stays at 2000
      expect(service.countdownTick()).toBe(2000);
    });

    it('stopCountdown clears the interval', () => {
      service.startCountdown();
      service.stopCountdown();
      const frozen = service.countdownTick();
      jasmine.clock().tick(2000);
      expect(service.countdownTick()).toBe(frozen);
    });
  });

  describe('leaveRoom', () => {
    it('stops polling + countdown + navigates', () => {
      const initialRoom = makeRoom({ status: 'WAITING' });
      roomApi.getRoom.and.returnValue(of(initialRoom));
      service.fetchRoom('ABC123');
      service.startCountdown();

      service.leaveRoom();

      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
      // SSE arrêtée: subsequent emissions must be no-op
      sseSubject.next(makeRoom({ status: 'ACTIVE', wsToken: 'late' }));
      expect(wsService.connect).not.toHaveBeenCalled();
    });
  });
});
