package com.skytrix.model.dto.card;

import lombok.Data;

import java.util.List;

@Data
public class UpdatePossessedCardDTO {
    private List<ShortCardPossessedDTO> cards;
}
