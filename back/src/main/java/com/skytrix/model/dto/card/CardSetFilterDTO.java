package com.skytrix.model.dto.card;

import lombok.Data;

import static org.springframework.util.StringUtils.hasText;

@Data
public class CardSetFilterDTO {
    private String cardSetName;
    private String cardSetCode;
    private String cardRarityCode;

    public boolean isNotEmpty() {
        return hasText(cardSetName) || hasText(cardSetCode) || hasText(cardRarityCode);
    }
}
