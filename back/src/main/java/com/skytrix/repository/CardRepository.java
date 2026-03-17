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

	@Query(value = "SELECT DISTINCT ON (c.passcode) c.passcode, t.name " +
		   "FROM card c JOIN translation t ON c.id = t.card_id " +
		   "WHERE LOWER(t.name) LIKE LOWER(CONCAT('%', :query, '%')) " +
		   "ORDER BY c.passcode, CASE WHEN CAST(t.language AS text) = 'FR' THEN 0 ELSE 1 END, t.name " +
		   "LIMIT :lim",
		   nativeQuery = true)
	List<Object[]> searchNamesByQuery(@Param("query") String query, @Param("lim") int limit);
}
