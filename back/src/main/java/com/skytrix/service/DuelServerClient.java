package com.skytrix.service;

import java.time.Duration;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import com.skytrix.model.dto.room.DuelCreationResponse;
import com.skytrix.model.dto.room.DuelDeckDTO;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class DuelServerClient {

    private final RestClient restClient;
    private final String internalKey;

    public DuelServerClient(@Value("${duel-server.url}") String duelServerUrl,
                            @Value("${DUEL_SERVER_INTERNAL_KEY:}") String internalKey) {
        this.internalKey = internalKey;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(5));
        this.restClient = RestClient.builder()
                .baseUrl(duelServerUrl)
                .requestFactory(factory)
                .build();
    }

    public DuelCreationResponse createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2) {
        return createDuel(player1Id, deck1, player2Id, deck2, false);
    }

    public DuelCreationResponse createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2, boolean skipRps) {
        return restClient.post()
                .uri("/api/duels")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Internal-Key", internalKey)
                .body(new CreateDuelRequest(
                        new DuelPlayer(player1Id, deck1),
                        new DuelPlayer(player2Id, deck2),
                        skipRps
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

    private record CreateDuelRequest(DuelPlayer player1, DuelPlayer player2, boolean skipRps) {}
    private record DuelPlayer(String id, DuelDeckDTO deck) {}
    private record ActiveDuelsResponse(List<String> duelIds) {}
}
