package com.skytrix.model.dto.card;

import lombok.Data;

import java.util.List;

import static org.springframework.util.StringUtils.hasText;

@Data
public class CardSetFilterDTO {
    private List<String> cardSetNames;
    private String cardSetCode;
    private String cardRarityCode;

    public boolean isNotEmpty() {
        return (cardSetNames != null && !cardSetNames.isEmpty())
            || hasText(cardSetCode)
            || hasText(cardRarityCode);
    }
}
