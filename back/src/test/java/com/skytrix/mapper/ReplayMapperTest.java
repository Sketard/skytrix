package com.skytrix.mapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.skytrix.model.dto.replay.ReplayDTO;
import com.skytrix.model.dto.replay.ReplayMetadata;
import com.skytrix.model.entity.Replay;
import com.skytrix.model.entity.User;
import com.skytrix.model.enums.DuelResult;

class ReplayMapperTest {

    private final ReplayMapper mapper = new ReplayMapperImpl();

    @Test
    void preservesDurationSecOnPlayer1Perspective() {
        Replay replay = buildReplay(872);

        ReplayDTO dto = mapper.toDto(replay, 1L);

        assertEquals(872, dto.getMetadata().durationSec());
        assertEquals(DuelResult.VICTORY, dto.getMetadata().result());
    }

    @Test
    void preservesDurationSecWhenFlippingForPlayer2() {
        Replay replay = buildReplay(872);

        ReplayDTO dto = mapper.toDto(replay, 2L);

        assertEquals(872, dto.getMetadata().durationSec(),
                "durationSec must survive the player2 perspective flip");
        assertEquals(DuelResult.DEFEAT, dto.getMetadata().result(),
                "result must be flipped from VICTORY to DEFEAT for player2");
    }

    @Test
    void preservesNullDurationSecForLegacyReplay() {
        Replay replay = buildReplay(null);

        ReplayDTO dto = mapper.toDto(replay, 2L);

        assertNull(dto.getMetadata().durationSec());
    }

    private Replay buildReplay(Integer durationSec) {
        User p1 = new User();
        p1.setId(1L);
        User p2 = new User();
        p2.setId(2L);

        ReplayMetadata meta = new ReplayMetadata(
                List.of("alice", "bob"),
                List.of("deck-a", "deck-b"),
                7,
                DuelResult.VICTORY,
                "2026-05-14T10:00:00Z",
                "abc",
                "1.2.3",
                durationSec
        );

        Replay replay = new Replay();
        replay.setPlayer1(p1);
        replay.setPlayer2(p2);
        replay.setMetadata(meta);
        return replay;
    }
}
