package com.skytrix.repository;

import com.skytrix.model.entity.CardUserPossessed;
import org.springframework.data.repository.CrudRepository;

import java.util.List;
import java.util.Optional;

public interface CardUserPossessedRepository extends CrudRepository<CardUserPossessed, Long> {
    Optional<CardUserPossessed> findByCardIdAndUserId(Long cardId, Long userId);
    List<CardUserPossessed> findAllByUserId(Long userId);
}
