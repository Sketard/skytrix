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
        Integer durationSec
) {}
