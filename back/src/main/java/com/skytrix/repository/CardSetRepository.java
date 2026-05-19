package com.skytrix.repository;

import com.skytrix.model.entity.CardSet;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;

import java.util.List;

public interface CardSetRepository extends CrudRepository<CardSet, Long>, JpaSpecificationExecutor<CardSet> {
    List<CardSet> findAllByIdIn(List<Long> ids);

    @Query("SELECT DISTINCT s.name FROM CardSet s ORDER BY s.name ASC")
    List<String> findDistinctNames();
}
