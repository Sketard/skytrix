package com.skytrix.service;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.model.enums.RoomStatus;

import lombok.extern.slf4j.Slf4j;

/**
 * Per-room SSE fan-out. Keyed first by roomCode, then by userId — the
 * creator and the joiner both subscribe, and events route by recipient.
 * Drives the waiting-room UX (browsing pings, room-joined-ready transition,
 * kick redirect, duel-ready bridge).
 */
@Service
@Slf4j
public class RoomEventService {

    /**
     * roomCode → (userId → emitter). The inner map is a ConcurrentHashMap
     * so concurrent subscribe/send/cleanup don't fight. The outer map is
     * laid out as {@code (room, user)} rather than {@code (room, list)}
     * so a user re-subscribing simply replaces their own slot — we never
     * accumulate stale emitters for the same user.
     */
    private final ConcurrentHashMap<String, ConcurrentHashMap<Long, SseEmitter>> emitters = new ConcurrentHashMap<>();

    private static final long SSE_TIMEOUT_MS = 30 * 60 * 1000L;

    /**
     * Subscribe a participant (creator or joiner) to the room's SSE stream.
     * Non-participants get 403. WAITING + READY + CREATING_DUEL are valid;
     * ACTIVE with a wsToken minted for this user emits an immediate
     * {@code room-ready} and completes (closes the race where the client
     * opens the EventSource just after {@code startDuel} flipped the room
     * to ACTIVE). ACTIVE without a token (pathological) and ENDED/CLOSED
     * still reject with 409.
     */
    public SseEmitter subscribe(String roomCode, RoomDTO room, Long userId) {
        boolean isCreator = userId.equals(room.getPlayer1().getId());
        boolean isJoiner = room.getPlayer2() != null && userId.equals(room.getPlayer2().getId());
        if (!isCreator && !isJoiner) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN, "Only room participants can subscribe");
        }
        var status = room.getStatus();
        if (status == RoomStatus.ACTIVE && room.getWsToken() != null) {
            return immediateRoomReadyEmitter(room);
        }
        if (status != RoomStatus.WAITING && status != RoomStatus.READY && status != RoomStatus.CREATING_DUEL) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.CONFLICT, "Room is not in a subscribable state");
        }

        var emitter = new SseEmitter(SSE_TIMEOUT_MS);
        var roomEmitters = emitters.computeIfAbsent(roomCode, k -> new ConcurrentHashMap<>());

        Runnable cleanup = () -> {
            roomEmitters.remove(userId, emitter);
            // Drop the room slot entirely once the last subscriber leaves
            // — avoids leaking empty inner maps for closed rooms.
            emitters.computeIfPresent(roomCode, (k, v) -> v.isEmpty() ? null : v);
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());

        var old = roomEmitters.put(userId, emitter);
        if (old != null) {
            try { old.complete(); } catch (Exception ignored) {}
        }

        return emitter;
    }

    /**
     * Joiner just landed on a WAITING room → status flipped to READY.
     * Only the creator cares (joiner already has the response from their
     * POST /join HTTP call). Emitter stays open — the creator will receive
     * more events until they click "Lancer la partie".
     */
    public void sendRoomJoinedReady(String roomCode, RoomDTO creatorDto) {
        sendTo(roomCode, creatorDto.getPlayer1().getId(), "room-joined-ready", creatorDto, false);
    }

    /**
     * Creator clicked "Lancer la partie" → status ACTIVE, duel-server is
     * up, wsTokens are minted. Notifies BOTH participants with their own
     * RoomDTO (each has the right wsToken). Completes the emitters after
     * the send since the room is leaving the waiting-room lifecycle.
     */
    public void sendRoomReady(String roomCode,
                              Long creatorId, RoomDTO creatorDto,
                              Long joinerId, RoomDTO joinerDto) {
        var roomEmitters = emitters.remove(roomCode);
        if (roomEmitters == null) return;

        deliverAndComplete(roomEmitters, creatorId, "room-ready", creatorDto, roomCode);
        deliverAndComplete(roomEmitters, joinerId, "room-ready", joinerDto, roomCode);
    }

    /**
     * Creator booted the joiner from a READY room → notify only the
     * kicked user. Their client redirects to /pvp with an error toast,
     * which closes the EventSource naturally — no need to complete the
     * emitter here (the close-handler reaps the slot).
     */
    public void sendKicked(String roomCode, Long kickedUserId) {
        sendTo(roomCode, kickedUserId, "kicked", "", false);
    }

    /**
     * Notify the creator that a non-participant is currently picking a
     * deck (i.e. opened the deck-picker dialog after hitting the room
     * URL). Sent by {@code RoomService.announceBrowsing}.
     */
    public void sendOpponentBrowsing(String roomCode, Object browsingUserDto) {
        var roomEmitters = emitters.get(roomCode);
        if (roomEmitters == null) return;
        // The creator is always one specific user — find them. The room
        // map carries the userId-keyed emitters, but we don't know the
        // creator's id here. Walk the map (size ≤ 2 in practice) and
        // send to all subscribers that are NOT the browsing user.
        Long browsingUserId = null;
        if (browsingUserDto instanceof Map<?, ?> map) {
            var id = map.get("id");
            if (id instanceof Long l) browsingUserId = l;
            else if (id instanceof Integer i) browsingUserId = i.longValue();
        }
        for (var entry : roomEmitters.entrySet()) {
            if (browsingUserId != null && entry.getKey().equals(browsingUserId)) continue;
            sendOnEmitter(roomCode, entry.getKey(), entry.getValue(),
                    "opponent-browsing", browsingUserDto);
        }
    }

    /**
     * Notify the creator that the previously-browsing opponent has
     * cancelled. Same fan-out shape as opponent-browsing.
     */
    public void sendOpponentLeftBrowsing(String roomCode) {
        var roomEmitters = emitters.get(roomCode);
        if (roomEmitters == null) return;
        for (var entry : roomEmitters.entrySet()) {
            sendOnEmitter(roomCode, entry.getKey(), entry.getValue(),
                    "opponent-left-browsing", "");
        }
    }

    /** Evict and complete every emitter for a room that ended or was deleted. */
    public void evict(String roomCode) {
        var roomEmitters = emitters.remove(roomCode);
        if (roomEmitters == null) return;
        for (var emitter : roomEmitters.values()) {
            try { emitter.complete(); } catch (Exception ignored) {}
        }
    }

    // ---------- private helpers ----------

    /**
     * Race resolver: client opened EventSource just after the room flipped
     * to ACTIVE. Mint an emitter that delivers {@code room-ready} synchronously
     * with the participant-scoped DTO (wsToken already set by RoomMapper)
     * then completes — same shape the client would have received via the
     * push path, so no client-side branching needed.
     */
    private SseEmitter immediateRoomReadyEmitter(RoomDTO room) {
        var emitter = new SseEmitter(0L);
        try {
            emitter.send(SseEmitter.event().name("room-ready").data(room, MediaType.APPLICATION_JSON));
            emitter.complete();
        } catch (IOException e) {
            log.warn("Failed to send immediate room-ready for room {}", room.getRoomCode(), e);
            emitter.completeWithError(e);
        }
        return emitter;
    }

    private void sendTo(String roomCode, Long userId, String eventName, Object payload, boolean complete) {
        var roomEmitters = emitters.get(roomCode);
        if (roomEmitters == null) return;
        var emitter = complete ? roomEmitters.remove(userId) : roomEmitters.get(userId);
        if (emitter == null) return;
        if (complete) deliverAndComplete(roomEmitters, userId, eventName, payload, roomCode);
        else sendOnEmitter(roomCode, userId, emitter, eventName, payload);
    }

    private void deliverAndComplete(Map<Long, SseEmitter> roomEmitters, Long userId,
                                    String eventName, Object payload, String roomCode) {
        var emitter = roomEmitters.remove(userId);
        if (emitter == null) return;
        try {
            emitter.send(SseEmitter.event().name(eventName).data(payload, MediaType.APPLICATION_JSON));
            emitter.complete();
        } catch (IOException e) {
            log.warn("Failed to send SSE {} for room {} user {}", eventName, roomCode, userId, e);
        }
    }

    private void sendOnEmitter(String roomCode, Long userId, SseEmitter emitter,
                               String eventName, Object payload) {
        try {
            emitter.send(SseEmitter.event().name(eventName).data(payload, MediaType.APPLICATION_JSON));
        } catch (IOException e) {
            log.warn("Failed to send SSE {} for room {} user {}", eventName, roomCode, userId, e);
            var roomEmitters = emitters.get(roomCode);
            if (roomEmitters != null) roomEmitters.remove(userId, emitter);
        }
    }
}
