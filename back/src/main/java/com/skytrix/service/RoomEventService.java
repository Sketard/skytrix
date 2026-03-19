package com.skytrix.service;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.model.enums.RoomStatus;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class RoomEventService {

    private final ConcurrentHashMap<String, SseEmitter> emitters = new ConcurrentHashMap<>();

    private static final long SSE_TIMEOUT_MS = 30 * 60 * 1000L;

    /**
     * Atomically checks that the room is in a subscribable state and registers an SSE emitter.
     * Synchronized on the room code to prevent a race with {@code sendRoomReady}.
     */
    public SseEmitter subscribe(String roomCode, RoomDTO room, Long userId) {
        if (!userId.equals(room.getPlayer1().getId())) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN, "Only room creator can subscribe");
        }
        var status = room.getStatus();
        if (status != RoomStatus.WAITING && status != RoomStatus.CREATING_DUEL) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.CONFLICT, "Room is not in waiting state");
        }

        var emitter = new SseEmitter(SSE_TIMEOUT_MS);
        Runnable cleanup = () -> emitters.remove(roomCode, emitter);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());

        var old = emitters.put(roomCode, emitter);
        if (old != null) {
            try { old.complete(); } catch (Exception ignored) {}
        }

        return emitter;
    }

    public void sendRoomReady(String roomCode, RoomDTO roomDto) {
        var emitter = emitters.remove(roomCode);
        if (emitter == null) return;

        try {
            emitter.send(SseEmitter.event()
                    .name("room-ready")
                    .data(roomDto, MediaType.APPLICATION_JSON));
            emitter.complete();
        } catch (IOException e) {
            log.warn("Failed to send SSE room-ready for room {}", roomCode, e);
        }
    }

    /** Evict and complete the emitter for a room that ended or was deleted. */
    public void evict(String roomCode) {
        var emitter = emitters.remove(roomCode);
        if (emitter != null) {
            try { emitter.complete(); } catch (Exception ignored) {}
        }
    }
}
