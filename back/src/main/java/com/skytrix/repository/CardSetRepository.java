package com.skytrix.repository;

import com.skytrix.model.entity.CardSet;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface CardSetRepository extends CrudRepository<CardSet, Long>, JpaSpecificationExecutor<CardSet> {
    List<CardSet> findAllByIdIn(List<Long> ids);

    @Query("SELECT DISTINCT s.name FROM CardSet s ORDER BY s.name ASC")
    List<String> findDistinctNames();

    /** Sets with at least {@code minCards} distinct cards, for booster mode. */
    @Query("""
            SELECT s.name AS name, MIN(s.code) AS code, COUNT(DISTINCT s.card.id) AS cardCount
            FROM CardSet s
            WHERE s.name IS NOT NULL AND s.card.passcode IS NOT NULL
            GROUP BY s.name
            HAVING COUNT(DISTINCT s.card.id) >= :minCards
            ORDER BY s.name ASC""")
    List<BoosterSetProjection> findBoosterSets(@Param("minCards") long minCards);

    /** Distinct (card id, passcode) pairs printed in a set. */
    @Query("SELECT DISTINCT s.card.id, s.card.passcode FROM CardSet s WHERE s.name = :name AND s.card.passcode IS NOT NULL")
    List<Object[]> findCardIdsAndPasscodesBySetName(@Param("name") String name);

    interface BoosterSetProjection {
        String getName();
        String getCode();
        long getCardCount();
    }
}
