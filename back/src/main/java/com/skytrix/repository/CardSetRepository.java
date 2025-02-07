package com.skytrix.repository;

import com.skytrix.model.entity.CardSet;
import org.springframework.data.repository.CrudRepository;

import java.util.List;

public interface CardSetRepository extends CrudRepository<CardSet, Long> {
    List<CardSet> findAllByIdIn(List<Long> ids);
}
