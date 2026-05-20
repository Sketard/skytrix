import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subscription, catchError, filter, interval, switchMap } from 'rxjs';
import { RoomApiService, LobbyEvent } from '../room-api.service';
import { RoomDTO } from '../room.types';
import { NEW_ROOM_FLASH_MS, POLL_FALLBACK_INTERVAL_MS } from '../pvp-timings';
import { ListStore } from '../../../core/store/list-store';

/**
 * Owns the lobby's room-list state machine: initial REST snapshot, SSE diff
 * stream, polling fallback, and the one-shot --new flash bookkeeping.
 *
 * Extends `ListStore<RoomDTO>` for the shared items/loading/error contract
 * (the lobby has no search/sort/filter, so the three hooks are no-ops — the
 * room list is always rendered in server order). Extracted from
 * `LobbyPageComponent` so the component reads as a thin presentation layer
 * (dialogs + navigation only). Lives at the lobby route scope — provided in
 * `LobbyPageComponent` rather than `providedIn:'root'` so the SSE
 * subscription tears down on navigation away.
 *
 * Public API used by the component (in addition to the ListStore base):
 *   - `rooms()` — alias of `items()`. `loading()` / `error()` from the base.
 *   - `liveSyncAvailable()` / `showLiveSyncBanner()` — connection banner.
 *   - `isNewRoom(code)` — drives the `.room-card--new` flash class.
 *   - `fetchSnapshot()` — retry trigger from the error empty-state.
 *   - `start()` — wires REST + SSE. Called from the component's ngOnInit.
 */
@Injectable()
export class LobbyRoomsStore extends ListStore<RoomDTO> {
  private readonly api = inject(RoomApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Domain-named alias of `items()` — clearer at call sites. */
  readonly rooms = this.items;

  readonly liveSyncAvailable = signal(false);

  // Latches on the first successful SSE `connected` so the banner can
  // distinguish "never connected yet" (cold start — no banner) from
  // "connected then dropped" (banner on).
  private readonly sseEverConnected = signal(false);

  readonly showLiveSyncBanner = computed(() =>
    this.sseEverConnected() && !this.liveSyncAvailable(),
  );

  // Codes that appeared in the latest diff — drained after NEW_ROOM_FLASH_MS.
  readonly newRoomCodes = signal<ReadonlySet<string>>(new Set());

  // First snapshot suppresses the flash: every room is "new" on init,
  // animating all at once would look like a glitch.
  private hasFetchedOnce = false;
  private pollFallbackSubscription: Subscription | null = null;
  private readonly suppressPollFallback = signal(false);

  constructor() {
    super('default', 'all');
  }

  start(): void {
    this.fetchSnapshot();
    this.startLobbyStream();
  }

  /** Pause the polling fallback while the caller is mid-action (join in
   *  flight) so the rooms list doesn't shift under their feet. */
  setSuppressPollFallback(value: boolean): void {
    this.suppressPollFallback.set(value);
  }

  fetchSnapshot(): void {
    this.setLoading(true);
    this.error.set(null);
    this.api.getRooms().subscribe({
      next: rooms => {
        this.applySnapshot(rooms);
        this.setLoading(false);
      },
      error: () => {
        this.setLoading(false);
        if (this.rooms().length === 0) {
          this.error.set('error.ROOM_LOAD_FAILED');
        }
      },
    });
  }

  isNewRoom(code: string): boolean {
    return this.newRoomCodes().has(code);
  }

  /** Optimistic local removal — used when the back rejects a join with 409
   *  (room already full) so the row disappears immediately. */
  removeRoom(code: string): void {
    this.items.update(list => list.filter(r => r.roomCode !== code));
  }

  private startLobbyStream(): void {
    this.api.subscribeToLobbyEvents().pipe(
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
        break;
      case 'created':
        this.addRoom(event.room);
        break;
      case 'removed':
        this.items.update(list => list.filter(r => r.roomCode !== event.roomCode));
        break;
      case 'updated':
        this.items.update(list => list.map(r =>
          r.roomCode === event.room.roomCode ? event.room : r,
        ));
        break;
    }
  }

  private startPollingFallback(): void {
    if (this.pollFallbackSubscription) return;
    this.pollFallbackSubscription = interval(POLL_FALLBACK_INTERVAL_MS).pipe(
      filter(() => !this.suppressPollFallback()),
      switchMap(() => this.api.getRooms().pipe(catchError(() => EMPTY))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(rooms => this.applySnapshot(rooms));
  }

  private stopPollingFallback(): void {
    if (this.pollFallbackSubscription) {
      this.pollFallbackSubscription.unsubscribe();
      this.pollFallbackSubscription = null;
    }
  }

  private applySnapshot(next: readonly RoomDTO[]): void {
    const previousCodes = new Set(this.rooms().map(r => r.roomCode));
    const appearedCodes = new Set<string>();
    if (this.hasFetchedOnce) {
      for (const room of next) {
        if (!previousCodes.has(room.roomCode)) appearedCodes.add(room.roomCode);
      }
    }
    this.hasFetchedOnce = true;
    this.items.set([...next]);
    if (appearedCodes.size > 0) this.armNewRoomFlash(appearedCodes);
  }

  private addRoom(room: RoomDTO): void {
    if (this.rooms().some(r => r.roomCode === room.roomCode)) return;
    this.items.update(list => [room, ...list]);
    if (this.hasFetchedOnce) this.armNewRoomFlash(new Set([room.roomCode]));
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

  // ─── ListStore hooks ──────────────────────────────────────────────────────
  // The lobby renders rooms in server order with no search/sort/filter UI.

  protected searchMatches(): boolean {
    return true;
  }

  protected passesFilter(): boolean {
    return true;
  }

  protected sortItems(items: RoomDTO[]): RoomDTO[] {
    return items;
  }
}
