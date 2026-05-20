package com.skytrix.service;

import jakarta.inject.Inject;

import static com.skytrix.utils.CoreUtils.findAny;
import static com.skytrix.utils.CoreUtils.getNullSafe;
import static com.skytrix.utils.CoreUtils.mapToList;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
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
        var mainIds = getNullSafe(createDTO.getMainIds());
        var extraIds = getNullSafe(createDTO.getExtraIds());
        var sideIds = getNullSafe(createDTO.getSideIds());
        var allCardEntries = Stream.of(mainIds, extraIds, sideIds).flatMap(Collection::stream).toList();
        var imageIds = getNullSafe(createDTO.getImageIds());

        var cards = cardRepository.findAllByIdIn(mapToList(allCardEntries, EntityIndexDTO::getId));
        var images = cardImageRepository.findAllByIdIn(mapToList(imageIds, EntityIndexDTO::getId));

        var selectedImageIds = allCardEntries.stream()
                .map(EntityIndexDTO::getImageId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        var selectedImages = selectedImageIds.isEmpty()
                ? Map.<Long, CardImage>of()
                : cardImageRepository.findAllByIdIn(selectedImageIds).stream()
                    .collect(Collectors.toMap(CardImage::getId, Function.identity()));

        var deckId = createDTO.getId();
        var deck = new Deck();
        if (deckId != null) {
            deck = deckRepository.findById(deckId).orElseThrow();
        }

        deck.getImages().clear();
        deck.addImages(getImageIndexed(imageIds, images, deck));
        deck.setName(createDTO.getName());
        deck.getCardsIndexed().clear();
        deck.addCards(getCardDeckIndex(mainIds, cards, deck, DeckKeyword.MAIN, selectedImages));
        deck.addCards(getCardDeckIndex(extraIds, cards, deck, DeckKeyword.EXTRA, selectedImages));
        deck.addCards(getCardDeckIndex(sideIds, cards, deck, DeckKeyword.SIDE, selectedImages));
        deck.setUser(authService.getConnectedUser());
        // @UpdateTimestamp only fires when Hibernate detects a dirty field on
        // the parent entity. Edits that touch only the child collection
        // (cardsIndexed / images — the most common case: adding/removing
        // cards without renaming the deck) would NOT bump updated_at,
        // breaking the deck-list "Recent" sort. Force it here so the
        // timestamp always reflects the user's last meaningful action.
        deck.setUpdatedAt(Instant.now());
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

    private List<CardDeckIndex> getCardDeckIndex(List<EntityIndexDTO> cardsIndexed, List<Card> cards, Deck deck, DeckKeyword type, Map<Long, CardImage> selectedImages)  {
        if (cardsIndexed == null) {
            return List.of();
        }
        return mapToList(cardsIndexed, cid -> {
            var card = findAny(cards, c -> Objects.equals(c.getId(), cid.getId()));
            CardImage selectedImage = null;
            if (cid.getImageId() != null) {
                selectedImage = selectedImages.get(cid.getImageId());
                if (selectedImage != null && !Objects.equals(selectedImage.getCard().getId(), card.getId())) {
                    selectedImage = null;
                }
            }
            return deckMapper.toCardDeckIndex(card, cid.getIndex(), type, deck, selectedImage);
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
