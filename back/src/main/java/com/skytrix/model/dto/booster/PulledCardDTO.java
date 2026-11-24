package com.skytrix.model.dto.booster;

import com.skytrix.model.dto.card.CardDetailedDTO;
import com.skytrix.model.enums.DeckKeyword;

import lombok.Data;
import lombok.NoArgsConstructor;

/** One card pulled from a booster; {@code id} identifies this copy. */
@Data
@NoArgsConstructor
public class PulledCardDTO {
    private Long id;
    private int boosterIndex;
    private int slotIndex;
    private CardDetailedDTO card;
    private DeckKeyword deckZone;
    private Integer deckIndex;
}
