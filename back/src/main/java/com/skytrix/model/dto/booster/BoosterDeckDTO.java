package com.skytrix.model.dto.booster;

import java.util.List;

import jakarta.validation.constraints.NotNull;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Deck built from pulled cards, as {@link PulledCardDTO#getId()} lists in deck order. */
@Data
@NoArgsConstructor
public class BoosterDeckDTO {
    @NotNull
    private List<Long> main;
    @NotNull
    private List<Long> extra;
}
