package com.skytrix.service;

import jakarta.inject.Inject;

import java.util.List;

import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import com.skytrix.model.dto.booster.BoosterSetDTO;
import com.skytrix.repository.CardSetRepository;

@Service
public class CardSetService {

    /** A booster holds 5 cards; smaller sets can't fill one without repeats only. */
    public static final int MIN_BOOSTER_SET_CARDS = 5;

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

    /**
     * Sets that booster mode can open. Static between two card syncs, so
     * cached like {@link #findAllNames}; YugiproApiService.fetchAll evicts it.
     */
    @Cacheable("boosterSets")
    public List<BoosterSetDTO> findBoosterSets() {
        return cardSetRepository.findBoosterSets(MIN_BOOSTER_SET_CARDS).stream()
                .map(p -> new BoosterSetDTO(p.getName(), setPrefix(p.getCode()), p.getCardCount()))
                .toList();
    }

    /** "LOB-EN001" → "LOB". */
    private static String setPrefix(String code) {
        if (code == null || code.isBlank()) return null;
        var dash = code.indexOf('-');
        return dash > 0 ? code.substring(0, dash) : code;
    }
}
