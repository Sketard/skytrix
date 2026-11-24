package com.skytrix.repository;

import java.util.List;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;

import com.skytrix.model.entity.RoomBoosterCard;

public interface RoomBoosterCardRepository extends CrudRepository<RoomBoosterCard, Long> {

    List<RoomBoosterCard> findByRoomIdAndUserIdOrderByBoosterIndexAscSlotIndexAsc(Long roomId, Long userId);

    @Query("SELECT COALESCE(MAX(b.boosterIndex) + 1, 0) FROM RoomBoosterCard b WHERE b.room.id = :roomId AND b.userId = :userId")
    int countOpenedBoosters(@Param("roomId") Long roomId, @Param("userId") Long userId);

    @Modifying
    @Query("DELETE FROM RoomBoosterCard b WHERE b.room.id = :roomId AND b.userId = :userId")
    void deleteByRoomIdAndUserId(@Param("roomId") Long roomId, @Param("userId") Long userId);
}
