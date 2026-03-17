package com.skytrix.service;

import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

import static com.skytrix.utils.CoreUtils.mapToList;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.mapper.CardMapper;
import com.skytrix.model.dto.card.CardDetailedDTO;
import com.skytrix.model.dto.card.CardFilterDTO;
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

    public CardDetailedDTO getCardByCode(long cardCode) {
        var card = cardRepository.findByPasscode(cardCode);
        if (card == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return cardMapper.toCardDetailedDTO(card);
    }

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
