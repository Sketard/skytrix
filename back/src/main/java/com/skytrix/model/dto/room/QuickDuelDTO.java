package com.skytrix.model.dto.room;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class QuickDuelDTO {

    @NotNull
    private Long decklistId1;

    @NotNull
    private Long decklistId2;

    private Integer firstPlayer;

    private boolean skipShuffle;

    @Min(30)
    @Max(3600)
    private Integer turnTimeSecs;
}
