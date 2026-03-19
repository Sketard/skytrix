package com.skytrix.service;

import java.io.IOException;
import java.time.Duration;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import com.skytrix.model.dto.room.DuelCreationResponse;
import com.skytrix.model.dto.room.DuelDeckDTO;

import org.slf4j.MDC;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.HttpClientErrorException;

import static com.skytrix.security.RequestLoggingFilter.MDC_REQUEST_ID;
import static com.skytrix.security.RequestLoggingFilter.REQUEST_ID_HEADER;

@Service
@Slf4j
public class DuelServerClient {

    private final RestClient restClient;
    private final RestClient longTimeoutRestClient;
    private final String internalKey;

    public DuelServerClient(@Value("${duel-server.url}") String duelServerUrl,
                            @Value("${duel-server.internal-key:dev-internal-key}") String internalKey) {
        this.internalKey = internalKey;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(5));
        this.restClient = RestClient.builder()
                .baseUrl(duelServerUrl)
                .requestFactory(factory)
                .requestInterceptor(this::propagateRequestId)
                .build();

        var longFactory = new SimpleClientHttpRequestFactory();
        longFactory.setConnectTimeout(Duration.ofSeconds(10));
        longFactory.setReadTimeout(Duration.ofMinutes(5));
        this.longTimeoutRestClient = RestClient.builder()
                .baseUrl(duelServerUrl)
                .requestFactory(longFactory)
                .requestInterceptor(this::propagateRequestId)
                .build();
    }

    public DuelCreationResponse createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2) {
        return createDuel(player1Id, deck1, player2Id, deck2, false);
    }

    public DuelCreationResponse createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2, boolean soloMode) {
        return createDuel(player1Id, deck1, player2Id, deck2, soloMode, false);
    }

    public DuelCreationResponse createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2, boolean soloMode, boolean skipShuffle) {
        return createDuel(player1Id, deck1, player2Id, deck2, soloMode, skipShuffle, null);
    }

    public DuelCreationResponse createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2, boolean soloMode, boolean skipShuffle, Integer turnTimeSecs) {
        return restClient.post()
                .uri("/api/duels")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Internal-Key", internalKey)
                .body(new CreateDuelRequest(
                        new DuelPlayer(player1Id, deck1),
                        new DuelPlayer(player2Id, deck2),
                        soloMode,
                        skipShuffle,
                        turnTimeSecs
                ))
                .retrieve()
                .body(DuelCreationResponse.class);
    }

    public boolean isServerHealthy() {
        try {
            restClient.get()
                    .uri("/health")
                    .retrieve()
                    .toBodilessEntity();
            return true;
        } catch (Exception e) {
            log.debug("Health check failed", e);
            return false;
        }
    }

    public List<String> getActiveDuelIds() {
        try {
            var response = restClient.get()
                    .uri("/api/duels/active")
                    .retrieve()
                    .body(ActiveDuelsResponse.class);
            return response != null && response.duelIds() != null ? response.duelIds() : List.of();
        } catch (Exception e) {
            log.warn("Failed to fetch active duel IDs from duel server: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * Asks the duel server which passcodes are missing from its cards.cdb.
     * Returns the list of unknown passcodes, or empty if all are valid.
     */
    public List<Integer> findMissingPasscodes(List<Integer> passcodes) {
        try {
            var response = restClient.post()
                    .uri("/api/validate-passcodes")
                    .contentType(MediaType.APPLICATION_JSON)
                    .header("X-Internal-Key", internalKey)
                    .body(new ValidatePasscodesRequest(passcodes))
                    .retrieve()
                    .body(ValidatePasscodesResponse.class);
            return response != null && response.missing() != null ? response.missing() : List.of();
        } catch (Exception e) {
            log.warn("Failed to validate passcodes against duel server: {}", e.getMessage());
            return List.of();
        }
    }

    public void updateData() {
        int maxRetries = 2;
        Exception lastException = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                longTimeoutRestClient.put()
                        .uri("/api/update-data")
                        .header("X-Internal-Key", internalKey)
                        .retrieve()
                        .toBodilessEntity();
                return;
            } catch (HttpClientErrorException e) {
                // 4xx errors (e.g., 409 Conflict when duels are active) are not transient — don't retry
                throw e;
            } catch (Exception e) {
                lastException = e;
                if (attempt < maxRetries) {
                    log.warn("Duel server update failed (attempt {}/{}): {} — retrying",
                            attempt + 1, maxRetries + 1, e.getMessage());
                    try { Thread.sleep(2_000L * (attempt + 1)); } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new RuntimeException("Interrupted during retry", ie);
                    }
                }
            }
        }
        log.error("Duel server update failed after {} attempts", maxRetries + 1);
        throw new RuntimeException("Duel server update failed", lastException);
    }

    public void terminateDuel(String duelServerId) {
        try {
            restClient.delete()
                    .uri("/api/duels/{duelServerId}", duelServerId)
                    .header("X-Internal-Key", internalKey)
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            log.warn("Failed to terminate duel {} on duel server: {}", duelServerId, e.getMessage());
        }
    }

    private org.springframework.http.client.ClientHttpResponse propagateRequestId(
            org.springframework.http.HttpRequest request, byte[] body,
            org.springframework.http.client.ClientHttpRequestExecution execution) throws IOException {
        var reqId = MDC.get(MDC_REQUEST_ID);
        if (reqId != null) {
            request.getHeaders().set(REQUEST_ID_HEADER, reqId);
        }
        return execution.execute(request, body);
    }

    private record CreateDuelRequest(DuelPlayer player1, DuelPlayer player2, boolean soloMode, boolean skipShuffle, Integer turnTimeSecs) {}
    private record DuelPlayer(String id, DuelDeckDTO deck) {}
    private record ActiveDuelsResponse(List<String> duelIds) {}
    private record ValidatePasscodesRequest(List<Integer> passcodes) {}
    private record ValidatePasscodesResponse(List<Integer> missing) {}
}
