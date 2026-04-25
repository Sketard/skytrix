package com.skytrix.service;

import jakarta.inject.Inject;

import java.util.List;

import org.springframework.stereotype.Service;

import com.skytrix.model.dto.card.CardSetFilterDTO;
import com.skytrix.model.dto.card.CardSetShortDTO;
import com.skytrix.repository.CardSetRepository;

@Service
public class CardSetService {

    @Inject
    private CardSetRepository cardSetRepository;

    @Inject
    private FilterService filterService;

    public List<CardSetShortDTO> searchShort(CardSetFilterDTO filter) {
        return cardSetRepository.searchDistinctNames(filterService.cardSetSpecification(filter))
            .stream()
            .map(name -> new CardSetShortDTO(name, null))
            .toList();
    }
}
