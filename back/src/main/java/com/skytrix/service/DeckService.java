package com.skytrix.service;

import jakarta.inject.Inject;

import static com.skytrix.utils.CoreUtils.findAny;
import static com.skytrix.utils.CoreUtils.mapToList;

import java.util.Collection;
import java.util.List;
import java.util.Objects;
import java.util.stream.Stream;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.skytrix.mapper.DeckMapper;
import com.skytrix.model.dto.deck.CreateDeckDTO;
import com.skytrix.model.dto.deck.DeckDTO;
import com.skytrix.model.dto.deck.EntityIndexDTO;
import com.skytrix.model.dto.deck.ShortDeckDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardDeckIndex;
import com.skytrix.model.entity.CardImage;
import com.skytrix.model.entity.Deck;
import com.skytrix.model.entity.ImageIndex;
import com.skytrix.model.enums.DeckKeyword;
import com.skytrix.repository.CardImageRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.repository.DeckRepository;
import com.skytrix.security.AuthService;

@Service
public class DeckService {
    @Inject
    private DeckRepository deckRepository;

    @Inject
    private CardRepository cardRepository;

    @Inject
    private CardImageRepository cardImageRepository;

    @Inject
    private DeckMapper deckMapper;

    @Inject
    private AuthService authService;

    @Transactional
    public DeckDTO createDeck(CreateDeckDTO createDTO) {
        var mainIds = createDTO.getMainIds();
        var extraIds = createDTO.getExtraIds();
        var sideIds = createDTO.getSideIds();
        var cardIds = Stream.of(mainIds, extraIds, sideIds).flatMap(Collection::stream).toList();
        var imageIds = createDTO.getImageIds();

        var cards = cardRepository.findAllByIdIn(mapToList(cardIds, EntityIndexDTO::getId));
        var images = cardImageRepository.findAllByIdIn(mapToList(imageIds, EntityIndexDTO::getId));
        var deckId = createDTO.getId();
        var deck = new Deck();
        if (deckId != null) {
            deck = deckRepository.findById(deckId).orElseThrow();
        }

        deck.getImages().clear();
        deck.addImages(getImageIndexed(imageIds, images, deck));
        deck.setName(createDTO.getName());
        deck.getCardsIndexed().clear();
        deck.addCards(getCardDeckIndex(mainIds, cards, deck, DeckKeyword.MAIN));
        deck.addCards(getCardDeckIndex(extraIds, cards, deck, DeckKeyword.EXTRA));
        deck.addCards(getCardDeckIndex(sideIds, cards, deck, DeckKeyword.SIDE));
        deck.setUser(authService.getConnectedUser());
        deckRepository.save(deck);
        return deckMapper.toDeckDTO(deck);
    }

    public DeckDTO getById(Long id) {
        return deckMapper.toDeckDTO(deckRepository.findById(id).orElseThrow());
    }

    public List<ShortDeckDTO> getAll() {
        return mapToList(deckRepository.findAllByUserId(authService.getConnectedUserId()), deck -> deckMapper.toShortDeckDTO(deck));
    }

    public void deleteById(Long id) {
        deckRepository.deleteById(id);
    }

    private List<CardDeckIndex> getCardDeckIndex(List<EntityIndexDTO> cardsIndexed, List<Card> cards, Deck deck, DeckKeyword type)  {
        if (cardsIndexed == null) {
            return List.of();
        }
        return mapToList(cardsIndexed, cid -> {
            var card = findAny(cards, c -> Objects.equals(c.getId(), cid.getId()));
            return deckMapper.toCardDeckIndex(card, cid.getIndex(), type, deck);
        });
    }

    private List<ImageIndex> getImageIndexed(List<EntityIndexDTO> entityIndexes, List<CardImage> images, Deck deck)  {
        if (entityIndexes == null) {
            return List.of();
        }
        return mapToList(entityIndexes, index -> {
            var image = findAny(images, i -> Objects.equals(i.getId(), index.getId()));
            return deckMapper.toImageIndex(image, index.getIndex(), deck);
        });
    }

}
