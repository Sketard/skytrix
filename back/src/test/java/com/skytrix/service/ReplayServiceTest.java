package com.skytrix.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.skytrix.mapper.ReplayMapper;
import com.skytrix.repository.ReplayRepository;
import com.skytrix.repository.ReplayRepository.ReplayStatsProjection;
import com.skytrix.repository.UserRepository;

@ExtendWith(MockitoExtension.class)
class ReplayServiceTest {

    @Mock
    private ReplayRepository replayRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private ReplayMapper replayMapper;

    @InjectMocks
    private ReplayService replayService;

    @Test
    void getStatsForUser_computesWinrateFromCounts() {
        when(replayRepository.getStatsForUser(42L)).thenReturn(projection(5, 3, 2, 0));

        var stats = replayService.getStatsForUser(42L);

        assertEquals(5, stats.total());
        assertEquals(3, stats.victories());
        assertEquals(2, stats.defeats());
        assertEquals(0, stats.draws());
        assertEquals(0.6, stats.winrate(), 0.001);
    }

    @Test
    void getStatsForUser_returnsZeroWinrateWhenNoReplays() {
        when(replayRepository.getStatsForUser(42L)).thenReturn(projection(0, 0, 0, 0));

        var stats = replayService.getStatsForUser(42L);

        assertEquals(0, stats.total());
        assertEquals(0.0, stats.winrate(), 0.001);
    }

    @Test
    void getStatsForUser_excludesDrawsFromWinrateNumerator() {
        when(replayRepository.getStatsForUser(42L)).thenReturn(projection(10, 4, 4, 2));

        var stats = replayService.getStatsForUser(42L);

        assertEquals(0.4, stats.winrate(), 0.001);
    }

    private ReplayStatsProjection projection(long total, long victories, long defeats, long draws) {
        return new ReplayStatsProjection() {
            @Override public long getTotal() { return total; }
            @Override public long getVictories() { return victories; }
            @Override public long getDefeats() { return defeats; }
            @Override public long getDraws() { return draws; }
        };
    }
}
