package com.skytrix.service;

import jakarta.inject.Inject;

import static com.skytrix.utils.CoreUtils.mapToList;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.mapper.CardMapper;
import com.skytrix.model.dto.card.CardDetailedDTO;
import com.skytrix.model.dto.card.CardFilterDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardUserPossessed;
import com.skytrix.repository.CardRepository;
import com.skytrix.repository.CardUserPossessedRepository;
import com.skytrix.repository.UserRepository;
import com.skytrix.security.AuthService;
import com.skytrix.utils.CustomPageable;

@Service
public class CardService {
    @Inject
    private CardRepository cardRepository;

    @Inject
    private CardUserPossessedRepository cardUserPossessedRepository;

    @Inject
    private UserRepository userRepository;

    @Inject
    private FilterService filterService;

    @Inject
    private AuthService authService;

    @Inject
    private CardMapper cardMapper;

    // readOnly tx: Card.sets/images/translations are LAZY — the mapper walks
    // them after the repository call, so a persistence context must stay open
    // for the mapping. Without this, the call works only under open-in-view
    // (which the perf audit B-M1 plans to disable) → LazyInitializationException.
    @Transactional(readOnly = true)
    public CardDetailedDTO getCardByCode(long cardCode) {
        var card = cardRepository.findByPasscode(cardCode);
        if (card == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return cardMapper.toCardDetailedDTO(card);
    }

    // readOnly tx: same LAZY-collection reason as getCardByCode — the mapper
    // runs inside the CustomPageable lambda, walking Card.sets/images.
    @Transactional(readOnly = true)
    public CustomPageable<CardDetailedDTO> search(CardFilterDTO filter, int offset, int quantity) {
        var page = cardRepository.findAll(filterService.cardSpecification(filter), PageRequest.of(offset, quantity));
        // Load every favorited id for the page in ONE query (perf-audit B-M6 —
        // was one EXISTS per card). Empty page → empty set, no query.
        var cardIds = mapToList(page.getContent(), Card::getId);
        var favoritedIds = cardIds.isEmpty()
            ? Set.<Long>of()
            : Set.copyOf(cardRepository.findFavoritedCardIds(authService.getConnectedUserId(), cardIds));
        return new CustomPageable<>(
            () -> page,
            card -> cardMapper.toCardDetailedDTO(card, favoritedIds)
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

    @Transactional
    public void updatePossessedNumber(Long cardId, Long userId, Integer number) {
        var card = cardRepository.findById(cardId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        var existing = cardUserPossessedRepository.findByCardIdAndUserId(cardId, userId);
        if (existing.isPresent()) {
            if (number > 0) {
                existing.get().setPossessedNumber(number);
                cardUserPossessedRepository.save(existing.get());
            } else {
                cardUserPossessedRepository.delete(existing.get());
            }
        } else if (number > 0) {
            var user = authService.getConnectedUser();
            var entry = new CardUserPossessed();
            entry.setCard(card);
            entry.setUser(user);
            entry.setPossessedNumber(number);
            cardUserPossessedRepository.save(entry);
        }
    }

    public List<Map<String, Object>> searchNames(String query) {
        var results = cardRepository.searchNamesByQuery(query, 30);
        return results.stream()
            .map(row -> Map.<String, Object>of("code", row[0], "name", row[1]))
            .toList();
    }

    public Map<Long, Integer> getPossessedMap(Long userId) {
        return cardUserPossessedRepository.findAllByUserId(userId)
            .stream()
            .collect(Collectors.toMap(e -> e.getCard().getId(), CardUserPossessed::getPossessedNumber));
    }
}
