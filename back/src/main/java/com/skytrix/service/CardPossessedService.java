package com.skytrix.service;

import jakarta.inject.Inject;

import static com.skytrix.utils.CoreUtils.filter;
import static com.skytrix.utils.CoreUtils.findAny;
import static com.skytrix.utils.CoreUtils.mapToList;

import java.util.List;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.skytrix.mapper.CardMapper;
import com.skytrix.model.dto.card.CardFilterDTO;
import com.skytrix.model.dto.card.CardPossessedDTO;
import com.skytrix.model.dto.card.ShortCardPossessedDTO;
import com.skytrix.model.dto.card.UpdatePossessedCardDTO;
import com.skytrix.repository.CardPossessedRepository;
import com.skytrix.repository.CardSetRepository;
import com.skytrix.security.AuthService;
import com.skytrix.utils.CustomPageable;

@Service
public class CardPossessedService {
    @Inject
    private AuthService authService;

    @Inject
    private CardPossessedRepository cardPossessedRepository;

    @Inject
    private CardSetRepository cardSetRepository;

    @Inject
    private FilterService filterService;

    @Inject
    private CardMapper cardMapper;

    public CustomPageable<CardPossessedDTO> search(CardFilterDTO filter, int offset, int quantity) {
        var specification = filterService.cardPossessedSpecification(filter);
        filterService.cardPossessedSpecification(filter);
        return new CustomPageable<>(
            () -> cardPossessedRepository.findAll(specification, PageRequest.of(offset, quantity)),
            cardMapper::toCardPossessedDTO
        );
    }

    @Transactional
    public void updatePossessedCards(UpdatePossessedCardDTO updateDTO) {
        var updatedPossessedCards = updateDTO.getCards();

        var concernedPossessedCards = cardPossessedRepository.findAllByCardSetIdInAndUserId(
            mapToList(updatedPossessedCards, ShortCardPossessedDTO::getCardSetId),
                authService.getConnectedUserId()
        );

        // create non-existing
        var cardsToCreate = updatedPossessedCards.stream()
            .filter(cardToCreate ->
                cardToCreate.getNumber() > 0
                && concernedPossessedCards.stream().noneMatch(currentCard -> currentCard.getCardSet().getId() == cardToCreate.getCardSetId()))
            .toList();
        createPossessedCards(cardsToCreate);

        // update existing
        concernedPossessedCards.forEach(existingConcerned -> {
            var updated = findAny(updatedPossessedCards, updatePossessed -> updatePossessed.getCardSetId() == existingConcerned.getCardSet().getId());
            existingConcerned.setNumber(updated.getNumber());
        });

        // delete all existing updated with number to 0
        cardPossessedRepository.deleteAll(filter(concernedPossessedCards, concerned -> concerned.getNumber() == 0));
    }

    @Transactional
    public List<ShortCardPossessedDTO> getAllShort() {
        return mapToList(cardPossessedRepository.findAll(), cardMapper::toShortCardPossessedDTO);
    }

    private void createPossessedCards(List<ShortCardPossessedDTO> possessedCards) {
        var cardSets = cardSetRepository.findAllByIdIn(mapToList(possessedCards, ShortCardPossessedDTO::getCardSetId));
        cardPossessedRepository.saveAll(
            mapToList(possessedCards, possessedCard -> cardMapper.toCardPossessed(
                findAny(cardSets, cardSet -> cardSet.getId() == possessedCard.getCardSetId()),
                possessedCard.getNumber()
            )
        ));
    }

}
