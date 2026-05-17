package com.skytrix.service;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.skytrix.model.dto.room.RoomDTO;

import lombok.extern.slf4j.Slf4j;

/**
 * Lobby live updates over Server-Sent Events. Each connected lobby client
 * gets its own {@link SseEmitter}; on every room mutation, the service
 * fan-outs `room-created` / `room-removed` events to all subscribers so
 * the front-end can apply a diff instead of polling.
 *
 * <p>Pattern mirror of {@link RoomEventService} but broadcast-style — that
 * service holds one emitter per room (for the creator's room-ready signal);
 * this one holds N emitters per logical lobby view.
 *
 * <p>Keep-alive comment ping every {@value #KEEPALIVE_INTERVAL_SECONDS}s
 * defeats idle proxy timeouts and lets the client detect a dropped TCP
 * connection within bounded time even when no real event occurs.
 */
@Service
@Slf4j
public class RoomLobbyEventService {

    private static final long SSE_TIMEOUT_MS = 30 * 60 * 1000L; // 30 minutes
    private static final long KEEPALIVE_INTERVAL_SECONDS = 25L;

    /** Subscribers indexed by an opaque per-connection token so we can clean
     *  up cleanly on disconnect without scanning the values. */
    private final ConcurrentHashMap<String, SseEmitter> emitters = new ConcurrentHashMap<>();

    private ScheduledExecutorService keepAlive;

    @PostConstruct
    void start() {
        // Single daemon thread for the keep-alive ticker — broadcast is cheap
        // (one comment per subscriber) and concurrent fan-out would race the
        // emitters map.
        keepAlive = Executors.newSingleThreadScheduledExecutor(r -> {
            var t = new Thread(r, "room-lobby-sse-keepalive");
            t.setDaemon(true);
            return t;
        });
        keepAlive.scheduleAtFixedRate(this::pingAll, KEEPALIVE_INTERVAL_SECONDS, KEEPALIVE_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stop() {
        if (keepAlive != null) keepAlive.shutdownNow();
        for (var emitter : emitters.values()) {
            try { emitter.complete(); } catch (Exception ignored) {}
        }
        emitters.clear();
    }

    public SseEmitter subscribe() {
        var emitter = new SseEmitter(SSE_TIMEOUT_MS);
        var id = UUID.randomUUID().toString();
        Runnable cleanup = () -> emitters.remove(id);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());
        emitters.put(id, emitter);

        // Send an immediate connect event so the client knows the channel is
        // live before any real room mutation. Helps the front close the SSE
        // race window (subscribe → first event) without waiting for activity.
        try {
            emitter.send(SseEmitter.event().name("connected").data("ok"));
        } catch (IOException e) {
            log.warn("Failed to send connect event", e);
            emitters.remove(id);
            try { emitter.completeWithError(e); } catch (Exception ignored) {}
        }
        return emitter;
    }

    public void broadcastRoomCreated(RoomDTO room) {
        broadcast("room-created", room);
    }

    public void broadcastRoomRemoved(String roomCode) {
        // Lean payload — the client only needs the code to drop the row.
        broadcast("room-removed", Map.of("roomCode", roomCode));
    }

    public void broadcastRoomUpdated(RoomDTO room) {
        broadcast("room-updated", room);
    }

    private void broadcast(String eventName, Object payload) {
        forEachEmitter(emitter -> emitter.send(SseEmitter.event()
                .name(eventName)
                .data(payload, MediaType.APPLICATION_JSON)));
    }

    private void pingAll() {
        // `.comment(...)` writes `:` lines that EventSource silently
        // ignores — no event reaches the application, but the TCP
        // bytes keep the connection warm.
        forEachEmitter(emitter -> emitter.send(SseEmitter.event().comment("keep-alive")));
    }

    /**
     * Iterate every live emitter and apply {@code action}. Dead emitters
     * (IOException, IllegalStateException) are dropped from the map AND
     * marked complete with the original error, so onError/onCompletion fires
     * once. Eliminates the broadcast/pingAll boilerplate where the only
     * differences were the lambda body.
     */
    @FunctionalInterface
    private interface EmitterAction {
        void apply(SseEmitter emitter) throws IOException;
    }

    private void forEachEmitter(EmitterAction action) {
        for (var entry : emitters.entrySet()) {
            try {
                action.apply(entry.getValue());
            } catch (IOException e) {
                evictEmitter(entry.getKey(), entry.getValue(), e);
            } catch (IllegalStateException e) {
                evictEmitter(entry.getKey(), entry.getValue(), e);
            }
        }
    }

    private void evictEmitter(String key, SseEmitter emitter, Throwable cause) {
        emitters.remove(key);
        try { emitter.completeWithError(cause); } catch (Exception ignored) {}
    }

    int subscriberCount() {
        return emitters.size();
    }
}
