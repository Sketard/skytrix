package com.skytrix.model.dto.deck;

import com.skytrix.model.dto.card.CardDetailedDTO;

import lombok.Data;

@Data
public class IndexedCardDetailDTO {
    private int index;
    private CardDetailedDTO card;
}
