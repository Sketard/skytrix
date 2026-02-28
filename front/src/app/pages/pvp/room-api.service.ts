import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RoomDTO } from './room.types';

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
}
