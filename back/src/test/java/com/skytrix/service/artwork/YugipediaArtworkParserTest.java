package com.skytrix.service.artwork;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class YugipediaArtworkParserTest {

    private static final String MAGIA = """
            {{CardTable2
            | en_name               = Dragon Master Magia
            | image                 =\s
            1;   DragonMasterMagia-QCDB-JP-UR.png;       DragonMasterMagia-MADU-JP-VG-artwork.png
            1.1; DragonMasterMagia-RA04-EN-PlScR-1E.png; DragonMasterMagia-MADU-EN-VG-artwork.png
            2;   DragonMasterMagia-LOSP-JP-PScR.png
            2.1; DragonMasterMagia-BLGG-EN-UR-1E.png
            | attribute             = LIGHT
            }}""";

    @Test
    void numberedRowsGiveOneArtworkPerNumber() {
        var rows = YugipediaArtworkParser.parse(MAGIA);
        assertEquals(4, rows.size());
        assertEquals(2, YugipediaArtworkParser.artworkCount(rows));
        assertEquals(Map.of(1, "DragonMasterMagia-RA04-EN-PlScR-1E.png", 2, "DragonMasterMagia-BLGG-EN-UR-1E.png"),
                YugipediaArtworkParser.englishScanPerArtwork(rows));
    }

    @Test
    void singleImageParameterIsArtworkOne() {
        var rows = YugipediaArtworkParser.parse("""
                {{CardTable2
                | image           = PaleozoicAnomalocaris-MP25-EN-PScR-1E.png
                | attribute       = WATER
                }}""");
        assertEquals(1, YugipediaArtworkParser.artworkCount(rows));
        assertEquals("PaleozoicAnomalocaris-MP25-EN-PScR-1E.png", rows.get(0).file());
    }

    @Test
    void commentsAreIgnoredAndJapaneseOnlyArtworksLeftOut() {
        var rows = YugipediaArtworkParser.parse("""
                | image = \s
                1; DarkMagician-TN23-EN-QCScR-LE.png;     DarkMagician-TF05-JP-VG-artwork.png
                <!-- artwork 3 is the Arkana artwork -->
                4; DarkMagician-LC01-EN-UR-LE-25thAnniversaryEdition.png; DarkMagician-MADU-EN-VG-artwork.png
                10; DarkMagician-PPC1-JP-C.png;           DarkMagician-CA-9.png
                | attribute = DARK""");
        assertEquals(3, YugipediaArtworkParser.artworkCount(rows));
        var english = YugipediaArtworkParser.englishScanPerArtwork(rows);
        assertEquals(2, english.size());
        assertTrue(english.containsKey(1) && english.containsKey(4));
    }

    @Test
    void flattestEnglishRarityIsPreferred() {
        var rows = YugipediaArtworkParser.parse("""
                | image =
                1; Card-RA04-EN-QCScR-1E.png
                1.1; Card-LDS3-EN-C-1E.png
                1.2; Card-MP24-EN-UR-1E.png
                | attribute = DARK""");
        assertEquals("Card-LDS3-EN-C-1E.png", YugipediaArtworkParser.englishScanPerArtwork(rows).get(1));
    }

    @Test
    void missingParameterGivesNoRow() {
        assertTrue(YugipediaArtworkParser.parse("{{CardTable2\n| attribute = DARK\n}}").isEmpty());
        assertTrue(YugipediaArtworkParser.parse(null).isEmpty());
    }
}
