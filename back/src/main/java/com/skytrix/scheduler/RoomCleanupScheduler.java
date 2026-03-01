package com.skytrix.scheduler;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;

import jakarta.inject.Inject;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.skytrix.model.entity.Room;
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
            room.setStatus(RoomStatus.CLOSED);
            log.info("Cleaned up orphaned waiting room: {} (code: {})", room.getId(), room.getRoomCode());
        }

        if (!orphanedRooms.isEmpty()) {
            roomRepository.saveAll(orphanedRooms);
            log.info("Cleaned up {} orphaned waiting rooms", orphanedRooms.size());
        }
    }

    @Scheduled(fixedRate = 300_000)
    @Transactional
    public void cleanupOrphanedActiveRooms() {
        var activeRooms = roomRepository.findByStatus(RoomStatus.ACTIVE);
        if (activeRooms.isEmpty()) return;

        var activeDuelIds = duelServerClient.getActiveDuelIds();
        if (activeDuelIds == null) {
            log.warn("Duel server unreachable — skipping orphaned room cleanup");
            return;
        }

        var activeDuelIdSet = new HashSet<>(activeDuelIds);
        var toClose = new ArrayList<Room>();
        for (var room : activeRooms) {
            if (room.getDuelServerId() == null || !activeDuelIdSet.contains(room.getDuelServerId())) {
                room.setStatus(RoomStatus.CLOSED);
                toClose.add(room);
                log.info("Closed orphaned active room: {} (code: {}, duelId: {})",
                        room.getId(), room.getRoomCode(), room.getDuelServerId());
            }
        }
        if (!toClose.isEmpty()) {
            roomRepository.saveAll(toClose);
            log.info("Closed {} orphaned active rooms", toClose.size());
        }
    }
}
