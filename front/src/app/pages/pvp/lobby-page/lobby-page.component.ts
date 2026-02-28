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

  goToDecks(): void {
    this.router.navigate(['/decks']);
  }

  getRelativeTime(date: string): string {
    return relativeTime(date);
  }

  joinRoom(room: RoomDTO): void {
    const dialogRef = this.dialog.open(DeckPickerDialogComponent, {
      width: '340px',
    });

    dialogRef.afterClosed().subscribe((decklistId: number | undefined) => {
      if (decklistId === undefined) return;
      this.joiningRoomCode.set(room.roomCode);
      this.roomApi.joinRoom(room.roomCode, decklistId).subscribe({
        next: () => {
          this.router.navigate(['/pvp/duel', room.roomCode]);
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
