package com.skytrix.model.dto.replay;

import java.util.List;

import com.skytrix.model.enums.DuelResult;

public record ReplayMetadata(
        List<String> playerUsernames,
        List<String> deckNames,
        int turnCount,
        DuelResult result,
        String date,
        String scriptsHash,
        String ocgcoreVersion,
        Integer durationSec,
        // Deck-order convention of the persisted decks ("verbatim" on
        // replays captured after the deck-order fix; null on legacy
        // replays, which the duel-server treats as the pre-fix order).
        // Stored verbatim so the duel-server can branch on it at replay time.
        String deckOrder
) {}
