package com.skytrix.model.dto.card;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class CardImageDTO {
    private Long id;
    private Long imageId;
    private String url;
    private String smallUrl;
    private Long cardId;
}
