package com.skytrix.repository;

import java.util.List;

import org.springframework.data.jpa.domain.Specification;

import com.skytrix.model.entity.CardSet;

public interface CardSetRepositoryCustom {
    List<String> searchDistinctNames(Specification<CardSet> spec);
}
