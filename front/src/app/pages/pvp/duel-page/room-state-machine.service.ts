import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, interval, Subject, switchMap, takeUntil } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { displaySuccess, displayError } from '../../../core/utilities/functions';
import { RoomDTO, SHARE_TEXT_TEMPLATE } from '../room.types';
import { RoomApiService } from '../room-api.service';
import { AuthService } from '../../../services/auth.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import { DeckPickerDialogComponent } from '../lobby-page/deck-picker-dialog.component';

export type RoomState = 'loading' | 'waiting' | 'creating-duel' | 'connecting' | 'duel-loading' | 'active' | 'error';

/**
 * Encapsulates the room lifecycle: fetch, poll, join (deck-picker dialog),
 * countdown timer, and WS connection hand-off.
 *
 * Provided at component level (NOT root).
 */
@Injectable()
export class RoomStateMachineService {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);
  private readonly dialog = inject(MatDialog);
  private readonly roomApiService = inject(RoomApiService);
  private readonly authService = inject(AuthService);

  // Injected via init() because they are component-scoped
  private wsService!: DuelWebSocketService;
  private tabGuard!: DuelTabGuardService;

  // --- Public signals ---
  readonly roomState = signal<RoomState>('loading');
  readonly room = signal<RoomDTO | null>(null);
  readonly deckName = signal('');

  readonly countdownTick = signal(Date.now());
  readonly countdown = computed(() => {
    this.countdownTick();
    const r = this.room();
    if (!r) return null;
    const expiresAt = new Date(r.createdAt).getTime() + 30 * 60 * 1000;
    const remaining = Math.max(0, expiresAt - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const color = totalSeconds > 60 ? 'green' : totalSeconds > 30 ? 'yellow' : 'red';
    return { display, color, expired: totalSeconds === 0 };
  });

  readonly canShare = typeof navigator !== 'undefined' && !!navigator.share;

  // Room ID for POST /rooms/:id/end on duel end
  roomId: number | null = null;
  decklistId: number | null = null;

  private readonly stopPolling$ = new Subject<void>();
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Must be called once to inject component-scoped services.
   */
  init(config: {
    wsService: DuelWebSocketService;
    tabGuard: DuelTabGuardService;
  }): void {
    this.wsService = config.wsService;
    this.tabGuard = config.tabGuard;
  }

  /** Clean up polling and countdown on destroy. */
  destroy(): void {
    this.stopPolling$.next();
    this.stopCountdown();
  }

  // ---------------------------------------------------------------------------
  // Room fetching
  // ---------------------------------------------------------------------------

  fetchRoom(roomCode: string): void {
    this.roomState.set('loading');
    this.roomApiService.getRoom(roomCode).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: room => {
        this.roomId = room.id;
        this.decklistId = room.decklistId;
        this.room.set(room);
        this.handleRoomStatus(room);
      },
      error: (err: HttpErrorResponse) => {
        const message = err.status === 404
          ? 'Room not found or already ended'
          : 'Unable to reach server';
        displayError(this.snackBar, message);
        this.router.navigate(['/pvp']);
      },
    });
  }

  private handleRoomStatus(room: RoomDTO): void {
    const currentUserId = this.authService.user()?.id;
    const isParticipant = currentUserId === room.player1.id || (room.player2 !== null && currentUserId === room.player2.id);

    switch (room.status) {
      case 'WAITING':
        if (isParticipant) {
          this.roomState.set('waiting');
          this.startPolling(room.roomCode);
        } else {
          this.openDeckPickerForJoin(room.roomCode);
        }
        break;
      case 'CREATING_DUEL':
        this.roomState.set('creating-duel');
        this.startPolling(room.roomCode);
        break;
      case 'ACTIVE':
        this.connectWhenReady(room);
        break;
      case 'ENDED':
        displayError(this.snackBar, 'Room not found or already ended');
        this.router.navigate(['/pvp']);
        break;
      case 'CLOSED':
        displayError(this.snackBar, 'This room has been closed');
        this.router.navigate(['/pvp']);
        break;
    }
  }

  private openDeckPickerForJoin(roomCode: string, attempt = 0): void {
    if (attempt >= 3) {
      displayError(this.snackBar, 'Too many failed attempts');
      this.router.navigate(['/pvp']);
      return;
    }
    const dialogRef = this.dialog.open(DeckPickerDialogComponent);
    dialogRef.afterClosed().pipe(
      switchMap(decklistId => {
        if (decklistId === undefined || decklistId === null) {
          this.router.navigate(['/pvp']);
          return EMPTY;
        }
        this.decklistId = decklistId;
        return this.roomApiService.joinRoom(roomCode, decklistId);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: room => {
        this.room.set(room);
        this.roomId = room.id;
        this.handleRoomStatus(room);
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 409) {
          displayError(this.snackBar, 'Room is full');
          this.router.navigate(['/pvp']);
        } else if (err.status === 422) {
          displayError(this.snackBar, 'Invalid deck, please select another');
          this.openDeckPickerForJoin(roomCode, attempt + 1);
        } else {
          displayError(this.snackBar, 'Failed to join room');
          this.router.navigate(['/pvp']);
        }
      },
    });
  }

  connectWhenReady(room: RoomDTO): void {
    this.roomState.set('connecting');
    if (room.wsToken) {
      this.tabGuard.init(room.roomCode);
      this.tabGuard.broadcast();
      this.wsService.connect(room.wsToken);
    } else {
      displayError(this.snackBar, 'Unable to connect to duel');
      this.router.navigate(['/pvp']);
    }
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private startPolling(roomCode: string): void {
    this.stopPolling$.next();
    let consecutiveErrors = 0;

    interval(3000).pipe(
      takeUntil(this.stopPolling$),
      takeUntilDestroyed(this.destroyRef),
      switchMap(() => this.roomApiService.getRoom(roomCode).pipe(
        catchError(() => {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            this.stopPolling$.next();
            this.roomState.set('error');
          }
          return EMPTY;
        }),
      )),
    ).subscribe(room => {
      consecutiveErrors = 0;
      this.room.set(room);
      if (room.status === 'WAITING') {
        this.roomState.set('waiting');
      } else if (room.status === 'CREATING_DUEL') {
        this.roomState.set('creating-duel');
      } else if (room.status === 'ACTIVE') {
        this.stopPolling$.next();
        this.connectWhenReady(room);
      } else if (room.status === 'ENDED') {
        this.stopPolling$.next();
        displayError(this.snackBar, 'Room not found or already ended');
        this.router.navigate(['/pvp']);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Countdown
  // ---------------------------------------------------------------------------

  startCountdown(): void {
    if (this.countdownInterval) return;
    this.countdownInterval = setInterval(() => this.countdownTick.set(Date.now()), 1000);
  }

  stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Waiting room actions
  // ---------------------------------------------------------------------------

  copyRoomLink(): void {
    const code = this.room()?.roomCode;
    if (!code) return;
    const url = `${window.location.origin}/pvp/duel/${code}`;
    this.clipboard.copy(url);
    displaySuccess(this.snackBar, 'Link copied!', 3000);
  }

  shareRoom(): void {
    const code = this.room()?.roomCode;
    if (!code) return;
    const baseUrl = window.location.origin;
    navigator.share({
      title: 'skytrix PvP Duel',
      text: SHARE_TEXT_TEMPLATE(code, baseUrl),
    }).catch(() => this.copyRoomLink());
  }

  leaveRoom(): void {
    this.stopPolling$.next();
    this.stopCountdown();
    this.router.navigate(['/pvp']);
  }
}
