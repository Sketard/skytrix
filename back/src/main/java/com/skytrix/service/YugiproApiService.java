package com.skytrix.service;

import com.skytrix.mapper.CardMapper;
import com.skytrix.model.dto.yugipro.YugiproCardDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardImage;
import com.skytrix.repository.CardImageRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.requester.YugiproRequester;
import jakarta.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.stream.Collectors;

import static com.skytrix.model.enums.Language.EN;
import static com.skytrix.model.enums.Language.FR;
import static com.skytrix.utils.CoreUtils.mapToList;
import static java.lang.Thread.sleep;

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

    @Inject
    private SyncTaskTracker syncTaskTracker;

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
        var reconciledCards = new ArrayList<Card>();

        fetchedCardsEnMap.forEach((key, value) -> {
            if (!allSavedCardsMap.containsKey(key)) {
                var betaId = value.getBetaId();
                var existingByBetaId = betaId != null ? allSavedCardsMap.get(betaId) : null;
                if (existingByBetaId != null) {
                    log.info("Passcode reconciliation via beta_id: '{}' {} → {}", value.getName(), betaId, key);
                    existingByBetaId.setPasscode(key);
                    reconciledCards.add(existingByBetaId);
                } else {
                    missing.add(value);
                }
            }
        });

        if (!reconciledCards.isEmpty()) {
            cardRepository.saveAll(reconciledCards);
            reconciledCards.forEach(card -> allSavedCardsMap.put(card.getPasscode(), card));
            log.info("Reconciled {} cards via beta_id", reconciledCards.size());
        }

        var updatedCards = new ArrayList<Card>();
        allSavedCardsMap.forEach((key, value) -> {
            var enCard = fetchedCardsEnMap.get(key);
            if (enCard != null) {
                var changed = false;
                if (value.getFirstTcgRelease() == null && enCard.getFirstTcgRelease() != null) {
                    value.setFirstTcgRelease(enCard.getFirstTcgRelease());
                    changed = true;
                }
                // Update card fields if YGOPro data changed
                if (!Objects.equals(value.getAtk(), enCard.getAtk())) { value.setAtk(enCard.getAtk()); changed = true; }
                if (!Objects.equals(value.getDef(), enCard.getDef())) { value.setDef(enCard.getDef()); changed = true; }
                if (!Objects.equals(value.getLevel(), enCard.getLevel())) { value.setLevel(enCard.getLevel()); changed = true; }
                if (!Objects.equals(value.getScale(), enCard.getScale())) { value.setScale(enCard.getScale()); changed = true; }
                if (!Objects.equals(value.getLinkval(), enCard.getLinkval())) { value.setLinkval(enCard.getLinkval()); changed = true; }
                // Update translations (upsert)
                value.addTranslation(enCard, EN);
                if (changed) {
                    updatedCards.add(value);
                }
            }
            // Add or update FR translation
            var frCard = fetchedCardsFrMap.get(key);
            if (frCard != null) {
                value.addTranslation(frCard, FR);
            }
        });

        if (!updatedCards.isEmpty()) {
            cardRepository.saveAll(updatedCards);
            log.info("Updated {} existing cards", updatedCards.size());
        }

        var newCards = mapToList(missing, cardDTO -> cardMapper.toCard(cardDTO, EN));
        newCards.forEach(newCard -> {
            var tradCard = fetchedCardsFrMap.getOrDefault(newCard.getPasscode(), null);
            newCard.addTranslation(tradCard, FR);
        });

        if (!newCards.isEmpty()) {
            cardRepository.saveAll(newCards);
            log.info("Added {} new cards", newCards.size());
        }
    }

    @Transactional
    public void fetchAllBanList() {
        var fetchedCardsEn = requester.fetchAll(EN);
        var fetchedCardsMap = fetchedCardsEn.stream().collect(Collectors.toMap(YugiproCardDTO::getId, Function.identity()));
        var allSavedCards = cardRepository.findAll();
        var missingCards = new ArrayList<String>();
        var updatedCards = new ArrayList<Card>();

        allSavedCards.forEach(card -> {
            var cardFetch = fetchedCardsMap.get(card.getPasscode());
            if (cardFetch == null) {
                cardFetch = requester.fetchById(card.getPasscode());
                if (cardFetch == null) {
                    missingCards.add("passcode:" + card.getPasscode());
                    return;
                }
            }
            var banChanged = !Objects.equals(card.getBanInfo(), cardFetch.getTcgBanInfo());
            var genesysChanged = !Objects.equals(card.getGenesysPoint(), cardFetch.getGenesysPoint());
            if (banChanged || genesysChanged) {
                card.setBanInfo(cardFetch.getTcgBanInfo());
                card.setGenesysPoint(cardFetch.getGenesysPoint());
                updatedCards.add(card);
            }
        });

        if (!updatedCards.isEmpty()) {
            cardRepository.saveAll(updatedCards);
            log.info("Updated ban info for {} cards", updatedCards.size());
        }
        if (!missingCards.isEmpty()) {
            log.warn("Some cards are missing : {}", missingCards);
        }
    }

    private static final int IMAGE_THREAD_POOL_SIZE = 4;
    private static final int MAX_CONSECUTIVE_FAILURES = 10;
    private static final long IMAGE_THROTTLE_MS = 50;

    public void fetchAllMissingImageAndSave() {
        var task = syncTaskTracker.get("images");
        var executor = Executors.newFixedThreadPool(IMAGE_THREAD_POOL_SIZE);
        try {
            var firstPage = cardImageRepository.findAllBySmallLocalOrLocal(false, false, PageRequest.of(0, 100));
            task.start((int) firstPage.getTotalElements());
            var consecutiveFailures = new AtomicInteger(0);
            var page = firstPage;
            var pageCount = 0;
            while (page.hasContent()) {
                waitWhilePaused(task);
                log.info("Fetching images page {}. Remaining pages: {}", pageCount, page.getTotalPages());
                var results = fetchAllAndSaveParallel(page.getContent(), false, executor, consecutiveFailures, task);
                if (results.circuitBroken) {
                    log.error("Circuit breaker tripped after {} consecutive failures — aborting image fetch. {} images still missing.",
                            MAX_CONSECUTIVE_FAILURES, page.getTotalElements());
                    task.fail("Circuit breaker: " + MAX_CONSECUTIVE_FAILURES + " échecs consécutifs");
                    return;
                }
                page = cardImageRepository.findAllBySmallLocalOrLocal(false, false, PageRequest.of(0, 100));
                log.info("Finished images page {}. Succeeded: {}, Failed: {}", pageCount++, results.succeeded, results.failed);
            }
            task.complete();
        } catch (Exception e) {
            task.fail(e.getMessage());
            throw e;
        } finally {
            executor.shutdown();
        }
    }

    public void updateTcgImages() {
        var task = syncTaskTracker.get("tcgImages");
        var executor = Executors.newFixedThreadPool(IMAGE_THREAD_POOL_SIZE);
        try {
            log.info("Starting fetching images TCG");
            var cards = cardImageRepository.findAllByTcgUpdatedAndCardFirstTcgReleaseIsNotNull(false);
            task.start(cards.size());
            fetchAllAndSaveParallel(cards, true, executor, new AtomicInteger(0), task);
            task.complete();
            log.info("Ending fetching images TCG");
        } catch (Exception e) {
            task.fail(e.getMessage());
            throw e;
        } finally {
            executor.shutdown();
        }
    }

    @Transactional
    public void refreshCardImages(Long cardId) {
        log.info("Refreshing images for card ID: {}", cardId);
        var card = cardRepository.findById(cardId).orElseThrow(() -> new NoSuchElementException("Card not found with ID: " + cardId));
        var cardImages = card.getImages();
        for (CardImage cardImage : cardImages) {
            fetchAndSaveImages(cardImage, true);
        }
        cardImageRepository.saveAll(cardImages);
        log.info("Finished refreshing images for card ID: {}", cardId);
    }

    private record BatchResult(int succeeded, int failed, boolean circuitBroken) {}

    private BatchResult fetchAllAndSaveParallel(List<CardImage> cardImages, boolean forceUpdate,
                                                 ExecutorService executor, AtomicInteger consecutiveFailures,
                                                 SyncTaskTracker.TaskState task) {
        var futures = new ArrayList<Future<Boolean>>();
        var submittedImages = new ArrayList<CardImage>();
        for (var cardImage : cardImages) {
            if (consecutiveFailures.get() >= MAX_CONSECUTIVE_FAILURES) {
                break;
            }
            submittedImages.add(cardImage);
            futures.add(executor.submit(() -> {
                var ok = fetchAndSaveImages(cardImage, forceUpdate);
                if (ok) {
                    consecutiveFailures.set(0);
                    task.incrementProcessed();
                } else {
                    consecutiveFailures.incrementAndGet();
                    task.incrementFailed();
                }
                return ok;
            }));
        }

        int succeeded = 0;
        int failed = 0;
        for (var future : futures) {
            try {
                if (future.get()) succeeded++;
                else failed++;
            } catch (Exception e) {
                failed++;
                consecutiveFailures.incrementAndGet();
                task.incrementFailed();
            }
        }

        if (!submittedImages.isEmpty()) {
            cardImageRepository.saveAll(submittedImages);
        }

        return new BatchResult(succeeded, failed, consecutiveFailures.get() >= MAX_CONSECUTIVE_FAILURES);
    }

    private boolean fetchAndSaveImages(CardImage cardImage, boolean forceUpdate) {
        var imageId = cardImage.getImageId();
        var smallPath = smallImageFolder + imageId + ".jpg";
        var bigPath = bigImageFolder + imageId + ".jpg";

        var smallOk = createImage(smallPath, cardImage, true, forceUpdate);
        if (smallOk) {
            cardImage.setSmallUrl(smallPath);
            cardImage.setSmallLocal(true);
        }
        var bigOk = createImage(bigPath, cardImage, false, forceUpdate);
        if (bigOk) {
            cardImage.setUrl(bigPath);
            cardImage.setLocal(true);
        }
        if (cardImage.getCard().getFirstTcgRelease() != null && smallOk && bigOk) {
            cardImage.setTcgUpdated(true);
        }
        return smallOk || bigOk;
    }

    private void waitWhilePaused(SyncTaskTracker.TaskState task) {
        while (task.shouldPause()) {
            try {
                sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private boolean createImage(String path, CardImage cardImage, boolean small, boolean forceUpdate) {
        if (Files.exists(Path.of(path)) && !forceUpdate) {
            return true;
        }
        var tmpPath = Path.of(path + ".tmp");
        try {
            var byteArray = requester.fetchImage(cardImage, small);
            if (byteArray == null || byteArray.length == 0) {
                log.warn("Empty image data for imageId {}", cardImage.getImageId());
                return false;
            }
            Files.write(tmpPath, byteArray);
            Files.move(tmpPath, Path.of(path), StandardCopyOption.REPLACE_EXISTING);
            sleep(IMAGE_THROTTLE_MS);
            return true;
        } catch (IOException e) {
            log.error("Failed to fetch/write image for imageId {}: {}", cardImage.getImageId(), e.getMessage());
            try { Files.deleteIfExists(tmpPath); } catch (IOException ignored) {}
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Interrupted while fetching imageId {}", cardImage.getImageId());
            try { Files.deleteIfExists(tmpPath); } catch (IOException ignored) {}
            return false;
        }
    }

}
