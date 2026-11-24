package com.skytrix.model.dto.booster;

import java.util.List;

import lombok.Data;
import lombok.NoArgsConstructor;

/** The connected player's side of a booster-mode room. */
@Data
@NoArgsConstructor
public class BoosterStateDTO {
    private String setName;
    private int boosterCount;
    private int openedBoosters;
    private int minMainDeckSize;
    private int maxMainDeckSize;
    private int maxExtraDeckSize;
    private boolean ready;
    /** Every card pulled so far, ordered by booster then slot. */
    private List<PulledCardDTO> cards;
}
