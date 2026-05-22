package com.skytrix.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;

import com.skytrix.model.entity.Card;

public interface CardRepository extends CrudRepository<Card, Long>, JpaSpecificationExecutor<Card> {
    List<Card> findAll();
    List<Card> findAllByIdIn(List<Long> ids);

	Card findByPasscode(long passcode);

	List<Card> findAllByPasscodeIn(List<Long> passcodes);

	boolean existsByIdAndFavoritedById(Long cardId, Long userId);

	/**
	 * Returns, among the given card ids, those the user has favorited — in a
	 * single query. Replaces the per-card existsByIdAndFavoritedById call
	 * (perf-audit finding B-M6: one EXISTS per mapped card).
	 */
	@Query("SELECT c.id FROM Card c JOIN c.favoritedBy u " +
		   "WHERE u.id = :userId AND c.id IN :cardIds")
	List<Long> findFavoritedCardIds(@Param("userId") Long userId, @Param("cardIds") List<Long> cardIds);

	@Query(value = "SELECT DISTINCT ON (c.passcode) c.passcode, t.name " +
		   "FROM card c JOIN translation t ON c.id = t.card_id " +
		   "WHERE LOWER(t.name) LIKE LOWER(CONCAT('%', :query, '%')) " +
		   "ORDER BY c.passcode, CASE WHEN CAST(t.language AS text) = 'FR' THEN 0 ELSE 1 END, t.name " +
		   "LIMIT :lim",
		   nativeQuery = true)
	List<Object[]> searchNamesByQuery(@Param("query") String query, @Param("lim") int limit);
}
