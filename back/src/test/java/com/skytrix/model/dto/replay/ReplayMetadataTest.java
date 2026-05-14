package com.skytrix.model.dto.replay;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class ReplayMetadataTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void deserializesLegacyMetadataWithoutDurationSec() throws Exception {
        String legacyJson = """
                {
                  "playerUsernames": ["alice", "bob"],
                  "deckNames": ["deck-a", "deck-b"],
                  "turnCount": 7,
                  "result": "VICTORY",
                  "date": "2026-01-15T10:00:00Z",
                  "scriptsHash": "abc",
                  "ocgcoreVersion": "1.2.3"
                }
                """;

        ReplayMetadata meta = mapper.readValue(legacyJson, ReplayMetadata.class);

        assertNotNull(meta);
        assertEquals(7, meta.turnCount());
        assertNull(meta.durationSec(), "Legacy replay must deserialize with null durationSec");
    }

    @Test
    void deserializesNewMetadataWithDurationSec() throws Exception {
        String newJson = """
                {
                  "playerUsernames": ["alice", "bob"],
                  "deckNames": ["deck-a", "deck-b"],
                  "turnCount": 11,
                  "result": "VICTORY",
                  "date": "2026-05-14T10:00:00Z",
                  "scriptsHash": "abc",
                  "ocgcoreVersion": "1.2.3",
                  "durationSec": 872
                }
                """;

        ReplayMetadata meta = mapper.readValue(newJson, ReplayMetadata.class);

        assertEquals(872, meta.durationSec());
    }
}
