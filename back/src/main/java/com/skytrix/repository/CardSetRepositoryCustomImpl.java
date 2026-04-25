package com.skytrix.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

import java.util.List;

import org.springframework.data.jpa.domain.Specification;

import com.skytrix.model.entity.CardSet;

public class CardSetRepositoryCustomImpl implements CardSetRepositoryCustom {

    @PersistenceContext
    private EntityManager em;

    @Override
    public List<String> searchDistinctNames(Specification<CardSet> spec) {
        var cb = em.getCriteriaBuilder();
        var query = cb.createQuery(String.class);
        var root = query.from(CardSet.class);

        query.select(root.get("name"))
             .distinct(true)
             .where(spec.toPredicate(root, query, cb))
             .orderBy(cb.asc(root.get("name")));

        return em.createQuery(query).getResultList();
    }
}
