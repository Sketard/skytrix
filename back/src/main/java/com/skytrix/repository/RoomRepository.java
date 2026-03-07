package com.skytrix.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import jakarta.persistence.LockModeType;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;

import com.skytrix.model.entity.Room;
import com.skytrix.model.enums.RoomStatus;

public interface RoomRepository extends CrudRepository<Room, Long> {

    Optional<Room> findByRoomCode(String roomCode);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM Room r WHERE r.roomCode = :roomCode")
    Optional<Room> findByRoomCodeForUpdate(@Param("roomCode") String roomCode);

    List<Room> findByStatus(RoomStatus status);

    @Query("SELECT r FROM Room r JOIN FETCH r.player1 LEFT JOIN FETCH r.player2 WHERE r.status = ?1 ORDER BY r.createdAt DESC")
    List<Room> findTop10ByStatusWithPlayers(RoomStatus status, Pageable pageable);

    List<Room> findByStatusAndCreatedAtBefore(RoomStatus status, Instant before);
}
