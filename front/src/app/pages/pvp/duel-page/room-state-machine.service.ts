import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, switchMap, takeUntil, timeout } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { TranslateService } from '@ngx-translate/core';
import { NotificationService } from '../../../core/services/notification.service';
import { RoomDTO } from '../room.types';
import { RoomApiService, type BrowsingUser } from '../room-api.service';
import { AuthService } from '../../../services/auth.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import { DeckPickerDialogComponent, deckPickerDialogConfig } from '../lobby-page/deck-picker-dialog.component';

export type RoomState = 'loading' | 'waiting' | 'ready' | 'creating-duel' | 'connecting' | 'duel-loading' | 'active' | 'error';

/**
 * Encapsulates the room lifecycle: fetch, poll, join (deck-picker dialog),
 * countdown timer, and WS connection hand-off.
 *
 * Provided at component level (NOT root).
 *
 * ## State transition matrix
 *
 * Set by RoomStateMachineService:
 *   loading       ← fetchRoom() entry point
 *   waiting       ← handleRoomStatus(WAITING + isParticipant)
 *   ready         ← handleRoomStatus(READY + isParticipant) — both players
 *                   in the waiting room, creator gets start/kick buttons
 *   creating-duel ← handleRoomStatus(CREATING_DUEL) | startDuel() in-flight
 *   connecting    ← connectWhenReady(room.wsToken)  // also via SSE ready event
 *   error         ← startSseSubscription error fallback
 *
 * Set EXTERNALLY (forceState) — owned by collaborator services:
 *   duel-loading  ← duel-loading-effects.service.ts (post-WS-connect, pre-RPS)
 *   active        ← duel-loading-effects.service.ts | solo-mode-effects.service.ts
 *   connecting    ← duel-page.component.ts (REMATCH_STARTING + reconnect paths)
 *
 * Terminal exits (always via `redirectWithError`):
 *   - HTTP 404 / 5xx on getRoom         → ROOM_NOT_FOUND | DUEL_CONNECT_FAILED
 *   - room.status === ENDED             → ROOM_NOT_FOUND
 *   - room.status === CLOSED            → ROOM_CLOSED
 *   - ACTIVE w/o wsToken                → DUEL_CONNECT_FAILED (M17 fix: SSE arrêtée)
 *   - join 409 (full) / non-422 errors  → ROOM_FULL | ROOM_JOIN_FAILED
 *   - 3 invalid deck attempts           → TOO_MANY_ATTEMPTS
 */
@Injectable()
export class RoomStateMachineService {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notify = inject(NotificationService);
  private readonly translate = inject(TranslateService);
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
  /** Non-participant who has the deck picker open for this room — set on
   *  the `opponent-browsing` SSE event, cleared on `opponent-left-browsing`
   *  or `room-ready`. Drives the waiting screen's "opponent slot" UI. */
  readonly browsingOpponent = signal<BrowsingUser | null>(null);

  readonly countdownTick = signal(Date.now());
  readonly countdown = computed(() => {
    this.countdownTick();
    const r = this.room();
    if (!r) return null;
    const expiresAt = new Date(r.createdAt).getTime() + 30 * 60 * 1000;
    const remaining = Math.max(0, expiresAt - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const display = `${totalSeconds}s`;
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

  forceState(state: RoomState): void {
    this.roomState.set(state);
  }

  /** Clean up polling and countdown on destroy. */
  destroy(): void {
    this.stopPolling$.next();
    this.stopCountdown();
  }

  /**
   * Single terminal exit: stop SSE + countdown, surface a localized error,
   * and route back to lobby. All error paths (HTTP failures, ENDED/CLOSED
   * status, ACTIVE w/o token, deck join errors) funnel through here so
   * cleanup invariants (no zombie SSE, no zombie countdown) are guaranteed.
   */
  private redirectWithError(messageKey: string): void {
    this.stopPolling$.next();
    this.stopCountdown();
    this.notify.error(messageKey);
    this.router.navigate(['/pvp']);
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
        this.redirectWithError(err.status === 404 ? 'error.ROOM_NOT_FOUND' : 'error.DUEL_CONNECT_FAILED');
      },
    });
  }

  /** True when the connected user is the room creator (player1). */
  readonly isCreator = computed(() => {
    const r = this.room();
    const uid = this.authService.user()?.id;
    return !!r && !!uid && r.player1.id === uid;
  });

  /** True when the connected user is the joiner (player2). */
  readonly isJoiner = computed(() => {
    const r = this.room();
    const uid = this.authService.user()?.id;
    return !!r && !!uid && r.player2 !== null && r.player2.id === uid;
  });

  private handleRoomStatus(room: RoomDTO): void {
    const currentUserId = this.authService.user()?.id;
    const isParticipant = currentUserId === room.player1.id || (room.player2 !== null && currentUserId === room.player2.id);

    switch (room.status) {
      case 'WAITING':
        if (isParticipant) {
          this.roomState.set('waiting');
          this.startSseSubscription(room.roomCode);
        } else {
          this.openDeckPickerForJoin(room.roomCode);
        }
        break;
      case 'READY':
        if (isParticipant) {
          // Both players sit in the same waiting room; the UI splits
          // between creator (start/kick buttons) and joiner ("host will
          // start") via isCreator/isJoiner signals.
          this.roomState.set('ready');
          this.startSseSubscription(room.roomCode);
        } else {
          // Non-participant landed on a READY room → it's "full" enough,
          // bounce back to the lobby.
          this.redirectWithError('error.ROOM_FULL');
        }
        break;
      case 'CREATING_DUEL':
        this.roomState.set('creating-duel');
        this.startSseSubscription(room.roomCode);
        break;
      case 'ACTIVE':
        this.connectWhenReady(room);
        break;
      case 'ENDED':
        this.redirectWithError('error.ROOM_NOT_FOUND');
        break;
      case 'CLOSED':
        this.redirectWithError('error.ROOM_CLOSED');
        break;
    }
  }

  private openDeckPickerForJoin(roomCode: string, attempt = 0): void {
    if (attempt >= 3) {
      this.redirectWithError('error.TOO_MANY_ATTEMPTS');
      return;
    }
    // Fire-and-forget: tell the creator their slot just filled with us.
    // Failure is non-fatal (best-effort presence ping).
    this.roomApiService.announceBrowsing(roomCode).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({ error: () => {} });

    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      ...deckPickerDialogConfig(),
      data: { context: 'join' },
    });
    dialogRef.afterClosed().pipe(
      switchMap((result: { id: number; name: string } | undefined) => {
        // DeckPickerDialogComponent.confirm() closes with `{ id, name }` for
        // 'create'/'join' contexts. Passing the raw object to joinRoom (which
        // expects a number) hits the back-end with an unparseable payload and
        // triggers the 500 "Impossible de rejoindre la room" Axel observed
        // on direct-URL deep-links.
        if (!result) {
          // User cancelled the dialog — tell the creator their slot just
          // emptied, then navigate back to the lobby.
          this.roomApiService.announceLeftBrowsing(roomCode).pipe(
            takeUntilDestroyed(this.destroyRef),
          ).subscribe({ error: () => {} });
          this.router.navigate(['/pvp']);
          return EMPTY;
        }
        this.decklistId = result.id;
        this.deckName.set(result.name);
        return this.roomApiService.joinRoom(roomCode, result.id);
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
          this.redirectWithError('error.ROOM_FULL');
        } else if (err.status === 422) {
          // Recoverable: re-open the picker, keep SSE/countdown alive
          this.notify.error('error.INVALID_DECK_SELECT');
          this.openDeckPickerForJoin(roomCode, attempt + 1);
        } else {
          this.redirectWithError('error.ROOM_JOIN_FAILED');
        }
      },
    });
  }

  connectWhenReady(room: RoomDTO): void {
    if (!room.wsToken) {
      // M17 fix: must redirect-with-cleanup BEFORE flipping state, otherwise
      // a still-live SSE could re-deliver ACTIVE and re-trigger this branch.
      this.redirectWithError('error.DUEL_CONNECT_FAILED');
      return;
    }
    // Idempotency guard: startDuel() races the HTTP response and the SSE
    // `room-ready` event — both call this method. A double WS connect
    // kills the first handshake in-flight and surfaces as "connection
    // lost" on the dice screen. Bail if we've already bridged.
    const state = this.roomState();
    if (state === 'connecting' || state === 'duel-loading' || state === 'active') return;
    this.roomState.set('connecting');
    this.tabGuard.init(room.roomCode);
    this.tabGuard.broadcast();
    this.wsService.connect(room.wsToken);
  }

  // ---------------------------------------------------------------------------
  // SSE subscription (replaces polling)
  // ---------------------------------------------------------------------------

  private startSseSubscription(roomCode: string): void {
    this.stopPolling$.next();

    this.roomApiService.subscribeToRoomEvents(roomCode).pipe(
      timeout(5 * 60 * 1000), // 5 min — fallback to GET if SSE never delivers
      takeUntil(this.stopPolling$),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: event => {
        switch (event.kind) {
          case 'browsing':
            this.browsingOpponent.set(event.user);
            break;
          case 'left-browsing':
            this.browsingOpponent.set(null);
            break;
          case 'joined-ready':
            // Joiner picked a deck and is now in the room (creator-side
            // event). Clear the browsing slot, refresh the room DTO so
            // player2 + status=READY surface, and flip to the ready state.
            this.browsingOpponent.set(null);
            this.room.set(event.room);
            this.roomState.set('ready');
            break;
          case 'kicked':
            // Creator booted us. Bounce to /pvp with an error toast —
            // the kicker is the only one who sees the room slide back
            // to WAITING in the lobby.
            this.redirectWithError('error.KICKED_FROM_ROOM');
            break;
          case 'ready':
            // Duel bridge — clear the browsing slot (the room DTO now
            // has the real player2) and bridge to the duel.
            this.browsingOpponent.set(null);
            this.room.set(event.room);
            if (event.room.status === 'ACTIVE') {
              this.connectWhenReady(event.room);
            }
            break;
        }
      },
      error: () => {
        this.roomApiService.getRoom(roomCode).pipe(
          takeUntilDestroyed(this.destroyRef),
        ).subscribe({
          next: room => {
            this.room.set(room);
            this.handleRoomStatus(room);
          },
          error: () => this.roomState.set('error'),
        });
      },
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
    this.notify.success('success.LINK_COPIED', undefined, 3000);
  }

  shareRoom(): void {
    const code = this.room()?.roomCode;
    if (!code) return;
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/pvp/duel/${code}`;
    navigator.share({
      title: 'skytrix PvP Duel',
      text: this.translate.instant('duel.share.text', { roomCode: code, url }),
    }).catch(() => this.copyRoomLink());
  }

  leaveRoom(): void {
    this.stopPolling$.next();
    this.stopCountdown();
    this.router.navigate(['/pvp']);
  }

  // ---------------------------------------------------------------------------
  // Ready-state actions (creator only — UI gates with isCreator())
  // ---------------------------------------------------------------------------

  /**
   * Creator clicks "Lancer la partie" on a READY room. The state flips
   * to `creating-duel` for instant feedback; the existing SSE subscription
   * delivers the `room-ready` event once the duel-server is up and bridges
   * us into the duel (joiner gets their own `room-ready` event in parallel).
   */
  startDuel(): void {
    const code = this.room()?.roomCode;
    if (!code) return;
    this.roomState.set('creating-duel');
    this.roomApiService.startDuel(code).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: room => {
        this.room.set(room);
        // The server has already emitted `room-ready` over SSE by the
        // time this HTTP response lands; the SSE handler will call
        // connectWhenReady. We also fall through here as a safety net
        // in case SSE happens to be slower than the HTTP round-trip.
        if (room.status === 'ACTIVE') {
          this.connectWhenReady(room);
        }
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 503) {
          // Duel server unavailable — back-end rolled the room to
          // WAITING and dropped player2. The creator's next event
          // will be `getRoom` on the next state push; surface a toast
          // and bounce back to waiting.
          this.notify.error('error.DUEL_CONNECT_FAILED');
          this.roomState.set('waiting');
        } else {
          this.redirectWithError('error.DUEL_CONNECT_FAILED');
        }
      },
    });
  }

  /**
   * Creator clicks "Kick" on a READY room. The room flips back to
   * WAITING and resurfaces in the lobby; the joiner receives a `kicked`
   * SSE event and is redirected.
   */
  kickPlayer(): void {
    const code = this.room()?.roomCode;
    if (!code) return;
    this.roomApiService.kickPlayer(code).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        // Optimistic: rebuild the room DTO without player2 and flip
        // ourselves back to waiting. The SSE pipe stays alive so the
        // creator immediately sees a new browsing user if one shows up.
        const current = this.room();
        if (current) {
          this.room.set({ ...current, player2: null, status: 'WAITING' });
        }
        this.browsingOpponent.set(null);
        this.roomState.set('waiting');
      },
      error: () => this.notify.error('error.UNKNOWN'),
    });
  }
}
