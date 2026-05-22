package com.skytrix.service;

import jakarta.inject.Inject;

import java.util.List;

import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import com.skytrix.repository.CardSetRepository;

@Service
public class CardSetService {

    @Inject
    private CardSetRepository cardSetRepository;

    /**
     * Set names for the Card Search filter. The underlying query is a
     * `SELECT DISTINCT name ... ORDER BY` — a Seq Scan over ~43k card_set rows
     * (~17 ms, perf-audit finding B-C5). The result is fully static between
     * two card syncs, so it is cached; YugiproApiService.fetchAll evicts it.
     */
    @Cacheable("cardSetNames")
    public List<String> findAllNames() {
        return cardSetRepository.findDistinctNames();
    }
}
