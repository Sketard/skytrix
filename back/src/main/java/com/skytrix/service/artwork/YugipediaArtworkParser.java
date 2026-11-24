package com.skytrix.service.artwork;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Reads the artworks of a card from the {@code image} parameter of its Yugipedia card table.
 *
 * <p>Two formats exist:
 * <pre>
 * | image = PaleozoicAnomalocaris-MP25-EN-PScR-1E.png          (single artwork)
 *
 * | image =
 * 1;   DragonMasterMagia-QCDB-JP-UR.png;       DragonMasterMagia-MADU-JP-VG-artwork.png
 * 1.1; DragonMasterMagia-RA04-EN-PlScR-1E.png; DragonMasterMagia-MADU-EN-VG-artwork.png
 * 2;   DragonMasterMagia-LOSP-JP-PScR.png
 * 2.1; DragonMasterMagia-BLGG-EN-UR-1E.png
 * </pre>
 * {@code N} is the artwork number, {@code N.k} another scan of the same artwork (often from another region);
 * the second column of a row is the artwork alone, unused here.
 */
public final class YugipediaArtworkParser {
    private static final Pattern IMAGE_PARAM = Pattern.compile(
            "\\|\\s*image\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-z_0-9]+\\s*=|\\n}})");
    private static final Pattern COMMENT = Pattern.compile("<!--[\\s\\S]*?-->");
    private static final Pattern NUMBERED_ROW = Pattern.compile("^(\\d+)(?:\\.\\d+)?\\s*;\\s*([^;]*?)\\s*(?:;.*)?$");
    private static final Pattern IMAGE_FILE = Pattern.compile("(?i).+\\.(png|jpe?g|gif)$");
    private static final Pattern LANGUAGE = Pattern.compile("-(EN|NA|EU|AU|FR|FC|DE|IT|SP|PT|JP|JA|KR|SC|TC|AE)-");
    private static final Pattern RARITY = Pattern.compile("-(?:EN|NA|EU|AU)-([A-Za-z]+)");
    private static final List<String> ENGLISH = List.of("EN", "NA", "EU", "AU");
    // Flat rarities first: holo patterns (Secret, Quarter Century, Platinum…) blur the illustration.
    private static final List<String> RARITY_PREFERENCE = List.of("C", "SP", "R", "SR", "UR");

    private YugipediaArtworkParser() {
    }

    /** One scan of one artwork. */
    public record ScanRow(int artwork, String file) {
        public String language() {
            var m = LANGUAGE.matcher(file);
            return m.find() ? m.group(1) : "?";
        }

        public boolean isEnglish() {
            return ENGLISH.contains(language());
        }

        int rarityRank() {
            var m = RARITY.matcher(file);
            if (!m.find()) {
                return RARITY_PREFERENCE.size();
            }
            var rank = RARITY_PREFERENCE.indexOf(m.group(1));
            return rank < 0 ? RARITY_PREFERENCE.size() : rank;
        }
    }

    /** All scan rows of the {@code image} parameter, in page order. */
    public static List<ScanRow> parse(String wikitext) {
        var rows = new ArrayList<ScanRow>();
        if (wikitext == null) {
            return rows;
        }
        var param = IMAGE_PARAM.matcher(wikitext);
        if (!param.find()) {
            return rows;
        }
        for (var rawLine : COMMENT.matcher(param.group(1)).replaceAll("").split("\n")) {
            var line = rawLine.trim();
            var numbered = NUMBERED_ROW.matcher(line);
            if (numbered.matches()) {
                if (!numbered.group(2).isBlank()) {
                    rows.add(new ScanRow(Integer.parseInt(numbered.group(1)), numbered.group(2).replace('_', ' ').trim()));
                }
            } else if (rows.isEmpty() && !line.contains(";") && IMAGE_FILE.matcher(line).matches()) {
                rows.add(new ScanRow(1, line.replace('_', ' ')));
            }
        }
        return rows;
    }

    /** Number of distinct artworks listed, whatever the scan language. */
    public static int artworkCount(List<ScanRow> rows) {
        return (int) rows.stream().map(ScanRow::artwork).distinct().count();
    }

    /**
     * For each artwork that has an English scan, the English scan with the flattest rarity.
     * Artworks only scanned in Japanese/Korean are left out: their older frames do not line up with the
     * YGOPRODeck renders, so the artwork comparison would wrongly call them new.
     */
    public static Map<Integer, String> englishScanPerArtwork(List<ScanRow> rows) {
        var best = new LinkedHashMap<Integer, ScanRow>();
        rows.stream().filter(ScanRow::isEnglish).forEach(row ->
                best.merge(row.artwork(), row, (a, b) -> b.rarityRank() < a.rarityRank() ? b : a));
        var result = new LinkedHashMap<Integer, String>();
        best.forEach((art, row) -> result.put(art, row.file()));
        return result;
    }
}
