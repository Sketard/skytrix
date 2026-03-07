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

  quickDuel(decklistId1: number, decklistId2: number, firstPlayer: number): Observable<QuickDuelResponse> {
    return this.http.post<QuickDuelResponse>('/api/rooms/quick-duel', { decklistId1, decklistId2, firstPlayer });
  }
}
