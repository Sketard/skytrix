package com.skytrix.model.dto.card;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class CardSetDTO {
    private Long id;
    private String name;
    private String code;
    private String rarity;
    private String rarityCode;
    private float price;
    private long cardId;
}
