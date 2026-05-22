package com.skytrix.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.repository.CrudRepository;

import com.skytrix.model.entity.Deck;

public interface DeckRepository extends CrudRepository<Deck, Long> {
    // @EntityGraph join-fetches cardsIndexed + its card in one query, instead
    // of one lazy SELECT per deck then per card (perf-audit finding B-M7).
    // Only ONE bag (cardsIndexed) is graphed — images stays @BatchSize on the
    // entity; graphing two List collections throws MultipleBagFetchException.
    @EntityGraph(attributePaths = {"cardsIndexed", "cardsIndexed.card"})
    List<Deck> findAllByUserId(Long id);

    @EntityGraph(attributePaths = {"cardsIndexed", "cardsIndexed.card"})
    Optional<Deck> findById(Long id);
}
