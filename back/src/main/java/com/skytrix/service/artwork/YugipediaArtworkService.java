package com.skytrix.service.artwork;

import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardImage;
import com.skytrix.model.enums.ImageSource;
import com.skytrix.repository.CardImageRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.requester.YugipediaRequester;
import com.skytrix.service.SyncTaskTracker;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static com.skytrix.service.artwork.CardScanImages.BIG_HEIGHT;
import static com.skytrix.service.artwork.CardScanImages.BIG_WIDTH;
import static com.skytrix.service.artwork.CardScanImages.SAME_ARTWORK_MAX_DISTANCE;
import static com.skytrix.service.artwork.CardScanImages.SMALL_HEIGHT;
import static com.skytrix.service.artwork.CardScanImages.SMALL_WIDTH;

/**
 * Adds the artworks YGOPRODeck lacks (alternate arts, full arts) from Yugipedia card scans.
 *
 * <p>For each card never checked, or whose page changed since the last sync: read the {@code image} parameter of
 * its Yugipedia page, keep the artworks that have an English scan, compare each scan with the YGOPRODeck images of
 * the card (perceptual hash of the illustration) and import the scans that match none as new {@link CardImage}s
 * ({@link ImageSource#YUGIPEDIA}).
 * YGOPRODeck images are never modified. Background and measures: {@code work/yugipedia-artworks/README.md}.
 */
@Service
@Slf4j
public class YugipediaArtworkService {
    /** Yugipedia artworks get image ids far above any YGOPRODeck id (≤ 10 digits) so file names never collide. */
    static final long IMAGE_ID_OFFSET = 90_000_000_000L;
    private static final float BIG_QUALITY = 0.85f;
    private static final float SMALL_QUALITY = 0.85f;

    private final YugipediaRequester requester;
    private final CardRepository cardRepository;
    private final CardImageRepository cardImageRepository;
    private final TransactionTemplate transactionTemplate;

    @Value("${document.folder.image.small}")
    private String smallImageFolder;

    @Value("${document.folder.image.big}")
    private String bigImageFolder;

    public YugipediaArtworkService(YugipediaRequester requester, CardRepository cardRepository,
                                   CardImageRepository cardImageRepository, TransactionTemplate transactionTemplate) {
        this.requester = requester;
        this.cardRepository = cardRepository;
        this.cardImageRepository = cardImageRepository;
        this.transactionTemplate = transactionTemplate;
    }

    /** Up to this many new cards, their pages are looked up by passcode rather than listing every card page. */
    private static final int TITLE_LOOKUP_MAX = 100;
    /** Pages edited while the previous sync ran, clock differences: look back a little further. */
    private static final Duration MODIFIED_MARGIN = Duration.ofDays(1);
    private static final int IN_CLAUSE_CHUNK = 1000;

    /** A card to look at; {@code previousCount} is null when it was never checked (or checked before counts). */
    record CardToCheck(Long cardId, Long passcode, Integer previousCount) {
    }

    /**
     * Processes the cards never checked, then the checked cards whose Yugipedia page was edited since the last sync
     * (a new artwork shows up as an edit of the page). An edited page is downloaded again only when it lists more
     * artworks than last time. Progress goes to {@code task} (restarted with the number of cards to look at), which
     * can pause the run between two batches.
     */
    public void importNewArtworks(SyncTaskTracker.TaskState task) {
        var toCheck = new LinkedHashMap<Long, CardToCheck>();
        for (var row : cardRepository.findIdAndPasscodeOfCardsNeverCheckedForArtworks()) {
            toCheck.put((Long) row[1], new CardToCheck((Long) row[0], (Long) row[1], null));
        }
        var titles = new HashMap<Long, String>();
        var lastSync = cardRepository.findLastYugipediaArtworksCheck();
        if (lastSync != null) {
            var modified = requester.fetchCardsModifiedSince(lastSync.minus(MODIFIED_MARGIN));
            titles.putAll(modified);
            var passcodes = new ArrayList<>(modified.keySet());
            for (int i = 0; i < passcodes.size(); i += IN_CLAUSE_CHUNK) {
                var chunk = passcodes.subList(i, Math.min(i + IN_CLAUSE_CHUNK, passcodes.size()));
                for (var row : cardRepository.findArtworkCheckOfCheckedCards(chunk)) {
                    toCheck.putIfAbsent((Long) row[1], new CardToCheck((Long) row[0], (Long) row[1], (Integer) row[2]));
                }
            }
        }
        if (toCheck.isEmpty()) {
            log.info("Yugipedia artworks: no card to check");
            return;
        }
        task.start(toCheck.size());
        log.info("Yugipedia artworks: {} cards to check", toCheck.size());

        var withoutTitle = toCheck.keySet().stream().filter(p -> !titles.containsKey(p)).toList();
        if (!withoutTitle.isEmpty()) {
            titles.putAll(withoutTitle.size() <= TITLE_LOOKUP_MAX
                    ? requester.fetchPageTitles(withoutTitle)
                    : requester.fetchPageTitles());
        }
        var withPage = new ArrayList<CardToCheck>();
        var withoutPage = new ArrayList<CheckResult>();
        toCheck.values().forEach(card -> {
            if (titles.containsKey(card.passcode())) {
                withPage.add(card);
            } else {
                withoutPage.add(new CheckResult(card.cardId(), null));
            }
        });
        markChecked(withoutPage, task);

        var imported = 0;
        for (int i = 0; i < withPage.size(); i += YugipediaRequester.TITLES_PER_REQUEST) {
            waitWhilePaused(task);
            var batch = withPage.subList(i, Math.min(i + YugipediaRequester.TITLES_PER_REQUEST, withPage.size()));
            imported += processBatch(batch, titles, task);
        }
        log.info("Yugipedia artworks: done, {} artworks imported", imported);
    }

    private record CheckResult(Long cardId, Integer artworkCount) {
    }

    private int processBatch(List<CardToCheck> batch, Map<Long, String> titles, SyncTaskTracker.TaskState task) {
        var wikitexts = requester.fetchWikitexts(batch.stream().map(c -> titles.get(c.passcode())).toList());

        // No download when the page cannot bring anything: a single artwork, no English scan, or an edited page
        // that lists no more artworks than at the previous check.
        var toProcess = new ArrayList<CardToCheck>();
        var scansByCard = new HashMap<Long, Map<Integer, String>>();
        var counts = new HashMap<Long, Integer>();
        var nothingToDo = new ArrayList<CheckResult>();
        for (var card : batch) {
            var rows = YugipediaArtworkParser.parse(wikitexts.get(titles.get(card.passcode())));
            var count = YugipediaArtworkParser.artworkCount(rows);
            var scans = YugipediaArtworkParser.englishScanPerArtwork(rows);
            var noGrowth = card.previousCount() != null && count <= card.previousCount();
            if (noGrowth || count < 2 || scans.isEmpty()) {
                nothingToDo.add(new CheckResult(card.cardId(), count));
            } else {
                toProcess.add(card);
                scansByCard.put(card.cardId(), scans);
                counts.put(card.cardId(), count);
            }
        }
        markChecked(nothingToDo, task);

        var urls = resolveUrls(scansByCard.values().stream().flatMap(m -> m.values().stream())
                .collect(Collectors.toCollection(LinkedHashSet::new)));
        var imported = 0;
        for (var card : toProcess) {
            try {
                var count = transactionTemplate.execute(status ->
                        processCard(card.cardId(), scansByCard.get(card.cardId()), urls, counts.get(card.cardId())));
                imported += Objects.requireNonNullElse(count, 0);
                task.incrementProcessed();
            } catch (Exception e) {
                // Not marked as checked: the next run tries this card again.
                log.warn("Yugipedia artworks: card {} failed: {}", card.passcode(), e.getMessage());
                task.incrementFailed();
            }
        }
        return imported;
    }

    private Map<String, String> resolveUrls(Set<String> files) {
        var list = new ArrayList<>(files);
        var urls = new HashMap<String, String>();
        for (int i = 0; i < list.size(); i += YugipediaRequester.TITLES_PER_REQUEST) {
            urls.putAll(requester.fetchFileUrls(list.subList(i, Math.min(i + YugipediaRequester.TITLES_PER_REQUEST, list.size()))));
        }
        return urls;
    }

    /** @return number of artworks imported; the card is marked checked unless it must be retried */
    private int processCard(Long cardId, Map<Integer, String> scans, Map<String, String> urls, int artworkCount) {
        var card = cardRepository.findById(cardId).orElseThrow();
        var known = new ArrayList<boolean[]>();
        var alreadyImported = new HashSet<String>();
        for (var image : card.getImages()) {
            if (image.isFromYgoprodeck()) {
                var hash = hashOf(image.getSmallUrl());
                if (hash != null) {
                    known.add(hash);
                }
            } else if (image.getSourceFile() != null) {
                alreadyImported.add(image.getSourceFile());
            }
        }
        if (known.isEmpty()) {
            // YGOPRODeck images not downloaded yet: comparing is impossible, try again on a later run.
            log.info("Yugipedia artworks: card {} has no local image to compare with, retried later", card.getPasscode());
            return 0;
        }

        // Download and hash the English scans not imported yet.
        var candidates = new ArrayList<Candidate>();
        for (var file : scans.values()) {
            var url = urls.get(file);
            if (alreadyImported.contains(file) || url == null) {
                continue;
            }
            var bytes = requester.downloadFile(url);
            if (bytes == null) {
                throw new IllegalStateException("could not download " + file);
            }
            var scan = CardScanImages.read(bytes);
            candidates.add(new Candidate(file, bytes, CardScanImages.artworkHash(scan)));
        }

        // Each YGOPRODeck image claims its nearest scan when close enough; scans nobody claims are new artworks.
        // (Several YGOPRODeck ids can show the same drawing, so this is not a one-to-one assignment.)
        var claimed = new HashSet<String>();
        for (var hash : known) {
            candidates.stream()
                    .min((a, b) -> Integer.compare(CardScanImages.distance(hash, a.hash()), CardScanImages.distance(hash, b.hash())))
                    .filter(c -> CardScanImages.distance(hash, c.hash()) <= SAME_ARTWORK_MAX_DISTANCE)
                    .ifPresent(c -> claimed.add(c.file()));
        }
        var imported = 0;
        for (var candidate : candidates) {
            if (!claimed.contains(candidate.file())) {
                importArtwork(card, candidate);
                imported++;
            }
        }
        card.setYugipediaArtworksCheckedAt(Instant.now());
        card.setYugipediaArtworkCount(artworkCount);
        if (imported > 0) {
            log.info("Yugipedia artworks: {} new artwork(s) for card {}", imported, card.getPasscode());
        }
        return imported;
    }

    private record Candidate(String file, byte[] bytes, boolean[] hash) {
    }

    private void importArtwork(Card card, Candidate candidate) {
        var image = CardImage.builder()
                .card(card)
                .source(ImageSource.YUGIPEDIA)
                .sourceFile(candidate.file())
                .tcgUpdated(true)
                .build();
        image = cardImageRepository.save(image);
        // A new id for every import: images are served with a one-year immutable cache, a file must never change
        // behind an id the browsers already know.
        var imageId = IMAGE_ID_OFFSET + image.getId();
        var scan = CardScanImages.read(candidate.bytes());
        var big = CardScanImages.toCardImage(scan, BIG_WIDTH, BIG_HEIGHT);
        var small = CardScanImages.resize(big, SMALL_WIDTH, SMALL_HEIGHT);
        var bigPath = bigImageFolder + imageId + ".jpg";
        var smallPath = smallImageFolder + imageId + ".jpg";
        write(bigPath, CardScanImages.jpeg(big, BIG_QUALITY));
        write(smallPath, CardScanImages.jpeg(small, SMALL_QUALITY));
        image.setImageId(imageId);
        image.setUrl(bigPath);
        image.setSmallUrl(smallPath);
        image.setLocal(true);
        image.setSmallLocal(true);
        card.getImages().add(image);
    }

    private boolean[] hashOf(String path) {
        if (path == null || !Files.exists(Path.of(path))) {
            return null;
        }
        try {
            return CardScanImages.artworkHash(CardScanImages.read(Files.readAllBytes(Path.of(path))));
        } catch (IOException | RuntimeException e) {
            log.warn("Yugipedia artworks: unreadable image {}: {}", path, e.getMessage());
            return null;
        }
    }

    private void markChecked(List<CheckResult> results, SyncTaskTracker.TaskState task) {
        if (results.isEmpty()) {
            return;
        }
        var now = Instant.now();
        transactionTemplate.executeWithoutResult(status -> results.forEach(r ->
                cardRepository.markYugipediaArtworksChecked(r.cardId(), r.artworkCount(), now)));
        results.forEach(r -> task.incrementProcessed());
    }

    private static void write(String path, byte[] bytes) {
        var target = Path.of(path);
        var tmp = Path.of(path + ".tmp");
        try {
            Files.write(tmp, bytes);
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void waitWhilePaused(SyncTaskTracker.TaskState task) {
        while (task.shouldPause()) {
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }
}
