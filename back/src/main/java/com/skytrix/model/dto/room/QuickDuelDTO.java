package com.skytrix.model.dto.room;

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
}
