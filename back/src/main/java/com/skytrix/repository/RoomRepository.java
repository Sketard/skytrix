package com.skytrix.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;

import com.skytrix.model.entity.Room;
import com.skytrix.model.enums.RoomStatus;

public interface RoomRepository extends CrudRepository<Room, Long> {

    Optional<Room> findByRoomCode(String roomCode);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM Room r WHERE r.id = :id")
    Optional<Room> findByIdForUpdate(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM Room r WHERE r.roomCode = :roomCode")
    Optional<Room> findByRoomCodeForUpdate(@Param("roomCode") String roomCode);

    @Query("SELECT r FROM Room r WHERE r.status = :status AND (r.player1.id = :userId OR r.player2.id = :userId)")
    List<Room> findByStatusAndPlayerId(@Param("status") RoomStatus status, @Param("userId") Long userId);

    List<Room> findByStatus(RoomStatus status);

    List<Room> findByStatusOrderByCreatedAtDesc(RoomStatus status);

    List<Room> findTop10ByStatusOrderByCreatedAtDesc(RoomStatus status);

    List<Room> findByStatusAndCreatedAtBefore(RoomStatus status, Instant before);
}
