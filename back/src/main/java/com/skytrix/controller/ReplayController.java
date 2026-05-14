package com.skytrix.controller;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.model.dto.replay.ReplayDTO;
import com.skytrix.model.dto.replay.ReplayStatsDTO;
import com.skytrix.security.AuthService;
import com.skytrix.service.ReplayService;
import com.skytrix.utils.CustomPageable;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@RestController
@RequiredArgsConstructor
@Slf4j
public class ReplayController {

    private final ReplayService replayService;
    private final AuthService authService;

    @Value("${duel-server.internal-key:dev-internal-key}")
    private String internalKey;

    @GetMapping("/replays/stats")
    public ReplayStatsDTO getStats() {
        var userId = authService.getConnectedUserId();
        return replayService.getStatsForUser(userId);
    }

    @GetMapping("/replays")
    public CustomPageable<ReplayDTO> getMatchHistory(
            @RequestParam(value = "offset", defaultValue = "0") int page,
            @RequestParam(value = "quantity", defaultValue = "20") int quantity) {
        if (page < 0 || quantity < 1 || quantity > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "offset must be >= 0 and quantity must be between 1 and 100");
        }
        var userId = authService.getConnectedUserId();
        return replayService.getMatchHistory(userId, authService.isAdmin(), page, quantity);
    }

    @PostMapping("/replays")
    @ResponseStatus(code = HttpStatus.CREATED)
    public Map<String, UUID> saveReplay(
            @RequestHeader(value = "X-Internal-Key", required = false) String providedKey,
            @Valid @RequestBody ReplayDTO dto) {
        validateInternalKey(providedKey);
        var id = replayService.saveReplay(dto);
        return Map.of("id", id);
    }

    @DeleteMapping("/replays/{id}")
    @ResponseStatus(code = HttpStatus.NO_CONTENT)
    public void deleteReplay(@PathVariable UUID id) {
        var userId = authService.getConnectedUserId();
        replayService.deleteReplay(id, userId, authService.isAdmin());
    }

    @GetMapping("/internal/replays/{id}")
    public ReplayDTO getReplayDetail(
            @RequestHeader(value = "X-Internal-Key", required = false) String providedKey,
            @PathVariable UUID id) {
        validateInternalKey(providedKey);
        return replayService.getReplayDetail(id);
    }

    private void validateInternalKey(String providedKey) {
        if (providedKey == null || !MessageDigest.isEqual(
                providedKey.getBytes(StandardCharsets.UTF_8),
                internalKey.getBytes(StandardCharsets.UTF_8))) {
            log.warn("Rejected internal key attempt on replay endpoint");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or missing internal key");
        }
    }
}
