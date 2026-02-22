package com.skytrix.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.CrudRepository;

import com.skytrix.model.entity.Card;

public interface CardRepository extends CrudRepository<Card, Long>, JpaSpecificationExecutor<Card> {
    List<Card> findAll();
    List<Card> findAllByIdIn(List<Long> ids);

	Card findByPasscode(long passcode);

	boolean existsByIdAndFavoritedById(Long cardId, Long userId);
}
