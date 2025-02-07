package com.skytrix.service;

import jakarta.inject.Inject;

import static com.skytrix.model.enums.Language.EN;
import static com.skytrix.model.enums.Language.FR;
import static com.skytrix.utils.CoreUtils.findAny;
import static com.skytrix.utils.CoreUtils.mapToList;
import static java.lang.Thread.sleep;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationStartedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.skytrix.mapper.CardMapper;
import com.skytrix.model.dto.yugipro.YugiproCardDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardImage;
import com.skytrix.repository.CardImageRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.requester.YugiproRequester;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class YugiproApiService {
    @Inject
    private YugiproRequester requester;

    @Inject
    private CardMapper cardMapper;

    @Inject
    private CardRepository cardRepository;

    @Inject
    private CardImageRepository cardImageRepository;

    @Value("${document.folder.image.small}")
    private String smallImageFolder;

    @Value("${document.folder.image.big}")
    private String bigImageFolder;

    @Transactional
    public void fetchAll() {
        var fetchedCardsEn = requester.fetchAll(EN);
        var fetchedCardsFr = requester.fetchAll(FR);

        var fetchedCardsEnMap = fetchedCardsEn.stream().collect(Collectors.toMap(YugiproCardDTO::getId, Function.identity()));
        var fetchedCardsFrMap = fetchedCardsFr.stream().collect(Collectors.toMap(YugiproCardDTO::getId, Function.identity()));

        var allSavedCardsMap = cardRepository.findAll().stream().collect(Collectors.toMap(Card::getPasscode, Function.identity()));

        var missing = new ArrayList<YugiproCardDTO>();
        fetchedCardsEnMap.forEach((key, value) -> {
            if (!allSavedCardsMap.containsKey(key)) {
                missing.add(value);
            }
        });

        var missingFrCards = new ArrayList<Card>();
        allSavedCardsMap.forEach((key, value) -> {
            if (!value.hasTranslation(FR)) {
                missingFrCards.add(value);
            }
            var updatedCard = fetchedCardsEnMap.get(key);
            if (value.getFirstTcgRelease() == null && updatedCard != null) {
                value.setFirstTcgRelease(updatedCard.getFirstTcgRelease());
            }
        });

        var cards = mapToList(missing, cardDTO -> cardMapper.toCard(cardDTO, EN));
        cards.addAll(missingFrCards);

        cards.forEach(missingFrCard -> {
            var tradCard = fetchedCardsFrMap.getOrDefault(missingFrCard.getPasscode(), null);
            missingFrCard.addTranslation(tradCard, FR);
        });

        cardRepository.saveAll(cards);
    }

    @Transactional
    public void fetchAllBanList() {
        var fetchedCardsEn = requester.fetchAll(EN);
        var  allSavedCards = cardRepository.findAll();
        var missingCards = new ArrayList<String>();

        allSavedCards.forEach(card -> {
            try {
                var cardFetch = findAny(fetchedCardsEn, fetchedCard -> Objects.equals(card.getPasscode(), fetchedCard.getId()));
                card.setBanInfo(cardFetch.getTcgBanInfo());
            } catch(NoSuchElementException e) {
                missingCards.add(card.getName());
            }
        });

        if (!missingCards.isEmpty()) {
            log.warn("Some cards are missing : {}", missingCards);
        }
    }

    public void fetchAllMissingImageAndSave() {
        var page = cardImageRepository.findAllBySmallLocalOrLocal(false, false, PageRequest.of(0, 100));
        var pageCount = 0;
        while (page.hasContent()) {
            log.info("Starting fetching images number {}. Remaining {}", pageCount, page.getTotalPages());
            fetchAllAndSave(page.getContent(), false);
            page = cardImageRepository.findAllBySmallLocalOrLocal(false, false, PageRequest.of(0, 100));
            log.info("ending fetching images number {}. Remaining {}", pageCount++, page.getTotalPages());
        }
    }

    @Transactional
    public void updateTcgImages() {
        var cards = cardImageRepository.findAllByTcgUpdatedAndCardFirstTcgReleaseIsNotNull(false);
        fetchAllAndSave(cards, true);
    }

    private void fetchAllAndSave(List<CardImage> cardImages, boolean forceUpdate) {
        cardImages.forEach(cardImage -> fetchAndSaveImages(cardImage, forceUpdate));
    }

    private void fetchAndSaveImages(CardImage cardImage, boolean forceUpdate) {
        var imageId = cardImage.getImageId();
        var smallPath = smallImageFolder + imageId + ".jpg";
        var bigPath = bigImageFolder + imageId + ".jpg";

        createImage(smallPath, cardImage, true, forceUpdate);
        cardImage.setSmallUrl(smallPath);
        cardImage.setSmallLocal(true);
        createImage(bigPath, cardImage, false, forceUpdate);
        cardImage.setUrl(bigPath);
        cardImage.setLocal(true);
        if (cardImage.getCard().getFirstTcgRelease() != null) {
            cardImage.setTcgUpdated(true);
        }
        cardImageRepository.save(cardImage);
    }

    private void createImage(String path, CardImage cardImage, boolean small, boolean forceUpdate) {
        if (!Files.exists(Path.of(path)) || forceUpdate) {
            var file = new File(path);
            try (FileOutputStream outputStream = new FileOutputStream(file)) {
                var byteArray = requester.fetchImage(cardImage, small);
                outputStream.write(byteArray);
                sleep(250);
            } catch (IOException ignored) {
                log.warn("Carte avec l'imageId {} non récupérée", cardImage.getImageId());
            } catch(InterruptedException e) {
                Thread.currentThread().interrupt();
                log.error(e.getMessage());
            }
        }
    }

}
