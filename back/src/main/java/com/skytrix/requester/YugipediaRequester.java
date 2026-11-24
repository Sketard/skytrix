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
import java.util.HashMap;
import java.util.Map;

/**
 * Reads French card names and texts from Yugipedia through its Semantic MediaWiki
 * {@code action=ask} API.
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

    /**
     * Fetches every OCG/TCG card that has a French name on Yugipedia.
     *
     * @return French texts keyed by passcode
     */
    public Map<Long, YugipediaTranslationDTO> fetchFrenchTranslations() {
        var result = new HashMap<Long, YugipediaTranslationDTO>();
        for (int digit = 0; digit <= 9; digit++) {
            int offset = 0;
            while (true) {
                var page = fetchPage(digit, offset);
                var results = page.path("query").path("results");
                results.properties().forEach(entry -> addResult(result, entry.getKey(), entry.getValue().path("printouts")));
                var next = page.path("query-continue-offset");
                if (next.isMissingNode() || next.asInt() <= offset) {
                    break;
                }
                offset = next.asInt();
                if (offset > MAX_OFFSET) {
                    // Rows past this point would be lost: the bucket must be split further.
                    throw new InternalServerError("Yugipedia bucket " + digit + "* exceeds " + MAX_OFFSET + " cards");
                }
            }
            log.info("Yugipedia: passcodes {}* done, {} French texts so far", digit, result.size());
        }
        return result;
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

    private JsonNode fetchPage(int digit, int offset) {
        var query = "[[Concept:CG cards]][[French name::+]][[Password::~" + digit + "*]]"
                + "|?" + PROP_PASSWORD + "|?" + PROP_NAME + "|?" + PROP_LORE + "|?" + PROP_PENDULUM
                + "|limit=" + PAGE_SIZE + "|offset=" + offset;
        var request = HttpRequest.newBuilder()
                .uri(buildUri(buildAskUri(query)))
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
        return BASE_URI + "?action=ask&format=json&query=" + URLEncoder.encode(query, StandardCharsets.UTF_8);
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
