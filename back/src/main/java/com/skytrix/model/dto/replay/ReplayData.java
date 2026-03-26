package com.skytrix.model.dto.replay;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.List;

public record ReplayData(
        @Size(min = 4, max = 4) List<String> seed,
        @Size(min = 2, max = 2) List<@Valid ReplayDeck> decks,
        @Size(max = 10000) List<@Valid CapturedResponse> playerResponses
) {}
