package com.skytrix.repository;

import java.util.List;

import com.skytrix.model.entity.CardDeckIndex;
import org.springframework.data.repository.CrudRepository;

public interface CardDeckIndexRepository extends CrudRepository<CardDeckIndex, Long> {

    List<CardDeckIndex> findByDeckId(Long deckId);
}
