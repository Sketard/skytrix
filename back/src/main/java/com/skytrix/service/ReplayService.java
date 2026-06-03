package com.skytrix.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import com.skytrix.mapper.ReplayMapper;
import com.skytrix.model.dto.replay.ReplayDTO;
import com.skytrix.model.dto.replay.ReplayStatsDTO;
import com.skytrix.model.entity.Replay;
import com.skytrix.repository.ReplayRepository;
import com.skytrix.repository.UserRepository;
import com.skytrix.utils.CustomPageable;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class ReplayService {

    private final ReplayRepository replayRepository;
    private final UserRepository userRepository;
    private final ReplayMapper replayMapper;

    @Transactional
    public UUID saveReplay(ReplayDTO dto) {
        if (dto.getReplayData() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "replayData is required");
        }
        var player1 = userRepository.findById(dto.getPlayer1Id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Player 1 not found"));
        var player2 = userRepository.findById(dto.getPlayer2Id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Player 2 not found"));

        var replay = replayMapper.toEntity(dto);
        replay.setPlayer1(player1);
        replay.setPlayer2(player2);

        replayRepository.save(replay);
        log.info("Replay saved: {} ({} vs {})", replay.getId(), player1.getPseudo(), player2.getPseudo());
        return replay.getId();
    }

    @Transactional(readOnly = true)
    public ReplayDTO getReplayDetail(UUID id) {
        var replay = replayRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Replay not found"));
        return replayMapper.toDetailDto(replay);
    }

    @Transactional(readOnly = true)
    public CustomPageable<ReplayDTO> getMatchHistory(Long userId, boolean isAdmin, int page, int quantity) {
        var pageable = PageRequest.of(page, quantity, Sort.by(Sort.Direction.DESC, "createdAt"));
        if (isAdmin) {
            return buildPageWithFavorites(userId, () -> replayRepository.findAll(pageable), null);
        }
        return buildPageWithFavorites(
                userId,
                () -> replayRepository.findByPlayer1IdOrPlayer2Id(userId, userId, pageable),
                userId);
    }

    /**
     * Paginated list of the user's favorited replays. Always perspective-aware
     * (the user is necessarily one of the players — the repo query enforces
     * it). Sorted by replay createdAt DESC like the main history.
     */
    @Transactional(readOnly = true)
    public CustomPageable<ReplayDTO> getFavoritedReplays(Long userId, int page, int quantity) {
        var pageable = PageRequest.of(page, quantity, Sort.by(Sort.Direction.DESC, "createdAt"));
        return buildPageWithFavorites(
                userId,
                () -> replayRepository.findFavoritedByUser(userId, pageable),
                userId);
    }

    @Transactional
    public boolean addFavorite(UUID replayId, Long userId) {
        var replay = replayRepository.findById(replayId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Replay not found"));
        if (!replay.getPlayer1().getId().equals(userId) && !replay.getPlayer2().getId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not authorized to favorite this replay");
        }
        var user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        var favorites = user.getFavoriteReplays();
        if (favorites == null) {
            user.setFavoriteReplays(new java.util.ArrayList<>());
            favorites = user.getFavoriteReplays();
        }
        if (favorites.stream().anyMatch(r -> r.getId().equals(replayId))) {
            return false;
        }
        favorites.add(replay);
        userRepository.save(user);
        return true;
    }

    @Transactional
    public boolean removeFavorite(UUID replayId, Long userId) {
        var user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
        var favorites = user.getFavoriteReplays();
        if (favorites == null) return false;
        boolean removed = favorites.removeIf(r -> r.getId().equals(replayId));
        if (removed) userRepository.save(user);
        return removed;
    }

    /**
     * Wraps a paginated Replay fetch with `isFavorite` enrichment. The
     * favorited-ids set is fetched once per page (single query against the
     * join table for the N replay ids of the current page) — cheaper than
     * a per-row boolean check. `perspectiveUserId == null` (admin path) skips
     * the perspective flip in `toDto(replay, userId)`.
     *
     * Implementation note: the supplier closure runs the page query EAGERLY
     * (so we can compute `favoritedIds` before mapping). The `CustomPageable`
     * constructor then re-invokes the supplier — that's why we cache the page
     * in a single-element holder and the supplier returns the cached value
     * on the second call. Cheap (one DB roundtrip total, one favorited-ids
     * lookup) and keeps `CustomPageable`'s 2-arg signature stable.
     */
    private CustomPageable<ReplayDTO> buildPageWithFavorites(
            Long userId,
            java.util.function.Supplier<org.springframework.data.domain.Page<Replay>> pageSupplier,
            Long perspectiveUserId) {
        var page = pageSupplier.get();
        Set<UUID> favoritedIds = page.getContent().isEmpty()
                ? Set.of()
                : replayRepository.findFavoritedIdsByUserIn(
                        userId,
                        page.getContent().stream().map(Replay::getId).collect(Collectors.toSet()));
        return new CustomPageable<>(
                () -> page,
                replay -> {
                    var dto = perspectiveUserId != null
                            ? replayMapper.toDto(replay, perspectiveUserId)
                            : replayMapper.toDto(replay);
                    dto.setIsFavorite(favoritedIds.contains(replay.getId()));
                    return dto;
                });
    }

    @Transactional
    public void deleteReplay(UUID id, Long userId, boolean isAdmin) {
        var replay = replayRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Replay not found"));
        if (!isAdmin && !replay.getPlayer1().getId().equals(userId) && !replay.getPlayer2().getId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not authorized to delete this replay");
        }
        replayRepository.delete(replay);
    }

    @Transactional(readOnly = true)
    public ReplayStatsDTO getStatsForUser(Long userId) {
        var stats = replayRepository.getStatsForUser(userId);
        long total = stats.getTotal();
        long victories = stats.getVictories();
        double winrate = total == 0 ? 0.0 : Math.round((double) victories / total * 100.0) / 100.0;
        return new ReplayStatsDTO(total, victories, stats.getDefeats(), stats.getDraws(), winrate);
    }

    @Transactional
    public int purgeExpiredReplays(int retentionDays) {
        if (retentionDays < 1) {
            log.error("retentionDays must be >= 1, got {}", retentionDays);
            return 0;
        }
        Instant threshold = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        int totalDeleted = 0;
        int deleted;
        do {
            deleted = replayRepository.deleteExpiredBatch(threshold, 1000);
            totalDeleted += deleted;
        } while (deleted > 0);
        return totalDeleted;
    }
}
