package com.skytrix.requester;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skytrix.exception.InternalServerError;
import com.skytrix.model.dto.yugipedia.YugipediaTranslationDTO;
import com.skytrix.utils.WikitextCleaner;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.IntConsumer;

/**
 * Reads Yugipedia: French card names and texts through its Semantic MediaWiki {@code action=ask} API,
 * card pages and file URLs through the MediaWiki {@code action=query} API, and card scans.
 *
 * <p>Two constraints of that API shape this class:
 * <ul>
 *   <li>an {@code ask} query returns at most 500 rows and refuses offsets above 5000
 *       (it silently restarts at 0), so the card pool is split by the first digit of the
 *       passcode — each bucket stays well under 5000 cards;</li>
 *   <li>the site sits behind Cloudflare, which answers a burst of requests with an HTML
 *       challenge page instead of JSON. Requests are spaced out and a challenge triggers a
 *       long pause before retrying.</li>
 * </ul>
 */
@Service
@Slf4j
public class YugipediaRequester extends Requester {
    private static final String BASE_URI = "https://yugipedia.com/api.php";
    private static final int PAGE_SIZE = 500;
    private static final int MAX_OFFSET = 5000;
    private static final int MAX_CHALLENGE_RETRIES = 4;
    private static final String PROP_PASSWORD = "Password";
    private static final String PROP_NAME = "French name";
    private static final String PROP_LORE = "French lore";
    private static final String PROP_PENDULUM = "French Pendulum Effect";

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${yugipedia.user-agent:SkytrixCardSync/1.0 (Yu-Gi-Oh! deck builder; French card text sync)}")
    private String userAgent;

    @Value("${yugipedia.request-delay-ms:3000}")
    private long requestDelayMs;

    @Value("${yugipedia.challenge-backoff-ms:90000}")
    private long challengeBackoffMs;

    /** Scans come from img.yugipedia.com, a CDN that did not challenge during the prototype; still spaced. */
    @Value("${yugipedia.image-delay-ms:300}")
    private long imageDelayMs;

    /** Batch size of MediaWiki {@code titles=} parameters (API limit for regular clients). */
    public static final int TITLES_PER_REQUEST = 50;
    /** SMW refuses a {@code [[Password::a||b||…]]} condition past ~12 values ("restrictions on query size"). */
    static final int PASSCODES_PER_ASK = 10;
    private static final DateTimeFormatter SMW_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss").withZone(ZoneOffset.UTC);

    /**
     * Fetches every OCG/TCG card that has a French name on Yugipedia.
     *
     * @return French texts keyed by passcode
     */
    public Map<Long, YugipediaTranslationDTO> fetchFrenchTranslations() {
        var result = new HashMap<Long, YugipediaTranslationDTO>();
        askByPasscodeDigit("[[French name::+]]",
                "|?" + PROP_PASSWORD + "|?" + PROP_NAME + "|?" + PROP_LORE + "|?" + PROP_PENDULUM,
                (title, printouts) -> addResult(result, title, printouts),
                digit -> log.info("Yugipedia: passcodes {}* done, {} French texts so far", digit, result.size()));
        return result;
    }

    /**
     * Page title of every OCG/TCG card on Yugipedia, French name or not.
     *
     * @return page titles keyed by passcode
     */
    public Map<Long, String> fetchPageTitles() {
        var result = new HashMap<Long, String>();
        askByPasscodeDigit("", "|?" + PROP_PASSWORD, (title, printouts) -> {
            var passcode = parsePasscode(first(printouts, PROP_PASSWORD));
            if (passcode != null) {
                result.putIfAbsent(passcode, title);
            }
        }, digit -> log.info("Yugipedia: passcodes {}* done, {} card pages so far", digit, result.size()));
        return result;
    }

    /**
     * Page title of the given cards only, {@value #PASSCODES_PER_ASK} per request: cheaper than
     * {@link #fetchPageTitles()} (~30 requests) when only a few cards are new.
     */
    public Map<Long, String> fetchPageTitles(Collection<Long> passcodes) {
        var list = new ArrayList<>(passcodes);
        var result = new HashMap<Long, String>();
        for (int i = 0; i < list.size(); i += PASSCODES_PER_ASK) {
            var values = list.subList(i, Math.min(i + PASSCODES_PER_ASK, list.size())).stream()
                    .map(YugipediaRequester::passwordText).toList();
            var query = "[[Concept:CG cards]][[Password::" + String.join("||", values) + "]]|?" + PROP_PASSWORD
                    + "|limit=" + PAGE_SIZE;
            getJson(buildAskUri(query)).path("query").path("results").properties().forEach(entry -> {
                var passcode = parsePasscode(first(entry.getValue().path("printouts"), PROP_PASSWORD));
                if (passcode != null) {
                    result.putIfAbsent(passcode, entry.getKey());
                }
            });
        }
        return result;
    }

    /**
     * OCG/TCG card pages edited since {@code since} (any edit: new print, text fix, new artwork…).
     *
     * @return page titles keyed by passcode
     */
    public Map<Long, String> fetchCardsModifiedSince(Instant since) {
        var condition = "[[Modification date::>" + SMW_DATE.format(since) + "]]";
        var result = new HashMap<Long, String>();
        BiConsumer<String, JsonNode> collect = (title, printouts) -> {
            var passcode = parsePasscode(first(printouts, PROP_PASSWORD));
            if (passcode != null) {
                result.putIfAbsent(passcode, title);
            }
        };
        // Usually a few hundred pages: one query. After a long pause it may pass the 5000 offset cap,
        // then the digit buckets take over.
        if (!askPaginated("[[Concept:CG cards]]" + condition, "|?" + PROP_PASSWORD, collect)) {
            result.clear();
            askByPasscodeDigit(condition, "|?" + PROP_PASSWORD, collect, digit -> { });
        }
        log.info("Yugipedia: {} card pages edited since {}", result.size(), since);
        return result;
    }

    /** Yugipedia stores passwords as 8-digit text: 32864 is "00032864". */
    static String passwordText(long passcode) {
        return String.format("%08d", passcode);
    }

    /**
     * Wikitext of up to {@link #TITLES_PER_REQUEST} pages.
     *
     * @return wikitext keyed by the title as given; pages that do not exist are absent
     */
    public Map<String, String> fetchWikitexts(List<String> titles) {
        var params = new LinkedHashMap<String, String>();
        params.put("action", "query");
        params.put("prop", "revisions");
        params.put("rvprop", "content");
        params.put("rvslots", "main");
        params.put("titles", String.join("|", titles));
        var json = getJson(buildQueryUri(params));
        var canonical = canonicalTitles(json, titles);
        var byTitle = new HashMap<String, String>();
        json.path("query").path("pages").forEach(page -> {
            var content = page.path("revisions").path(0).path("slots").path("main").path("*");
            if (!content.isMissingNode()) {
                byTitle.put(page.path("title").asText(), content.asText());
            }
        });
        var result = new HashMap<String, String>();
        canonical.forEach((asked, title) -> {
            if (byTitle.containsKey(title)) {
                result.put(asked, byTitle.get(title));
            }
        });
        return result;
    }

    /**
     * Download URL of up to {@link #TITLES_PER_REQUEST} files. Thumbnails are not requested: Yugipedia refuses to
     * generate them for clients outside its pages ({@code thumbsize-blocked}).
     *
     * @param files file names without the {@code File:} prefix
     * @return URL keyed by the file name as given; missing files are absent
     */
    public Map<String, String> fetchFileUrls(List<String> files) {
        var asked = files.stream().map(file -> "File:" + file).toList();
        var params = new LinkedHashMap<String, String>();
        params.put("action", "query");
        params.put("prop", "imageinfo");
        params.put("iiprop", "url");
        params.put("titles", String.join("|", asked));
        var json = getJson(buildQueryUri(params));
        var canonical = canonicalTitles(json, asked);
        var urlByTitle = new HashMap<String, String>();
        json.path("query").path("pages").forEach(page -> {
            var url = page.path("imageinfo").path(0).path("url");
            if (!url.isMissingNode()) {
                urlByTitle.put(page.path("title").asText(), url.asText());
            }
        });
        var result = new HashMap<String, String>();
        for (int i = 0; i < files.size(); i++) {
            var url = urlByTitle.get(canonical.get(asked.get(i)));
            if (url != null) {
                result.put(files.get(i), url);
            }
        }
        return result;
    }

    /** Downloads a scan; {@code null} when the server does not answer 200. */
    public byte[] downloadFile(String url) {
        pause(imageDelayMs);
        var request = HttpRequest.newBuilder()
                .uri(buildUri(url))
                .timeout(Duration.ofSeconds(60))
                .header("User-Agent", userAgent)
                .GET()
                .build();
        var response = sendRequestByteArray(request);
        if (response.statusCode() != 200) {
            log.warn("Yugipedia file returned HTTP {}: {}", response.statusCode(), url);
            return null;
        }
        return response.body();
    }

    /** MediaWiki rewrites titles (underscores, first letter) and lists the rewrites under query.normalized. */
    private static Map<String, String> canonicalTitles(JsonNode json, List<String> asked) {
        var normalized = new HashMap<String, String>();
        json.path("query").path("normalized").forEach(n -> normalized.put(n.path("from").asText(), n.path("to").asText()));
        var result = new LinkedHashMap<String, String>();
        asked.forEach(title -> result.put(title, normalized.getOrDefault(title, title)));
        return result;
    }

    /**
     * Runs an {@code ask} query over every OCG/TCG card, one bucket per first passcode digit.
     *
     * @param extraConditions SMW conditions added to the card filter (may be empty)
     * @param printouts       {@code |?Property} list
     */
    private void askByPasscodeDigit(String extraConditions, String printouts,
                                    BiConsumer<String, JsonNode> onResult, IntConsumer onBucketDone) {
        for (int digit = 0; digit <= 9; digit++) {
            var conditions = "[[Concept:CG cards]]" + extraConditions + "[[Password::~" + digit + "*]]";
            if (!askPaginated(conditions, printouts, onResult)) {
                // Rows past the cap would be lost: the bucket must be split further.
                throw new InternalServerError("Yugipedia bucket " + digit + "* exceeds " + MAX_OFFSET + " cards");
            }
            onBucketDone.accept(digit);
        }
    }

    /**
     * Pages through an {@code ask} query, 500 rows at a time.
     *
     * @return false when the results go past the offset cap (5000), i.e. some rows were not read
     */
    private boolean askPaginated(String conditions, String printouts, BiConsumer<String, JsonNode> onResult) {
        int offset = 0;
        while (true) {
            var page = getJson(buildAskUri(conditions + printouts + "|limit=" + PAGE_SIZE + "|offset=" + offset));
            page.path("query").path("results").properties()
                    .forEach(entry -> onResult.accept(entry.getKey(), entry.getValue().path("printouts")));
            var next = page.path("query-continue-offset");
            if (next.isMissingNode() || next.asInt() <= offset) {
                return true;
            }
            offset = next.asInt();
            if (offset > MAX_OFFSET) {
                return false;
            }
        }
    }

    private void addResult(Map<Long, YugipediaTranslationDTO> result, String pageTitle, JsonNode printouts) {
        var passcode = parsePasscode(first(printouts, PROP_PASSWORD));
        var name = WikitextCleaner.clean(first(printouts, PROP_NAME));
        if (passcode == null || name == null || name.isBlank()) {
            return;
        }
        var lore = WikitextCleaner.clean(first(printouts, PROP_LORE));
        var pendulum = WikitextCleaner.clean(first(printouts, PROP_PENDULUM));
        var description = buildDescription(lore, pendulum);
        var previous = result.putIfAbsent(passcode, new YugipediaTranslationDTO(passcode, name, description));
        if (previous != null && !previous.name().equals(name)) {
            log.debug("Yugipedia: passcode {} on several pages, keeping '{}' over '{}' ({})",
                    passcode, previous.name(), name, pageTitle);
        }
    }

    /** Same layout as YGOPRODeck's Pendulum descriptions, so the front shows both alike. */
    static String buildDescription(String lore, String pendulum) {
        if (pendulum == null || pendulum.isBlank()) {
            return lore;
        }
        return "[ Pendulum Effect ] \n" + pendulum + "\n\n[ Monster Effect ] \n" + (lore == null ? "" : lore);
    }

    private JsonNode getJson(String uri) {
        var request = HttpRequest.newBuilder()
                .uri(buildUri(uri))
                .timeout(Duration.ofSeconds(60))
                .header("User-Agent", userAgent)
                .header("Accept", "application/json")
                .GET()
                .build();

        for (int attempt = 0; attempt <= MAX_CHALLENGE_RETRIES; attempt++) {
            pause(requestDelayMs);
            java.net.http.HttpResponse<String> response;
            try {
                response = sendRequest(request);
            } catch (InternalServerError e) {
                // 5xx retried and exhausted by Requester: treat like a challenge, wait longer.
                log.warn("Yugipedia request failed ({}), attempt {}/{}", e.getMessage(), attempt + 1, MAX_CHALLENGE_RETRIES + 1);
                if (attempt < MAX_CHALLENGE_RETRIES) {
                    pause(challengeBackoffMs);
                }
                continue;
            }
            var body = response.body();
            if (response.statusCode() == 200 && body != null && body.stripLeading().startsWith("{")) {
                try {
                    var json = objectMapper.readTree(body);
                    if (json.has("error")) {
                        // MediaWiki errors carry "info"; SMW query errors carry a "query" array instead.
                        throw new InternalServerError("Yugipedia API error: " + json.path("error"));
                    }
                    return json;
                } catch (IOException e) {
                    throw new InternalServerError("Unreadable Yugipedia response: " + e.getMessage());
                }
            }
            // Cloudflare challenge (HTML, usually 403/503): back off and try again.
            log.warn("Yugipedia returned HTTP {} without JSON (rate limit / Cloudflare challenge), attempt {}/{} — waiting {}s",
                    response.statusCode(), attempt + 1, MAX_CHALLENGE_RETRIES + 1, challengeBackoffMs / 1000);
            if (attempt < MAX_CHALLENGE_RETRIES) {
                pause(challengeBackoffMs);
            }
        }
        throw new InternalServerError("Yugipedia kept refusing requests (Cloudflare challenge)");
    }

    /**
     * Form-encodes the SMW query. Spring's {@code UriComponentsBuilder.encode()} leaves "+" as is, which the
     * server then reads as a space: {@code [[French name::+]]} became {@code [[French name:: ]]} and the whole
     * query was rejected ("[[ not closed").
     */
    static String buildAskUri(String query) {
        var params = new LinkedHashMap<String, String>();
        params.put("action", "ask");
        params.put("query", query);
        return buildQueryUri(params);
    }

    /** {@code format=json} plus the given parameters, each value form-encoded (see {@link #buildAskUri}). */
    static String buildQueryUri(Map<String, String> params) {
        var uri = new StringBuilder(BASE_URI).append("?format=json");
        params.forEach((key, value) -> uri.append("&").append(key).append("=")
                .append(URLEncoder.encode(value, StandardCharsets.UTF_8)));
        return uri.toString();
    }

    private static String first(JsonNode printouts, String property) {
        var values = printouts.path(property);
        if (!values.isArray() || values.isEmpty()) {
            return null;
        }
        return values.get(0).asText(null);
    }

    private static Long parsePasscode(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new InternalServerError("Interrupted while waiting for Yugipedia");
        }
    }
}
