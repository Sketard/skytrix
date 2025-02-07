package com.skytrix.model.dto.card;

import lombok.Data;

@Data
public class CardPossessedDTO {
    private CardImageDTO cardImage;
    private CardDTO card;
    private CardSetDTO cardSet;
    private int number;
}
