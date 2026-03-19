import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RoomDTO } from './room.types';

export interface QuickDuelResponse {
  roomCode: string;
  wsToken1: string;
  wsToken2: string;
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

  quickDuel(decklistId1: number, decklistId2: number, firstPlayer: number, skipShuffle: boolean, turnTimeSecs: number): Observable<QuickDuelResponse> {
    return this.http.post<QuickDuelResponse>('/api/rooms/quick-duel', { decklistId1, decklistId2, firstPlayer, skipShuffle, turnTimeSecs });
  }

  subscribeToRoomEvents(roomCode: string): Observable<RoomDTO> {
    return new Observable<RoomDTO>(subscriber => {
      const eventSource = new EventSource(`/api/rooms/${roomCode}/events`);

      eventSource.addEventListener('room-ready', (event: MessageEvent) => {
        const room: RoomDTO = JSON.parse(event.data);
        subscriber.next(room);
        subscriber.complete();
        eventSource.close();
      });

      eventSource.onerror = () => {
        // readyState CLOSED (2) = fatal; CONNECTING (0) = browser auto-reconnecting (transient)
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          subscriber.error(new Error('SSE connection failed'));
        }
        // Transient errors: let the browser reconnect automatically
      };

      return () => eventSource.close();
    });
  }
}
