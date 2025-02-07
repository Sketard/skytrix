package com.skytrix.repository;

import com.skytrix.model.entity.CardPossessed;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.CrudRepository;

import java.util.List;

public interface CardPossessedRepository extends CrudRepository<CardPossessed, Long>, JpaSpecificationExecutor<CardPossessed> {
    List<CardPossessed> findAllByCardSetIdInAndUserId(List<Long> cardSetId, long userId);
    List<CardPossessed> findAll();
}
