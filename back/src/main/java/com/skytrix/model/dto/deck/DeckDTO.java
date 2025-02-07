package com.skytrix.model.dto.deck;

import java.util.List;

import lombok.Data;

@Data
public class DeckDTO {
    private Long id;
    private String name;
    private List<IndexedCardImageDTO> images;
    private List<IndexedCardDetailDTO> mainDeck;
    private List<IndexedCardDetailDTO> extraDeck;
    private List<IndexedCardDetailDTO> sideDeck;
}
