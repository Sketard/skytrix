package com.skytrix.model.dto.deck;

import com.skytrix.model.dto.card.CardImageDTO;

import lombok.Data;

@Data
public class IndexedCardImageDTO {
    private int index;
    private CardImageDTO image;
}
