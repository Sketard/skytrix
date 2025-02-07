package com.skytrix.repository;

import java.util.List;

import org.springframework.data.repository.CrudRepository;

import com.skytrix.model.entity.Deck;

public interface DeckRepository extends CrudRepository<Deck, Long> {
    List<Deck> findAllByUserId(Long id);
}
