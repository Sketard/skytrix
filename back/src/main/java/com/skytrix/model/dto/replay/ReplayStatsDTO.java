package com.skytrix.model.dto.replay;

public record ReplayStatsDTO(
        long total,
        long victories,
        long defeats,
        long draws,
        double winrate
) {}
