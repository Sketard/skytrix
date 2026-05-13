import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, filter, interval, Subscription, switchMap } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslatePipe } from '@ngx-translate/core';
import { RelativeTimePipe } from '../../../core/pipes/relative-time.pipe';
import { RoomDTO } from '../room.types';
import { RoomApiService, LobbyEvent } from '../room-api.service';
import { DeckPickerDialogComponent, DeckPickerContext } from './deck-picker-dialog.component';
import { AvatarComponent } from '../../../shared/avatar';
import { RoomCardSkeletonComponent } from '../../../shared/skel';

// Animation flash-in for rooms appearing in the diff (CSS class `room-card--new`
// is removed after this duration so the animation only plays once per room).
const NEW_ROOM_FLASH_MS = 700;

// Polling fallback interval — kicks in if the SSE lobby stream errors out
// permanently. Same cadence as the legacy pre-SSE polling so we don't
// surprise the backend with a different load shape on degradation.
const POLL_FALLBACK_INTERVAL_MS = 10_000;

// Fixed virtual-scroll item size: rendered .room-card height (~88-92px on
// desktop, ~96px on mobile w/ stacked CTA) + 12px row gap. Matches the
// `--room-card-row` SCSS token so the viewport and the cards stay aligned.
// Audit: if the room-card layout grows a new row, bump this AND the token.
const ROOM_CARD_ITEM_SIZE_PX = 104;

@Component({
  selector: 'app-lobby-page',
  templateUrl: './lobby-page.component.html',
  styleUrl: './lobby-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton, MatIcon, MatProgressSpinner,
    ScrollingModule,
    RelativeTimePipe, TranslatePipe,
    AvatarComponent, RoomCardSkeletonComponent,
  ],
})
export class LobbyPageComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly roomApi = inject(RoomApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);

  readonly roomCardItemSize = ROOM_CARD_ITEM_SIZE_PX;
  readonly rooms = signal<RoomDTO[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly joiningRoomCode = signal<string | null>(null);
  readonly creatingRoom = signal(false);
  readonly searchQuery = signal('');

  // True once the SSE `connected` event has fired and the stream stays
  // alive. Flips to false on permanent SSE error → triggers the polling
  // fallback + the "Synchro live indisponible" banner (gated on
  // sseEverConnected so the banner doesn't flash during the cold-start
  // window between ngOnInit and the first SSE `connected` event).
  readonly liveSyncAvailable = signal(false);

  // Latches on the first successful SSE `connected` event so the
  // showLiveSyncBanner computed can distinguish "never connected yet"
  // (cold start — no banner) from "connected then dropped" (banner on).
  private readonly sseEverConnected = signal(false);

  readonly showLiveSyncBanner = computed(() =>
    this.sseEverConnected() && !this.liveSyncAvailable(),
  );

  // Room codes that appeared in the latest diff — used to flash `--new` once.
  // Drained via a setTimeout after NEW_ROOM_FLASH_MS so the flash never replays.
  readonly newRoomCodes = signal<ReadonlySet<string>>(new Set());

  // First fetch suppresses the flash: every room is "new" on init, animating
  // all of them at once would look like a glitch. Real diffs are the only
  // legitimate flash trigger.
  private hasFetchedOnce = false;

  // Holds the polling fallback subscription so we can stop it if SSE
  // reconnects (browser auto-reconnect of EventSource).
  private pollFallbackSubscription: Subscription | null = null;

  readonly filteredRooms = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return this.rooms();
    return this.rooms().filter(r => r.player1.pseudo.toLowerCase().includes(query));
  });

  readonly roomsCount = computed(() => this.filteredRooms().length);

  readonly hasSearchActive = computed(() => this.searchQuery().trim().length > 0);

  readonly showEmptyState = computed(() =>
    !this.loading()
    && !this.error()
    && this.rooms().length === 0,
  );

  readonly showNoResultsState = computed(() =>
    !this.loading()
    && !this.error()
    && this.rooms().length > 0
    && this.filteredRooms().length === 0,
  );

  private readonly dialogConfig = {
    width: 'min(520px, 85dvw)',
    maxHeight: '80dvh',
  };

  ngOnInit(): void {
    // Initial snapshot via REST so the page renders the current state even
    // before SSE delivers anything. SSE then keeps the snapshot in sync
    // through diffs.
    this.fetchRooms();
    this.startLobbyStream();
  }

  fetchRooms(): void {
    this.loading.set(true);
    this.error.set(null);
    this.roomApi.getRooms().subscribe({
      next: rooms => {
        this.applySnapshot(rooms);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        if (this.rooms().length > 0) {
          this.notify.error('error.ROOM_REFRESH_FAILED');
        } else {
          this.error.set('error.ROOM_LOAD_FAILED');
        }
      },
    });
  }

  // Subscribes to the SSE lobby diff stream. On permanent error, falls back
  // to REST polling. EventSource handles transient reconnects natively.
  private startLobbyStream(): void {
    this.roomApi.subscribeToLobbyEvents().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: event => this.applyLobbyEvent(event),
      error: () => {
        this.liveSyncAvailable.set(false);
        this.startPollingFallback();
      },
    });
  }

  private applyLobbyEvent(event: LobbyEvent): void {
    switch (event.kind) {
      case 'connected':
        this.liveSyncAvailable.set(true);
        this.sseEverConnected.set(true);
        this.stopPollingFallback();
        // The first REST snapshot already ran in ngOnInit; we don't refetch
        // here to avoid a double-load. A re-snapshot on reconnect could
        // make sense in a future iteration (recover from missed events
        // during the disconnect window).
        break;
      case 'created':
        this.addRoom(event.room);
        break;
      case 'removed':
        this.rooms.update(list => list.filter(r => r.roomCode !== event.roomCode));
        break;
      case 'updated':
        this.rooms.update(list => list.map(r =>
          r.roomCode === event.room.roomCode ? event.room : r,
        ));
        break;
    }
  }

  private startPollingFallback(): void {
    if (this.pollFallbackSubscription) return;
    this.pollFallbackSubscription = interval(POLL_FALLBACK_INTERVAL_MS).pipe(
      filter(() => this.joiningRoomCode() === null),
      switchMap(() => this.roomApi.getRooms().pipe(
        catchError(() => EMPTY),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(rooms => {
      this.applySnapshot(rooms);
    });
  }

  private stopPollingFallback(): void {
    if (this.pollFallbackSubscription) {
      this.pollFallbackSubscription.unsubscribe();
      this.pollFallbackSubscription = null;
    }
  }

  // Snapshot replacement (REST fetch). Marks rooms newly-appeared since the
  // previous snapshot for the one-shot --new flash animation. On the very
  // first snapshot every room is "new" — we suppress the flash there to
  // avoid the page-load glitch where every card animates at once.
  private applySnapshot(next: readonly RoomDTO[]): void {
    const previousCodes = new Set(this.rooms().map(r => r.roomCode));
    const appearedCodes = new Set<string>();
    if (this.hasFetchedOnce) {
      for (const room of next) {
        if (!previousCodes.has(room.roomCode)) {
          appearedCodes.add(room.roomCode);
        }
      }
    }
    this.hasFetchedOnce = true;
    this.rooms.set([...next]);
    if (appearedCodes.size > 0) this.armNewRoomFlash(appearedCodes);
  }

  // SSE `room-created` diff. Idempotent: ignore if the room is already in
  // the list (defensive — the server shouldn't double-broadcast but a
  // reconnect race could replay an event).
  private addRoom(room: RoomDTO): void {
    if (this.rooms().some(r => r.roomCode === room.roomCode)) return;
    this.rooms.update(list => [room, ...list]);
    if (this.hasFetchedOnce) {
      this.armNewRoomFlash(new Set([room.roomCode]));
    }
  }

  private armNewRoomFlash(appearedCodes: ReadonlySet<string>): void {
    this.newRoomCodes.update(prev => {
      const merged = new Set(prev);
      appearedCodes.forEach(code => merged.add(code));
      return merged;
    });
    setTimeout(() => {
      this.newRoomCodes.update(prev => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        appearedCodes.forEach(code => next.delete(code));
        return next;
      });
    }, NEW_ROOM_FLASH_MS);
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  isNewRoom(roomCode: string): boolean {
    return this.newRoomCodes().has(roomCode);
  }

  trackByRoomCode(_index: number, room: RoomDTO): string {
    return room.roomCode;
  }

  createRoom(): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      ...this.dialogConfig,
      data: { context: 'create' satisfies DeckPickerContext },
    });

    dialogRef.afterClosed().subscribe((result: { id: number; name: string } | undefined) => {
      if (!result) return;
      this.creatingRoom.set(true);
      this.roomApi.createRoom(result.id).subscribe({
        next: room => {
          this.creatingRoom.set(false);
          this.router.navigate(['/pvp/duel', room.roomCode], {
            state: { deckName: result.name },
          });
        },
        error: (err: HttpErrorResponse) => {
          this.creatingRoom.set(false);
          this.notify.error(err.status === 422 ? err : 'error.ROOM_CREATE_FAILED');
        },
      });
    });
  }

  quickDuel(): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      ...this.dialogConfig,
      data: { context: 'quickDuel' satisfies DeckPickerContext },
    });

    dialogRef.afterClosed().subscribe((result: { decklistId1: number; decklistId2: number; firstPlayer: number; skipShuffle: boolean; turnTimeSecs: number } | undefined) => {
      if (!result) return;
      this.creatingRoom.set(true);
      this.roomApi.quickDuel(result.decklistId1, result.decklistId2, result.firstPlayer, result.skipShuffle, result.turnTimeSecs).subscribe({
        next: response => {
          this.creatingRoom.set(false);
          this.router.navigate(['/pvp/duel', response.roomCode], {
            state: { wsToken1: response.wsToken1, wsToken2: response.wsToken2, decklistId: result.decklistId1 },
            queryParams: { solo: 'true' },
          });
        },
        error: (err: HttpErrorResponse) => {
          this.creatingRoom.set(false);
          this.notify.error(err.status === 422 ? err : 'error.QUICK_DUEL_FAILED');
        },
      });
    });
  }

  joinRoom(room: RoomDTO): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      ...this.dialogConfig,
      data: { context: 'join' satisfies DeckPickerContext },
    });

    dialogRef.afterClosed().subscribe((result: { id: number; name: string } | undefined) => {
      if (!result) return;
      this.joiningRoomCode.set(room.roomCode);
      this.roomApi.joinRoom(room.roomCode, result.id).subscribe({
        next: () => {
          this.router.navigate(['/pvp/duel', room.roomCode], {
            state: { deckName: result.name },
          });
        },
        error: (err: HttpErrorResponse) => {
          this.joiningRoomCode.set(null);
          if (err.status === 409) {
            this.notify.error('error.ROOM_FULL');
            this.rooms.update(list => list.filter(r => r.roomCode !== room.roomCode));
          } else if (err.status === 422) {
            this.notify.error(err);
          } else {
            this.notify.error('error.ROOM_JOIN_FAILED');
          }
        },
      });
    });
  }
}
