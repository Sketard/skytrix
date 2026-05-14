import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RoomDTO } from './room.types';

export interface QuickDuelResponse {
  roomCode: string;
  wsToken1: string;
  wsToken2: string;
}

interface EventSourceHandlers<T> {
  /** Named SSE events → emitted values. Each handler receives the parsed
   *  `MessageEvent.data` (JSON.parse) and returns the discriminated-union
   *  value to push to the subscriber, or `null` to skip the emit. */
  events: Record<string, (data: unknown) => T | null>;
  /** Emit on `complete` close (default false — observable stays open until
   *  unsubscribe or a fatal error). When true, the first triggered named
   *  event also calls `subscriber.complete()` and closes the stream. */
  completeOnFirstEvent?: boolean;
}

@Injectable({ providedIn: 'root' })
export class RoomApiService {
  private readonly http = inject(HttpClient);

  createRoom(decklistId: number): Observable<RoomDTO> {
    return this.http.post<RoomDTO>('/api/rooms', { decklistId });
  }

  getRoom(roomCode: string): Observable<RoomDTO> {
    return this.http.get<RoomDTO>(`/api/rooms/${roomCode}`);
  }

  getRooms(): Observable<RoomDTO[]> {
    return this.http.get<RoomDTO[]>('/api/rooms');
  }

  joinRoom(roomCode: string, decklistId: number): Observable<RoomDTO> {
    return this.http.post<RoomDTO>(`/api/rooms/${roomCode}/join`, { decklistId });
  }

  /** Creator-only: bridge a READY room to ACTIVE. Returns the creator's
   *  RoomDTO with wsToken populated. The joiner receives the same signal
   *  via the `room-ready` SSE event (with their own wsToken). */
  startDuel(roomCode: string): Observable<RoomDTO> {
    return this.http.post<RoomDTO>(`/api/rooms/${roomCode}/start`, {});
  }

  /** Creator-only: kick the joiner from a READY room — the room returns
   *  to WAITING and resurfaces in the lobby. The joiner's SSE receives
   *  a `kicked` event and their UI bounces them back to /pvp. */
  kickPlayer(roomCode: string): Observable<void> {
    return this.http.post<void>(`/api/rooms/${roomCode}/kick`, {});
  }

  quickDuel(decklistId1: number, decklistId2: number, firstPlayer: number, skipShuffle: boolean, turnTimeSecs: number): Observable<QuickDuelResponse> {
    return this.http.post<QuickDuelResponse>('/api/rooms/quick-duel', { decklistId1, decklistId2, firstPlayer, skipShuffle, turnTimeSecs });
  }

  // Admin-only: force-close a room from the lobby (typically a stale or
  // abusive WAITING room). Backend gates with @Secured("ROLE_ADMIN") and
  // returns 403 if the caller is not ADMIN.
  adminDeleteRoom(roomCode: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/rooms/${roomCode}`);
  }

  /** Non-participant signals they're on the deck picker for this room.
   *  Fire-and-forget: the creator's SSE receives an `opponent-browsing`
   *  event with the user's pseudo so their waiting screen can show the
   *  slot occupied. Idempotent server-side. */
  announceBrowsing(roomCode: string): Observable<void> {
    return this.http.post<void>(`/api/rooms/${roomCode}/announce-browsing`, {});
  }

  /** Non-participant cancels their deck pick — the SSE receives an
   *  `opponent-left-browsing` event so the creator falls back to the
   *  "waiting" UI. Idempotent server-side. */
  announceLeftBrowsing(roomCode: string): Observable<void> {
    return this.http.post<void>(`/api/rooms/${roomCode}/announce-left-browsing`, {});
  }

  /**
   * Per-room SSE used by participants' WAITING screens (creator AND joiner
   * subscribe). Emits:
   *   - `{ kind: 'browsing', user }`     — a non-participant opened the
   *     deck picker (creator-side only — joiner doesn't care).
   *   - `{ kind: 'left-browsing' }`      — they cancelled.
   *   - `{ kind: 'joined-ready', room }` — joiner picked a deck, room
   *     status flipped to READY (creator-side only). Stream stays open.
   *   - `{ kind: 'kicked' }`             — creator kicked the joiner
   *     (joiner-side only). Subscriber should redirect to /pvp.
   *   - `{ kind: 'ready', room }`        — duel is starting; subscriber
   *     completes after this. Both sides receive their own RoomDTO with
   *     their own wsToken.
   */
  subscribeToRoomEvents(roomCode: string): Observable<RoomEvent> {
    return this.openEventSource<RoomEvent>(`/api/rooms/${roomCode}/events`, {
      events: {
        'opponent-browsing':      data => ({ kind: 'browsing', user: data as BrowsingUser }),
        'opponent-left-browsing': () => ({ kind: 'left-browsing' }),
        'room-joined-ready':      data => ({ kind: 'joined-ready', room: data as RoomDTO }),
        'kicked':                 () => ({ kind: 'kicked' }),
        'room-ready':             data => ({ kind: 'ready', room: data as RoomDTO }),
      },
      // The lifecycle is open until `room-ready` (or `kicked` for the
      // joiner). We can't use `completeOnFirstEvent` because the
      // browsing / joined-ready pings should leave the stream alive.
      // The state-machine completes manually on terminal events.
    });
  }

  /**
   * Live lobby diff stream (Phase 2.11). Server-sent events:
   *   - "connected"     : initial handshake, payload="ok"
   *   - "room-created"  : payload=RoomDTO
   *   - "room-removed"  : payload={ roomCode }
   *   - "room-updated"  : payload=RoomDTO  (reserved for future)
   * The lobby page applies the diff onto `rooms()` and falls back to REST
   * polling if the stream errors permanently.
   */
  subscribeToLobbyEvents(): Observable<LobbyEvent> {
    return this.openEventSource<LobbyEvent>(`/api/rooms/events`, {
      events: {
        'connected':    () => ({ kind: 'connected' }),
        'room-created': data => ({ kind: 'created', room: data as RoomDTO }),
        'room-removed': data => ({ kind: 'removed', roomCode: (data as { roomCode: string }).roomCode }),
        'room-updated': data => ({ kind: 'updated', room: data as RoomDTO }),
      },
    });
  }

  /**
   * Generic SSE wrapper — single source of truth for EventSource lifecycle
   * (creation, JSON-parsing per named event, error→close discrimination,
   * teardown). Both `subscribeToRoomEvents` and `subscribeToLobbyEvents`
   * route through here so the readyState/CLOSED check, the auto-reconnect
   * pass-through, and the cleanup on unsubscribe stay in sync.
   */
  private openEventSource<T>(url: string, handlers: EventSourceHandlers<T>): Observable<T> {
    return new Observable<T>(subscriber => {
      const eventSource = new EventSource(url);

      for (const [name, transform] of Object.entries(handlers.events)) {
        eventSource.addEventListener(name, (event: MessageEvent) => {
          const raw = event.data ? safeParse(event.data) : null;
          const value = transform(raw);
          if (value === null) return;
          subscriber.next(value);
          if (handlers.completeOnFirstEvent) {
            subscriber.complete();
            eventSource.close();
          }
        });
      }

      eventSource.onerror = () => {
        // readyState CLOSED (2) = fatal; CONNECTING (0) = browser auto-reconnecting (transient)
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          subscriber.error(new Error(`SSE connection failed: ${url}`));
        }
        // Transient errors: let the browser reconnect automatically.
      };

      return () => eventSource.close();
    });
  }
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

export type LobbyEvent =
  | { kind: 'connected' }
  | { kind: 'created'; room: RoomDTO }
  | { kind: 'removed'; roomCode: string }
  | { kind: 'updated'; room: RoomDTO };

export interface BrowsingUser { id: number; pseudo: string; }

export type RoomEvent =
  | { kind: 'browsing'; user: BrowsingUser }
  | { kind: 'left-browsing' }
  | { kind: 'joined-ready'; room: RoomDTO }
  | { kind: 'kicked' }
  | { kind: 'ready'; room: RoomDTO };
