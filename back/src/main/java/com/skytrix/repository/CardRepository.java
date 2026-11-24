package com.skytrix.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
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

	/** {@code [card id, passcode]} of every card whose Yugipedia artworks were never processed. */
	@Query("SELECT c.id, c.passcode FROM Card c WHERE c.yugipediaArtworksCheckedAt IS NULL ORDER BY c.id")
	List<Object[]> findIdAndPasscodeOfCardsNeverCheckedForArtworks();

	/** {@code [card id, passcode, artwork count]} of the already processed cards among {@code passcodes}. */
	@Query("SELECT c.id, c.passcode, c.yugipediaArtworkCount FROM Card c"
			+ " WHERE c.passcode IN :passcodes AND c.yugipediaArtworksCheckedAt IS NOT NULL")
	List<Object[]> findArtworkCheckOfCheckedCards(@Param("passcodes") Collection<Long> passcodes);

	/** End of the last Yugipedia artwork sync, as far as the cards tell; null before the first one. */
	@Query("SELECT MAX(c.yugipediaArtworksCheckedAt) FROM Card c")
	Instant findLastYugipediaArtworksCheck();

	@Modifying
	@Query("UPDATE Card c SET c.yugipediaArtworksCheckedAt = :at, c.yugipediaArtworkCount = :count WHERE c.id = :id")
	int markYugipediaArtworksChecked(@Param("id") Long id, @Param("count") Integer count, @Param("at") Instant at);
}
