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

    /**
     * Paginated list of replays the user has favorited. Ordering follows the
     * `Pageable.sort` argument; callers typically sort by replay `createdAt`
     * DESC to mirror the main history view. The match also requires the user
     * to be one of the two players (or admin via a separate code path) to
     * prevent a leaked favorite row from exposing a replay the user lost
     * access to.
     */
    @EntityGraph(attributePaths = {"player1", "player2"})
    @Query("""
            SELECT r FROM Replay r
            JOIN User u ON u.id = :userId
            WHERE r MEMBER OF u.favoriteReplays
              AND (r.player1.id = :userId OR r.player2.id = :userId)
            """)
    Page<Replay> findFavoritedByUser(@Param("userId") Long userId, Pageable pageable);

    /**
     * Returns the IDs of replays favorited by the user among the provided set.
     * Cheaper than fetching the full join — used by the list mapper to enrich
     * `isFavorite` on every DTO of a page in a single query.
     */
    @Query("""
            SELECT r.id FROM User u JOIN u.favoriteReplays r
            WHERE u.id = :userId AND r.id IN :replayIds
            """)
    java.util.Set<UUID> findFavoritedIdsByUserIn(
            @Param("userId") Long userId,
            @Param("replayIds") java.util.Collection<UUID> replayIds);

    @Query("""
            SELECT COUNT(r) > 0 FROM User u JOIN u.favoriteReplays r
            WHERE u.id = :userId AND r.id = :replayId
            """)
    boolean isFavoritedByUser(@Param("userId") Long userId, @Param("replayId") UUID replayId);

    @Modifying(clearAutomatically = true)
    @Query(value = "DELETE FROM replay WHERE id IN (SELECT id FROM replay WHERE created_at < :threshold LIMIT :batchSize)", nativeQuery = true)
    int deleteExpiredBatch(@Param("threshold") Instant threshold, @Param("batchSize") int batchSize);

    interface ReplayStatsProjection {
        long getTotal();
        long getVictories();
        long getDefeats();
        long getDraws();
    }

    /**
     * PvP win/loss stats for a user. Solo "quick duels" are persisted as
     * replays with player1_id = player2_id = the same user (so they stay
     * replayable in the match-history list) — but they are excluded here:
     * a solo row would otherwise match BOTH the victory and defeat filters
     * (both branches of each OR are true when both ids are :userId),
     * inflating victories + defeats past total.
     */
    @Query(value = """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE
                (player1_id = :userId AND metadata->>'result' IN ('VICTORY', 'OPPONENT_TIMEOUT', 'OPPONENT_DISCONNECT', 'OPPONENT_SURRENDER'))
                OR
                (player2_id = :userId AND metadata->>'result' IN ('DEFEAT', 'TIMEOUT', 'DISCONNECT', 'SURRENDER'))
              ) AS victories,
              COUNT(*) FILTER (WHERE
                (player1_id = :userId AND metadata->>'result' IN ('DEFEAT', 'TIMEOUT', 'DISCONNECT', 'SURRENDER'))
                OR
                (player2_id = :userId AND metadata->>'result' IN ('VICTORY', 'OPPONENT_TIMEOUT', 'OPPONENT_DISCONNECT', 'OPPONENT_SURRENDER'))
              ) AS defeats,
              COUNT(*) FILTER (WHERE metadata->>'result' = 'DRAW') AS draws
            FROM replay
            WHERE (player1_id = :userId OR player2_id = :userId)
              AND player1_id <> player2_id
            """, nativeQuery = true)
    ReplayStatsProjection getStatsForUser(@Param("userId") Long userId);
}
