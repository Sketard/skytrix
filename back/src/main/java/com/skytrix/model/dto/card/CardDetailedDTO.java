package com.skytrix.model.dto.card;

import java.util.List;

import lombok.Data;

@Data
public class CardDetailedDTO {
    private List<CardSetDTO> sets;
    private List<CardImageDTO> images;
    private CardDTO card;
    private boolean favorite;
}
