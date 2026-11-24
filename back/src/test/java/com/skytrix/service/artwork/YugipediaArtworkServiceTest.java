package com.skytrix.service.artwork;

import com.skytrix.model.entity.Card;
import com.skytrix.model.entity.CardImage;
import com.skytrix.model.enums.ImageSource;
import com.skytrix.repository.CardImageRepository;
import com.skytrix.repository.CardRepository;
import com.skytrix.requester.YugipediaRequester;
import com.skytrix.service.SyncTaskTracker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class YugipediaArtworkServiceTest {

    private static final long PASSCODE = 14558127L;
    private static final String TITLE = "Ash Blossom & Joyous Spring";

    @TempDir
    Path folder;

    private YugipediaRequester requester;
    private CardRepository cardRepository;
    private CardImageRepository cardImageRepository;
    private YugipediaArtworkService service;
    private Card card;
    private SyncTaskTracker.TaskState task;

    @BeforeEach
    void setUp() throws Exception {
        requester = mock(YugipediaRequester.class);
        cardRepository = mock(CardRepository.class);
        cardImageRepository = mock(CardImageRepository.class);
        var transactions = mock(TransactionTemplate.class);
        when(transactions.execute(any())).thenAnswer(inv -> inv.<TransactionCallback<?>>getArgument(0).doInTransaction(null));
        doAnswer(inv -> {
            inv.<Consumer<Object>>getArgument(0).accept(null);
            return null;
        }).when(transactions).executeWithoutResult(any());

        service = new YugipediaArtworkService(requester, cardRepository, cardImageRepository, transactions);
        Files.createDirectories(folder.resolve("big"));
        Files.createDirectories(folder.resolve("small"));
        ReflectionTestUtils.setField(service, "bigImageFolder", folder.resolve("big") + "/");
        ReflectionTestUtils.setField(service, "smallImageFolder", folder.resolve("small") + "/");

        // The card has one YGOPRODeck image (artwork drawn from seed 1) stored locally.
        card = new Card();
        card.setId(7L);
        card.setPasscode(PASSCODE);
        var smallPath = folder.resolve("small").resolve(PASSCODE + ".jpg");
        Files.write(smallPath, CardScanImages.jpeg(CardScanImagesTest.card(1, 268, 391, 1f, false), 0.9f));
        card.setImages(new ArrayList<>(List.of(CardImage.builder().id(1L).imageId(PASSCODE)
                .smallUrl(smallPath.toString()).smallLocal(true).local(true).build())));

        when(cardRepository.findIdAndPasscodeOfCardsNeverCheckedForArtworks()).thenReturn(List.<Object[]>of(new Object[]{7L, PASSCODE}));
        when(cardRepository.findById(7L)).thenReturn(Optional.of(card));
        when(requester.fetchPageTitles(anyCollection())).thenReturn(Map.of(PASSCODE, TITLE));
        when(cardImageRepository.save(any())).thenAnswer(inv -> {
            CardImage image = inv.getArgument(0);
            image.setId(42L);
            return image;
        });
        task = new SyncTaskTracker.TaskState();
        task.markRunning();
    }

    @Test
    void importsOnlyTheScanThatMatchesNoYgoprodeckImage() throws Exception {
        when(requester.fetchWikitexts(anyList())).thenReturn(Map.of(TITLE, """
                | image =
                1; Ash-LAVD-EN-C-1E.png
                2; Ash-RA05-EN-UR-1E.png
                | attribute = FIRE"""));
        when(requester.fetchFileUrls(anyList())).thenReturn(Map.of(
                "Ash-LAVD-EN-C-1E.png", "https://img/1.png", "Ash-RA05-EN-UR-1E.png", "https://img/2.png"));
        // Scan 1 = same artwork as the YGOPRODeck image (seed 1), scan 2 = another artwork (seed 2).
        when(requester.downloadFile("https://img/1.png")).thenReturn(png(CardScanImagesTest.card(1, 822, 1198, 0.85f, true)));
        when(requester.downloadFile("https://img/2.png")).thenReturn(png(CardScanImagesTest.card(2, 822, 1198, 0.85f, true)));

        service.importNewArtworks(task);

        assertEquals(2, card.getImages().size());
        var imported = card.getImages().get(1);
        assertEquals(ImageSource.YUGIPEDIA, imported.getSource());
        assertEquals("Ash-RA05-EN-UR-1E.png", imported.getSourceFile());
        assertEquals(YugipediaArtworkService.IMAGE_ID_OFFSET + 42, imported.getImageId());
        assertTrue(Files.exists(Path.of(imported.getUrl())) && Files.exists(Path.of(imported.getSmallUrl())));
        assertTrue(imported.isTcgUpdated(), "the TCG image refresh must leave it alone");
        assertNotNull(card.getYugipediaArtworksCheckedAt());
        assertEquals(2, card.getYugipediaArtworkCount());
        assertEquals(PASSCODE, card.getMainImage().getImageId());
        verify(requester, never()).fetchPageTitles();
        assertEquals(1, task.getProcessed());
    }

    @Test
    void singleArtworkCardIsCheckedWithoutDownload() {
        when(requester.fetchWikitexts(anyList())).thenReturn(Map.of(TITLE, "| image = Ash-LAVD-EN-C-1E.png\n| attribute = FIRE"));

        service.importNewArtworks(task);

        verify(cardRepository).markYugipediaArtworksChecked(eq(7L), eq(1), any());
        verify(requester, never()).downloadFile(anyString());
        assertEquals(1, card.getImages().size());
    }

    @Test
    void cardWithoutLocalYgoprodeckImageIsLeftForALaterRun() throws Exception {
        Files.delete(Path.of(card.getImages().get(0).getSmallUrl()));
        when(requester.fetchWikitexts(anyList())).thenReturn(Map.of(TITLE, """
                | image =
                1; Ash-LAVD-EN-C-1E.png
                2; Ash-RA05-EN-UR-1E.png
                | attribute = FIRE"""));
        when(requester.fetchFileUrls(anyList())).thenReturn(Map.of());

        service.importNewArtworks(task);

        assertNull(card.getYugipediaArtworksCheckedAt());
        verify(requester, never()).downloadFile(anyString());
    }

    @Test
    void editedPageListingNoMoreArtworksIsNotDownloadedAgain() {
        alreadyCheckedAndEditedSince(2);
        when(requester.fetchWikitexts(anyList())).thenReturn(Map.of(TITLE, TWO_ARTWORKS));

        service.importNewArtworks(task);

        verify(cardRepository).markYugipediaArtworksChecked(eq(7L), eq(2), any());
        verify(requester, never()).downloadFile(anyString());
        verify(requester, never()).fetchPageTitles(anyCollection());
    }

    @Test
    void editedPageWithANewArtworkIsProcessed() throws Exception {
        alreadyCheckedAndEditedSince(1);
        when(requester.fetchWikitexts(anyList())).thenReturn(Map.of(TITLE, TWO_ARTWORKS));
        when(requester.fetchFileUrls(anyList())).thenReturn(Map.of(
                "Ash-LAVD-EN-C-1E.png", "https://img/1.png", "Ash-RA05-EN-UR-1E.png", "https://img/2.png"));
        when(requester.downloadFile("https://img/1.png")).thenReturn(png(CardScanImagesTest.card(1, 822, 1198, 0.85f, true)));
        when(requester.downloadFile("https://img/2.png")).thenReturn(png(CardScanImagesTest.card(2, 822, 1198, 0.85f, true)));

        service.importNewArtworks(task);

        assertEquals(2, card.getImages().size());
        assertEquals("Ash-RA05-EN-UR-1E.png", card.getImages().get(1).getSourceFile());
        assertEquals(2, card.getYugipediaArtworkCount());
    }

    private static final String TWO_ARTWORKS = """
            | image =
            1; Ash-LAVD-EN-C-1E.png
            2; Ash-RA05-EN-UR-1E.png
            | attribute = FIRE""";

    /** The card was checked during the last sync with {@code count} artworks; its page was edited since. */
    private void alreadyCheckedAndEditedSince(int count) {
        var lastSync = Instant.parse("2026-11-20T10:00:00Z");
        when(cardRepository.findIdAndPasscodeOfCardsNeverCheckedForArtworks()).thenReturn(List.of());
        when(cardRepository.findLastYugipediaArtworksCheck()).thenReturn(lastSync);
        when(requester.fetchCardsModifiedSince(any())).thenReturn(Map.of(PASSCODE, TITLE));
        when(cardRepository.findArtworkCheckOfCheckedCards(anyCollection()))
                .thenReturn(List.<Object[]>of(new Object[]{7L, PASSCODE, count}));
        card.setYugipediaArtworksCheckedAt(lastSync);
        card.setYugipediaArtworkCount(count);
    }

    private static byte[] png(java.awt.image.BufferedImage image) throws Exception {
        var out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(image, "png", out);
        return out.toByteArray();
    }
}
