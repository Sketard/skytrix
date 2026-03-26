package com.skytrix.repository;

import java.time.Instant;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;

import com.skytrix.model.entity.Replay;

public interface ReplayRepository extends CrudRepository<Replay, UUID>, PagingAndSortingRepository<Replay, UUID>, JpaSpecificationExecutor<Replay> {

    @Override
    @EntityGraph(attributePaths = {"player1", "player2"})
    Page<Replay> findAll(Pageable pageable);

    @EntityGraph(attributePaths = {"player1", "player2"})
    Page<Replay> findByPlayer1IdOrPlayer2Id(Long player1Id, Long player2Id, Pageable pageable);

    @Modifying(clearAutomatically = true)
    @Query(value = "DELETE FROM replay WHERE id IN (SELECT id FROM replay WHERE created_at < :threshold LIMIT :batchSize)", nativeQuery = true)
    int deleteExpiredBatch(@Param("threshold") Instant threshold, @Param("batchSize") int batchSize);
}
