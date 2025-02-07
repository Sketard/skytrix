package com.skytrix.service;

import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

import static com.skytrix.utils.CoreUtils.mapToList;

import java.util.List;
import java.util.Objects;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import com.skytrix.mapper.CardMapper;
import com.skytrix.model.dto.card.CardDetailedDTO;
import com.skytrix.model.dto.card.CardFilterDTO;
import com.skytrix.repository.CardRepository;
import com.skytrix.repository.UserRepository;
import com.skytrix.security.AuthService;
import com.skytrix.utils.CustomPageable;

@Service
public class CardService {
    @Inject
    private CardRepository cardRepository;

    @Inject
    private UserRepository userRepository;

    @Inject
    private FilterService filterService;

    @Inject
    private AuthService authService;

    @Inject
    private CardMapper cardMapper;

    public CustomPageable<CardDetailedDTO> search(CardFilterDTO filter, int offset, int quantity) {
        return new CustomPageable<>(
            () -> cardRepository.findAll(filterService.cardSpecification(filter), PageRequest.of(offset, quantity)),
            cardMapper::toCardDetailedDTO
        );
    }

    @Transactional
    public void addFavorite(Long cardId) {
        var user =  authService.getConnectedUser();
        var card = cardRepository.findById(cardId).orElseThrow();
        user.getFavoriteCards().add(card);
        card.getFavoritedBy().add(user);
    }

    @Transactional
    public List<CardDetailedDTO> removeFavorite(Long cardId) {
        var user =  authService.getConnectedUser();
        var card = cardRepository.findById(cardId).orElseThrow();
        user.getFavoriteCards().removeIf(favoriteCard -> Objects.equals(favoriteCard.getId(), cardId));
        card.getFavoritedBy().removeIf(cardUser -> Objects.equals(user.getId(), cardUser.getId()));
        return mapToList(user.getFavoriteCards(), cardMapper::toCardDetailedDTO);
    }
}
