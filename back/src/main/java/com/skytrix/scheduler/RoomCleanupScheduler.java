package com.skytrix.scheduler;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.skytrix.model.enums.RoomStatus;
import com.skytrix.repository.RoomRepository;
import com.skytrix.service.DuelServerClient;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@Slf4j
@RequiredArgsConstructor
public class RoomCleanupScheduler {

    private final RoomRepository roomRepository;
    private final DuelServerClient duelServerClient;

    @Scheduled(fixedRate = 300_000)
    @Transactional
    public void cleanupOrphanedWaitingRooms() {
        var threshold = Instant.now().minus(30, ChronoUnit.MINUTES);
        var orphanedRooms = roomRepository.findByStatusAndCreatedAtBefore(RoomStatus.WAITING, threshold);

        for (var room : orphanedRooms) {
            room.setStatus(RoomStatus.CLOSED);
            log.info("Cleaned up orphaned waiting room: {} (code: {})", room.getId(), room.getRoomCode());
        }

        if (!orphanedRooms.isEmpty()) {
            log.info("Cleaned up {} orphaned waiting rooms", orphanedRooms.size());
        }
    }

    @Scheduled(fixedRate = 300_000)
    @Transactional
    public void cleanupOrphanedActiveRooms() {
        var activeRooms = roomRepository.findByStatus(RoomStatus.ACTIVE);
        if (activeRooms.isEmpty()) return;

        var activeDuelIds = duelServerClient.getActiveDuelIds();
        if (activeDuelIds.isEmpty()) {
            log.warn("Duel server returned no active duels or is unreachable — skipping orphaned room cleanup");
            return;
        }

        var activeDuelIdSet = new HashSet<>(activeDuelIds);
        for (var room : activeRooms) {
            if (room.getDuelServerId() == null || !activeDuelIdSet.contains(room.getDuelServerId())) {
                room.setStatus(RoomStatus.CLOSED);
                log.info("Closed orphaned active room: {} (code: {}, duelId: {})",
                        room.getId(), room.getRoomCode(), room.getDuelServerId());
            }
        }
    }

    @Scheduled(fixedRate = 120_000)
    @Transactional
    public void cleanupStuckCreatingDuelRooms() {
        var threshold = Instant.now().minus(2, ChronoUnit.MINUTES);
        var stuckRooms = roomRepository.findByStatusAndCreatedAtBefore(RoomStatus.CREATING_DUEL, threshold);

        for (var room : stuckRooms) {
            room.setStatus(RoomStatus.CLOSED);
            log.info("Cleaned up stuck CREATING_DUEL room: {} (code: {})", room.getId(), room.getRoomCode());
        }

        if (!stuckRooms.isEmpty()) {
            log.info("Cleaned up {} stuck CREATING_DUEL rooms", stuckRooms.size());
        }
    }
}
