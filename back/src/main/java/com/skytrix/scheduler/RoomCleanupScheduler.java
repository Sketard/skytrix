package com.skytrix.scheduler;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import jakarta.inject.Inject;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.skytrix.model.enums.RoomStatus;
import com.skytrix.repository.RoomRepository;
import com.skytrix.service.DuelServerClient;

import lombok.extern.slf4j.Slf4j;

@Component
@Slf4j
public class RoomCleanupScheduler {

    @Inject
    private RoomRepository roomRepository;

    @Inject
    private DuelServerClient duelServerClient;

    @Scheduled(fixedRate = 300_000)
    @Transactional
    public void cleanupOrphanedWaitingRooms() {
        var threshold = Instant.now().minus(30, ChronoUnit.MINUTES);
        var orphanedRooms = roomRepository.findByStatusAndCreatedAtBefore(RoomStatus.WAITING, threshold);

        for (var room : orphanedRooms) {
            room.setStatus(RoomStatus.ENDED);
            roomRepository.save(room);
            log.info("Cleaned up orphaned waiting room: {} (code: {})", room.getId(), room.getRoomCode());
        }

        if (!orphanedRooms.isEmpty()) {
            log.info("Cleaned up {} orphaned waiting rooms", orphanedRooms.size());
        }
    }

    // AC5: periodic health-check for ACTIVE rooms (every 60s)
    // NOTE: No per-duel endpoint on the duel server — can only check overall server health.
    // Normal cleanup: Angular receives DUEL_END → calls POST /rooms/:id/end.
    // This handles the fallback: duel server crashed → bulk-end all ACTIVE rooms.
    @Scheduled(fixedRate = 60_000)
    @Transactional
    public void cleanupOrphanedActiveRooms() {
        var activeRooms = roomRepository.findByStatus(RoomStatus.ACTIVE);
        if (activeRooms.isEmpty()) return;

        if (!duelServerClient.isServerHealthy()) {
            for (var room : activeRooms) {
                room.setStatus(RoomStatus.ENDED);
                roomRepository.save(room);
                log.warn("Ended active room due to unhealthy duel server: {} (code: {})", room.getId(), room.getRoomCode());
            }
            log.warn("Ended {} active rooms — duel server unhealthy", activeRooms.size());
        }
    }
}
