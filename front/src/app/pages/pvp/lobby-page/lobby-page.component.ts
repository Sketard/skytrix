import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../services/auth.service';
import { TranslatePipe } from '@ngx-translate/core';
import { RelativeTimePipe } from '../../../core/pipes/relative-time.pipe';
import { RoomDTO } from '../room.types';
import { RoomApiService } from '../room-api.service';
import { DeckPickerDialogComponent, DeckPickerContext, deckPickerDialogConfig } from './deck-picker-dialog.component';
import { AvatarComponent } from '../../../shared/avatar';
import { RoomCardSkeletonComponent } from '../../../shared/skel';
import { ErrorBannerComponent } from '../../../shared/error-banner';
import { LobbyRoomsStore } from './lobby-rooms-store';

// Fixed virtual-scroll item size: rendered .room-card height (~88-92px on
// desktop, ~96px on mobile w/ stacked CTA) + 12px row gap. Matches the
// `--room-card-row` SCSS token so the viewport and the cards stay aligned.
// Audit: if the room-card layout grows a new row, bump this AND the token.
const ROOM_CARD_ITEM_SIZE_PX = 104;

export type LobbySortMode = 'newest' | 'oldest' | 'pseudoAsc';
const LOBBY_SORT_MODES: readonly LobbySortMode[] = ['newest', 'oldest', 'pseudoAsc'];

@Component({
  selector: 'app-lobby-page',
  templateUrl: './lobby-page.component.html',
  styleUrl: './lobby-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LobbyRoomsStore],
  imports: [
    MatButton, MatIcon, MatProgressSpinner, MatTooltipModule, MatMenuModule,
    ScrollingModule,
    RelativeTimePipe, TranslatePipe,
    AvatarComponent, RoomCardSkeletonComponent, ErrorBannerComponent,
  ],
})
export class LobbyPageComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly roomApi = inject(RoomApiService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  protected readonly store = inject(LobbyRoomsStore);

  readonly isAdmin = computed(() => this.auth.user()?.role === 'ADMIN');
  readonly deletingRoomCode = signal<string | null>(null);
  readonly joiningRoomCode = signal<string | null>(null);
  readonly creatingRoom = signal(false);
  readonly searchQuery = signal('');
  readonly sortMode = signal<LobbySortMode>('newest');
  readonly sortModes = LOBBY_SORT_MODES;
  readonly roomCardItemSize = ROOM_CARD_ITEM_SIZE_PX;

  readonly filteredRooms = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const mode = this.sortMode();
    const rooms = query
      ? this.store.rooms().filter(r => r.player1.pseudo.toLowerCase().includes(query))
      : [...this.store.rooms()];
    switch (mode) {
      case 'newest':
        return rooms.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      case 'oldest':
        return rooms.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      case 'pseudoAsc':
        return rooms.sort((a, b) =>
          a.player1.pseudo.localeCompare(b.player1.pseudo, undefined, { sensitivity: 'base' }));
    }
  });

  readonly sortLabelKey = computed(() => `lobby.sort.${this.sortMode()}`);

  readonly roomsCount = computed(() => this.filteredRooms().length);
  readonly hasSearchActive = computed(() => this.searchQuery().trim().length > 0);

  readonly showEmptyState = computed(() =>
    !this.store.loading() && !this.store.error() && this.store.rooms().length === 0);

  readonly showNoResultsState = computed(() =>
    !this.store.loading() && !this.store.error()
    && this.store.rooms().length > 0 && this.filteredRooms().length === 0);

  ngOnInit(): void {
    this.store.start();
  }

  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  setSortMode(mode: LobbySortMode): void {
    this.sortMode.set(mode);
  }

  trackByRoomCode(_index: number, room: RoomDTO): string {
    return room.roomCode;
  }

  /** Admin-only force-close. Backend emits the SSE `removed` diff once the
   *  room is gone, so we just let the existing diff stream update the UI. */
  adminDeleteRoom(room: RoomDTO, event: MouseEvent): void {
    event.stopPropagation();
    if (this.deletingRoomCode() !== null) return;
    this.deletingRoomCode.set(room.roomCode);
    this.roomApi.adminDeleteRoom(room.roomCode).subscribe({
      next: () => this.deletingRoomCode.set(null),
      error: () => {
        this.deletingRoomCode.set(null);
        this.notify.error('error.ROOM_ADMIN_DELETE_FAILED');
      },
    });
  }

  createRoom(): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      ...deckPickerDialogConfig(),
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
      ...deckPickerDialogConfig(),
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
      ...deckPickerDialogConfig(),
      data: { context: 'join' satisfies DeckPickerContext },
    });

    dialogRef.afterClosed().subscribe((result: { id: number; name: string } | undefined) => {
      if (!result) return;
      this.joiningRoomCode.set(room.roomCode);
      this.store.setSuppressPollFallback(true);
      this.roomApi.joinRoom(room.roomCode, result.id).subscribe({
        next: () => {
          this.router.navigate(['/pvp/duel', room.roomCode], {
            state: { deckName: result.name },
          });
        },
        error: (err: HttpErrorResponse) => {
          this.joiningRoomCode.set(null);
          this.store.setSuppressPollFallback(false);
          if (err.status === 409) {
            this.notify.error('error.ROOM_FULL');
            this.store.removeRoom(room.roomCode);
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
