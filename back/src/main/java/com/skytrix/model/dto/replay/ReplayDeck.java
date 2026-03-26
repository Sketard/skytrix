package com.skytrix.model.dto.replay;

import jakarta.validation.constraints.Size;
import java.util.List;

public record ReplayDeck(
        @Size(max = 60) List<Long> main,
        @Size(max = 15) List<Long> extra
) {}
