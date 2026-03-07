import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, filter, interval, switchMap } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { displayError, relativeTime } from '../../../core/utilities/functions';
import { environment } from '../../../../environments/environment';
import { RoomDTO } from '../room.types';
import { RoomApiService } from '../room-api.service';
import { DeckPickerDialogComponent } from './deck-picker-dialog.component';

@Component({
  selector: 'app-lobby-page',
  templateUrl: './lobby-page.component.html',
  styleUrl: './lobby-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIconButton, MatIcon, MatProgressSpinner],
})
export class LobbyPageComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly roomApi = inject(RoomApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly rooms = signal<RoomDTO[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly joiningRoomCode = signal<string | null>(null);
  readonly creatingRoom = signal(false);
  readonly isProduction = environment.production;

  ngOnInit(): void {
    this.fetchRooms();
    this.startPolling();
  }

  fetchRooms(): void {
    this.loading.set(true);
    this.error.set(null);
    this.roomApi.getRooms().subscribe({
      next: rooms => {
        this.rooms.set(rooms);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        if (this.rooms().length > 0) {
          displayError(this.snackBar, 'Failed to refresh rooms');
        } else {
          this.error.set('Failed to load rooms');
        }
      },
    });
  }

  private startPolling(): void {
    interval(10000).pipe(
      filter(() => this.joiningRoomCode() === null),
      switchMap(() => this.roomApi.getRooms().pipe(
        catchError(() => EMPTY),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(rooms => {
      this.rooms.set(rooms);
    });
  }

  createRoom(): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      width: '340px',
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
          if (err.status === 422) {
            const reason = err.error?.message ?? err.error?.error ?? 'Deck validation failed';
            displayError(this.snackBar, reason);
          } else {
            displayError(this.snackBar, 'Failed to create room');
          }
        },
      });
    });
  }

  quickDuel(): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      width: '340px',
      data: { quickDuel: true },
    });

    dialogRef.afterClosed().subscribe((result: { decklistId1: number; decklistId2: number; firstPlayer: number } | undefined) => {
      if (!result) return;
      this.creatingRoom.set(true);
      this.roomApi.quickDuel(result.decklistId1, result.decklistId2, result.firstPlayer).subscribe({
        next: response => {
          this.creatingRoom.set(false);
          this.router.navigate(['/pvp/duel', response.roomCode], {
            state: { wsToken1: response.wsToken1, wsToken2: response.wsToken2 },
            queryParams: { solo: 'true' },
          });
        },
        error: (err: HttpErrorResponse) => {
          this.creatingRoom.set(false);
          if (err.status === 422) {
            const reason = err.error?.message ?? err.error?.error ?? 'Deck validation failed';
            displayError(this.snackBar, reason);
          } else {
            displayError(this.snackBar, 'Failed to start quick duel');
          }
        },
      });
    });
  }

  getRelativeTime(date: string): string {
    return relativeTime(date);
  }

  joinRoom(room: RoomDTO): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      width: '340px',
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
            displayError(this.snackBar, 'Room is full');
            this.rooms.update(list => list.filter(r => r.roomCode !== room.roomCode));
          } else if (err.status === 422) {
            const reason = err.error?.message ?? err.error?.error ?? 'Deck validation failed';
            displayError(this.snackBar, reason);
          } else {
            displayError(this.snackBar, 'Failed to join room');
          }
        },
      });
    });
  }
}
